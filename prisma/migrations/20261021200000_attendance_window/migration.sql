-- The attendance window: self check-in, and a publish gate on what the cohort may read.
--
-- Additive only, and hand-written for the same reason as the three migrations before it:
-- `migrate dev` generates destructive drop-and-re-add diffs for enum changes on this schema.
-- Every statement is guarded so a partial run can be repeated.

-- Who put a mark here - the student, or the person teaching. Defaults to TUTOR, which is the
-- truth for every row that already exists: before this migration the only way to be marked
-- was for somebody to open the sheet and tick a box.
DO $$ BEGIN
    CREATE TYPE "AttendanceSource" AS ENUM ('TUTOR', 'SELF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "session_attendance"
    ADD COLUMN IF NOT EXISTS "source" "AttendanceSource" NOT NULL DEFAULT 'TUTOR',
    ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3);

ALTER TABLE "class_session"
    ADD COLUMN IF NOT EXISTS "attendanceOpensAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "attendanceClosesAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "attendanceOpenedById" TEXT,
    ADD COLUMN IF NOT EXISTS "attendanceGraceMins" INTEGER,
    ADD COLUMN IF NOT EXISTS "attendancePublishedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "attendancePublishedById" TEXT;

-- "Is any register open for me right now" runs on every student page load and the answer is
-- almost always no, so it has to be an index hit rather than a scan of every class ever held.
CREATE INDEX IF NOT EXISTS "class_session_attendanceClosesAt_idx"
    ON "class_session"("attendanceClosesAt");

DO $$ BEGIN
    ALTER TABLE "class_session" ADD CONSTRAINT "class_session_attendanceOpenedById_fkey"
        FOREIGN KEY ("attendanceOpenedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "class_session" ADD CONSTRAINT "class_session_attendancePublishedById_fkey"
        FOREIGN KEY ("attendancePublishedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── BACKFILL: every register that has already been taken counts as published ──────────────
--
-- This is the one statement in the migration that is not purely structural, and it is here to
-- avoid a silent REGRESSION rather than to add a feature. Students can already see their own
-- mark per class on /classroom; once the publish gate goes in, an unpublished session hides
-- it. Shipping without this backfill would therefore blank out attendance history that a
-- cohort was reading yesterday, with no action by anyone and nothing on screen to explain it.
--
-- `markedAt` of the last row is used as the publish time rather than `now()`: these registers
-- were effectively visible from the moment they were taken, and stamping them all with the
-- deploy time would claim a publishing event that never happened.
--
-- Sessions with no marks at all are left alone - there is nothing to publish, and a null here
-- is what lets a tutor's first real "Show to students" press mean something.
UPDATE "class_session" cs
SET "attendancePublishedAt" = sub."lastMarkedAt"
FROM (
    SELECT "sessionId", MAX("markedAt") AS "lastMarkedAt"
    FROM "session_attendance"
    GROUP BY "sessionId"
) sub
WHERE cs."id" = sub."sessionId"
  AND cs."attendancePublishedAt" IS NULL;
