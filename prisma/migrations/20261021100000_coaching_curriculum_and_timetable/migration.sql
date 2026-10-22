-- Coaching curriculum, per-batch timetable, and the COACH role.
--
-- Additive only: two new tables, one new enum, one new enum VALUE, and nullable columns on
-- three existing tables. Nothing is dropped and nothing is rewritten, so a rollback is
-- "stop reading the new columns" rather than a restore.
--
-- Hand-written rather than `migrate dev`-generated: on this schema that generator has produced
-- destructive drop-and-re-add diffs for enum changes, which on `Role` would mean dropping the
-- column every user's access hangs off.

-- A new value on an existing enum. Safe inside Prisma's transaction on PG12+ because nothing
-- in this migration USES the value - the first COACH account is created from the app.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COACH';

DO $$ BEGIN
    CREATE TYPE "SessionDelivery" AS ENUM ('LIVE', 'PRE_RECORDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "curriculum_template" (
    "id"          TEXT NOT NULL,
    "line"        "BatchLine" NOT NULL DEFAULT 'B2',
    "name"        TEXT NOT NULL,
    "levelCode"   TEXT,
    "description" TEXT,
    "sprintDays"  INTEGER DEFAULT 90,
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "curriculum_template_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "curriculum_template_line_active_idx" ON "curriculum_template"("line", "active");

CREATE TABLE IF NOT EXISTS "curriculum_item" (
    "id"           TEXT NOT NULL,
    "templateId"   TEXT NOT NULL,
    "weekNumber"   INTEGER NOT NULL,
    "orderIndex"   INTEGER NOT NULL DEFAULT 0,
    "title"        TEXT NOT NULL,
    "framework"    TEXT,
    "type"         "GnEventType" NOT NULL DEFAULT 'COACHING',
    "delivery"     "SessionDelivery" NOT NULL DEFAULT 'LIVE',
    "durationMins" INTEGER,
    "dayOfWeek"    INTEGER,
    "startTime"    TEXT,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "curriculum_item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_item_templateId_weekNumber_orderIndex_key"
    ON "curriculum_item"("templateId", "weekNumber", "orderIndex");
CREATE INDEX IF NOT EXISTS "curriculum_item_templateId_weekNumber_orderIndex_idx"
    ON "curriculum_item"("templateId", "weekNumber", "orderIndex");

DO $$ BEGIN
    ALTER TABLE "curriculum_item" ADD CONSTRAINT "curriculum_item_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "curriculum_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The batch's link to its curriculum, and the sprint start the founders' sheet carries as its
-- last row. Both nullable: every German Note batch has neither, and so does every B2 batch
-- created before this migration.
ALTER TABLE "batch" ADD COLUMN IF NOT EXISTS "curriculumTemplateId" TEXT;
ALTER TABLE "batch" ADD COLUMN IF NOT EXISTS "sprintStartDate" DATE;
CREATE INDEX IF NOT EXISTS "batch_curriculumTemplateId_idx" ON "batch"("curriculumTemplateId");
DO $$ BEGIN
    ALTER TABLE "batch" ADD CONSTRAINT "batch_curriculumTemplateId_fkey"
        FOREIGN KEY ("curriculumTemplateId") REFERENCES "curriculum_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Where a session sits in the programme. `delivery` defaults to LIVE, which is what every
-- existing German Note class already is, so the backfill is the default itself.
ALTER TABLE "class_session" ADD COLUMN IF NOT EXISTS "framework" TEXT;
ALTER TABLE "class_session" ADD COLUMN IF NOT EXISTS "weekNumber" INTEGER;
ALTER TABLE "class_session" ADD COLUMN IF NOT EXISTS "orderIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "class_session" ADD COLUMN IF NOT EXISTS "delivery" "SessionDelivery" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "class_session" ADD COLUMN IF NOT EXISTS "curriculumItemId" TEXT;
CREATE INDEX IF NOT EXISTS "class_session_batchId_weekNumber_orderIndex_idx"
    ON "class_session"("batchId", "weekNumber", "orderIndex");
CREATE INDEX IF NOT EXISTS "class_session_curriculumItemId_idx" ON "class_session"("curriculumItemId");
DO $$ BEGIN
    ALTER TABLE "class_session" ADD CONSTRAINT "class_session_curriculumItemId_fkey"
        FOREIGN KEY ("curriculumItemId") REFERENCES "curriculum_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The coach as an ACCOUNT, beside the name string that has carried the fact until now.
-- `assignedCoach` is deliberately left in place: it holds years of rows for coaches who never
-- had a login, and dropping it would erase them.
ALTER TABLE "enrollment" ADD COLUMN IF NOT EXISTS "coachId" TEXT;
CREATE INDEX IF NOT EXISTS "enrollment_coachId_status_idx" ON "enrollment"("coachId", "status");
DO $$ BEGIN
    ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_coachId_fkey"
        FOREIGN KEY ("coachId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill `coachId` from the name already on the row, where that name resolves to exactly one
-- active non-student account. Without this the coaching desk opens EMPTY for every coach on day
-- one, because every existing enrollment names its coach only as text.
--
-- Deliberately conservative: a name matching two accounts is left null. "We cannot say which
-- account this is" is the honest answer, and a wrong link would put somebody else's student on
-- a coach's desk. `assignedCoach` is untouched either way and stays the human record.
UPDATE "enrollment" e
   SET "coachId" = u."id"
  FROM "user" u
 WHERE e."coachId" IS NULL
   AND e."assignedCoach" IS NOT NULL
   AND btrim(e."assignedCoach") <> ''
   AND u."name" = btrim(e."assignedCoach")
   AND u."status" = 'ACTIVE'
   AND u."role" <> 'STUDENT'
   AND (
     SELECT count(*) FROM "user" u2
      WHERE u2."name" = btrim(e."assignedCoach")
        AND u2."status" = 'ACTIVE'
        AND u2."role" <> 'STUDENT'
   ) = 1;
