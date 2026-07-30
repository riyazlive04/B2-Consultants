-- ER v2 Track B — Sessions and coursework.
--
-- gn_event already held the diagram's exact session vocabulary (KICKOFF / COACHING /
-- LINKEDIN / QA / OPEN_MARKET). It is promoted, not replaced.
--
-- The table is `class_session`, NOT `session`: `session` is Better Auth's login-session
-- table. Same collision, same resolution as LedgerAccount vs Better Auth's `account`.

-- ── 1. gn_event → class_session ───────────────────────────────────────────────
ALTER TABLE "gn_event" RENAME TO "class_session";
ALTER TABLE "class_session" RENAME CONSTRAINT "gn_event_pkey" TO "class_session_pkey";
ALTER TABLE "class_session" RENAME CONSTRAINT "gn_event_batchId_fkey" TO "class_session_batchId_fkey";
ALTER TABLE "class_session" RENAME CONSTRAINT "gn_event_createdById_fkey" TO "class_session_createdById_fkey";
ALTER INDEX "gn_event_batchId_startsAt_idx" RENAME TO "class_session_batchId_startsAt_idx";

-- SESSION ||--o| RECORDING. Unique: a recording is of at most one session.
ALTER TABLE "class_session" ADD COLUMN "recordingId" TEXT;
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_recordingId_fkey"
  FOREIGN KEY ("recordingId") REFERENCES "gn_recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "class_session_recordingId_key" ON "class_session"("recordingId");

-- ── 2. Coursework ─────────────────────────────────────────────────────────────
CREATE TYPE "SessionTaskType" AS ENUM ('WATCH_VIDEO', 'APPLY_JOB', 'HOMEWORK', 'OTHER');

CREATE TABLE "session_task" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "SessionTaskType" NOT NULL DEFAULT 'HOMEWORK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "recordingId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "session_task_pkey" PRIMARY KEY ("id")
);

-- Reuses the shipped TaskCompletion enum (YES / NO / PENDING) rather than inventing a
-- parallel vocabulary for the same idea.
CREATE TABLE "session_task_completion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "TaskCompletion" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "autoCompleted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "session_task_completion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "session_task_sessionId_orderIndex_idx" ON "session_task"("sessionId", "orderIndex");
CREATE INDEX "session_task_recordingId_idx" ON "session_task"("recordingId");
CREATE INDEX "session_task_completion_studentId_status_idx" ON "session_task_completion"("studentId", "status");
CREATE UNIQUE INDEX "session_task_completion_taskId_studentId_key" ON "session_task_completion"("taskId", "studentId");

ALTER TABLE "session_task" ADD CONSTRAINT "session_task_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "class_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_task" ADD CONSTRAINT "session_task_recordingId_fkey"
  FOREIGN KEY ("recordingId") REFERENCES "gn_recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "session_task_completion" ADD CONSTRAINT "session_task_completion_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "session_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_task_completion" ADD CONSTRAINT "session_task_completion_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
