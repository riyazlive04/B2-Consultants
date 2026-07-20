-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "GnSlotPreference" AS ENUM ('WEEKDAY', 'WEEKEND', 'EITHER');

-- CreateEnum
CREATE TYPE "BookOrderStatus" AS ENUM ('DEFERRED', 'QUOTE_REQUESTED', 'QUOTED', 'ORDERED', 'PAID', 'COURIERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "discovery_outcome" ADD COLUMN     "coveredForId" TEXT;

-- AlterTable
ALTER TABLE "gn_recording_watch" ADD COLUMN     "durationSecs" INTEGER,
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "positionSecs" INTEGER,
ADD COLUMN     "watchedPct" INTEGER;

-- AlterTable
ALTER TABLE "student" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';

-- CreateTable
CREATE TABLE "gn_pending_joiner" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "level" "ProgramLevel" NOT NULL,
    "preference" "GnSlotPreference" NOT NULL DEFAULT 'EITHER',
    "preferredTime" TEXT,
    "workshopId" TEXT,
    "notes" TEXT,
    "assignedBatchId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_pending_joiner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_order" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "level" "ProgramLevel" NOT NULL,
    "vendorId" TEXT,
    "status" "BookOrderStatus" NOT NULL DEFAULT 'DEFERRED',
    "quotedAmountInrMinor" BIGINT,
    "paidAmountInrMinor" BIGINT,
    "shipToAddress" TEXT,
    "shipToPhone" TEXT,
    "courierRef" TEXT,
    "deferReason" TEXT,
    "notes" TEXT,
    "quotedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "courieredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gn_pending_joiner_level_preference_idx" ON "gn_pending_joiner"("level", "preference");

-- CreateIndex
CREATE INDEX "gn_pending_joiner_assignedBatchId_idx" ON "gn_pending_joiner"("assignedBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "gn_pending_joiner_studentId_level_key" ON "gn_pending_joiner"("studentId", "level");

-- CreateIndex
CREATE INDEX "book_order_status_idx" ON "book_order"("status");

-- CreateIndex
CREATE INDEX "book_order_vendorId_idx" ON "book_order"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "book_order_studentId_level_key" ON "book_order"("studentId", "level");

-- AddForeignKey
ALTER TABLE "discovery_outcome" ADD CONSTRAINT "discovery_outcome_coveredForId_fkey" FOREIGN KEY ("coveredForId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_pending_joiner" ADD CONSTRAINT "gn_pending_joiner_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_pending_joiner" ADD CONSTRAINT "gn_pending_joiner_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "gn_workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_pending_joiner" ADD CONSTRAINT "gn_pending_joiner_assignedBatchId_fkey" FOREIGN KEY ("assignedBatchId") REFERENCES "gn_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_order" ADD CONSTRAINT "book_order_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_order" ADD CONSTRAINT "book_order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
