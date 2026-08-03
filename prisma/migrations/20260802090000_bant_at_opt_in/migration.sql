-- BANT at opt-in (Application Logic §4.3 stage 1) + the L1 desk's working-set index.
--
-- Additive only: every column is nullable or defaulted, no existing row is rewritten, and
-- nothing that reads today changes shape. Safe to apply to a live database with traffic on it.

-- Which stage produced a lead's score. MANUAL outranks both form stages, so a redelivered
-- webhook can never overwrite a specialist's own judgement.
CREATE TYPE "BantSource" AS ENUM ('OPT_IN', 'BOOKING', 'MANUAL');

-- ── Lead: the band score as of the LANDING PAGE ─────────────────────────────────────────
-- BANT previously existed only on `booking_request`, which only the in-app /book form creates,
-- so a landing-page lead relayed by Pabbly arrived with its qualification answers in the payload
-- and nowhere to put them.
--
-- The four dimension booleans are NULLABLE here, unlike their `booking_request` counterparts
-- which default to false. That is safe there because a row only exists once a form was
-- submitted; here most leads are never scored at all, and "no evidence for Budget" must not read
-- as "they have no budget".
ALTER TABLE "lead" ADD COLUMN "bantBudget"    BOOLEAN;
ALTER TABLE "lead" ADD COLUMN "bantAuthority" BOOLEAN;
ALTER TABLE "lead" ADD COLUMN "bantNeed"      BOOLEAN;
ALTER TABLE "lead" ADD COLUMN "bantTimeline"  BOOLEAN;
ALTER TABLE "lead" ADD COLUMN "bantScore"     INTEGER;
ALTER TABLE "lead" ADD COLUMN "bantAvg"       DOUBLE PRECISION;
ALTER TABLE "lead" ADD COLUMN "bantVerdict"   "BantVerdict";
ALTER TABLE "lead" ADD COLUMN "bantScoredAt"  TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "bantSource"    "BantSource";

-- The sender's answers verbatim, plus what we made of them. Both the evidence and the debugging
-- surface: when a landing-page question is reworded and stops matching the catalogue, Console
-- reads this to show which fields arrived unrecognised instead of the score silently reading 0.
ALTER TABLE "lead" ADD COLUMN "intakeAnswers" JSONB;

-- ── The L1 desk's working set ───────────────────────────────────────────────────────────
-- "My open leads, newest first" and "my leads created this month" both filter on assignedToId
-- AND range/order on createdAt. The existing single-column assignedToId index could only narrow
-- to the owner and then had to sort the remainder — after the 23,430-lead hand-out, most of the
-- table per caller.
CREATE INDEX "lead_assignedToId_createdAt_idx" ON "lead"("assignedToId", "createdAt");

-- ── Inbound mapping on the question catalogue ───────────────────────────────────────────
-- How an external form's vocabulary is recognised as one of our questions. Founder-editable at
-- Console → Qualification, because the landing page posts its own field names and its own answer
-- wording and both change whenever marketing rewrites the page.
--
-- DELIBERATELY NOT inside `options`: the qualification_question_version_guard trigger treats
-- `options` as immutable once answered, so an alias stored there could only be added by spawning
-- a new question version. Recognising that the page now says "Right away" for an option that
-- already meant `immediately` changes nothing about what was asked or what it scored — it is a
-- parsing rule, not evidence. Neither column below is in the trigger's field list, so both stay
-- editable in place on an answered question.
ALTER TABLE "qualification_question"
  ADD COLUMN "inboundKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "qualification_question" ADD COLUMN "answerAliases" JSONB;
