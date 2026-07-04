-- Bucket-1 enum changes, isolated in their own migration (same reason as wave1a):
-- Postgres requires new enum values to be COMMITTED before a later migration can
-- reference them in defaults / data.

-- AlterEnum: Synamate pipeline parity — workshop branch + post-offer money trail
ALTER TYPE "LeadStage" ADD VALUE 'SENT_TO_WORKSHOP';
ALTER TYPE "LeadStage" ADD VALUE 'WORKSHOP_FOLLOWUP';
ALTER TYPE "LeadStage" ADD VALUE 'OFFER_FOLLOWUP';
ALTER TYPE "LeadStage" ADD VALUE 'DEPOSIT_FOLLOWUP';
ALTER TYPE "LeadStage" ADD VALUE 'DEPOSIT_PAID';

-- CreateEnum: split pay vs full pay on a closed deal
CREATE TYPE "PaymentPlan" AS ENUM ('SPLIT_PAY', 'FULL_PAY');

-- CreateEnum: weighted-BANT recommendation (avg >3 confirm · 2-3 doubt · <2 cancel)
CREATE TYPE "BantVerdict" AS ENUM ('CONFIRM', 'DOUBT', 'CANCEL');

-- CreateEnum: sprint-week review status
CREATE TYPE "SprintStatus" AS ENUM ('PENDING', 'ACHIEVED', 'MISSED');
