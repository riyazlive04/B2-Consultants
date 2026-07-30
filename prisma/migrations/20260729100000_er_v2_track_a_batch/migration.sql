-- ER v2 Track A — the delivery spine: one `Batch` for both business lines.
--
-- RENAME, NEVER DROP-AND-CREATE. Every existing German Note batch, its roster, its
-- recordings, its modules, its calendar and its community posts must survive this migration
-- untouched. `ALTER TABLE ... RENAME` is a catalogue-only operation: no rows move, no FK is
-- rebuilt, and the change is instantaneous even on a large table.
--
-- Indexes and constraints are renamed alongside the tables. Postgres would keep working with
-- the old names, but Prisma derives expected names from the model — leaving them stale makes
-- every future `migrate dev` want to drop and recreate them.

-- ── 1. The discriminator ──────────────────────────────────────────────────────
CREATE TYPE "BatchLine" AS ENUM ('B2', 'GERMAN_NOTE');

-- ── 2. gn_batch → batch ───────────────────────────────────────────────────────
ALTER TABLE "gn_batch" RENAME TO "batch";
ALTER TABLE "batch" RENAME CONSTRAINT "gn_batch_pkey" TO "batch_pkey";
ALTER TABLE "batch" RENAME CONSTRAINT "gn_batch_tutorId_fkey" TO "batch_tutorId_fkey";
ALTER INDEX "gn_batch_status_idx" RENAME TO "batch_status_idx";
ALTER INDEX "gn_batch_tutorId_idx" RENAME TO "batch_tutorId_idx";

-- Every row that exists today is a German Note batch — which is exactly why GERMAN_NOTE is
-- the column default rather than B2. Existing behaviour is preserved by construction.
ALTER TABLE "batch" ADD COLUMN "line" "BatchLine" NOT NULL DEFAULT 'GERMAN_NOTE';
ALTER TABLE "batch" ADD COLUMN "code" TEXT;
ALTER TABLE "batch" ADD COLUMN "startDate" DATE;
ALTER TABLE "batch" ADD COLUMN "endDate" DATE;

CREATE UNIQUE INDEX "batch_code_key" ON "batch"("code");
CREATE INDEX "batch_line_status_idx" ON "batch"("line", "status");

-- ── 3. gn_batch_member → batch_member ─────────────────────────────────────────
ALTER TABLE "gn_batch_member" RENAME TO "batch_member";
ALTER TABLE "batch_member" RENAME CONSTRAINT "gn_batch_member_pkey" TO "batch_member_pkey";
ALTER TABLE "batch_member" RENAME CONSTRAINT "gn_batch_member_batchId_fkey" TO "batch_member_batchId_fkey";
ALTER TABLE "batch_member" RENAME CONSTRAINT "gn_batch_member_studentId_fkey" TO "batch_member_studentId_fkey";
ALTER INDEX "gn_batch_member_studentId_idx" RENAME TO "batch_member_studentId_idx";
ALTER INDEX "gn_batch_member_batchId_studentId_key" RENAME TO "batch_member_batchId_studentId_key";

-- ── 4. Enrollment gains its batch and its lead ────────────────────────────────
-- Both NULLABLE and both SetNull. Nullable because no existing enrollment has a batch to
-- point at, and because decision D2 ("is B2 coaching actually batched, or 1:1?") is still
-- open — if the answer is 1:1 this column simply stays empty and costs nothing.
ALTER TABLE "enrollment" ADD COLUMN "batchId" TEXT;
ALTER TABLE "enrollment" ADD COLUMN "leadId" TEXT;

ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "enrollment_batchId_idx" ON "enrollment"("batchId");
CREATE INDEX "enrollment_leadId_idx" ON "enrollment"("leadId");
