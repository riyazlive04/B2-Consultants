-- ER v2 Track D — configurable qualification questions.
--
-- ADDITIVE ONLY. The 18 hardcoded columns on booking_request are untouched: the public form
-- keeps writing them, lib/bant.ts keeps reading them, and nothing about today's scoring
-- changes when this migration lands. The catalogue runs in SHADOW until a full historical
-- replay shows zero disagreements (see docs/ER_V2_ALIGNMENT_PLAN.md §6.2).
--
-- D5 was answered VERSIONED: an edit creates (key, version+1) and leaves answered versions
-- alone, so a re-tune can never rewrite why we called someone.

CREATE TYPE "BantDimension" AS ENUM ('BUDGET', 'AUTHORITY', 'NEED', 'TIMELINE', 'NONE');
CREATE TYPE "QuestionKind" AS ENUM ('TEXT', 'LONG_TEXT', 'SELECT', 'MULTI_SELECT', 'BOOLEAN', 'NUMBER');

CREATE TABLE "qualification_question" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "helpText" TEXT,
    "kind" "QuestionKind" NOT NULL DEFAULT 'SELECT',
    "options" JSONB,
    "dimension" "BantDimension" NOT NULL DEFAULT 'NONE',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "qualification_question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_answer" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "bookingRequestId" TEXT,
    "questionId" TEXT NOT NULL,
    "answerRaw" TEXT NOT NULL,
    "score" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_answer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qualification_question_key_version_key" ON "qualification_question"("key", "version");
CREATE INDEX "qualification_question_active_orderIndex_idx" ON "qualification_question"("active", "orderIndex");
CREATE UNIQUE INDEX "lead_answer_bookingRequestId_questionId_key" ON "lead_answer"("bookingRequestId", "questionId");
CREATE INDEX "lead_answer_leadId_idx" ON "lead_answer"("leadId");
CREATE INDEX "lead_answer_questionId_idx" ON "lead_answer"("questionId");

ALTER TABLE "lead_answer" ADD CONSTRAINT "lead_answer_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_answer" ADD CONSTRAINT "lead_answer_bookingRequestId_fkey"
  FOREIGN KEY ("bookingRequestId") REFERENCES "booking_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT, not Cascade: a question that has been answered may be retired (active = false)
-- but must never be deleted out from under the answers that cite it. The wording IS the
-- evidence for the verdict.
ALTER TABLE "lead_answer" ADD CONSTRAINT "lead_answer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "qualification_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cutover instrumentation on the booking. Both nullable; neither is read by any decision.
ALTER TABLE "booking_request" ADD COLUMN "bantShadowAvg" DOUBLE PRECISION;
ALTER TABLE "booking_request" ADD COLUMN "bantConfigVersion" INTEGER;

-- Versions of a question are immutable once answered. Without this, "edit creates v+1" is a
-- convention in one server action rather than a property of the data.
CREATE OR REPLACE FUNCTION forbid_answered_question_edit() RETURNS trigger AS $$
BEGIN
  IF (NEW."text"      IS DISTINCT FROM OLD."text"
   OR NEW."options"   IS DISTINCT FROM OLD."options"
   OR NEW."dimension" IS DISTINCT FROM OLD."dimension"
   OR NEW."weight"    IS DISTINCT FROM OLD."weight"
   OR NEW."kind"      IS DISTINCT FROM OLD."kind")
   AND EXISTS (SELECT 1 FROM "lead_answer" WHERE "questionId" = OLD."id") THEN
    RAISE EXCEPTION 'qualification_question %: already answered — create a new version instead', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qualification_question_version_guard
  BEFORE UPDATE ON "qualification_question"
  FOR EACH ROW EXECUTE FUNCTION forbid_answered_question_edit();
