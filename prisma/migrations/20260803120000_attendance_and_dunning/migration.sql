-- Attendance, and the dunning ladder's durable state.
--
-- Two new tables and two new enums. Purely ADDITIVE: no existing table is altered, no row is
-- read, rewritten or backfilled, and nothing that reads today changes shape. Safe to apply to a
-- live database while it is serving.

-- ═══════════════════ 1. Attendance ═══════════════════
--
-- The gap: tutor fees are computed against `batch._count.members + _count.enrollments` — the
-- ROSTER. The business therefore pays per head enrolled while holding no record of heads
-- present, and both a behaviour-derived drop-risk signal and a no-show rate sit blocked behind
-- that absence.
--
-- LATE and EXCUSED are separate values rather than shades of ABSENT because a two-value enum
-- forces one of them to be a lie: a student 20 minutes late did attend, and a student excused
-- for a funeral did not attend but is not at risk. Folding either into ABSENT puts them in the
-- drop-risk list, which is the one list this data exists to produce.
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

CREATE TABLE "session_attendance" (
    "id"              TEXT NOT NULL,
    "sessionId"       TEXT NOT NULL,
    "studentId"       TEXT NOT NULL,
    -- NOT NULL and with no default: a sheet that was never opened has NO ROWS, which is a
    -- different and more honest state than a table full of PENDING. It also stops an unmarked
    -- session from silently counting against every student's attendance rate.
    "status"          "AttendanceStatus" NOT NULL,
    "minutesAttended" INTEGER,
    "note"            TEXT,
    "markedById"      TEXT,
    "markedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id")
);

-- Cascade from both parents: attendance is meaningless without the session it was taken at or
-- the student it was taken for, and an orphan row would silently distort every rate computed
-- off this table.
ALTER TABLE "session_attendance"
  ADD CONSTRAINT "session_attendance_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "class_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_attendance"
  ADD CONSTRAINT "session_attendance_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, matching every other actor link in this schema: removing a tutor's login must never
-- delete the evidence of who marked a register.
ALTER TABLE "session_attendance"
  ADD CONSTRAINT "session_attendance_markedById_fkey"
  FOREIGN KEY ("markedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One verdict per student per session. This is the register, not a log of edits — a correction
-- updates the row and the activity log carries the history. It is also what makes marking a
-- sheet idempotent, so a double-submit cannot create two conflicting answers.
CREATE UNIQUE INDEX "session_attendance_sessionId_studentId_key"
  ON "session_attendance"("sessionId", "studentId");

-- "This student's record across every batch" — the drop-risk read.
CREATE INDEX "session_attendance_studentId_status_idx"
  ON "session_attendance"("studentId", "status");

-- "Everyone at this session" — the marking sheet's own read.
CREATE INDEX "session_attendance_sessionId_idx" ON "session_attendance"("sessionId");


-- ═══════════════════ 2. Dunning ═══════════════════
--
-- The reminder this replaces deduped by string-matching its own subject line against the
-- `message` table (`subject LIKE 'Payment reminder%'`). That holds exactly until someone rewords
-- a subject — at which point every student who received the old wording is chased again.
-- Whether a rung of the ladder has been climbed is a fact, and facts belong in a row.
CREATE TYPE "DunningStage" AS ENUM ('UPCOMING', 'MISSED', 'FINAL');

CREATE TABLE "dunning_event" (
    "id"           TEXT NOT NULL,
    "instalmentId" TEXT NOT NULL,
    "stage"        "DunningStage" NOT NULL,
    -- Snapshotted, not read live from config: "why did this go by email" has to stay answerable
    -- after the founder changes the channel for that stage.
    "channel"      TEXT NOT NULL,
    "sentAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A stage recorded with delivered = false STILL blocks a re-send. Retrying on a Resend
    -- outage would flood the student the moment service came back.
    "delivered"    BOOLEAN NOT NULL DEFAULT false,
    "messageId"    TEXT,
    "note"         TEXT,

    CONSTRAINT "dunning_event_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dunning_event"
  ADD CONSTRAINT "dunning_event_instalmentId_fkey"
  FOREIGN KEY ("instalmentId") REFERENCES "instalment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- THE GUARANTEE. A stage that has fired cannot fire twice, so the daily cron, a manual run and a
-- retry after a crash all converge on the same outcome — which is what makes the ladder safe to
-- run on any cadence at all.
CREATE UNIQUE INDEX "dunning_event_instalmentId_stage_key"
  ON "dunning_event"("instalmentId", "stage");

-- "What did we send this week" — the founder's audit of an engine that talks to paying students.
CREATE INDEX "dunning_event_sentAt_idx" ON "dunning_event"("sentAt");
