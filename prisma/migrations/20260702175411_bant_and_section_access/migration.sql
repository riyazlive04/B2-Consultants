-- AlterTable
ALTER TABLE "discovery_outcome" ADD COLUMN     "bantAuthority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bantBudget" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bantNeed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bantTimeline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "sectionAccess" JSONB;
