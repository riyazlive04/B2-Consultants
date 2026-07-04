-- Wave-1 enum changes, isolated in their own migration.
-- Postgres requires new enum values to be COMMITTED before they can be used as a
-- column default / inserted. Adding them here (separate transaction) lets the next
-- migration (wave1_booking_and_lead_capture) reference them safely.

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'BOOKED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterEnum: capture channels for the new webhooks
ALTER TYPE "LeadSource" ADD VALUE 'META_ADS';
ALTER TYPE "LeadSource" ADD VALUE 'LANDING_PAGE';

-- AlterEnum: ingest provenance for the in-sourced booking + capture paths
ALTER TYPE "Source" ADD VALUE 'BOOKING_FORM';
ALTER TYPE "Source" ADD VALUE 'META_LEAD_AD';
ALTER TYPE "Source" ADD VALUE 'FLEXIFUNNELS';
