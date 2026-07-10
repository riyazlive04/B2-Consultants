-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "telecaller_payout" (
    "id" TEXT NOT NULL,
    "teamProfileId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "bonusInrMinor" BIGINT NOT NULL DEFAULT 0,
    "bonusEurMinor" BIGINT NOT NULL DEFAULT 0,
    "commInrMinor" BIGINT NOT NULL DEFAULT 0,
    "commEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telecaller_payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telecaller_payout_teamProfileId_month_idx" ON "telecaller_payout"("teamProfileId", "month");

-- CreateIndex
CREATE INDEX "telecaller_payout_month_idx" ON "telecaller_payout"("month");

-- AddForeignKey
ALTER TABLE "telecaller_payout" ADD CONSTRAINT "telecaller_payout_teamProfileId_fkey" FOREIGN KEY ("teamProfileId") REFERENCES "team_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telecaller_payout" ADD CONSTRAINT "telecaller_payout_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
