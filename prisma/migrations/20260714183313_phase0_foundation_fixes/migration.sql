-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerSourceType" ADD VALUE 'INVOICE';
ALTER TYPE "LedgerSourceType" ADD VALUE 'PAYMENT';

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "read" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pipeline" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pipeline_stage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "probability" INTEGER;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fxRateUsed" DECIMAL(14,6),
ADD COLUMN     "priceEurMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN     "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "fxRateUsed" DECIMAL(14,6);

-- CreateIndex
CREATE INDEX "company_deletedAt_idx" ON "company"("deletedAt");

-- CreateIndex
CREATE INDEX "invoice_payment_recordedById_idx" ON "invoice_payment"("recordedById");

-- CreateIndex
CREATE INDEX "message_direction_read_idx" ON "message"("direction", "read");

-- CreateIndex
CREATE INDEX "message_assignedToId_idx" ON "message"("assignedToId");

-- AddForeignKey
ALTER TABLE "invoice_payment" ADD CONSTRAINT "invoice_payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
