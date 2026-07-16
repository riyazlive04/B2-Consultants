-- CreateTable
CREATE TABLE "sss_slot" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 45,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "journeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sss_slot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sss_slot_journeyId_key" ON "sss_slot"("journeyId");

-- CreateIndex
CREATE INDEX "sss_slot_status_startsAt_idx" ON "sss_slot"("status", "startsAt");

-- CreateIndex
CREATE INDEX "sss_slot_ownerId_startsAt_idx" ON "sss_slot"("ownerId", "startsAt");

-- AddForeignKey
ALTER TABLE "sss_slot" ADD CONSTRAINT "sss_slot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sss_slot" ADD CONSTRAINT "sss_slot_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "outreach_journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
