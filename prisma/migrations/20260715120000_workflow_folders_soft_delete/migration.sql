-- Synamate Automation parity: workflow folders, soft delete.
-- Additive and back-compatible: existing workflows land in the root ("Home") folder
-- (folderId NULL) and are not deleted (deletedAt NULL), which is exactly their
-- pre-migration behaviour.

-- CreateTable
CREATE TABLE "workflow_folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_folder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_folder_name_key" ON "workflow_folder"("name");

-- AlterTable
ALTER TABLE "workflow" ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "workflow_folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The trigger scan now also filters on deletedAt; widen the index to match.
-- DropIndex
DROP INDEX "workflow_status_triggerType_idx";

-- CreateIndex
CREATE INDEX "workflow_status_triggerType_deletedAt_idx" ON "workflow"("status", "triggerType", "deletedAt");

-- CreateIndex
CREATE INDEX "workflow_folderId_idx" ON "workflow"("folderId");

-- CreateIndex
CREATE INDEX "workflow_deletedAt_idx" ON "workflow"("deletedAt");
