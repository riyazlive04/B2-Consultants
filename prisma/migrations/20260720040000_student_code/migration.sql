-- Human-readable student number (§6.1): two students called "Anna Smith" were
-- indistinguishable on screen, which has already caused a payment to be credited
-- to the wrong person.
--
-- Deliberately additive and reversible:
--   * the column is NULLABLE, so every existing row stays valid the instant this
--     lands and the app keeps working before the backfill has run;
--   * Postgres allows many NULLs under a UNIQUE index, so the constraint can be
--     created up-front and still let the backfill fill rows in at its own pace.
-- Rollback is DROP INDEX + DROP COLUMN; no data is rewritten by this migration.
ALTER TABLE "student" ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "student_code_key" ON "student"("code");
