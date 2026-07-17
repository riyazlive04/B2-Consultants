-- CreateEnum
CREATE TYPE "DailyLogSource" AS ENUM ('HUMAN', 'EOD_AUTO');

-- AlterTable
ALTER TABLE "daily_log" ADD COLUMN     "source" "DailyLogSource" NOT NULL DEFAULT 'HUMAN';
