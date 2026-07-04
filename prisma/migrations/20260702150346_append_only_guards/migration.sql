-- APPEND-ONLY enforcement at the DATABASE layer (CONTEXT §6 / PRD2 §6).
-- The service layer never exposes update/delete on these tables; these triggers
-- make that guarantee hold even against raw SQL or a future coding mistake.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Milestone history: never editable, never deletable (incl. Admin).
CREATE TRIGGER milestone_log_append_only
  BEFORE UPDATE OR DELETE ON "milestone_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Signal-colour audit: every change is a new row, history is immutable.
CREATE TRIGGER signal_change_log_append_only
  BEFORE UPDATE OR DELETE ON "signal_change_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Lead stage history: immutable timeline behind pipeline/funnel metrics.
CREATE TRIGGER lead_stage_history_append_only
  BEFORE UPDATE OR DELETE ON "lead_stage_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Daily logs: never deletable. The ONLY permitted update is Admin appending a
-- correction note — the original numbers must stay intact (PRD2 §6).
CREATE OR REPLACE FUNCTION daily_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'daily_log is append-only: DELETE is not allowed';
  END IF;
  IF (to_jsonb(OLD) - 'correctionNote') IS DISTINCT FROM (to_jsonb(NEW) - 'correctionNote') THEN
    RAISE EXCEPTION 'daily_log is append-only: only correctionNote may be updated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_log_append_only
  BEFORE UPDATE OR DELETE ON "daily_log"
  FOR EACH ROW EXECUTE FUNCTION daily_log_guard();
