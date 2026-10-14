-- Team payments, and owner's equity as a real record.
--
-- ─────────────────────────────── WHAT THIS IS FOR ───────────────────────────────
--
-- 1. TEAM PAY (`expense.teamProfileId`, `team_profile.monthlyPay*Minor`)
--    Paying a colleague was a free-text expense: `vendor` held whatever was typed that month, so
--    "Karthik", "Karthick" and "Karthick salary" were three different payees to every total in
--    the app, and "what have we paid this person this year" had no answer at all. The only
--    structured pay flow was the Telecaller Pay board, which lists ACTIVE profiles whose
--    logVariant is APPOINTMENT_SETTER or DISCOVERY_SPECIALIST - so the delivery coach and every
--    tutor were outside it by construction.
--
--    `teamProfileId` is the link; `monthlyPay*Minor` is the figure the pay form opens on. Both
--    additive, both optional/zero-defaulted, so every existing expense and profile is unchanged
--    and behaves exactly as before.
--
-- 2. OWNER'S EQUITY (`equity_contribution`, `EquityEntryKind`, `LedgerSourceType.EQUITY`)
--    Capital was one nullable column on the weekly cash position - `personalSavingsInrMinor`,
--    labelled "planning only" and excluded from everything - which cannot say whose money it is,
--    when it went in, or whether it is still in. With more than one person contributing it
--    cannot say anything at all.
--
--    The column is NOT dropped. The figures already in it are a record of something, and deleting
--    a founder's numbers to tidy a schema is not a migration anyone should write. Nothing reads it
--    any more; the schema marks it deprecated.
--
--    A contribution posts Dr the asset it landed in / Cr Owner's equity (3000) and is NEVER
--    income - equity reaching the P&L would inflate revenue, margin, commission and every growth
--    figure derived from them. It is also not added on top of Cash in Hand, which is the bank
--    balance the founder types each week and therefore already contains it.
--
-- REVERSIBILITY. Everything here is additive: two nullable/defaulted columns, one new enum, one
-- new enum VALUE, one new table. No column is dropped, renamed or re-typed, and no existing row
-- is rewritten.

-- AlterEnum
--
-- Safe inside the migration's transaction on PostgreSQL 12+ (the value is added, not used, here).
-- `forbid_duplicate_live_source()` keys off (sourceType, sourceId) generically, so the guard that
-- stops a row being posted to the ledger twice needs no change - the same reason INVOICE, PAYMENT
-- and TUTOR_FEE could be added before this.
ALTER TYPE "LedgerSourceType" ADD VALUE 'EQUITY';

-- CreateEnum
CREATE TYPE "EquityEntryKind" AS ENUM ('CONTRIBUTION', 'DRAWING');

-- AlterTable
ALTER TABLE "team_profile" ADD COLUMN "monthlyPayInrMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "team_profile" ADD COLUMN "monthlyPayEurMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "expense" ADD COLUMN "teamProfileId" TEXT;

-- CreateIndex
CREATE INDEX "expense_teamProfileId_date_idx" ON "expense"("teamProfileId", "date");

-- AddForeignKey
--
-- SetNull, like every other actor link on a money row: offboarding somebody must never delete the
-- record of what they were paid.
ALTER TABLE "expense" ADD CONSTRAINT "expense_teamProfileId_fkey"
  FOREIGN KEY ("teamProfileId") REFERENCES "team_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "equity_contribution" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "contributorName" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "EquityEntryKind" NOT NULL DEFAULT 'CONTRIBUTION',
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "accountCode" TEXT NOT NULL DEFAULT '1000',
    "notes" TEXT,
    "postedEntryId" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "equity_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equity_contribution_date_idx" ON "equity_contribution"("date");

-- CreateIndex
CREATE INDEX "equity_contribution_contributorName_idx" ON "equity_contribution"("contributorName");

-- CreateIndex
CREATE INDEX "equity_contribution_deletedAt_idx" ON "equity_contribution"("deletedAt");

-- AddForeignKey
ALTER TABLE "equity_contribution" ADD CONSTRAINT "equity_contribution_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_contribution" ADD CONSTRAINT "equity_contribution_enteredById_fkey"
  FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_contribution" ADD CONSTRAINT "equity_contribution_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
