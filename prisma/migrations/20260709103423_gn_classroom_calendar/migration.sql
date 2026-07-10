-- AlterTable
ALTER TABLE "gn_recording" ADD COLUMN     "moduleId" TEXT;

-- CreateTable
CREATE TABLE "gn_module" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_event" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER,
    "joinUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gn_module_batchId_orderIndex_idx" ON "gn_module"("batchId", "orderIndex");

-- CreateIndex
CREATE INDEX "gn_event_batchId_startsAt_idx" ON "gn_event"("batchId", "startsAt");

-- CreateIndex
CREATE INDEX "gn_recording_moduleId_idx" ON "gn_recording"("moduleId");

-- AddForeignKey
ALTER TABLE "gn_module" ADD CONSTRAINT "gn_module_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gn_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_event" ADD CONSTRAINT "gn_event_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gn_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_event" ADD CONSTRAINT "gn_event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_recording" ADD CONSTRAINT "gn_recording_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "gn_module"("id") ON DELETE SET NULL ON UPDATE CASCADE;
