-- CreateEnum
CREATE TYPE "GnBatchStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GnVideoProvider" AS ENUM ('YOUTUBE', 'VIMEO', 'GDRIVE');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TUTOR';

-- CreateTable
CREATE TABLE "gn_batch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "ProgramLevel" NOT NULL,
    "tutorId" TEXT,
    "status" "GnBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_batch_member" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gn_batch_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_recording" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "classDate" DATE NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "provider" "GnVideoProvider" NOT NULL,
    "embedUrl" TEXT NOT NULL,
    "notes" TEXT,
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_post" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gn_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_like" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gn_like_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gn_batch_status_idx" ON "gn_batch"("status");

-- CreateIndex
CREATE INDEX "gn_batch_tutorId_idx" ON "gn_batch"("tutorId");

-- CreateIndex
CREATE INDEX "gn_batch_member_studentId_idx" ON "gn_batch_member"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "gn_batch_member_batchId_studentId_key" ON "gn_batch_member"("batchId", "studentId");

-- CreateIndex
CREATE INDEX "gn_recording_batchId_classDate_idx" ON "gn_recording"("batchId", "classDate");

-- CreateIndex
CREATE INDEX "gn_post_batchId_createdAt_idx" ON "gn_post"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "gn_comment_postId_createdAt_idx" ON "gn_comment"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gn_like_postId_userId_key" ON "gn_like"("postId", "userId");

-- AddForeignKey
ALTER TABLE "gn_batch" ADD CONSTRAINT "gn_batch_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_batch_member" ADD CONSTRAINT "gn_batch_member_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gn_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_batch_member" ADD CONSTRAINT "gn_batch_member_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_recording" ADD CONSTRAINT "gn_recording_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gn_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_recording" ADD CONSTRAINT "gn_recording_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_post" ADD CONSTRAINT "gn_post_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gn_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_post" ADD CONSTRAINT "gn_post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_comment" ADD CONSTRAINT "gn_comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "gn_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_comment" ADD CONSTRAINT "gn_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_like" ADD CONSTRAINT "gn_like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "gn_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_like" ADD CONSTRAINT "gn_like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
