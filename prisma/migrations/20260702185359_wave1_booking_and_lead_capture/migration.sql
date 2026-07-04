-- Wave-1 tables. Enum values used below (Source.BOOKING_FORM, SlotStatus, BookingStatus)
-- were added in the preceding migration 20260702185358_wave1a_enum_values.

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactedAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "utm" JSONB;

-- CreateTable
CREATE TABLE "appointment_slot" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_request" (
    "id" TEXT NOT NULL,
    "slotId" TEXT,
    "leadId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "city" TEXT,
    "currentJobTitle" TEXT,
    "prospectIndustry" TEXT,
    "linkedInProfile" TEXT,
    "highestEducation" TEXT,
    "yearsExperience" TEXT,
    "whyGermany" TEXT,
    "participateWorkshop" BOOLEAN NOT NULL DEFAULT false,
    "reasonForCall" TEXT,
    "alreadyApplied" TEXT,
    "whenStartGermany" TEXT,
    "germanVisa" TEXT,
    "germanLevel" TEXT,
    "willingnessLearnGerman" TEXT,
    "currentIncome" TEXT,
    "readyToInvest" TEXT,
    "decisionMaking" TEXT,
    "commitment" TEXT,
    "howKnowUs" TEXT,
    "bantBudget" BOOLEAN NOT NULL DEFAULT false,
    "bantAuthority" BOOLEAN NOT NULL DEFAULT false,
    "bantNeed" BOOLEAN NOT NULL DEFAULT false,
    "bantTimeline" BOOLEAN NOT NULL DEFAULT false,
    "bantScore" INTEGER NOT NULL DEFAULT 0,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "Source" NOT NULL DEFAULT 'BOOKING_FORM',
    "utm" JSONB,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_slot_status_startsAt_idx" ON "appointment_slot"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_request_slotId_key" ON "booking_request"("slotId");

-- CreateIndex
CREATE INDEX "booking_request_status_createdAt_idx" ON "booking_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "booking_request_bantScore_idx" ON "booking_request"("bantScore");

-- CreateIndex
CREATE INDEX "lead_assignedToId_idx" ON "lead"("assignedToId");

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slot" ADD CONSTRAINT "appointment_slot_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "appointment_slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
