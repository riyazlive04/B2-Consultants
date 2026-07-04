-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'HEAD', 'USER');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('MANUAL', 'SYNAMATE', 'RAZORPAY', 'SHEET', 'FATHOM');

-- CreateEnum
CREATE TYPE "ProgramLevel" AS ENUM ('SOLO', 'GUIDED', 'ELITE', 'GN_A1', 'GN_A2', 'GN_B1', 'GN_B2', 'GN_BUNDLE', 'OTHER');

-- CreateEnum
CREATE TYPE "Signal" AS ENUM ('GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('FULL_PAYMENT', 'INSTALMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER_INR', 'BANK_TRANSFER_EUR', 'PAYPAL', 'RAZORPAY', 'CASH', 'UPI', 'CREDIT_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MARKETING', 'TOOLS_SOFTWARE', 'TEAM_SALARIES', 'CONTENT_CREATION', 'EVENTS_OFFLINE', 'OPERATIONS', 'COGS_DIRECT_DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "PendingPaymentStatus" AS ENUM ('ACTIVE', 'PAID_IN_FULL', 'OVERDUE', 'DROPPED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('INSTAGRAM', 'YOUTUBE', 'LINKEDIN', 'WHATSAPP', 'REFERRAL', 'SUMMIT', 'WORKSHOP', 'GHOSTED_BLUEPRINT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW_LEAD', 'DISCO_BOOKED', 'DISCO_NOT_BOOKED', 'DISCO_COMPLETED', 'SSS_BOOKED', 'SSS_COMPLETED', 'PROPOSAL_SENT', 'WON', 'LOST', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('QUALIFIED_FOR_SSS', 'NOT_QUALIFIED_FOR_SSS', 'FOLLOW_UP_NEEDED', 'NO_SHOW', 'SENT_TO_WORKSHOP');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DailyLogVariant" AS ENUM ('DISCOVERY_SPECIALIST', 'APPOINTMENT_SETTER', 'DELIVERY_COACH');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DROPPED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ProgramDuration" AS ENUM ('DAYS_90', 'DAYS_120', 'LIFETIME');

-- CreateEnum
CREATE TYPE "Milestone" AS ENUM ('ONBOARDING', 'RESUME_BUILD', 'LINKEDIN_OPTIMISATION', 'APPLICATIONS', 'INTERVIEWS', 'OFFER_RECEIVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TaskCompletion" AS ENUM ('YES', 'NO', 'PENDING');

-- CreateEnum
CREATE TYPE "OutcomeAchieved" AS ENUM ('JOB_OFFER_RECEIVED', 'INTERVIEWS_ONLY', 'APPLICATIONS_STAGE', 'NO_OUTCOME_YET');

-- CreateEnum
CREATE TYPE "PayableFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "studentName" TEXT NOT NULL,
    "studentId" TEXT,
    "enrollmentId" TEXT,
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL,
    "programLevel" "ProgramLevel" NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "notes" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "externalRef" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "isCogs" BOOLEAN NOT NULL DEFAULT false,
    "vendor" TEXT NOT NULL,
    "notes" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "externalRef" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_payment" (
    "id" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "studentId" TEXT,
    "programLevel" "ProgramLevel" NOT NULL,
    "totalFeeInrMinor" BIGINT NOT NULL DEFAULT 0,
    "totalFeeEurMinor" BIGINT NOT NULL DEFAULT 0,
    "fxRateUsed" DECIMAL(14,6) NOT NULL,
    "nextDueDate" DATE,
    "status" "PendingPaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_target" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "targetInrMinor" BIGINT NOT NULL DEFAULT 80000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "leadSource" "LeadSource" NOT NULL,
    "dateIn" DATE NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW_LEAD',
    "notes" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "externalRef" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" "LeadStage",
    "toStage" "LeadStage" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_outcome" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "callDate" DATE NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "highlyQualified" BOOLEAN NOT NULL DEFAULT false,
    "sssDate" DATE,
    "notes" TEXT,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "externalRef" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "dashboardRole" "Role" NOT NULL DEFAULT 'USER',
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "dateJoined" DATE,
    "keyResponsibilities" TEXT,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "logVariant" "DailyLogVariant" NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "okr" (
    "id" TEXT NOT NULL,
    "teamProfileId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "targetNumeric" DECIMAL(14,2),
    "currentProgress" TEXT,
    "currentNumeric" DECIMAL(14,2),
    "manualCompletionPct" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "variant" "DailyLogVariant" NOT NULL,
    "discoveryCallsCompleted" INTEGER,
    "highlyQualifiedCalls" INTEGER,
    "followUpsDone" INTEGER,
    "proposalsSent" INTEGER,
    "noShows" INTEGER,
    "newLeadsContacted" INTEGER,
    "appointmentsSet" INTEGER,
    "followUpMessagesSent" INTEGER,
    "leadsAddedToPipeline" INTEGER,
    "sessionsDelivered" INTEGER,
    "studentsCheckedInOn" INTEGER,
    "assignmentsReviewed" INTEGER,
    "studentsFlaggedAtRisk" INTEGER,
    "notes" TEXT,
    "correctionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "targetRole" TEXT,
    "leadSource" "LeadSource",
    "leadId" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programLevel" "ProgramLevel" NOT NULL,
    "enrollmentDate" DATE NOT NULL,
    "duration" "ProgramDuration" NOT NULL,
    "programEndDate" DATE,
    "assignedCoach" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSessionDate" DATE,
    "totalSessionsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalSessionsPlanned" INTEGER,
    "lastTaskAssigned" TEXT,
    "lastTaskCompleted" "TaskCompletion",
    "applicationsSubmitted" INTEGER NOT NULL DEFAULT 0,
    "interviewsReceived" INTEGER NOT NULL DEFAULT 0,
    "currentMilestone" "Milestone" NOT NULL DEFAULT 'ONBOARDING',
    "signalColour" "Signal",
    "signalNotes" TEXT,
    "nextCheckInDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_log" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "previousMilestone" "Milestone",
    "newMilestone" "Milestone" NOT NULL,
    "note" TEXT,

    CONSTRAINT "milestone_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_change_log" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,
    "previousSignal" "Signal",
    "newSignal" "Signal" NOT NULL,
    "note" TEXT,

    CONSTRAINT "signal_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satisfaction_score" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "satisfactionScore" INTEGER NOT NULL,
    "npsScore" INTEGER NOT NULL,
    "testimonialReceived" BOOLEAN NOT NULL DEFAULT false,
    "outcomeAchieved" "OutcomeAchieved" NOT NULL DEFAULT 'NO_OUTCOME_YET',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satisfaction_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_funnel_snapshot" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "awarenessReach" INTEGER NOT NULL DEFAULT 0,
    "leadsCaptured" INTEGER NOT NULL DEFAULT 0,
    "callsCompleted" INTEGER NOT NULL DEFAULT 0,
    "proposalsSent" INTEGER NOT NULL DEFAULT 0,
    "enrollmentsSolo" INTEGER NOT NULL DEFAULT 0,
    "enrollmentsGuided" INTEGER NOT NULL DEFAULT 0,
    "enrollmentsElite" INTEGER NOT NULL DEFAULT 0,
    "ghostedDownloads" INTEGER NOT NULL DEFAULT 0,
    "workshopAttendees" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_funnel_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_position" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "bankBalanceInrMinor" BIGINT NOT NULL DEFAULT 0,
    "personalSavingsInrMinor" BIGINT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "frequency" "PayableFrequency" NOT NULL DEFAULT 'MONTHLY',
    "nextDueDate" DATE,
    "isCogs" BOOLEAN NOT NULL DEFAULT false,
    "status" "PayableStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inrPerEur" DECIMAL(14,6) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'frankfurter.app',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "income_date_idx" ON "income"("date");

-- CreateIndex
CREATE INDEX "income_studentId_idx" ON "income"("studentId");

-- CreateIndex
CREATE INDEX "income_programLevel_date_idx" ON "income"("programLevel", "date");

-- CreateIndex
CREATE UNIQUE INDEX "income_source_externalRef_key" ON "income"("source", "externalRef");

-- CreateIndex
CREATE INDEX "expense_date_idx" ON "expense"("date");

-- CreateIndex
CREATE INDEX "expense_isCogs_date_idx" ON "expense"("isCogs", "date");

-- CreateIndex
CREATE UNIQUE INDEX "expense_source_externalRef_key" ON "expense"("source", "externalRef");

-- CreateIndex
CREATE INDEX "pending_payment_status_nextDueDate_idx" ON "pending_payment"("status", "nextDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_target_month_key" ON "monthly_target"("month");

-- CreateIndex
CREATE INDEX "lead_stage_idx" ON "lead"("stage");

-- CreateIndex
CREATE INDEX "lead_dateIn_idx" ON "lead"("dateIn");

-- CreateIndex
CREATE INDEX "lead_leadSource_idx" ON "lead"("leadSource");

-- CreateIndex
CREATE UNIQUE INDEX "lead_source_externalRef_key" ON "lead"("source", "externalRef");

-- CreateIndex
CREATE INDEX "lead_stage_history_leadId_idx" ON "lead_stage_history"("leadId");

-- CreateIndex
CREATE INDEX "lead_stage_history_toStage_changedAt_idx" ON "lead_stage_history"("toStage", "changedAt");

-- CreateIndex
CREATE INDEX "discovery_outcome_callDate_idx" ON "discovery_outcome"("callDate");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_outcome_source_externalRef_key" ON "discovery_outcome"("source", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "team_profile_userId_key" ON "team_profile"("userId");

-- CreateIndex
CREATE INDEX "okr_teamProfileId_month_idx" ON "okr"("teamProfileId", "month");

-- CreateIndex
CREATE INDEX "daily_log_date_idx" ON "daily_log"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_log_userId_date_key" ON "daily_log"("userId", "date");

-- CreateIndex
CREATE INDEX "student_fullName_idx" ON "student"("fullName");

-- CreateIndex
CREATE INDEX "enrollment_studentId_idx" ON "enrollment"("studentId");

-- CreateIndex
CREATE INDEX "enrollment_status_programLevel_idx" ON "enrollment"("status", "programLevel");

-- CreateIndex
CREATE INDEX "enrollment_signalColour_idx" ON "enrollment"("signalColour");

-- CreateIndex
CREATE INDEX "milestone_log_enrollmentId_idx" ON "milestone_log"("enrollmentId");

-- CreateIndex
CREATE INDEX "signal_change_log_enrollmentId_idx" ON "signal_change_log"("enrollmentId");

-- CreateIndex
CREATE INDEX "satisfaction_score_studentId_idx" ON "satisfaction_score"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_funnel_snapshot_weekStart_key" ON "weekly_funnel_snapshot"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "cash_position_date_key" ON "cash_position"("date");

-- CreateIndex
CREATE INDEX "payable_status_nextDueDate_idx" ON "payable"("status", "nextDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rate_date_key" ON "fx_rate"("date");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income" ADD CONSTRAINT "income_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_payment" ADD CONSTRAINT "pending_payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_outcome" ADD CONSTRAINT "discovery_outcome_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_outcome" ADD CONSTRAINT "discovery_outcome_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_profile" ADD CONSTRAINT "team_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "okr" ADD CONSTRAINT "okr_teamProfileId_fkey" FOREIGN KEY ("teamProfileId") REFERENCES "team_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log" ADD CONSTRAINT "daily_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_log" ADD CONSTRAINT "milestone_log_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_log" ADD CONSTRAINT "milestone_log_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_change_log" ADD CONSTRAINT "signal_change_log_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_change_log" ADD CONSTRAINT "signal_change_log_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_score" ADD CONSTRAINT "satisfaction_score_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
