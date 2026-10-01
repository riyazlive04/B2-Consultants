-- Cancelled / released discovery slots.
--
-- Purely additive: one new table and one new enum, no change to any existing table, so it is safe
-- to deploy ahead of the code that writes it. Until that code ships the table simply stays empty.
--
-- WHY: handing a slot back to the calendar NULLS booking_request."slotId" (the column is UNIQUE, so
-- the slot cannot be re-booked while a cancelled booking still points at it). That erased the only
-- record of when the call had been, which made "show me the slots we cancelled" unanswerable.

-- CreateEnum
CREATE TYPE "SlotReleaseReason" AS ENUM ('NO_CONFIRMATION', 'CANCELLED', 'NO_SHOW', 'POSTPONED');

-- CreateTable
CREATE TABLE "slot_release" (
    "id" TEXT NOT NULL,
    "slotId" TEXT,
    "bookingRequestId" TEXT,
    "slotStartsAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "prospectName" TEXT NOT NULL,
    "reason" "SlotReleaseReason" NOT NULL,
    "releasedStatus" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "promotedBookingId" TEXT,
    "promotedName" TEXT,
    "releasedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slot_release_slotStartsAt_idx" ON "slot_release"("slotStartsAt");

-- CreateIndex
CREATE INDEX "slot_release_createdAt_idx" ON "slot_release"("createdAt");

-- CreateIndex
CREATE INDEX "slot_release_reason_createdAt_idx" ON "slot_release"("reason", "createdAt");

-- AddForeignKey
ALTER TABLE "slot_release" ADD CONSTRAINT "slot_release_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "appointment_slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_release" ADD CONSTRAINT "slot_release_bookingRequestId_fkey" FOREIGN KEY ("bookingRequestId") REFERENCES "booking_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

