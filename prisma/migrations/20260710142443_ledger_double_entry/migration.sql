-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('INR', 'EUR');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('INCOME', 'EXPENSE', 'MANUAL', 'OPENING_BALANCE', 'FX_REVALUATION');

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" "Currency",
    "isCogs" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortKey" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "narration" TEXT NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "sourceType" "LedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "reversalOfId" TEXT,
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_line" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitMinor" BIGINT NOT NULL DEFAULT 0,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL,
    "fxRate" DECIMAL(14,6) NOT NULL,
    "baseDebitMinor" BIGINT NOT NULL DEFAULT 0,
    "baseCreditMinor" BIGINT NOT NULL DEFAULT 0,
    "isCogs" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_lock" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedById" TEXT,
    "note" TEXT,

    CONSTRAINT "period_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entry" (
    "seq" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_code_key" ON "ledger_account"("code");

-- CreateIndex
CREATE INDEX "ledger_account_type_code_idx" ON "ledger_account"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_reversalOfId_key" ON "journal_entry"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entry_date_idx" ON "journal_entry"("date");

-- CreateIndex
CREATE INDEX "journal_entry_status_date_idx" ON "journal_entry"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_sourceType_sourceId_key" ON "journal_entry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_line_entryId_idx" ON "journal_line"("entryId");

-- CreateIndex
CREATE INDEX "journal_line_accountId_idx" ON "journal_line"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "period_lock_month_key" ON "period_lock"("month");

-- CreateIndex
CREATE UNIQUE INDEX "audit_entry_hash_key" ON "audit_entry"("hash");

-- CreateIndex
CREATE INDEX "audit_entry_entityType_entityId_idx" ON "audit_entry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_entry_at_idx" ON "audit_entry"("at");

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_lock" ADD CONSTRAINT "period_lock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
