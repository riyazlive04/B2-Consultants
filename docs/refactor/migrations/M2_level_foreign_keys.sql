-- M2 · Level.code becomes a real foreign key (P6)
--
-- NOT APPLIED, and currently BLOCKED. See docs/refactor/migrations/README.md.
--
-- ⚠ PREREQUISITE, measured on live 23 Oct 2026:
--   Two of three curriculum templates hold a level code the catalogue has never heard of -
--   "Guided" (should be "GUIDED") and "Gudied30" (a typo). The foreign key below WILL REFUSE TO
--   BE CREATED while they exist, which is the whole point of it.
--
--   Fix first:  npm run fix:level-codes            (dry run)
--               npm run fix:level-codes -- --apply (writes)
--   Then confirm: npm run migration:audit  → M2 must report "no unknown codes".

-- ──────────────────────── PRE-FLIGHT (run this first) ────────────────────────
-- Every row this returns is a value the app already treats as a level and the catalogue does not
-- have. Must return NOTHING before the UP section is run.
--
-- SELECT 'enrollment.programLevel' AS col, e."programLevel" AS value, count(*)
-- FROM "enrollment" e LEFT JOIN "level" l ON l.code = e."programLevel"
-- WHERE l.code IS NULL GROUP BY 1, 2
-- UNION ALL
-- SELECT 'batch.level', b."level", count(*)
-- FROM "batch" b LEFT JOIN "level" l ON l.code = b."level"
-- WHERE l.code IS NULL GROUP BY 1, 2
-- UNION ALL
-- SELECT 'lead.wonLevel', x."wonLevel", count(*)
-- FROM "lead" x LEFT JOIN "level" l ON l.code = x."wonLevel"
-- WHERE x."wonLevel" IS NOT NULL AND l.code IS NULL GROUP BY 1, 2
-- UNION ALL
-- SELECT 'product.levelCode', p."levelCode", count(*)
-- FROM "product" p LEFT JOIN "level" l ON l.code = p."levelCode"
-- WHERE p."levelCode" IS NOT NULL AND l.code IS NULL GROUP BY 1, 2
-- UNION ALL
-- SELECT 'curriculum_template.levelCode', c."levelCode", count(*)
-- FROM "curriculum_template" c LEFT JOIN "level" l ON l.code = c."levelCode"
-- WHERE c."levelCode" IS NOT NULL AND l.code IS NULL GROUP BY 1, 2;

-- ─────────────────────────────── UP ───────────────────────────────
-- `level.code` is already UNIQUE, so it can be a foreign-key target as it stands.
--
-- ON UPDATE CASCADE is the point of the exercise: it makes a level RENAMEABLE. Today changing a
-- code silently orphans every row that held it.
--
-- ON DELETE RESTRICT on the required columns means a level IN USE cannot be deleted. That is a
-- behaviour change and must ship WITH the code that turns the database error into a sentence -
-- "3 cohorts and 41 enrolments still use GN_A1, switch it off instead" - which is what
-- `Level.active` already exists for.
BEGIN;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_programLevel_fkey"
  FOREIGN KEY ("programLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "batch"
  ADD CONSTRAINT "batch_level_fkey"
  FOREIGN KEY ("level") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

-- Nullable columns: SET NULL on delete. Losing "which level did this lead win" is survivable;
-- refusing to delete a level because a closed deal mentions it is not.
ALTER TABLE "lead"
  ADD CONSTRAINT "lead_wonLevel_fkey"
  FOREIGN KEY ("wonLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "product"
  ADD CONSTRAINT "product_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "curriculum_template"
  ADD CONSTRAINT "curriculum_template_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;

-- ────────────────────────────── DOWN ──────────────────────────────
-- Fully reversible: constraints only, no data touched.
-- BEGIN;
-- ALTER TABLE "curriculum_template" DROP CONSTRAINT "curriculum_template_levelCode_fkey";
-- ALTER TABLE "product" DROP CONSTRAINT "product_levelCode_fkey";
-- ALTER TABLE "lead" DROP CONSTRAINT "lead_wonLevel_fkey";
-- ALTER TABLE "batch" DROP CONSTRAINT "batch_level_fkey";
-- ALTER TABLE "enrollment" DROP CONSTRAINT "enrollment_programLevel_fkey";
-- COMMIT;

-- ──────────────────────── NOT INCLUDED, and why ────────────────────────
-- Seven more columns hold a `Level.code` as text: InvoiceLine.levelCode, Workshop.level (×2
-- models), and the GN economics columns. They are deliberately left for a second pass:
--   · InvoiceLine is a FROZEN document line. A level renamed after an invoice was issued must
--     NOT cascade into it - the invoice says what it said. That column should keep its text.
--   · The workshop models want checking against their own history first.
-- Adding a foreign key to a frozen document is the kind of correctness that breaks an audit
-- trail, so it is a decision rather than a sweep.

-- ─────────────────── prisma/schema.prisma, model Level ───────────────────
-- Add the back-relations (Prisma needs both sides):
--
--   enrollments         Enrollment[]         @relation("EnrollmentLevel")
--   batches             Batch[]              @relation("BatchLevel")
--   wonLeads            Lead[]               @relation("LeadWonLevel")
--   products            Product[]            @relation("ProductLevel")
--   curriculumTemplates CurriculumTemplate[] @relation("CurriculumLevel")
--
-- …and on each referencing model, e.g. Enrollment:
--
--   programLevel      String
--   programLevelRef   Level  @relation("EnrollmentLevel", fields: [programLevel], references: [code], onUpdate: Cascade, onDelete: Restrict)
--
-- Named relations are required because Level ends up with five of them.
