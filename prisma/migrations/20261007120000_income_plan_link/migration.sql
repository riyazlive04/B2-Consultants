-- Which receivable a payment settles (FIN-12).
--
-- Paid-so-far was summed per STUDENT and handed to every plan that student had, so four plans
-- each claimed the whole payment history: all four read "nothing left to collect" while their
-- instalments were still due, and the receivables total came out below reality.
--
-- Additive and nullable on purpose. The ~23k existing rows predate the column and keep working:
-- lib/payment-allocation credits an unlinked payment across that student's plans oldest first,
-- each capped at its own balance, so the money is counted ONCE without a backfill guess.
-- ON DELETE SET NULL, matching the student/enrollment links beside it: archiving a receivable
-- must never take the record of the money with it.

ALTER TABLE "income" ADD COLUMN "pendingPaymentId" TEXT;

ALTER TABLE "income"
  ADD CONSTRAINT "income_pendingPaymentId_fkey"
  FOREIGN KEY ("pendingPaymentId") REFERENCES "pending_payment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "income_pendingPaymentId_idx" ON "income"("pendingPaymentId");
