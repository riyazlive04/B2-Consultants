-- ER v2 Track C — tutor fees as a record.
--
-- The RULE already shipped and is unit-tested (lib/tutor-fee.ts). This persists its OUTPUT so
-- "what did this trainer earn for this batch, and have we paid it" has an answer.
--
-- headcount / ratePerHeadInrMinor / amountInrMinor are SNAPSHOTS taken at compute time. A
-- student joining next month must not silently re-price a fee the founder already approved —
-- the same discipline as Agreement.data and BookOrder.shipToAddress.

CREATE TYPE "TutorFeeStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

CREATE TABLE "tutor_fee" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "trainerId" TEXT,
    "level" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "ratePerHeadInrMinor" BIGINT NOT NULL,
    "amountInrMinor" BIGINT NOT NULL,
    "overrideAmountInrMinor" BIGINT,
    "overrideReason" TEXT,
    "status" "TutorFeeStatus" NOT NULL DEFAULT 'DRAFT',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "postedEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tutor_fee_pkey" PRIMARY KEY ("id")
);

-- D3: the rate is per level per batch, not monthly. A batch running A1 then A2 makes two rows.
CREATE UNIQUE INDEX "tutor_fee_batchId_level_key" ON "tutor_fee"("batchId", "level");
CREATE INDEX "tutor_fee_trainerId_status_idx" ON "tutor_fee"("trainerId", "status");
CREATE INDEX "tutor_fee_status_computedAt_idx" ON "tutor_fee"("status", "computedAt");

ALTER TABLE "tutor_fee" ADD CONSTRAINT "tutor_fee_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, like every other money-adjacent actor link: deleting a user must never delete the
-- record of what they were owed.
ALTER TABLE "tutor_fee" ADD CONSTRAINT "tutor_fee_trainerId_fkey"
  FOREIGN KEY ("trainerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An APPROVED or PAID fee is frozen. Recompute skips them in application code; this trigger
-- is the backstop, because "the recompute job will be careful" is not an integrity guarantee.
-- Status transitions and the payout stamps are still allowed — it is the MONEY and the
-- evidence behind it that may not move once signed off.
CREATE OR REPLACE FUNCTION forbid_settled_tutor_fee_edit() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'PAID') AND (
       NEW."headcount"           IS DISTINCT FROM OLD."headcount"
    OR NEW."ratePerHeadInrMinor" IS DISTINCT FROM OLD."ratePerHeadInrMinor"
    OR NEW."amountInrMinor"      IS DISTINCT FROM OLD."amountInrMinor"
    OR NEW."level"               IS DISTINCT FROM OLD."level"
    OR NEW."batchId"             IS DISTINCT FROM OLD."batchId"
  ) THEN
    RAISE EXCEPTION 'tutor_fee %: cannot change the computed amount of an % fee', OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tutor_fee_settled_guard
  BEFORE UPDATE ON "tutor_fee"
  FOR EACH ROW EXECUTE FUNCTION forbid_settled_tutor_fee_edit();
