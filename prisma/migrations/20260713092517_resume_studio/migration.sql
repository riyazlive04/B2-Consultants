-- CreateTable
CREATE TABLE "resume" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "data" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_review" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "jdText" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'ai',
    "model" TEXT,
    "scoreOverall" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resume_ownerUserId_idx" ON "resume"("ownerUserId");

-- CreateIndex
CREATE INDEX "resume_leadId_idx" ON "resume"("leadId");

-- CreateIndex
CREATE INDEX "resume_review_resumeId_idx" ON "resume_review"("resumeId");

-- AddForeignKey
ALTER TABLE "resume_review" ADD CONSTRAINT "resume_review_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
