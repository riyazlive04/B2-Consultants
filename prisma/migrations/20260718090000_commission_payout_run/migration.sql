-- Commission payout runs (audit §C #23). Snapshots a month's deal-team commission totals so a
-- payout is a durable record, with an optional link to its ledger accrual entry. Author-only:
-- applies on the next `prisma migrate deploy`; never run against production by hand.

-- CreateTable
CREATE TABLE "commission_payout_run" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "totalInrMinor" BIGINT NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "postedEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payout_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_payout_run_month_key" ON "commission_payout_run"("month");
