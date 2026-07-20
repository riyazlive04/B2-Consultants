-- Attribute a cost to a business (§1.4).
--
-- Without this, per-line profit margin and runway were mathematically degenerate: allocating
-- every cost by revenue share makes net÷revenue (and cash÷burn) identical for B2 and German
-- Note by construction, so the numbers looked precise and carried no information.
--
-- Additive and non-rewriting: the column is NOT NULL but carries a DEFAULT, which Postgres
-- 11+ stores as metadata rather than rewriting every row. Defaulting to SHARED means existing
-- expenses keep exactly the behaviour they had before this column existed — apportioned by
-- revenue share — so no history is silently reattributed. The split sharpens only as costs
-- are deliberately tagged.
-- Rollback is DROP COLUMN + DROP TYPE.
CREATE TYPE "ExpenseBusinessLine" AS ENUM ('B2', 'GERMAN_NOTE', 'SHARED');

ALTER TABLE "expense"
  ADD COLUMN "businessLine" "ExpenseBusinessLine" NOT NULL DEFAULT 'SHARED';
