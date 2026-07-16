-- CreateEnum
CREATE TYPE "CallLogOutcome" AS ENUM ('SPOKE', 'NO_ANSWER', 'BUSY', 'CALLBACK', 'WRONG_NUMBER', 'NOT_INTERESTED');

-- AlterEnum
ALTER TYPE "WhatsAppKind" ADD VALUE 'EMI_PRE_DUE';

-- AlterTable
ALTER TABLE "team_profile" ADD COLUMN     "dailyCallTarget" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "call_log" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "CallLogOutcome" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_log_userId_calledAt_idx" ON "call_log"("userId", "calledAt");

-- CreateIndex
CREATE INDEX "call_log_leadId_calledAt_idx" ON "call_log"("leadId", "calledAt");

-- CreateIndex
CREATE INDEX "call_log_calledAt_idx" ON "call_log"("calledAt");

-- AddForeignKey
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
