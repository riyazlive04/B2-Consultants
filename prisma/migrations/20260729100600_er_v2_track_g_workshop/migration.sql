-- ER v2 Track G — workshops generalised, registrations made real.
--
-- Attendance was an INTEGER typed onto an ad set, and only people who CONVERTED got a row —
-- with no link to a Lead. So "who attended and didn't buy, and can we re-target them" was
-- unanswerable, despite the pipeline carrying SENT_TO_WORKSHOP and WORKSHOP_FOLLOWUP stages
-- built for exactly that motion.

-- ── gn_workshop → workshop ────────────────────────────────────────────────────
ALTER TABLE "gn_workshop" RENAME TO "workshop";
ALTER TABLE "workshop" RENAME CONSTRAINT "gn_workshop_pkey" TO "workshop_pkey";
ALTER INDEX "gn_workshop_status_idx" RENAME TO "workshop_status_idx";

ALTER TABLE "workshop" ADD COLUMN "line" "BatchLine" NOT NULL DEFAULT 'GERMAN_NOTE';
ALTER TABLE "workshop" ADD COLUMN "landingPageUrl" TEXT;
ALTER TABLE "workshop" ADD COLUMN "whatsappGroupLink" TEXT;
-- Distinct from `month`, which is the intake PERIOD. This is when the taster actually runs.
ALTER TABLE "workshop" ADD COLUMN "scheduledAt" TIMESTAMP(3);
CREATE INDEX "workshop_line_month_idx" ON "workshop"("line", "month");

-- NOTE on the inbound FKs: `ad_spend.workshopId_fkey` and
-- `gn_workshop_conversion.workshopId_fkey` follow this rename automatically — Postgres tracks
-- the reference by oid, not by name — and their constraint names already match what Prisma
-- derives from the *model* names (AdSpend.workshop, GnWorkshopConversion.workshop), which did
-- not change. Nothing to rename here.

-- ── Registrations ─────────────────────────────────────────────────────────────
CREATE TABLE "workshop_registration" (
    "id" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "leadId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "attendedAt" TIMESTAMP(3),
    "source" "Source" NOT NULL DEFAULT 'NATIVE_FORM',
    "externalRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workshop_registration_pkey" PRIMARY KEY ("id")
);

-- One registration per lead per workshop — this is what makes a replayed webhook idempotent.
CREATE UNIQUE INDEX "workshop_registration_workshopId_leadId_key" ON "workshop_registration"("workshopId", "leadId");
CREATE INDEX "workshop_registration_workshopId_attended_idx" ON "workshop_registration"("workshopId", "attended");
CREATE INDEX "workshop_registration_leadId_idx" ON "workshop_registration"("leadId");

ALTER TABLE "workshop_registration" ADD CONSTRAINT "workshop_registration_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull: a registration is evidence somebody turned up, and must survive the lead being
-- merged or archived.
ALTER TABLE "workshop_registration" ADD CONSTRAINT "workshop_registration_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Conversions gain their registration and their resolved batches ────────────
ALTER TABLE "gn_workshop_conversion" ADD COLUMN "registrationId" TEXT;
ALTER TABLE "gn_workshop_conversion" ADD COLUMN "batchA1Id" TEXT;
ALTER TABLE "gn_workshop_conversion" ADD COLUMN "batchA2Id" TEXT;
ALTER TABLE "gn_workshop_conversion" ADD COLUMN "batchB1Id" TEXT;

CREATE UNIQUE INDEX "gn_workshop_conversion_registrationId_key" ON "gn_workshop_conversion"("registrationId");

ALTER TABLE "gn_workshop_conversion" ADD CONSTRAINT "gn_workshop_conversion_registrationId_fkey"
  FOREIGN KEY ("registrationId") REFERENCES "workshop_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gn_workshop_conversion" ADD CONSTRAINT "gn_workshop_conversion_batchA1Id_fkey"
  FOREIGN KEY ("batchA1Id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gn_workshop_conversion" ADD CONSTRAINT "gn_workshop_conversion_batchA2Id_fkey"
  FOREIGN KEY ("batchA2Id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gn_workshop_conversion" ADD CONSTRAINT "gn_workshop_conversion_batchB1Id_fkey"
  FOREIGN KEY ("batchB1Id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
