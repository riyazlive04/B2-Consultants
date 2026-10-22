-- Co-signers, signer-filled fields, attachments, per-document options and trusted timestamps.
--
-- The second half of the agreements work (the first is 20261022090000_agreement_documents, and
-- this one depends on it: `agreement_body` and the `AgreementDocKind` enum must already exist).
--
-- Hand-written, for the reason given in the first migration: `prisma migrate dev` reaches for a
-- drop-and-re-add on anything it cannot diff cleanly, and `agreement` is the one table in this
-- database that must never be rebuilt.
--
-- ADDITIVE ONLY. Every new column is nullable with no default, so an agreement that exists today
-- reads back exactly as it does now - and because none of them enter `contentHash` unless a
-- document actually uses them, every signed PDF keeps the content hash printed on its pages.

-- AlterEnum
--
-- Safe inside this migration's transaction on PG 12+: values are ADDED here and first USED by
-- application code afterwards, which is the restriction that rule is really about.
ALTER TYPE "AgreementEventType" ADD VALUE 'SIGNER_SIGNED';
ALTER TYPE "AgreementEventType" ADD VALUE 'SIGNER_DECLINED';
ALTER TYPE "AgreementEventType" ADD VALUE 'ATTACHMENT_UPLOADED';
ALTER TYPE "AgreementEventType" ADD VALUE 'TIMESTAMPED';
ALTER TYPE "AgreementEventType" ADD VALUE 'IN_PERSON';

-- AlterTable: what the student typed and ticked, and the trusted timestamp over the sealed bytes
ALTER TABLE "agreement" ADD COLUMN     "signerFieldValues" JSONB,
                        ADD COLUMN     "tsToken" BYTEA,
                        ADD COLUMN     "tsAuthority" TEXT,
                        ADD COLUMN     "tsGenTime" TIMESTAMP(3),
                        ADD COLUMN     "tsError" TEXT;

-- AlterTable: per-document switches (currently `initialEveryPage`)
ALTER TABLE "agreement_template_version" ADD COLUMN "options" JSONB;
ALTER TABLE "agreement_body" ADD COLUMN "options" JSONB;

-- CreateTable
CREATE TABLE "agreement_signer" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "signaturePng" BYTEA,
    "signedAt" TIMESTAMP(3),
    "device" JSONB,
    "fieldValues" JSONB,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_signer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_attachment" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "signerRole" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Unique like the student's: a leaked row cannot be redeemed, because only the hash is stored.
CREATE UNIQUE INDEX "agreement_signer_tokenHash_key" ON "agreement_signer"("tokenHash");

-- CreateIndex
CREATE INDEX "agreement_signer_agreementId_position_idx" ON "agreement_signer"("agreementId", "position");

-- CreateIndex
CREATE INDEX "agreement_signer_expiresAt_idx" ON "agreement_signer"("expiresAt");

-- CreateIndex
-- One file per box: uploading again REPLACES, rather than leaving the renderer to pick.
CREATE UNIQUE INDEX "agreement_attachment_agreementId_fieldId_key" ON "agreement_attachment"("agreementId", "fieldId");

-- AddForeignKey
ALTER TABLE "agreement_signer" ADD CONSTRAINT "agreement_signer_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_attachment" ADD CONSTRAINT "agreement_attachment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────── Integrity guards ───────────────────

-- `signerFieldValues` joins the frozen set.
--
-- It holds the consent boxes the student ticked, and a tick that could be added - or removed -
-- after the fact would be worth exactly nothing. It is written in the same statement that sets
-- `signedAt`, so it is covered from the first instant it exists.
--
-- The timestamp columns are DELIBERATELY ABSENT from this comparison, and that is not an
-- oversight: a timestamp is taken OVER the sealed bytes and therefore cannot exist until after
-- they are sealed. `tsToken` is written once, guarded by its own `tsToken IS NULL` compare-and-set
-- in the application, and `tsError` is a retry note. See server/agreement-timestamp.ts.
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
     OR NEW."signerFieldValues" IS DISTINCT FROM OLD."signerFieldValues"
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

-- A co-signer's ink is evidence in exactly the same way the student's is, and theirs lands BEFORE
-- the seal - so the moment the parent agreement is signed, their row is frozen too. Without this,
-- the signature on a sealed document could be swapped for a different one afterwards.
--
-- `declinedAt` is in the comparison as well: a refusal that could be erased would let a blocked
-- agreement be quietly unblocked.
CREATE OR REPLACE FUNCTION agreement_signer_seal_guard() RETURNS trigger AS $$
DECLARE
  sealed TIMESTAMP(3);
  docno  TEXT;
BEGIN
  SELECT a."signedAt", a."documentNo" INTO sealed, docno
    FROM "agreement" a
   WHERE a."id" = COALESCE(NEW."agreementId", OLD."agreementId");

  IF sealed IS NOT NULL THEN
    RAISE EXCEPTION 'agreement %: a signer on a sealed agreement is immutable', docno;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_signer_sealed_immutable
  BEFORE UPDATE OR DELETE ON "agreement_signer"
  FOR EACH ROW EXECUTE FUNCTION agreement_signer_seal_guard();

-- The same for files collected during a ceremony. An ID photo that could be replaced after the
-- contract was sealed is not evidence of anything.
CREATE OR REPLACE FUNCTION agreement_attachment_seal_guard() RETURNS trigger AS $$
DECLARE
  sealed TIMESTAMP(3);
  docno  TEXT;
BEGIN
  SELECT a."signedAt", a."documentNo" INTO sealed, docno
    FROM "agreement" a
   WHERE a."id" = COALESCE(NEW."agreementId", OLD."agreementId");

  IF sealed IS NOT NULL THEN
    RAISE EXCEPTION 'agreement %: an attachment on a sealed agreement is immutable', docno;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_attachment_sealed_immutable
  BEFORE UPDATE OR DELETE ON "agreement_attachment"
  FOR EACH ROW EXECUTE FUNCTION agreement_attachment_seal_guard();
