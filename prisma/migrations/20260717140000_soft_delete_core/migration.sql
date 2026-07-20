-- Soft-delete (delete -> Archive) for the 9 core record types.
-- Additive & non-destructive: nullable `deletedAt`/`deletedById` columns, a partial-friendly
-- index on `deletedAt`, and a SetNull FK to `user` for the "archived by" author.
-- `company` and `product` already carried a dormant `deletedAt` (and company its index),
-- so they only gain `deletedById` here.

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "contact_task" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "expense" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "income" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "opportunity" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "pending_payment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "contact_task_deletedAt_idx" ON "contact_task"("deletedAt");

-- CreateIndex
CREATE INDEX "expense_deletedAt_idx" ON "expense"("deletedAt");

-- CreateIndex
CREATE INDEX "income_deletedAt_idx" ON "income"("deletedAt");

-- CreateIndex
CREATE INDEX "invoice_deletedAt_idx" ON "invoice"("deletedAt");

-- CreateIndex
CREATE INDEX "lead_deletedAt_idx" ON "lead"("deletedAt");

-- CreateIndex
CREATE INDEX "opportunity_deletedAt_idx" ON "opportunity"("deletedAt");

-- CreateIndex
CREATE INDEX "pending_payment_deletedAt_idx" ON "pending_payment"("deletedAt");

-- CreateIndex
CREATE INDEX "product_deletedAt_idx" ON "product"("deletedAt");

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_payment" ADD CONSTRAINT "pending_payment_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_task" ADD CONSTRAINT "contact_task_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
