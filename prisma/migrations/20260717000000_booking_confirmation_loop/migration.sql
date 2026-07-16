-- Bookings confirmation loop (Module E): confirm-or-cancel + promote-next.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. Local/prod are PG17+, so the batched form is fine.
ALTER TYPE "WhatsAppKind" ADD VALUE 'BOOKING_CONFIRM_REQUEST';
ALTER TYPE "WhatsAppKind" ADD VALUE 'BOOKING_RESCHEDULED';
ALTER TYPE "WhatsAppKind" ADD VALUE 'BOOKING_AUTO_CANCELLED';

-- AlterTable
ALTER TABLE "booking_request" ADD COLUMN     "confirmSentAt" TIMESTAMP(3);
ALTER TABLE "booking_request" ADD COLUMN     "confirmedAt" TIMESTAMP(3);
