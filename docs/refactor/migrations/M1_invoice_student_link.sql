-- M1 · Invoice can name the student (P14)
--
-- NOT APPLIED. See docs/refactor/migrations/README.md for the reasoning, the risk and the
-- measured live impact (7 invoices; the backfill below currently matches nothing).
--
-- Deliberately NOT placed in prisma/migrations/: a folder there is picked up by the next
-- `npm run db:deploy`, and these must not apply themselves. When approved, create the Prisma
-- migration and paste the UP section into its migration.sql.
--
-- Run order: UP, then the schema.prisma change, then `npx prisma generate`, then the BACKFILL
-- as a separate deliberate step once the read code is in and tolerating nulls.

-- ─────────────────────────────── UP ───────────────────────────────
BEGIN;

ALTER TABLE "invoice" ADD COLUMN "studentId" TEXT;
ALTER TABLE "invoice" ADD COLUMN "enrollmentId" TEXT;

-- SET NULL, never CASCADE: an invoice is a financial record and must outlive the student row it
-- points at. Cascading would let a student deletion erase issued invoices, which is the one thing
-- the ledger exists to prevent.
ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "invoice_studentId_idx" ON "invoice"("studentId");
CREATE INDEX "invoice_enrollmentId_idx" ON "invoice"("enrollmentId");

COMMIT;

-- ───────────────────────────── BACKFILL ─────────────────────────────
-- Separate on purpose: re-runnable, readable, and reversible on its own (see DOWN-BACKFILL).
-- Only fills where the join is UNAMBIGUOUS. A lead with two students is skipped rather than
-- guessed - a wrongly attributed invoice is worse than an unattributed one.
--
-- BEGIN;
-- UPDATE "invoice" i
-- SET "studentId" = s.id
-- FROM "student" s
-- WHERE i."leadId" IS NOT NULL
--   AND s."leadId" = i."leadId"
--   AND i."studentId" IS NULL
--   AND (SELECT count(*) FROM "student" x WHERE x."leadId" = i."leadId") = 1;
-- COMMIT;

-- Check what it would do first:
-- SELECT count(*) FILTER (WHERE n = 1) AS will_fill,
--        count(*) FILTER (WHERE n > 1) AS ambiguous,
--        count(*) FILTER (WHERE n = 0) AS lead_never_became_a_student
-- FROM (
--   SELECT (SELECT count(*) FROM "student" x WHERE x."leadId" = i."leadId") AS n
--   FROM "invoice" i WHERE i."leadId" IS NOT NULL
-- ) q;

-- ────────────────────────── DOWN-BACKFILL ──────────────────────────
-- Undoes only the links the backfill made. Safe at any time: it cannot distinguish a link made
-- by hand afterwards, so run it ONLY if nothing has set `studentId` manually since.
-- UPDATE "invoice" SET "studentId" = NULL WHERE "studentId" IS NOT NULL;

-- ────────────────────────────── DOWN ──────────────────────────────
-- BEGIN;
-- DROP INDEX "invoice_enrollmentId_idx";
-- DROP INDEX "invoice_studentId_idx";
-- ALTER TABLE "invoice" DROP CONSTRAINT "invoice_enrollmentId_fkey";
-- ALTER TABLE "invoice" DROP CONSTRAINT "invoice_studentId_fkey";
-- ALTER TABLE "invoice" DROP COLUMN "enrollmentId";
-- ALTER TABLE "invoice" DROP COLUMN "studentId";
-- COMMIT;

-- ─────────────────── prisma/schema.prisma, model Invoice ───────────────────
-- Add beside the existing `leadId` / `lead` pair:
--
--   studentId    String?
--   student      Student?    @relation(fields: [studentId], references: [id], onDelete: SetNull)
--   enrollmentId String?
--   enrollment   Enrollment? @relation(fields: [enrollmentId], references: [id], onDelete: SetNull)
--
--   @@index([studentId])
--   @@index([enrollmentId])
--
-- …and the matching back-relations on Student (`invoices Invoice[]`) and Enrollment
-- (`invoices Invoice[]`).
