-- AlterTable
ALTER TABLE "agreement" ADD COLUMN     "founderDevice" JSONB,
ADD COLUMN     "signerDevice" JSONB;

-- The seal guard must learn about the new evidence columns. `signerDevice` records how the
-- signature was physically made and which IP our server observed; a signed agreement whose
-- device record can still be edited proves nothing at all. `founderDevice` is deliberately NOT
-- frozen by signedAt — it is written at countersigning, long before, and the ISSUED path already
-- refuses to run twice.
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
     OR NEW."signerDevice"     IS DISTINCT FROM OLD."signerDevice"
  THEN
    RAISE EXCEPTION 'agreement %: the sealed record is immutable once signed', OLD."documentNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
