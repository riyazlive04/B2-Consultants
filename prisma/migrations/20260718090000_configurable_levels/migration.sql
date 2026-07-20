-- Configurable levels: replace the `ProgramLevel` Postgres enum with a `level` config table.
--
-- The seven level columns (income.programLevel, pending_payment.programLevel, lead.wonLevel,
-- enrollment.programLevel, gn_batch.level, gn_pending_joiner.level, book_order.level) are cast
-- enum -> text IN PLACE. The enum labels ("GN_A1", "SOLO", …) are preserved verbatim, so no row
-- changes value and every existing (studentId, level) unique pair is unaffected.
--
-- Order matters: create the table + seed it, cast the columns off the enum, THEN drop the enum type.

-- 1. New kind enum for the level catalogue.
CREATE TYPE "LevelKind" AS ENUM ('COACHING_TIER', 'GERMAN_LEVEL', 'GERMAN_BUNDLE', 'OTHER');

-- 2. The configurable level catalogue.
CREATE TABLE "level" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "LevelKind" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "incomeAccountCode" TEXT NOT NULL DEFAULT '4030',
    "booksCostInrMinor" BIGINT,
    "tutorCostInrMinor" BIGINT,
    "bundleMembers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "level_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "level_code_key" ON "level"("code");
CREATE INDEX "level_kind_active_order_idx" ON "level"("kind", "active", "order");

-- 3. Seed from the old enum values. Costs (paise) come from gn-workshop-pricing.ts GN_LEVEL_COST.
INSERT INTO "level"
    ("id", "code", "label", "kind", "order", "active", "locked", "incomeAccountCode", "booksCostInrMinor", "tutorCostInrMinor", "bundleMembers", "updatedAt")
VALUES
    ('lvl_solo',      'SOLO',      'Solo',      'COACHING_TIER',  0, true, true,  '4000', NULL,   NULL,   ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_guided',    'GUIDED',    'Guided',    'COACHING_TIER',  1, true, true,  '4010', NULL,   NULL,   ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_elite',     'ELITE',     'Elite',     'COACHING_TIER',  2, true, true,  '4020', NULL,   NULL,   ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_gn_a1',     'GN_A1',     'GN A1',     'GERMAN_LEVEL',   0, true, false, '4030', 130000, 700000, ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_gn_a2',     'GN_A2',     'GN A2',     'GERMAN_LEVEL',   1, true, false, '4030', 130000, 800000, ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_gn_b1',     'GN_B1',     'GN B1',     'GERMAN_LEVEL',   2, true, false, '4030', 130000, 1200000, ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_gn_b2',     'GN_B2',     'GN B2',     'GERMAN_LEVEL',   3, true, false, '4030', NULL,   NULL,   ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_gn_bundle', 'GN_BUNDLE', 'GN Bundle', 'GERMAN_BUNDLE',  0, true, false, '4030', NULL,   NULL,   ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    ('lvl_other',     'OTHER',     'Other',     'OTHER',          0, true, true,  '4090', NULL,   NULL,   ARRAY[]::TEXT[], CURRENT_TIMESTAMP);

-- 4. Cast the seven columns off the enum, in place (labels preserved).
ALTER TABLE "income"            ALTER COLUMN "programLevel" TYPE TEXT USING "programLevel"::TEXT;
ALTER TABLE "pending_payment"   ALTER COLUMN "programLevel" TYPE TEXT USING "programLevel"::TEXT;
ALTER TABLE "lead"              ALTER COLUMN "wonLevel"     TYPE TEXT USING "wonLevel"::TEXT;
ALTER TABLE "enrollment"        ALTER COLUMN "programLevel" TYPE TEXT USING "programLevel"::TEXT;
ALTER TABLE "gn_batch"          ALTER COLUMN "level"        TYPE TEXT USING "level"::TEXT;
ALTER TABLE "gn_pending_joiner" ALTER COLUMN "level"        TYPE TEXT USING "level"::TEXT;
ALTER TABLE "book_order"        ALTER COLUMN "level"        TYPE TEXT USING "level"::TEXT;

-- 5. The enum type is now unreferenced — drop it.
DROP TYPE "ProgramLevel";
