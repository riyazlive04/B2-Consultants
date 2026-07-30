-- ER v2 Track E — Enrollment as the contract anchor.
--
-- Agreement, BookOrder and PendingPayment all hung off Student. For a student on three
-- German levels, "which level is this contract / these books / this EMI plan for" was a
-- guess. This adds a SECOND, sharper link; `studentId` stays exactly as it is on all three.
--
-- Every column is nullable with ON DELETE SET NULL. The backfill (prisma/backfill-enrollment-links.ts)
-- links only unambiguous matches and leaves the rest null on purpose — a wrongly attributed
-- agreement is worse than an unattributed one.

ALTER TABLE "agreement"       ADD COLUMN "enrollmentId" TEXT;
ALTER TABLE "book_order"      ADD COLUMN "enrollmentId" TEXT;
ALTER TABLE "pending_payment" ADD COLUMN "enrollmentId" TEXT;

-- ER v2 EMI_PLAN.num_emis / levels_taken. Stored, not counted off instalment rows: these are
-- INPUTS the founder sets when building the plan ("2 EMIs per level"), and the rows they
-- imply may not all exist yet.
ALTER TABLE "pending_payment" ADD COLUMN "numEmis" INTEGER;
ALTER TABLE "pending_payment" ADD COLUMN "levelsTaken" INTEGER;

ALTER TABLE "agreement" ADD CONSTRAINT "agreement_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "book_order" ADD CONSTRAINT "book_order_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pending_payment" ADD CONSTRAINT "pending_payment_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "agreement_enrollmentId_idx"       ON "agreement"("enrollmentId");
CREATE INDEX "book_order_enrollmentId_idx"      ON "book_order"("enrollmentId");
CREATE INDEX "pending_payment_enrollmentId_idx" ON "pending_payment"("enrollmentId");
