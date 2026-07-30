-- ER v2 Track I — per-program milestones with a target day.
--
-- The `Milestone` enum stays as the stable key and `milestone_log` stays as the append-only
-- audit trail — nothing here weakens either. What this adds is the diagram's `target_day`,
-- per program level, so the at-risk radar has a real deadline instead of a vibe, and
-- "is Priya on track for day 45" becomes answerable without replaying the log.

CREATE TYPE "MilestoneProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED');

CREATE TABLE "program_milestone" (
    "id" TEXT NOT NULL,
    "levelCode" TEXT NOT NULL,
    "key" "Milestone" NOT NULL,
    "name" TEXT NOT NULL,
    "targetDay" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "program_milestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "milestone_progress" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "status" "MilestoneProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "achievedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "milestone_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_milestone_levelCode_key_key" ON "program_milestone"("levelCode", "key");
CREATE INDEX "program_milestone_levelCode_orderIndex_idx" ON "program_milestone"("levelCode", "orderIndex");
CREATE UNIQUE INDEX "milestone_progress_enrollmentId_milestoneId_key" ON "milestone_progress"("enrollmentId", "milestoneId");
CREATE INDEX "milestone_progress_status_idx" ON "milestone_progress"("status");

ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "program_milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
