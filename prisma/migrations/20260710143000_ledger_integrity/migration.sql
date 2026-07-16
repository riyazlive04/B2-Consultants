--- Ledger integrity (SPEC §10.1, §10.5).
---
--- The posting engine in src/server/ledger.ts already refuses an unbalanced entry, but
--- application code is the wrong place for the guarantee the whole product rests on:
--- "every money figure traces to a balanced journal entry" (SPEC §15). A future action,
--- a backfill script, or a hand-run SQL statement must be unable to leave the ledger
--- unbalanced. So the invariants live here.

--- ─────────────────── Row-level shape ───────────────────

--- Exactly one side per line, strictly positive, base amount on the same side.
--- A zero-amount line is not a fact about money; it is noise. Reject it.
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_one_sided" CHECK (
  ("debitMinor"  > 0 AND "baseDebitMinor"  > 0 AND "creditMinor" = 0 AND "baseCreditMinor" = 0)
  OR
  ("creditMinor" > 0 AND "baseCreditMinor" > 0 AND "debitMinor"  = 0 AND "baseDebitMinor"  = 0)
);

ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_fx_positive" CHECK ("fxRate" > 0);

--- INR is the base currency, so an INR line converts to itself at rate 1. If these two
--- ever disagree, some caller has invented a rate for the base currency.
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_inr_base_identity" CHECK (
  "currency" <> 'INR'
  OR ("fxRate" = 1 AND "baseDebitMinor" = "debitMinor" AND "baseCreditMinor" = "creditMinor")
);

ALTER TABLE "period_lock" ADD CONSTRAINT "period_lock_month_format"
  CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');

--- ─────────────────── Entry-level balance ───────────────────

--- Σ base debits = Σ base credits, and an entry has at least two lines.
--- Checked by id so both the line trigger and the entry trigger share one definition.
CREATE OR REPLACE FUNCTION assert_entry_balanced(p_entry_id TEXT) RETURNS void AS $$
DECLARE
  v_debit  NUMERIC;
  v_credit NUMERIC;
  v_lines  INT;
BEGIN
  -- The entry was removed inside this same transaction (only possible via a
  -- migration or a superuser bypassing the append-only guard). Nothing to assert.
  IF NOT EXISTS (SELECT 1 FROM "journal_entry" WHERE "id" = p_entry_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM("baseDebitMinor"), 0), COALESCE(SUM("baseCreditMinor"), 0), COUNT(*)
    INTO v_debit, v_credit, v_lines
    FROM "journal_line" WHERE "entryId" = p_entry_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'journal entry % has % line(s): double-entry needs at least two',
      p_entry_id, v_lines;
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debits % <> credits % (INR paise)',
      p_entry_id, v_debit, v_credit;
  END IF;
END;
$$ LANGUAGE plpgsql;

--- DEFERRABLE INITIALLY DEFERRED: an entry is balanced at COMMIT, not after each
--- INSERT. Otherwise the very first line of every entry would fail the check.
CREATE OR REPLACE FUNCTION journal_line_balance_check() RETURNS trigger AS $$
DECLARE
  v_entry_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_entry_id := OLD."entryId"; ELSE v_entry_id := NEW."entryId"; END IF;
  PERFORM assert_entry_balanced(v_entry_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_line_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_line"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_line_balance_check();

--- An entry inserted with no lines at all would never fire the line trigger above.
CREATE OR REPLACE FUNCTION journal_entry_balance_check() RETURNS trigger AS $$
BEGIN
  PERFORM assert_entry_balanced(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_entry_balanced"
  AFTER INSERT ON "journal_entry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balance_check();

--- ─────────────────── Period locking (SPEC §10.1) ───────────────────

--- Admin closes a month; nothing may be posted into it afterwards, so a backdated
--- entry can never restate a period Ameen has already read and acted on.
CREATE OR REPLACE FUNCTION forbid_posting_into_locked_period() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "period_lock" WHERE "month" = to_char(NEW."date", 'YYYY-MM')) THEN
    RAISE EXCEPTION 'accounting period % is locked: no entry may be posted into it',
      to_char(NEW."date", 'YYYY-MM');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--- UPDATE OF "date" only: voiding an entry inside a locked period changes `status`,
--- and that must stay possible for a court-ordered reversal.
CREATE TRIGGER "journal_entry_period_lock"
  BEFORE INSERT OR UPDATE OF "date" ON "journal_entry"
  FOR EACH ROW EXECUTE FUNCTION forbid_posting_into_locked_period();

--- ─────────────────── Immutability ───────────────────

--- History is corrected by posting a reversal, never by editing what was recorded.
--- `status` and `reversalOfId` are the only mutable columns — that IS the void path.
CREATE OR REPLACE FUNCTION journal_entry_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journal_entry is append-only: DELETE is not allowed (post a reversal)';
  END IF;
  IF (to_jsonb(OLD) - 'status' - 'reversalOfId')
     IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'reversalOfId') THEN
    RAISE EXCEPTION 'journal_entry is append-only: only status and reversalOfId may be updated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entry_append_only"
  BEFORE UPDATE OR DELETE ON "journal_entry"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();

--- Lines and the audit chain are absolutely immutable. forbid_mutation() is the
--- cascade-aware guard already used by milestone_log / signal_change_log / lead_stage_history.
CREATE TRIGGER "journal_line_append_only"
  BEFORE UPDATE OR DELETE ON "journal_line"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "audit_entry_append_only"
  BEFORE UPDATE OR DELETE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
