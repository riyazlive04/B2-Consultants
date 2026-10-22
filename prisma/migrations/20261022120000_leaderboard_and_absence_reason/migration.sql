-- The sprint leaderboard, and the absence reason a coach has to ask for.
--
-- Additive only, hand-written like every migration on this schema (`migrate dev` generates
-- destructive drop-and-re-add diffs for enum changes here). Guarded so a partial run repeats.

-- ── 1. Why they missed it ────────────────────────────────────────────────────────────────
-- Four nullable columns, and `reasonAskedAt` is the one that carries the design: nothing is
-- asked of a student until a coach presses "Ask why". An always-on reason box on every absence
-- is a form nobody fills in, and the silence it produces reads exactly like not caring.
ALTER TABLE "session_attendance"
    ADD COLUMN IF NOT EXISTS "reasonAskedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reasonAskedById" TEXT,
    ADD COLUMN IF NOT EXISTS "reason" TEXT,
    ADD COLUMN IF NOT EXISTS "reasonAt" TIMESTAMP(3);

DO $$ BEGIN
    ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_reasonAskedById_fkey"
        FOREIGN KEY ("reasonAskedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- "Who have I asked and not heard back from" - the coach's only outstanding-question read.
CREATE INDEX IF NOT EXISTS "session_attendance_reasonAskedAt_idx"
    ON "session_attendance"("reasonAskedAt");

-- ── 2. The self-reported half of the leaderboard ─────────────────────────────────────────
-- Only the things the app has no other way of knowing. Attendance, watched recordings,
-- coursework, sprint weeks and applications are all read from the records that already own
-- them - a second copy here would be free to disagree with the screens that show them.
DO $$ BEGIN
    CREATE TYPE "SprintLogKind" AS ENUM ('HR_CONNECTION', 'HR_INTERVIEW', 'APPLICATION_REVIEWED', 'WIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SprintLogSource" AS ENUM ('STUDENT', 'COACH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "sprint_log_entry" (
    "id"           TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "kind"         "SprintLogKind" NOT NULL,
    "quantity"     INTEGER NOT NULL DEFAULT 1,
    -- The day it HAPPENED, in IST - not when it was typed. A student logging Friday's interview
    -- on Sunday belongs in Friday's week, or every weekly total and every cap is wrong.
    "occurredOn"   DATE NOT NULL,
    "company"      TEXT,
    "note"         TEXT,
    "source"       "SprintLogSource" NOT NULL DEFAULT 'STUDENT',
    "loggedById"   TEXT,
    -- SOFT removal. This row can decide a ranking, so a coach taking points off a named person
    -- has to be visible and reversible rather than silent. House pattern: lib/soft-delete.
    "deletedAt"    TIMESTAMP(3),
    "deletedById"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sprint_log_entry_pkey" PRIMARY KEY ("id")
);

-- The leaderboard's own read: one enrollment's active entries over a date range.
CREATE INDEX IF NOT EXISTS "sprint_log_entry_enrollmentId_occurredOn_idx"
    ON "sprint_log_entry"("enrollmentId", "occurredOn");
CREATE INDEX IF NOT EXISTS "sprint_log_entry_kind_occurredOn_idx"
    ON "sprint_log_entry"("kind", "occurredOn");

DO $$ BEGIN
    ALTER TABLE "sprint_log_entry" ADD CONSTRAINT "sprint_log_entry_enrollmentId_fkey"
        FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "sprint_log_entry" ADD CONSTRAINT "sprint_log_entry_loggedById_fkey"
        FOREIGN KEY ("loggedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "sprint_log_entry" ADD CONSTRAINT "sprint_log_entry_deletedById_fkey"
        FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A quantity of zero or below would be an entry that scores nothing while looking like one;
-- an unbounded one is a number box wired to the top of a board that names people. The weekly
-- cap in the leaderboard config is the real ceiling - this is the guard against a typo.
DO $$ BEGIN
    ALTER TABLE "sprint_log_entry" ADD CONSTRAINT "sprint_log_quantity_sane"
        CHECK ("quantity" >= 1 AND "quantity" <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
