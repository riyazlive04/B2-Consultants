-- Recording access windows, plus the two catch-up touchpoints.
--
-- Additive only, hand-written for the same reason as the four migrations before it: `migrate
-- dev` generates destructive drop-and-re-add diffs for enum changes on this schema. Every
-- statement is guarded so a partial run can be repeated.

-- How long the students may see a recording. NULL = no time limit, which is exactly how every
-- existing recording behaved, so there is nothing to backfill: leaving these null preserves the
-- lifetime access every cohort already had. The window only ever starts applying to recordings
-- posted (or edited) after a tutor makes a decision about it.
ALTER TABLE "gn_recording"
    ADD COLUMN IF NOT EXISTS "availableUntil" TIMESTAMP(3);

-- "Which recordings are about to expire" and the catch-up sweep both read on this column, and
-- the answer is almost always "none of them".
CREATE INDEX IF NOT EXISTS "gn_recording_availableUntil_idx"
    ON "gn_recording"("availableUntil");

-- Two values, added separately so each is idempotent on a re-run.
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'CLASS_ABSENCE';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'CLASS_CATCH_UP';
