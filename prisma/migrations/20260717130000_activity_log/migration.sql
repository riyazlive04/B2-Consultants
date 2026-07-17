-- Who did what, when — one row per write action, across the whole app.
-- Separate from audit_entry on purpose: that chain is hash-linked and takes a global
-- advisory lock per append, so it can't carry a row per dial. See the model comment.

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_log_at_idx" ON "activity_log"("at");

-- CreateIndex
CREATE INDEX "activity_log_actorId_at_idx" ON "activity_log"("actorId", "at");

-- CreateIndex
CREATE INDEX "activity_log_section_at_idx" ON "activity_log"("section", "at");

-- CreateIndex
CREATE INDEX "activity_log_entityType_entityId_idx" ON "activity_log"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- APPEND-ONLY. A record of what someone did at 3pm is worth nothing if it can be edited
-- at 4pm, so the guarantee lives at the DB layer rather than in the service code.
--
-- The shared forbid_mutation() can't be reused here: it permits a cascaded DELETE but no
-- cascaded UPDATE, and this table's actorId is ON DELETE SET NULL — an UPDATE. Under
-- forbid_mutation() the FK would raise, and deleting a user would fail outright. This guard
-- allows exactly that one cascaded rewrite (actorId, at depth > 1) and nothing else: the
-- denormalised actorName/actorRole still name the person after their row is gone.
CREATE OR REPLACE FUNCTION activity_log_guard() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD; -- cascaded from deleting the parent entity
    END IF;
    -- The FK nulling actorId is the constraint doing its job, not a tamper. Any other
    -- column moving under cover of a cascade is.
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(OLD) - 'actorId') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'actorId')
       AND NEW."actorId" IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'activity_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_log_append_only
  BEFORE UPDATE OR DELETE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION activity_log_guard();
