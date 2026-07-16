-- AlterTable
ALTER TABLE "contact_note" ADD COLUMN     "opportunityId" TEXT;

-- CreateIndex
CREATE INDEX "contact_note_opportunityId_createdAt_idx" ON "contact_note"("opportunityId", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
