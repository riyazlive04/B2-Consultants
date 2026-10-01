-- CreateTable
CREATE TABLE "lead_email" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lead_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_score_event" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" "BantSource" NOT NULL,
    "budget" BOOLEAN,
    "authority" BOOLEAN,
    "need" BOOLEAN,
    "timeline" BOOLEAN,
    "score" INTEGER,
    "avg" DOUBLE PRECISION,
    "verdict" "BantVerdict",
    "configVersion" INTEGER,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_score_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_email_emailKey_idx" ON "lead_email"("emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "lead_email_leadId_emailKey_key" ON "lead_email"("leadId", "emailKey");

-- CreateIndex
CREATE INDEX "lead_score_event_leadId_scoredAt_idx" ON "lead_score_event"("leadId", "scoredAt");

-- AddForeignKey
ALTER TABLE "lead_email" ADD CONSTRAINT "lead_email_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_score_event" ADD CONSTRAINT "lead_score_event_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Backfill ────────────────────────────────────────────────────────────────────────
--
-- Without this the history starts empty, so the feature only becomes useful the NEXT time each
-- prospect opts in - and the addresses we can already prove they used are sitting in two columns
-- doing nothing. Both sources are addresses a real person really submitted:
--
--   1. `lead.email`      - the address we currently write to.
--   2. `booking_request.email` - the address they used when they booked a call, which is exactly
--      where a changed address shows up first. A lead whose booking email differs from their lead
--      email is the reported bug, already in the data.
--
-- Additive and idempotent: ON CONFLICT DO NOTHING, no UPDATE, no DELETE. The lead's current
-- address goes in first so it wins the conflict and keeps its own spelling.

INSERT INTO "lead_email" ("id", "leadId", "email", "emailKey", "firstSeenAt", "lastSeenAt", "timesSeen")
SELECT gen_random_uuid()::text, l."id", btrim(l."email"), lower(btrim(l."email")), l."createdAt", l."updatedAt", 1
FROM "lead" l
WHERE l."email" IS NOT NULL AND btrim(l."email") <> ''
ON CONFLICT ("leadId", "emailKey") DO NOTHING;

INSERT INTO "lead_email" ("id", "leadId", "email", "emailKey", "firstSeenAt", "lastSeenAt", "timesSeen")
SELECT DISTINCT ON (b."leadId", lower(btrim(b."email")))
       gen_random_uuid()::text, b."leadId", btrim(b."email"), lower(btrim(b."email")),
       b."createdAt", b."createdAt", 1
FROM "booking_request" b
WHERE b."leadId" IS NOT NULL AND b."email" IS NOT NULL AND btrim(b."email") <> ''
ORDER BY b."leadId", lower(btrim(b."email")), b."createdAt" ASC
ON CONFLICT ("leadId", "emailKey") DO NOTHING;

-- The CURRENT opt-in score becomes the first point of the history, so a prospect who is re-scored
-- tomorrow already has something to be compared against.
INSERT INTO "lead_score_event" ("id", "leadId", "source", "budget", "authority", "need", "timeline", "score", "avg", "verdict", "scoredAt")
SELECT gen_random_uuid()::text, l."id", COALESCE(l."bantSource", 'OPT_IN'::"BantSource"),
       l."bantBudget", l."bantAuthority", l."bantNeed", l."bantTimeline",
       l."bantScore", l."bantAvg", l."bantVerdict", COALESCE(l."bantScoredAt", l."createdAt")
FROM "lead" l
WHERE l."bantScoredAt" IS NOT NULL
  -- Re-runnable. There is no natural unique key to conflict on here, and a migration that is
  -- retried after a partial failure must not double every prospect's score history.
  AND NOT EXISTS (SELECT 1 FROM "lead_score_event" e WHERE e."leadId" = l."id");
