-- THE WEEKLY REPORT: six tables, six enums, three WhatsApp kinds, and the two templates
-- the founders' tracker implies.
--
-- Additive only, and hand-written for the same reason as the migrations before it:
-- `migrate dev` generates destructive drop-and-re-add diffs for enum changes on this
-- schema. Every statement is guarded so a partial run can be repeated.
--
-- The seed at the bottom is part of the migration rather than a script because a cohort
-- cannot be asked anything until a template exists, and a feature that ships needing a
-- manual setup step before it does anything at all is a feature that ships off.

-- ── Enums ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE "WeeklyQuestionKind" AS ENUM ('NUMBER', 'SCALE', 'SINGLE_SELECT', 'MULTI_SELECT', 'YES_NO', 'TEXT', 'LONG_TEXT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "WeeklyMetric" AS ENUM ('APPLICATIONS', 'INTERVIEWS', 'NETWORKING', 'LINKEDIN_POSTS', 'LEARNING_HOURS', 'BLOCKERS', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "WeeklyCycleStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "WeeklyFlag" AS ENUM ('GREEN', 'YELLOW', 'RED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "WeeklyAction" AS ENUM ('NONE', 'MESSAGE_SENT', 'CALL_SCHEDULED', 'ESCALATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "WeeklyResponseSource" AS ENUM ('STUDENT', 'STAFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Three kinds, not one, because WATI binds exactly one template per kind and an
-- invitation, a nudge and a you-have-missed-it are three different messages.
-- IF NOT EXISTS keeps a re-run harmless; none of these values is USED in this
-- transaction, which is what makes adding them here safe at all.
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'WEEKLY_REPORT_LINK';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'WEEKLY_REPORT_REMINDER';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'WEEKLY_REPORT_MISSING';

-- ── Tables ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "weekly_report_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "line" "BatchLine" NOT NULL,
    "levelCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_report_template_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_report_question" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" "WeeklyQuestionKind" NOT NULL,
    "metric" "WeeklyMetric" NOT NULL DEFAULT 'OTHER',
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "allowOther" BOOLEAN NOT NULL DEFAULT false,
    "min" INTEGER,
    "max" INTEGER,
    "targetNumeric" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_report_question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_report_cycle" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "batchWeekNumber" INTEGER,
    "status" "WeeklyCycleStatus" NOT NULL DEFAULT 'OPEN',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_report_cycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_report_response" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "source" "WeeklyResponseSource" NOT NULL DEFAULT 'STUDENT',
    "enteredById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_report_response_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_report_answer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "numeric" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_report_answer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_report_review" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "flag" "WeeklyFlag",
    "action" "WeeklyAction" NOT NULL DEFAULT 'NONE',
    "followUpNeeded" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "shareWithStudent" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_report_review_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "weekly_report_template_line_active_idx" ON "weekly_report_template"("line", "active");
CREATE INDEX IF NOT EXISTS "weekly_report_question_templateId_active_orderIndex_idx" ON "weekly_report_question"("templateId", "active", "orderIndex");
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_report_question_templateId_key_version_key" ON "weekly_report_question"("templateId", "key", "version");
CREATE INDEX IF NOT EXISTS "weekly_report_cycle_status_closesAt_idx" ON "weekly_report_cycle"("status", "closesAt");
CREATE INDEX IF NOT EXISTS "weekly_report_cycle_batchId_weekStart_idx" ON "weekly_report_cycle"("batchId", "weekStart");
-- THE IDEMPOTENCY GUARD for the cron: one cohort, one week, one cycle.
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_report_cycle_batchId_isoWeek_key" ON "weekly_report_cycle"("batchId", "isoWeek");
CREATE INDEX IF NOT EXISTS "weekly_report_response_studentId_submittedAt_idx" ON "weekly_report_response"("studentId", "submittedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_report_response_cycleId_studentId_key" ON "weekly_report_response"("cycleId", "studentId");
CREATE INDEX IF NOT EXISTS "weekly_report_answer_questionId_idx" ON "weekly_report_answer"("questionId");
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_report_answer_responseId_questionId_key" ON "weekly_report_answer"("responseId", "questionId");
CREATE INDEX IF NOT EXISTS "weekly_report_review_studentId_reviewedAt_idx" ON "weekly_report_review"("studentId", "reviewedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_report_review_cycleId_studentId_key" ON "weekly_report_review"("cycleId", "studentId");

-- ── A cohort may be asked its own questions ──────────────────────────────────────────
-- Two cohorts on the same level can be running different activities, and the level was the
-- only lever before this. Null means "work it out from the line and level".

ALTER TABLE "batch" ADD COLUMN IF NOT EXISTS "weeklyTemplateId" TEXT;
CREATE INDEX IF NOT EXISTS "batch_weeklyTemplateId_idx" ON "batch"("weeklyTemplateId");

DO $$ BEGIN
    ALTER TABLE "batch" ADD CONSTRAINT "batch_weeklyTemplateId_fkey"
        FOREIGN KEY ("weeklyTemplateId") REFERENCES "weekly_report_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── The send log learns about cohort-weeks ───────────────────────────────────────────
-- Exactly the same device as `classSessionId` on this table: it is how the engine answers
-- "has this student already had this week's link" from durable state rather than from memory.

ALTER TABLE "whatsapp_message" ADD COLUMN IF NOT EXISTS "weeklyCycleId" TEXT;
CREATE INDEX IF NOT EXISTS "whatsapp_message_weeklyCycleId_kind_idx" ON "whatsapp_message"("weeklyCycleId", "kind");

DO $$ BEGIN
    ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_weeklyCycleId_fkey"
        FOREIGN KEY ("weeklyCycleId") REFERENCES "weekly_report_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Foreign keys ─────────────────────────────────────────────────────────────────────
-- Actor links are SET NULL so deleting a staff account never deletes a student's answers;
-- `reviewedById` is the exception and cascades, because a review with no reviewer is an
-- anonymous verdict on a student and there is no honest way to render one.

DO $$ BEGIN
    ALTER TABLE "weekly_report_template" ADD CONSTRAINT "weekly_report_template_levelCode_fkey"
        FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_template" ADD CONSTRAINT "weekly_report_template_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_question" ADD CONSTRAINT "weekly_report_question_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "weekly_report_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_cycle" ADD CONSTRAINT "weekly_report_cycle_batchId_fkey"
        FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_cycle" ADD CONSTRAINT "weekly_report_cycle_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "weekly_report_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_cycle" ADD CONSTRAINT "weekly_report_cycle_openedById_fkey"
        FOREIGN KEY ("openedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_response" ADD CONSTRAINT "weekly_report_response_cycleId_fkey"
        FOREIGN KEY ("cycleId") REFERENCES "weekly_report_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_response" ADD CONSTRAINT "weekly_report_response_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_response" ADD CONSTRAINT "weekly_report_response_enrollmentId_fkey"
        FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_response" ADD CONSTRAINT "weekly_report_response_enteredById_fkey"
        FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_answer" ADD CONSTRAINT "weekly_report_answer_responseId_fkey"
        FOREIGN KEY ("responseId") REFERENCES "weekly_report_response"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_answer" ADD CONSTRAINT "weekly_report_answer_questionId_fkey"
        FOREIGN KEY ("questionId") REFERENCES "weekly_report_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_review" ADD CONSTRAINT "weekly_report_review_cycleId_fkey"
        FOREIGN KEY ("cycleId") REFERENCES "weekly_report_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_review" ADD CONSTRAINT "weekly_report_review_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "weekly_report_review" ADD CONSTRAINT "weekly_report_review_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Seed: the two templates the tracker implies ───────────────────────────────────────
-- The B2 question set is read off the live Sprint Tracker's own values, not invented: the
-- targets (10 applications, 7 contacts, 7 posts) are the Red Flag System's thresholds, the
-- learning-hour buckets and all eight blockers are the exact strings students have been
-- choosing, and `allowOther` is on because free text is ALREADY appearing in that column.
--
-- Fixed ids rather than generated ones so this block is re-runnable and so a later
-- migration can refer to these rows.

INSERT INTO "weekly_report_template" ("id", "name", "description", "line", "levelCode", "active", "createdAt", "updatedAt")
VALUES
    ('wrtpl_b2_sprint', 'B2 weekly sprint report',
     'The weekly progress report for coaching students on the 90/120-day sprint.',
     'B2', NULL, true, now(), now()),
    ('wrtpl_gn_weekly', 'German Note weekly check-in',
     'A shorter weekly check-in for German Note cohorts: study time, confidence, blockers.',
     'GERMAN_NOTE', NULL, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "weekly_report_question"
    ("id", "templateId", "key", "version", "kind", "metric", "label", "helpText",
     "required", "orderIndex", "options", "allowOther", "min", "max", "targetNumeric",
     "active", "createdAt", "updatedAt")
VALUES
    ('wrq_b2_applications', 'wrtpl_b2_sprint', 'applications', 1, 'NUMBER', 'APPLICATIONS',
     'How many job applications did you send this week?',
     'Count every application you actually submitted. The target is 10 a week.',
     true, 0, NULL, false, 0, 500, 10, true, now(), now()),

    ('wrq_b2_interviews', 'wrtpl_b2_sprint', 'interviews', 1, 'NUMBER', 'INTERVIEWS',
     'How many interviews did you have this week?',
     'Any call with a company about a role counts, including a first screening call.',
     true, 1, NULL, false, 0, 50, NULL, true, now(), now()),

    ('wrq_b2_learning_hours', 'wrtpl_b2_sprint', 'learning_hours', 1, 'SINGLE_SELECT', 'LEARNING_HOURS',
     'How many hours did you spend on German this week?',
     NULL, true, 2,
     $json$[{"value":"0","label":"None this week","numeric":0},
            {"value":"1-2","label":"1-2 hours","numeric":1},
            {"value":"3-5","label":"3-5 hours","numeric":3},
            {"value":"6-10","label":"6-10 hours","numeric":6},
            {"value":"10+","label":"10+ hours","numeric":10}]$json$::jsonb,
     false, NULL, NULL, NULL, true, now(), now()),

    ('wrq_b2_networking', 'wrtpl_b2_sprint', 'networking', 1, 'NUMBER', 'NETWORKING',
     'How many new networking contacts did you make this week?',
     'Connection requests with a personal message, plus comments on recruiter or company posts. The target is 7.',
     true, 3, NULL, false, 0, 500, 7, true, now(), now()),

    ('wrq_b2_linkedin_posts', 'wrtpl_b2_sprint', 'linkedin_posts', 1, 'NUMBER', 'LINKEDIN_POSTS',
     'How many posts did you publish on LinkedIn or Xing this week?',
     'The target is 7 - visibility is what makes German recruiters find you.',
     true, 4, NULL, false, 0, 200, 7, true, now(), now()),

    ('wrq_b2_blockers', 'wrtpl_b2_sprint', 'blockers', 1, 'SINGLE_SELECT', 'BLOCKERS',
     'What got in your way this week?',
     'Be honest - this is the question your coach reads first.',
     true, 5,
     $json$[{"value":"none","label":"No blockers - I'm on track"},
            {"value":"no_postings","label":"Can't find relevant job postings"},
            {"value":"german_requirements","label":"Struggling with German requirements in job listings"},
            {"value":"demotivated","label":"Feeling demotivated or overwhelmed"},
            {"value":"no_time","label":"Didn't have enough time this week"},
            {"value":"no_responses","label":"LinkedIn/Xing not getting responses"},
            {"value":"awaiting_company","label":"Waiting on a response from a company"},
            {"value":"resume","label":"Resume/CV needs improvement"}]$json$::jsonb,
     true, NULL, NULL, NULL, true, now(), now()),

    ('wrq_b2_wins', 'wrtpl_b2_sprint', 'wins', 1, 'LONG_TEXT', 'OTHER',
     'Anything you want your coach to know?',
     'A win worth celebrating, or something you need help with. Optional.',
     false, 6, NULL, false, NULL, NULL, NULL, true, now(), now()),

    -- German Note: the same shape, three questions, no job-search columns. A cohort
    -- learning A1 grammar is not sending applications, and asking them would produce a
    -- column of zeroes that the flag engine would then read as failure.
    ('wrq_gn_learning_hours', 'wrtpl_gn_weekly', 'learning_hours', 1, 'SINGLE_SELECT', 'LEARNING_HOURS',
     'How many hours did you study German outside class this week?',
     NULL, true, 0,
     $json$[{"value":"0","label":"None this week","numeric":0},
            {"value":"1-2","label":"1-2 hours","numeric":1},
            {"value":"3-5","label":"3-5 hours","numeric":3},
            {"value":"6-10","label":"6-10 hours","numeric":6},
            {"value":"10+","label":"10+ hours","numeric":10}]$json$::jsonb,
     false, NULL, NULL, NULL, true, now(), now()),

    ('wrq_gn_confidence', 'wrtpl_gn_weekly', 'confidence', 1, 'SCALE', 'OTHER',
     'How well did you follow this week''s classes?',
     '1 means you were lost, 5 means you followed everything comfortably.',
     true, 1, NULL, false, 1, 5, NULL, true, now(), now()),

    ('wrq_gn_blockers', 'wrtpl_gn_weekly', 'blockers', 1, 'SINGLE_SELECT', 'BLOCKERS',
     'What got in your way this week?',
     NULL, true, 2,
     $json$[{"value":"none","label":"No blockers - I'm keeping up"},
            {"value":"grammar","label":"Grammar is hard to follow"},
            {"value":"speaking","label":"Not enough speaking practice"},
            {"value":"attendance","label":"Couldn't attend the classes"},
            {"value":"homework","label":"Homework takes too long"},
            {"value":"no_time","label":"Didn't have enough time this week"}]$json$::jsonb,
     true, NULL, NULL, NULL, true, now(), now())
ON CONFLICT ("templateId", "key", "version") DO NOTHING;
