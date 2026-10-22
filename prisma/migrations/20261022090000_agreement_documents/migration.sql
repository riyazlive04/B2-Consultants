-- Uploaded agreement documents: templates, versions, and an agreement's own body.
--
-- Hand-written rather than generated, for the usual reason in this repo: `prisma migrate dev`
-- against a schema this size reaches for a drop-and-re-add on anything it cannot diff cleanly,
-- and `agreement` is the one table in the database that must never be rebuilt.
--
-- Additive only. `agreement.documentKind` defaults to 'GUIDED', so every existing row keeps
-- rendering through `documents/agreement-guided-*` and keeps the content hash printed on its
-- signed pages (contentHash is passed no body for a GUIDED agreement).

-- CreateEnum
CREATE TYPE "AgreementDocKind" AS ENUM ('GUIDED', 'DOCX', 'PDF');

-- AlterEnum
-- Safe inside the migration's transaction on PG 12+: the new value is added here and first USED
-- by application code afterwards, which is the restriction that rule is actually about.
ALTER TYPE "AgreementEventType" ADD VALUE 'DOCUMENT_ATTACHED';

-- AlterTable
ALTER TABLE "agreement" ADD COLUMN "documentKind" "AgreementDocKind" NOT NULL DEFAULT 'GUIDED';

-- CreateTable
CREATE TABLE "agreement_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AgreementDocKind" NOT NULL,
    "currentVersionId" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_template_version" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "kind" "AgreementDocKind" NOT NULL,
    "blocks" JSONB,
    "sourceBytes" BYTEA,
    "sourceName" TEXT NOT NULL,
    "sourceMime" TEXT NOT NULL,
    "sourceSize" INTEGER NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "pageSizes" JSONB,
    "fields" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_body" (
    "agreementId" TEXT NOT NULL,
    "kind" "AgreementDocKind" NOT NULL,
    "templateId" TEXT,
    "templateVersionId" TEXT,
    "templateLabel" TEXT,
    "blocks" JSONB,
    "sourceBytes" BYTEA,
    "sourceName" TEXT NOT NULL,
    "sourceMime" TEXT NOT NULL,
    "sourceSize" INTEGER NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "pageSizes" JSONB,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_body_pkey" PRIMARY KEY ("agreementId")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_template_currentVersionId_key" ON "agreement_template"("currentVersionId");

-- CreateIndex
CREATE INDEX "agreement_template_archivedAt_updatedAt_idx" ON "agreement_template"("archivedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_template_version_templateId_version_key" ON "agreement_template_version"("templateId", "version");

-- CreateIndex
CREATE INDEX "agreement_template_version_templateId_createdAt_idx" ON "agreement_template_version"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "agreement_body_templateId_idx" ON "agreement_body"("templateId");

-- AddForeignKey
ALTER TABLE "agreement_template" ADD CONSTRAINT "agreement_template_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "agreement_template_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_template" ADD CONSTRAINT "agreement_template_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_template_version" ADD CONSTRAINT "agreement_template_version_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "agreement_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_template_version" ADD CONSTRAINT "agreement_template_version_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_body" ADD CONSTRAINT "agreement_body_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_body" ADD CONSTRAINT "agreement_body_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "agreement_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_body" ADD CONSTRAINT "agreement_body_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "agreement_template_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────── Integrity guards (extends 20260710102518_agreements_esign) ───────────────────

-- `documentKind` decides WHICH RENDERER a signed agreement is served by, so it is evidence in
-- exactly the sense the rest of this function already guards: flipping it after the fact would
-- hand a different document to anyone re-reading the contract. Everything else in the comparison
-- is unchanged; `CREATE OR REPLACE` keeps the existing trigger binding.
CREATE OR REPLACE FUNCTION agreement_seal_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."signedAt" IS NULL THEN
    RETURN NEW; -- an unsigned agreement is still a draft; edit freely
  END IF;
  IF NEW."documentNo"          IS DISTINCT FROM OLD."documentNo"
     OR NEW."templateVersion"  IS DISTINCT FROM OLD."templateVersion"
     OR NEW."documentKind"     IS DISTINCT FROM OLD."documentKind"
     OR NEW."data"             IS DISTINCT FROM OLD."data"
     OR NEW."dataSha256"       IS DISTINCT FROM OLD."dataSha256"
     OR NEW."pdfBytes"         IS DISTINCT FROM OLD."pdfBytes"
     OR NEW."pdfSha256"        IS DISTINCT FROM OLD."pdfSha256"
     OR NEW."signedAt"         IS DISTINCT FROM OLD."signedAt"
     OR NEW."founderSignedAt"  IS DISTINCT FROM OLD."founderSignedAt"
     OR NEW."studentSignaturePng" IS DISTINCT FROM OLD."studentSignaturePng"
     OR NEW."founderSignaturePng" IS DISTINCT FROM OLD."founderSignaturePng"
  THEN
    RAISE EXCEPTION 'agreement %: the sealed record is immutable once signed', OLD."documentNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The body of an uploaded agreement IS its terms - for a DOCX document the blocks are the prose
-- itself, and for either kind the field placement decides who signed what. Once the parent is
-- signed it is frozen as hard as `data` is, and against raw SQL too: the service layer's
-- `status = 'DRAFT'` compare-and-set is the first line, this is the one that holds when somebody
-- is sitting at a psql prompt.
--
-- Rows are still DELETEable by cascade from a deleted draft agreement, because
-- `agreement_signed_no_delete` already refuses to delete a signed agreement at all.
CREATE OR REPLACE FUNCTION agreement_body_seal_guard() RETURNS trigger AS $$
DECLARE
  sealed TIMESTAMP(3);
  docno  TEXT;
BEGIN
  SELECT a."signedAt", a."documentNo" INTO sealed, docno
    FROM "agreement" a
   WHERE a."id" = COALESCE(NEW."agreementId", OLD."agreementId");

  IF sealed IS NOT NULL THEN
    RAISE EXCEPTION 'agreement %: the signed document body is immutable', docno;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_body_sealed_immutable
  BEFORE UPDATE OR DELETE ON "agreement_body"
  FOR EACH ROW EXECUTE FUNCTION agreement_body_seal_guard();
