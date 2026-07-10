-- AlterTable
ALTER TABLE "gn_comment" ADD COLUMN     "mentionedUserIds" TEXT[];

-- AlterTable
ALTER TABLE "gn_post" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "mentionedUserIds" TEXT[];

-- CreateTable
CREATE TABLE "gn_recording_watch" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "watchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gn_recording_watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_comment_like" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gn_comment_like_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gn_recording_watch_userId_idx" ON "gn_recording_watch"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "gn_recording_watch_recordingId_userId_key" ON "gn_recording_watch"("recordingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "gn_comment_like_commentId_userId_key" ON "gn_comment_like"("commentId", "userId");

-- AddForeignKey
ALTER TABLE "gn_recording_watch" ADD CONSTRAINT "gn_recording_watch_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "gn_recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_recording_watch" ADD CONSTRAINT "gn_recording_watch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_comment_like" ADD CONSTRAINT "gn_comment_like_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "gn_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_comment_like" ADD CONSTRAINT "gn_comment_like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
