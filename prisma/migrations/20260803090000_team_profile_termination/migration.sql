-- Terminating a team member.
--
-- Additive only: four nullable columns and one index. No existing row is read, rewritten or
-- backfilled, and nothing that reads today changes shape. Safe to apply to a live database.

-- ── Why these columns and not `deletedAt` ───────────────────────────────────────────────
-- The nine core record types use the `deletedAt` soft-delete pattern, and the 90-day retention
-- cron PURGES what that pattern archives. A person's employment record must never be purged:
-- their name has to keep resolving on every call, commission, discovery outcome and audit row
-- they ever produced. So "former team member" is its own permanent, restorable state.
ALTER TABLE "team_profile" ADD COLUMN "terminatedAt"       TIMESTAMP(3);
ALTER TABLE "team_profile" ADD COLUMN "terminatedById"     TEXT;
ALTER TABLE "team_profile" ADD COLUMN "terminationReason"  TEXT;
-- Who picked up their open work. Recorded because the reassignment leaves no trace on the rows
-- it moved — without this, "why does Asma own this lead" stops being answerable.
ALTER TABLE "team_profile" ADD COLUMN "successorProfileId" TEXT;

-- SetNull, matching every other actor link in the schema: an admin leaving must not erase the
-- record of who offboarded whom.
ALTER TABLE "team_profile"
  ADD CONSTRAINT "team_profile_terminatedById_fkey"
  FOREIGN KEY ("terminatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The People page reads "former team members" as its own list.
CREATE INDEX "team_profile_terminatedAt_idx" ON "team_profile"("terminatedAt");
