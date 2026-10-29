-- IN-APP IMPROVEMENTS  (docs/IMPROVEMENTS_MODULE_PLAN.md, phase P1)
--
-- Two tables and four enums. PURELY ADDITIVE: no existing table is altered, no column is
-- dropped, no data is rewritten. `user` gains four back-relations, which is a Prisma-side
-- change only and emits no SQL.
--
-- WRITTEN BY HAND, like every other enum change on this schema. `prisma migrate dev` still
-- reaches for a destructive drop-and-re-add here (see the 26 Oct wireflow migration and the
-- configurable-payment-types work for the two previous times that was true). CREATE TYPE is
-- instant and takes no table lock.
--
-- Safe to apply AHEAD of the image: nothing reads these tables until the new code ships, so
-- `npm run db:deploy` first and the container afterwards - which is the order this VPS needs
-- anyway, having no migrate gate of its own.

-- CreateEnum
CREATE TYPE "ImprovementKind" AS ENUM ('NOT_WORKING', 'WRONG_RESULT', 'LOGIC_CHANGE', 'MISSING_STATE', 'NEW_FEATURE', 'CONFUSING', 'ACCESS');

-- CreateEnum
CREATE TYPE "ImprovementSeverity" AS ENUM ('BLOCKING', 'ANNOYING', 'MINOR');

-- CreateEnum
CREATE TYPE "ImprovementStatus" AS ENUM ('NEW', 'TRIAGED', 'ACCEPTED', 'IN_PROGRESS', 'FIXED', 'CLOSED', 'DECLINED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ImprovementEventKind" AS ENUM ('STATUS', 'COMMENT', 'REKIND', 'ASSIGN', 'ATTACH');

-- CreateTable
CREATE TABLE "improvement" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "ImprovementKind" NOT NULL,
    "severity" "ImprovementSeverity" NOT NULL,
    "status" "ImprovementStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "reporterNote" TEXT,
    "route" TEXT NOT NULL,
    "routeParams" JSONB,
    "sectionKey" TEXT,
    "elementTag" JSONB,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "context" JSONB NOT NULL,
    "breadcrumbs" JSONB,
    "clientDigest" TEXT,
    "appVersion" TEXT,
    "reporterId" TEXT NOT NULL,
    "reporterRole" TEXT NOT NULL,
    "assigneeId" TEXT,
    "duplicateOfId" TEXT,
    "devNote" TEXT,
    "resolution" TEXT,
    "fixedInVersion" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "firstTriagedAt" TIMESTAMP(3),
    "fixedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "improvement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_event" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "ImprovementEventKind" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "body" TEXT,
    "visibleToReporter" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The human reference. Unique because it is quoted in conversation ("IMP-0014 is fixed") and two
-- reports sharing one would make that sentence meaningless.
CREATE UNIQUE INDEX "improvement_ref_key" ON "improvement"("ref");

-- CreateIndex
CREATE INDEX "improvement_status_createdAt_idx" ON "improvement"("status", "createdAt");

-- CreateIndex
-- "Which part of the app generates the most reports" - the number that decides where the next
-- week of work goes.
CREATE INDEX "improvement_sectionKey_status_idx" ON "improvement"("sectionKey", "status");

-- CreateIndex
CREATE INDEX "improvement_reporterId_createdAt_idx" ON "improvement"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "improvement_deletedAt_idx" ON "improvement"("deletedAt");

-- CreateIndex
CREATE INDEX "improvement_event_reportId_createdAt_idx" ON "improvement_event"("reportId", "createdAt");

-- AddForeignKey
-- RESTRICT on the reporter, like every other authorship link in this schema: deleting a user
-- must not erase the record that they reported something.
ALTER TABLE "improvement" ADD CONSTRAINT "improvement_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement" ADD CONSTRAINT "improvement_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement" ADD CONSTRAINT "improvement_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "improvement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement" ADD CONSTRAINT "improvement_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: an event is part of its report, not a record in its own right.
ALTER TABLE "improvement_event" ADD CONSTRAINT "improvement_event_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "improvement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_event" ADD CONSTRAINT "improvement_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
