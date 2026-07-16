-- CreateEnum
CREATE TYPE "GnWorkshopSource" AS ENUM ('AD', 'ORGANIC');

-- AlterTable: costs are now derived (cost model + ad-spend allocation), not stored.
ALTER TABLE "gn_workshop_conversion"
  DROP COLUMN "adSpendInrMinor",
  DROP COLUMN "booksCostInrMinor",
  DROP COLUMN "tutorCostInrMinor",
  ADD COLUMN "source" "GnWorkshopSource" NOT NULL DEFAULT 'AD',
  ADD COLUMN "booksCostOverrideInrMinor" BIGINT,
  ADD COLUMN "tutorCostOverrideInrMinor" BIGINT;
