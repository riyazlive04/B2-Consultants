-- CreateEnum
CREATE TYPE "InstalmentStatus" AS ENUM ('DUE', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('APPLIED', 'INTERVIEW', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GnEventType" AS ENUM ('KICKOFF', 'COACHING', 'LINKEDIN', 'QA', 'OPEN_MARKET', 'LIVE_CLASS', 'OTHER');

-- AlterTable
ALTER TABLE "enrollment" ADD COLUMN     "closerId" TEXT;

-- AlterTable
ALTER TABLE "gn_batch" ADD COLUMN     "targetStrength" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "gn_event" ADD COLUMN     "type" "GnEventType" NOT NULL DEFAULT 'LIVE_CLASS';

-- CreateTable
CREATE TABLE "instalment" (
    "id" TEXT NOT NULL,
    "pendingPaymentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidDate" DATE,
    "status" "InstalmentStatus" NOT NULL DEFAULT 'DUE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "jobUrl" TEXT,
    "location" TEXT,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" DATE NOT NULL,
    "statusAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instalment_status_dueDate_idx" ON "instalment"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "instalment_pendingPaymentId_seq_key" ON "instalment"("pendingPaymentId", "seq");

-- CreateIndex
CREATE INDEX "job_application_enrollmentId_status_idx" ON "job_application"("enrollmentId", "status");

-- CreateIndex
CREATE INDEX "job_application_status_statusAt_idx" ON "job_application"("status", "statusAt");

-- CreateIndex
CREATE INDEX "enrollment_closerId_idx" ON "enrollment"("closerId");

-- AddForeignKey
ALTER TABLE "instalment" ADD CONSTRAINT "instalment_pendingPaymentId_fkey" FOREIGN KEY ("pendingPaymentId") REFERENCES "pending_payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_closerId_fkey" FOREIGN KEY ("closerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
