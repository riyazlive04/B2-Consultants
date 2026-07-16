--- "At most one LIVE entry per source row."
---
--- The unique index this replaces said "at most one entry per source row, ever", which
--- made an edited Income unpostable: its first entry is voided (it stays, with its
--- sourceId, so the trail is traceable) and the restated entry needs the same sourceId.
---
--- The constraint we actually want is partial — unique among status='POSTED'. Prisma
--- cannot express that and would emit a DROP INDEX for it on the next `migrate dev`.
--- Prisma does not manage triggers, so the rule lives in one.

-- DropIndex
DROP INDEX "journal_entry_sourceType_sourceId_key";

-- CreateIndex
CREATE INDEX "journal_entry_sourceType_sourceId_idx" ON "journal_entry"("sourceType", "sourceId");

CREATE OR REPLACE FUNCTION forbid_duplicate_live_source() RETURNS trigger AS $$
BEGIN
  IF NEW."sourceId" IS NULL THEN
    RETURN NEW; -- MANUAL entries and reversals claim no source row
  END IF;

  -- Serialise concurrent posts of the same source row. Without this, two requests both
  -- see "no live entry" and both post — booking the same revenue twice, which is the
  -- single worst thing this ledger could do.
  PERFORM pg_advisory_xact_lock(hashtext(NEW."sourceType"::text || ':' || NEW."sourceId"));

  IF EXISTS (
    SELECT 1 FROM "journal_entry"
    WHERE "sourceType" = NEW."sourceType"
      AND "sourceId"   = NEW."sourceId"
      AND "status"     = 'POSTED'
      AND "id"        <> NEW."id"
  ) THEN
    RAISE EXCEPTION '% % already has a live journal entry: void it before re-posting',
      NEW."sourceType", NEW."sourceId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entry_one_live_source"
  BEFORE INSERT ON "journal_entry"
  FOR EACH ROW EXECUTE FUNCTION forbid_duplicate_live_source();
