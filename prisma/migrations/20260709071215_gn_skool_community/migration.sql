-- CreateEnum
CREATE TYPE "GnPostCategory" AS ENUM ('GENERAL', 'ANNOUNCEMENT', 'QUESTION', 'WIN');

-- AlterTable
ALTER TABLE "gn_post" ADD COLUMN     "category" "GnPostCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "title" TEXT;
