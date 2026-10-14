-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Configurable expense categories, the account an expense was actually paid from, and the
-- link from a receivable back to the payment that agreed it.
--
-- ⚠ WRITTEN BY HAND, NOT BY `prisma migrate dev`. For an enum → text change Prisma generates
--     ALTER TABLE "expense" DROP COLUMN "category", ADD COLUMN "category" TEXT NOT NULL;
-- which DISCARDS the category of every expense ever recorded (and fails outright on a
-- non-empty table, there being no default). The in-place `ALTER COLUMN ... TYPE TEXT USING`
-- below preserves every value: the enum labels and the config codes are the same strings, so
-- historic rows read back unchanged and need no backfill. This follows
-- 20261003120000_configurable_payment_types, which did the same for `income.paymentType`.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── 1. The category list becomes founder-editable (AppSetting "expenseCategories") ──────
-- WHY. It held eight values chosen in a spec, and the one a real business reaches for next -
-- Rent, Legal and accounting, Travel, Bank charges - was not among them, so such a cost could
-- only be filed as "Other": the P&L's biggest line became the one that says nothing, and the
-- founder could not fix it without a schema change and a deploy.
ALTER TABLE "expense" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "payable" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;

-- Nothing else referenced the type, so it goes with the columns' old shape.
DROP TYPE "ExpenseCategory";

-- ── 2. Which account the money actually left from ───────────────────────────────────────
-- WHY. `expenseEntryDraft` credited BANK_TRANSFER_INR for every expense, whatever had really
-- paid it, because the row carried nothing to say otherwise: petty cash never went down, the
-- euro account was drained in rupees, and neither could be reconciled against a statement.
-- DEFAULT '1000' is exactly what every historic row was posted to, so no existing journal
-- entry is restated by this column existing.
ALTER TABLE "expense" ADD COLUMN "paidFromAccount" TEXT NOT NULL DEFAULT '1000';

-- ── 3. The payment that agreed a plan ───────────────────────────────────────────────────
-- WHY. A plan and the income that generated it were two rows with nothing between them, so
-- correcting the amount received left the plan's `totalFee` and its instalment 1 holding the
-- figure typed first - the schedule and the balance then disagreed for good, and the dunning
-- ladder chased the difference.
ALTER TABLE "pending_payment" ADD COLUMN "startedByIncomeId" TEXT;
CREATE UNIQUE INDEX "pending_payment_startedByIncomeId_key" ON "pending_payment"("startedByIncomeId");
ALTER TABLE "pending_payment"
  ADD CONSTRAINT "pending_payment_startedByIncomeId_fkey"
  FOREIGN KEY ("startedByIncomeId") REFERENCES "income"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill, but only where the pairing is BEYOND DOUBT: instalment 1 of the plan and exactly
-- one live income row agree on the student, the date and both amounts, and that income matches
-- exactly one plan. Anything less is left null, which simply means "this plan cannot be
-- restated from its income" - the same conservative stance `autoSettle` takes. A guess here
-- would attach a payment to a schedule it never paid.
WITH first_inst AS (
  SELECT "pendingPaymentId" AS plan_id, "dueDate", "amountInrMinor", "amountEurMinor"
  FROM "instalment"
  WHERE seq = 1
),
cand AS (
  SELECT
    f.plan_id,
    inc.id AS income_id,
    COUNT(*) OVER (PARTITION BY f.plan_id) AS per_plan,
    COUNT(*) OVER (PARTITION BY inc.id)    AS per_income
  FROM first_inst f
  JOIN "pending_payment" p ON p.id = f.plan_id
  JOIN "income" inc
    ON inc."studentName"    = p."studentName"
   AND inc."date"           = f."dueDate"
   AND inc."amountInrMinor" = f."amountInrMinor"
   AND inc."amountEurMinor" = f."amountEurMinor"
   AND inc."deletedAt" IS NULL
  WHERE p."deletedAt" IS NULL
)
UPDATE "pending_payment" p
SET "startedByIncomeId" = c.income_id
FROM cand c
WHERE c.plan_id = p.id AND c.per_plan = 1 AND c.per_income = 1;
