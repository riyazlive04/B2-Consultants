-- Phase 4 of the funnel builder: global header/footer, a snippet library (templates + sections),
-- and A/B split variants. All additive — every existing funnel and step keeps working untouched.

-- CreateEnum
CREATE TYPE "SnippetScope" AS ENUM ('SECTION', 'PAGE');

-- AlterTable: blocks rendered around EVERY step of a funnel.
ALTER TABLE "funnel" ADD COLUMN     "footerBlocks" JSONB,
ADD COLUMN     "headerBlocks" JSONB;

-- AlterTable: a variant points at the step it tests against; the control has abTestOf NULL.
ALTER TABLE "funnel_step" ADD COLUMN     "abTestOf" TEXT,
ADD COLUMN     "abWeight" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "section_snippet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "scope" "SnippetScope" NOT NULL DEFAULT 'SECTION',
    "blocks" JSONB NOT NULL,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_snippet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "section_snippet_scope_category_idx" ON "section_snippet"("scope", "category");

-- CreateIndex
CREATE INDEX "funnel_step_abTestOf_idx" ON "funnel_step"("abTestOf");

-- AddForeignKey: deleting a control removes its variants with it — a variant of nothing is a
-- page nobody can reach and nobody remembers creating.
ALTER TABLE "funnel_step" ADD CONSTRAINT "funnel_step_abTestOf_fkey" FOREIGN KEY ("abTestOf") REFERENCES "funnel_step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_snippet" ADD CONSTRAINT "section_snippet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
