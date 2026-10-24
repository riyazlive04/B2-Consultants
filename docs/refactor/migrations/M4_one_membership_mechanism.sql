-- M4 · One batch-membership mechanism — STAGE 1 ONLY (P1)
--
-- NOT APPLIED, and NOT APPROVED. This needs two decisions from the founder before it is run:
--   1. Option A or Option B (see docs/refactor/migrations/README.md). My recommendation is A.
--   2. Whether stage 1 may go on live at all.
--
-- ── Why this is the cheapest it will ever be ───────────────────────────────────────────
-- Measured on live 23 Oct 2026: 23 cohorts, ZERO `batch_member` rows, 1 seated enrolment. German
-- Note membership is entirely unused today, so stage 1 would create exactly one row. If this
-- migration is ever going to happen, it is far less frightening now than after the German Note
-- rosters fill up.
--
-- ── What stage 1 is, and is not ────────────────────────────────────────────────────────
-- ADDITIVE ONLY. Nothing is removed, nothing changes behaviour, and no application code has to
-- change on the day it runs. It gives `batch_member` the link it needs to become the single
-- mechanism later; stages 2 (write both) and 3 (read only the join table, then drop
-- `Enrollment.batchId`) are a separate conversation, and not one to have until stage 1 has sat on
-- live for a full cohort cycle.

-- ──────────────────────── PRE-FLIGHT (run these first) ────────────────────────
-- 1. Per-cohort seat counts, to be compared against the same query AFTER. They must match, or
--    stage 1 is rolled back.
-- SELECT b.id, b.name, b.line,
--        (SELECT count(*) FROM "batch_member" m WHERE m."batchId" = b.id) AS members,
--        (SELECT count(*) FROM "enrollment" e
--          WHERE e."batchId" = b.id AND e.status IN ('ACTIVE','PAUSED'))   AS seated_enrolments
-- FROM "batch" b ORDER BY b.line, b.name;
--
-- 2. Any cohort using BOTH mechanisms. `levelFitsBatchLine` is meant to prevent this; if the
--    query returns anything, understand it before going further.
-- SELECT b.id, b.name FROM "batch" b
-- WHERE (SELECT count(*) FROM "batch_member" m WHERE m."batchId" = b.id) > 0
--   AND (SELECT count(*) FROM "enrollment" e
--         WHERE e."batchId" = b.id AND e.status IN ('ACTIVE','PAUSED')) > 0;
--
-- 3. A VERIFIED backup. `npm run db:backup` verifies its own dump; a backup nobody restored is a
--    hope, not a backup.

-- ─────────────────────────── UP (stage 1 of 3) ───────────────────────────
BEGIN;

-- 1. Membership gains the link to the enrolment that holds the seat.
ALTER TABLE "batch_member" ADD COLUMN "enrollmentId" TEXT;

ALTER TABLE "batch_member"
  ADD CONSTRAINT "batch_member_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index: one member row per enrolment, while leaving every German Note row (which
-- has no enrolment, and never will) free to hold NULL.
CREATE UNIQUE INDEX "batch_member_enrollmentId_key"
  ON "batch_member"("enrollmentId") WHERE "enrollmentId" IS NOT NULL;

-- 2. Backfill a member row for every seated enrolment.
--
--    `IN ('ACTIVE','PAUSED')` is SEATED_STATUSES from lib/enrollment-lifecycle.ts, written as the
--    POSITIVE list on purpose: a fifth status added later must then be considered here rather
--    than swept in silently by a NOT IN.
--
--    Idempotent - the NOT EXISTS makes re-running add nothing.
--
--    The id carries a `bm_mig_` prefix. Every other id in this database is a cuid, so these are
--    instantly identifiable as backfilled, which is what makes the rollback below EXACT rather
--    than approximate.
INSERT INTO "batch_member" ("id", "batchId", "studentId", "enrollmentId", "addedAt")
SELECT 'bm_mig_' || gen_random_uuid()::text,
       e."batchId",
       e."studentId",
       e.id,
       COALESCE(e."enrollmentDate", now())
FROM "enrollment" e
WHERE e."batchId" IS NOT NULL
  AND e.status IN ('ACTIVE', 'PAUSED')
  AND NOT EXISTS (
    SELECT 1 FROM "batch_member" m
    WHERE m."batchId" = e."batchId" AND m."studentId" = e."studentId"
  );

COMMIT;

-- ──────────────────────── POST-FLIGHT (run immediately) ────────────────────────
-- Re-run pre-flight query 1. `members` must have increased by exactly `seated_enrolments` for
-- every cohort, and `seated_enrolments` must be unchanged. Anything else: roll back.
--
-- SELECT count(*) AS backfilled FROM "batch_member" WHERE "id" LIKE 'bm_mig_%';
-- -- expected: the total of `seated_enrolments` from pre-flight (1, as of 23 Oct 2026)

-- ───────────────────────── DOWN (stage 1) ─────────────────────────
-- Deletes ONLY the rows this migration created, by their prefix. A seat added through the app
-- after stage 1 has a cuid and is real data; it is left alone rather than swept away with copies.
--
-- BEGIN;
-- DELETE FROM "batch_member" WHERE "id" LIKE 'bm_mig_%';
-- DROP INDEX "batch_member_enrollmentId_key";
-- ALTER TABLE "batch_member" DROP CONSTRAINT "batch_member_enrollmentId_fkey";
-- ALTER TABLE "batch_member" DROP COLUMN "enrollmentId";
-- COMMIT;

-- ⚠ WHAT THE PREFIX DOES AND DOES NOT BUY
-- It makes the DOWN precise: backfilled copies go, real seats stay. What it cannot do is restore
-- the enrollmentId LINK on a real seat, because that column is being dropped - so a coaching seat
-- added through the new mechanism after stage 1 reverts to a `batch_member` row with no enrolment
-- attached, while the enrolment it belonged to has a null `batchId`. Somebody would have to
-- re-seat that person.
--
-- So: stage 1 is CLEANLY reversible until the app writes through the new mechanism, and
-- RE-SEATABLE rather than clean after that. Take the backup either way.

-- ─────────────── prisma/schema.prisma, model BatchMember ───────────────
--   enrollmentId String?     @unique
--   enrollment   Enrollment? @relation(fields: [enrollmentId], references: [id], onDelete: SetNull)
--
-- …and `memberSeat BatchMember?` on Enrollment.
--
-- NOTE: Prisma's `@unique` emits a plain unique index, which on Postgres already permits multiple
-- NULLs - so it matches the partial index above in behaviour. If `prisma migrate dev` is used to
-- generate this, CHECK the SQL it produces: this project has been bitten before by a generated
-- migration that dropped and re-added a column rather than altering it.
