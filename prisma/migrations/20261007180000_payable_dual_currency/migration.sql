-- Payable becomes dual-currency, like Income, Expense and PendingPayment.
--
-- WHY
-- Every other money model in this app stores BOTH an INR and a EUR amount plus the rate that was
-- in force when it was entered, which is what lets the ₹/€ toggle pick a side rather than convert
-- one. `payable` had a single `amountInrMinor` column, so the New payable form could only offer a
-- rupee box - there was nowhere to put a euro figure - and a bill that genuinely arrives in euro
-- had to be converted by hand at whatever rate the person guessed on the day.
--
-- ADDITIVE AND BACKWARD-COMPATIBLE
-- Nothing is dropped or renamed. `amountInrMinor` keeps its meaning and its values; an existing
-- rupee payable simply gains a zero euro side, which is exactly how the aggregate helpers already
-- read a single-currency row.
--
-- ON THE BACKFILLED RATE
-- `fxRateUsed` cannot be left at zero: `aggEurMinor` DIVIDES the rupee amount by it to express a
-- rupee-quoted row in euro, so a zero would be a division by zero on the first read. Existing rows
-- are therefore stamped with the most recent rate on file, falling back to a sane constant if the
-- table is empty. That is an approximation for history - the honest alternative, inventing the
-- rate that applied the day each payable was created, is not recoverable - but it only ever
-- affects the EUR *rendering* of a bill that was always quoted in rupees. The rupee figure, which
-- is the one those rows were agreed in, is untouched.

ALTER TABLE "payable" ADD COLUMN "amountEurMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "payable" ADD COLUMN "fxRateUsed" DECIMAL(14,6) NOT NULL DEFAULT 0;

UPDATE "payable"
SET "fxRateUsed" = COALESCE(
  (SELECT "inrPerEur" FROM "fx_rate" ORDER BY "date" DESC LIMIT 1),
  95.000000
)
WHERE "fxRateUsed" = 0;
