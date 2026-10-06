-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Configurable payment types, a free-text "Other" payment method, and recurring payments.
--
-- WHY `paymentType` STOPS BEING AN ENUM. It held exactly two values, Full payment and
-- Instalment, so a student on a monthly subscription had to be filed as one of those two -
-- and filing a recurring charge as an instalment plan puts it in the dunning ladder, which
-- then chases somebody who owes nothing. The list is now founder-editable
-- (AppSetting "paymentTypes"), exactly as `programLevel` became the Level catalogue in
-- 20260718090000_configurable_levels. This follows that migration's approach deliberately.
--
-- ⚠ WRITTEN BY HAND, NOT BY `prisma migrate dev`. Prisma generates
--     ALTER TABLE "income" DROP COLUMN "paymentType", ADD COLUMN "paymentType" TEXT NOT NULL;
-- for this change, which DISCARDS the payment type of every income row ever recorded (and
-- fails outright on a non-empty table, there being no default). The in-place
-- `ALTER COLUMN ... TYPE TEXT USING` below preserves every value: the enum labels and the
-- config codes are the same strings ('FULL_PAYMENT', 'INSTALMENT'), so historic rows read
-- back unchanged and need no backfill.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- The enum's labels become plain text, in place. Values are preserved verbatim.
ALTER TABLE "income" ALTER COLUMN "paymentType" TYPE TEXT USING "paymentType"::TEXT;

-- Nothing else referenced the type, so it goes with the column's old shape.
DROP TYPE "PaymentType";

-- How often a recurring payment type bills.
CREATE TYPE "RecurrenceInterval" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

ALTER TABLE "income"
  -- What "Other" meant, in the operator's own words. "Other" with no note is a row nobody can
  -- reconcile against a bank statement later.
  ADD COLUMN "paymentMethodOther" TEXT,
  -- Set only for a SUBSCRIPTION-kind payment type; null for every other kind.
  ADD COLUMN "recurrenceInterval" "RecurrenceInterval",
  ADD COLUMN "recurrenceNextDate" DATE;
