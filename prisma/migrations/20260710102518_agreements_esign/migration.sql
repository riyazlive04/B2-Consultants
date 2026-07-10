-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgreementEventType" AS ENUM ('CREATED', 'ISSUED', 'DELIVERY_SENT', 'DELIVERY_SKIPPED', 'VIEWED', 'OTP_SENT', 'OTP_VERIFIED', 'OTP_FAILED', 'SIGNED', 'DECLINED', 'VOIDED', 'COPY_DOWNLOADED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WhatsAppKind" ADD VALUE 'AGREEMENT_SEND';
ALTER TYPE "WhatsAppKind" ADD VALUE 'AGREEMENT_OTP';
ALTER TYPE "WhatsAppKind" ADD VALUE 'AGREEMENT_REMINDER';

-- AlterTable
ALTER TABLE "whatsapp_message" ADD COLUMN     "agreementId" TEXT;

-- CreateTable
CREATE TABLE "agreement" (
    "id" TEXT NOT NULL,
    "documentNo" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "studentId" TEXT,
    "leadId" TEXT,
    "data" JSONB NOT NULL,
    "dataSha256" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "founderSignedAt" TIMESTAMP(3),
    "founderSignaturePng" BYTEA,
    "signedAt" TIMESTAMP(3),
    "studentSignaturePng" BYTEA,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "pdfBytes" BYTEA,
    "pdfSha256" TEXT,
    "pdfSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_event" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "type" "AgreementEventType" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_documentNo_key" ON "agreement"("documentNo");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_tokenHash_key" ON "agreement"("tokenHash");

-- CreateIndex
CREATE INDEX "agreement_status_createdAt_idx" ON "agreement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "agreement_studentId_idx" ON "agreement"("studentId");

-- CreateIndex
CREATE INDEX "agreement_leadId_idx" ON "agreement"("leadId");

-- CreateIndex
CREATE INDEX "agreement_expiresAt_idx" ON "agreement"("expiresAt");

-- CreateIndex
CREATE INDEX "agreement_event_agreementId_createdAt_idx" ON "agreement_event"("agreementId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_message_agreementId_idx" ON "whatsapp_message"("agreementId");

-- AddForeignKey
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────── Integrity guards (mirrors 20260702150346_append_only_guards) ───────────────────
-- The service layer never exposes these mutations. The triggers make the guarantee hold even
-- against raw SQL, a future coding mistake, or a founder with a psql prompt — which is exactly
-- the objection a disputing counterparty would raise about a self-hosted e-signature.

-- The audit trail IS the certificate. Without immutability a canvas squiggle proves nothing.
CREATE TRIGGER agreement_event_append_only
  BEFORE UPDATE OR DELETE ON "agreement_event"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Once signed, the sealed artifact and everything it attests to are frozen. Mutable columns
-- (status, updatedAt, otp*) are deliberately absent from the comparison — only the evidence
-- is locked, so a COPY_DOWNLOADED bump or an EXPIRED sweep still works.
CREATE OR REPLACE FUNCTION agreement_seal_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."signedAt" IS NULL THEN
    RETURN NEW; -- an unsigned agreement is still a draft; edit freely
  END IF;
  IF NEW."documentNo"          IS DISTINCT FROM OLD."documentNo"
     OR NEW."templateVersion"  IS DISTINCT FROM OLD."templateVersion"
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

CREATE TRIGGER agreement_seal_immutable
  BEFORE UPDATE ON "agreement"
  FOR EACH ROW EXECUTE FUNCTION agreement_seal_guard();

-- A signed agreement is evidence. Drafts may be deleted; executed contracts may not.
CREATE OR REPLACE FUNCTION agreement_delete_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."signedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'agreement %: a signed agreement cannot be deleted', OLD."documentNo";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_signed_no_delete
  BEFORE DELETE ON "agreement"
  FOR EACH ROW EXECUTE FUNCTION agreement_delete_guard();
