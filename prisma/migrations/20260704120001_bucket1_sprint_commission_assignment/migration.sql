-- Bucket-1 table changes: payment plan on leads, weighted BANT on bookings,
-- first-call assignment rules on team profiles, and the sprint-week tracker.

-- AlterTable: split/full pay stamp (set from DEPOSIT_PAID onward)
ALTER TABLE "lead" ADD COLUMN "paymentPlan" "PaymentPlan";

-- AlterTable: weighted BANT average + verdict on booking requests
ALTER TABLE "booking_request" ADD COLUMN "bantAvg" DOUBLE PRECISION,
                              ADD COLUMN "bantVerdict" "BantVerdict";

-- AlterTable: first-call rotation share + Saturday availability
ALTER TABLE "team_profile" ADD COLUMN "firstCallSharePct" INTEGER NOT NULL DEFAULT 0,
                           ADD COLUMN "worksSaturdays" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: sprint tracker (90-day Guided / 120-day Elite week-wise targets)
CREATE TABLE "sprint_week" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "target" TEXT,
    "targetNumeric" DECIMAL(14,2),
    "actual" TEXT,
    "actualNumeric" DECIMAL(14,2),
    "status" "SprintStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_week_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sprint_week_enrollmentId_weekIndex_key" ON "sprint_week"("enrollmentId", "weekIndex");

-- CreateIndex
CREATE INDEX "sprint_week_status_weekEnd_idx" ON "sprint_week"("status", "weekEnd");

-- AddForeignKey
ALTER TABLE "sprint_week" ADD CONSTRAINT "sprint_week_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_week" ADD CONSTRAINT "sprint_week_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
