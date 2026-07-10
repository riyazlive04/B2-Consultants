-- CreateEnum
CREATE TYPE "GoalScope" AS ENUM ('COMPANY', 'USER');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('BONUS', 'COMMISSION', 'PERK');

-- CreateEnum
CREATE TYPE "RewardGrantStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'PAID');

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "scope" "GoalScope" NOT NULL DEFAULT 'COMPANY',
    "teamProfileId" TEXT,
    "period" "GoalPeriod" NOT NULL DEFAULT 'MONTH',
    "periodStart" DATE NOT NULL,
    "targetValue" DECIMAL(16,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_rule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "RewardKind" NOT NULL DEFAULT 'BONUS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "roles" "Role"[],
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
    "perkLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_grant" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "teamProfileId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "qualifiedOn" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RewardGrantStatus" NOT NULL DEFAULT 'PENDING',
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_active_periodStart_idx" ON "goal"("active", "periodStart");

-- CreateIndex
CREATE INDEX "goal_teamProfileId_idx" ON "goal"("teamProfileId");

-- CreateIndex
CREATE INDEX "reward_rule_active_idx" ON "reward_rule"("active");

-- CreateIndex
CREATE INDEX "reward_grant_status_qualifiedOn_idx" ON "reward_grant"("status", "qualifiedOn");

-- CreateIndex
CREATE INDEX "reward_grant_teamProfileId_idx" ON "reward_grant"("teamProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_grant_ruleId_teamProfileId_periodKey_key" ON "reward_grant"("ruleId", "teamProfileId", "periodKey");

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_teamProfileId_fkey" FOREIGN KEY ("teamProfileId") REFERENCES "team_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "reward_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_teamProfileId_fkey" FOREIGN KEY ("teamProfileId") REFERENCES "team_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
