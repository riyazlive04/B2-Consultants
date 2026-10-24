-- Two approved structural fixes, 24 October 2026. Hand-written, not generated:
-- `prisma migrate dev` has produced a destructive drop-and-re-add on this schema before.
--
-- Proposals and reasoning: docs/refactor/migrations/README.md (M1 and M2).
-- Pre-flight audit: `npm run migration:audit` - every constrained column verified clean first.

-- ─────────────────────────────────────────────────────────────────────────────
-- M1 · An invoice can name the student and the enrolment it bills (was P14)
--
-- `leadId` alone could not answer "what has this student paid": it needed a join through
-- provenance, and it failed outright for a student who was never a lead - a walk-in, a German
-- Note learner, anyone imported.
--
-- Additive and nullable: an invoice legitimately predates the student record, and not every
-- invoice is for a student. SET NULL rather than CASCADE because an invoice is a financial
-- record and must outlive the row it points at.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "invoice" ADD COLUMN "studentId" TEXT;
ALTER TABLE "invoice" ADD COLUMN "enrollmentId" TEXT;

ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "invoice_studentId_idx" ON "invoice"("studentId");
CREATE INDEX "invoice_enrollmentId_idx" ON "invoice"("enrollmentId");

-- ─────────────────────────────────────────────────────────────────────────────
-- M2 · Level.code becomes a real reference (was P6)
--
-- `Level` had ZERO schema relations. Its `code` was soft-referenced as plain text in twelve
-- columns, nothing validated any of them, and two of three curriculum plans on live were filed
-- under a programme that does not exist - one of them a plain typo, "Gudied30". Corrected
-- 24/10/2026; this is what stops it recurring.
--
-- ON UPDATE CASCADE is the point: a level becomes RENAMEABLE instead of orphaning every row that
-- held its old code.
--
-- ON DELETE RESTRICT on the five required references means a level IN USE cannot be deleted. It
-- is switched off instead (`Level.active`), which is what that column is for. Nullable references
-- use SET NULL, because losing "which level did this lead win" is survivable and refusing to
-- delete a level over a closed deal is not.
--
-- NOT constrained, deliberately - four SNAPSHOT columns: income.programLevel,
-- invoiceLineItem.levelCode, tutorFee.level, bookOrder.level. Each records what was true when a
-- document was issued or a figure computed, and a level renamed afterwards must leave them saying
-- what they said. A foreign key on a frozen record is how an audit trail gets rewritten.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_programLevel_fkey"
  FOREIGN KEY ("programLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "batch"
  ADD CONSTRAINT "batch_level_fkey"
  FOREIGN KEY ("level") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "pending_payment"
  ADD CONSTRAINT "pending_payment_programLevel_fkey"
  FOREIGN KEY ("programLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "program_milestone"
  ADD CONSTRAINT "program_milestone_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "gn_pending_joiner"
  ADD CONSTRAINT "gn_pending_joiner_level_fkey"
  FOREIGN KEY ("level") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "lead"
  ADD CONSTRAINT "lead_wonLevel_fkey"
  FOREIGN KEY ("wonLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "product"
  ADD CONSTRAINT "product_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "curriculum_template"
  ADD CONSTRAINT "curriculum_template_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;
