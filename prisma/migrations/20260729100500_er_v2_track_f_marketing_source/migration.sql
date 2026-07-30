-- ER v2 Track F — campaign-level attribution.
--
-- `LeadSource` is the CHANNEL taxonomy and is untouched. MarketingSource is the campaign
-- beneath it, so "what did this campaign cost per enrolled student" becomes answerable.
--
-- gn_workshop_adset is RENAMED to ad_spend and generalised: it gains a MarketingSource link
-- (spend that isn't tied to a GN workshop) and a EUR leg (it was INR-only, even though B2
-- runs euro ad accounts). Existing rows keep their exact meaning — adSpendInrMinor is not
-- touched, and the new columns default to zero/null.
--
-- `INSIGHT` is deliberately NOT a table. It is a division over these rows; see
-- src/server/insights-metrics.ts.

CREATE TABLE "marketing_source" (
    "id" TEXT NOT NULL,
    "channel" "LeadSource" NOT NULL,
    "campaign" TEXT NOT NULL,
    "externalRef" TEXT,
    "line" "BatchLine",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_source_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_source_channel_campaign_key" ON "marketing_source"("channel", "campaign");
CREATE INDEX "marketing_source_active_idx" ON "marketing_source"("active");

-- ── gn_workshop_adset → ad_spend ──────────────────────────────────────────────
ALTER TABLE "gn_workshop_adset" RENAME TO "ad_spend";
ALTER TABLE "ad_spend" RENAME CONSTRAINT "gn_workshop_adset_pkey" TO "ad_spend_pkey";
ALTER TABLE "ad_spend" RENAME CONSTRAINT "gn_workshop_adset_workshopId_fkey" TO "ad_spend_workshopId_fkey";
ALTER INDEX "gn_workshop_adset_workshopId_idx" RENAME TO "ad_spend_workshopId_idx";

-- workshopId becomes optional: spend can now belong to a campaign with no workshop behind it.
ALTER TABLE "ad_spend" ALTER COLUMN "workshopId" DROP NOT NULL;
ALTER TABLE "ad_spend" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "ad_spend" ADD COLUMN "amountEurMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "ad_spend" ADD COLUMN "fxRateUsed" DECIMAL(14,6);
ALTER TABLE "ad_spend" ADD COLUMN "periodStart" DATE;
ALTER TABLE "ad_spend" ADD COLUMN "periodEnd" DATE;

ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "marketing_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ad_spend_sourceId_periodStart_idx" ON "ad_spend"("sourceId", "periodStart");

-- ── Lead gains its campaign ───────────────────────────────────────────────────
ALTER TABLE "lead" ADD COLUMN "marketingSourceId" TEXT;
ALTER TABLE "lead" ADD CONSTRAINT "lead_marketingSourceId_fkey"
  FOREIGN KEY ("marketingSourceId") REFERENCES "marketing_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "lead_marketingSourceId_idx" ON "lead"("marketingSourceId");
