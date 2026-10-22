-- Why a student stopped: the reason behind the founders' discontinue button (@37:54-39:42).
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────
-- NOT a new enum value. `StudentStatus` has carried DROPPED since the beginning, and
-- `Enrollment.status` is a StudentStatus - the plan that preceded this migration had read
-- `EnrollmentStatus` (ACTIVE | COMPLETED | FAILED) at schema.prisma#L1807, which belongs to
-- `workflow_enrollment`, an automation table with nothing to do with students. So there is no
-- `ALTER TYPE` here, and the destructive drop-and-re-add that `prisma migrate dev` reaches for
-- on enum changes in this repo is not in play.
--
-- ── WHAT IT IS ──────────────────────────────────────────────────────────────────────────
-- Three nullable columns and one foreign key. ADDITIVE ONLY: every enrolment that exists today
-- reads back exactly as it does now, and the rows already sitting at DROPPED simply carry a
-- NULL reason - which the churn breakdown tallies as "Not recorded" rather than discarding.
--
-- There is deliberately no `discontinuedAt` column. `enrollment.statusChangedAt` already records
-- when the status moved and is already what "dropped this month" reads; a second clock would be
-- free to disagree with it.
--
-- ── MONEY IS UNTOUCHED, ON PURPOSE ──────────────────────────────────────────────────────
-- Discontinuing is not a refund. §8 of the agreement is explicit that withdrawal earns no
-- refund, so a student who walks away still owes the instalments they signed for. Nothing in
-- revenue recognition, instalment settlement or the dunning ladder reads enrolment status - they
-- read `pending_payment.status` and `income` - so no column in this migration can reach them.
-- `src/lib/__tests__/enrollment-lifecycle.test.ts` asserts that separation stays true.

-- AlterTable
ALTER TABLE "enrollment" ADD COLUMN     "discontinueReason" TEXT,
                         ADD COLUMN     "discontinueNote" TEXT,
                         ADD COLUMN     "discontinuedById" TEXT;

-- AddForeignKey
--
-- SET NULL, like `coachId` and `closerId` beside it: removing a coach's login must orphan the
-- attribution, never delete the enrolment or the reason the student left.
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_discontinuedById_fkey"
  FOREIGN KEY ("discontinuedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
--
-- The churn breakdown groups DROPPED rows by reason, and the Students board reads it on every
-- load. `status` alone is not selective here (most rows are ACTIVE), so the pair is what makes
-- the breakdown a scan of the dropped rows rather than of the table.
CREATE INDEX "enrollment_status_discontinueReason_idx" ON "enrollment"("status", "discontinueReason");
