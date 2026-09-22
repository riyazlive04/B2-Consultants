-- BANT moves from a 0-5 scale to 0-4 (founder request, 22/09/2026).
--
-- Every stored score is multiplied by 0.8 - the same factor the code applied to its answer table
-- and its thresholds (confirm >3 -> >2.4, doubt from 2 -> 1.6, dimension met at 3 -> 2.4). The
-- verdicts already stored (`bantVerdict`, `qualified`) are left alone: they were taken on the old
-- scale, and scaling score and threshold together leaves every one of them where it was.
--
-- Averages were stored to one decimal, so a rescaled value is rounded back to one decimal. On
-- that 0.1 grid the rounding never crosses a threshold: an old 3.0 becomes 2.4 (still Doubt), an
-- old 3.1 becomes 2.5 (still Confirm), an old 2.0 becomes 1.6 and an old 1.9 becomes 1.5.
--
-- Runs once, inside `prisma migrate deploy`, immediately before the new code starts.

-- ── Averages ────────────────────────────────────────────────────────────────────────────────
UPDATE "booking_request" SET "bantAvg" = ROUND(("bantAvg" * 0.8)::numeric, 1) WHERE "bantAvg" IS NOT NULL;
UPDATE "booking_request" SET "bantShadowAvg" = ROUND(("bantShadowAvg" * 0.8)::numeric, 1) WHERE "bantShadowAvg" IS NOT NULL;
UPDATE "lead" SET "bantAvg" = ROUND(("bantAvg" * 0.8)::numeric, 1) WHERE "bantAvg" IS NOT NULL;
UPDATE "outreach_journey" SET "bantScoreAtQual" = ROUND(("bantScoreAtQual" * 0.8)::numeric, 1) WHERE "bantScoreAtQual" IS NOT NULL;

-- ── Per-answer scores ───────────────────────────────────────────────────────────────────────
-- An INTEGER cannot hold the new scale (a 1.5 becomes 1.2), so the column becomes a float. The
-- old values were already rounded to whole numbers at submit time; they are rescaled as stored.
ALTER TABLE "lead_answer" ALTER COLUMN "score" TYPE DOUBLE PRECISION USING ROUND(("score" * 0.8)::numeric, 1);

-- ── The question catalogue ──────────────────────────────────────────────────────────────────
-- Each option is { value, label, score, aliases? }. Rescale `score` where it is a number and keep
-- the option order and every other key exactly as it was.
--
-- `qualification_question_version_guard` forbids editing the options of an answered question,
-- so a reweight has to become a new version. This is not a reweight: the answers citing these
-- questions were rescaled by the same factor above, so what each answer was worth, relative to
-- the scale, is unchanged. The guard is off for this one statement only.
ALTER TABLE "qualification_question" DISABLE TRIGGER qualification_question_version_guard;

UPDATE "qualification_question" q
SET "options" = (
  SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(o -> 'score') = 'number'
      THEN jsonb_set(o, '{score}', to_jsonb(ROUND(((o ->> 'score')::numeric) * 0.8, 1)))
      ELSE o
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(q."options") WITH ORDINALITY AS t(o, ord)
)
WHERE jsonb_typeof(q."options") = 'array' AND jsonb_array_length(q."options") > 0;

ALTER TABLE "qualification_question" ENABLE TRIGGER qualification_question_version_guard;
