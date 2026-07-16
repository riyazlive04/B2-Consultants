-- CreateEnum
CREATE TYPE "OutreachStep" AS ENUM ('INTRO_WHATSAPP', 'FIRST_CALL', 'CHECK_1', 'FOLLOWUP_WHATSAPP', 'CHECK_2', 'FOLLOWUP_CALL', 'FINAL_CHECK', 'BANT_QUALIFICATION', 'KEY_METRICS_TRANSFER', 'DISCO_WELCOME', 'DISCO_CONFIRM_1', 'DISCO_CONFIRM_2', 'DISCO_CONFIRM_CALL_1', 'DISCO_CONFIRM_CALL_2', 'DISCO_CANCEL_MSG', 'DISCO_CANCEL', 'SSS_CONFIRM_1', 'SSS_CONFIRM_2', 'SSS_CANCEL_MSG', 'SSS_CANCEL');

-- CreateEnum
CREATE TYPE "OutreachPhase" AS ENUM ('OPT_IN', 'BOOKING_CHASE', 'QUALIFICATION', 'DISCO_CONFIRMATION', 'AWAITING_DISCO', 'HANDOFF', 'SSS_CONFIRMATION', 'COMPLETED', 'IGNORED', 'CANCELLED', 'CLOSED_NOT_HQ');

-- CreateEnum
CREATE TYPE "QualifiedVerdict" AS ENUM ('YES', 'MAYBE', 'NO');

-- CreateEnum
CREATE TYPE "OutreachStepStatus" AS ENUM ('DUE', 'SENT', 'SKIPPED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('WHATSAPP', 'CALL', 'SYSTEM');

-- CreateTable
CREATE TABLE "outreach_journey" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "bookingId" TEXT,
    "phase" "OutreachPhase" NOT NULL DEFAULT 'OPT_IN',
    "optInAt" TIMESTAMP(3) NOT NULL,
    "contactedAt" TIMESTAMP(3),
    "qualified" "QualifiedVerdict",
    "qualifiedAt" TIMESTAMP(3),
    "qualifiedById" TEXT,
    "bantScoreAtQual" DOUBLE PRECISION,
    "respTouchpointId" TEXT,
    "respDiscoId" TEXT,
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "whatsappSentAt" TIMESTAMP(3),
    "whatsappConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "whatsappConfirmedAt" TIMESTAMP(3),
    "salesCallConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "salesCallConfirmedAt" TIMESTAMP(3),
    "highlyQualified" BOOLEAN,
    "highlyQualifiedAt" TIMESTAMP(3),
    "sssAt" TIMESTAMP(3),
    "zoomLink" TEXT,
    "redFlag" BOOLEAN NOT NULL DEFAULT false,
    "redFlagReason" TEXT,
    "ignoredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_step_log" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "step" "OutreachStep" NOT NULL,
    "status" "OutreachStepStatus" NOT NULL DEFAULT 'DUE',
    "channel" "OutreachChannel" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "actedAt" TIMESTAMP(3),
    "actedById" TEXT,
    "renderedBody" TEXT,
    "outcome" TEXT,
    "whatsAppMessageId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_step_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_journey_leadId_key" ON "outreach_journey"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_journey_bookingId_key" ON "outreach_journey"("bookingId");

-- CreateIndex
CREATE INDEX "outreach_journey_phase_idx" ON "outreach_journey"("phase");

-- CreateIndex
CREATE INDEX "outreach_journey_contactedAt_idx" ON "outreach_journey"("contactedAt");

-- CreateIndex
CREATE INDEX "outreach_journey_qualified_idx" ON "outreach_journey"("qualified");

-- CreateIndex
CREATE INDEX "outreach_step_log_status_dueAt_idx" ON "outreach_step_log"("status", "dueAt");

-- CreateIndex
CREATE INDEX "outreach_step_log_journeyId_idx" ON "outreach_step_log"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_step_log_journeyId_step_key" ON "outreach_step_log"("journeyId", "step");

-- CreateIndex
CREATE INDEX "booking_request_email_idx" ON "booking_request"("email");

-- AddForeignKey
ALTER TABLE "outreach_journey" ADD CONSTRAINT "outreach_journey_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_journey" ADD CONSTRAINT "outreach_journey_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_journey" ADD CONSTRAINT "outreach_journey_qualifiedById_fkey" FOREIGN KEY ("qualifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_journey" ADD CONSTRAINT "outreach_journey_respTouchpointId_fkey" FOREIGN KEY ("respTouchpointId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_journey" ADD CONSTRAINT "outreach_journey_respDiscoId_fkey" FOREIGN KEY ("respDiscoId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_step_log" ADD CONSTRAINT "outreach_step_log_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "outreach_journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_step_log" ADD CONSTRAINT "outreach_step_log_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
