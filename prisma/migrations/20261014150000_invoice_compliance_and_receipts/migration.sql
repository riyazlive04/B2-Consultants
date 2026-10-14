-- Invoice numbering INV-yy9999, the contents §14 Abs. 4 UStG requires, and payment receipts.
--
-- Additive only: every new column is nullable, the new table starts empty. Hand-written rather
-- than `migrate dev`-generated, which has produced destructive drop-and-re-add diffs on this
-- schema before.

CREATE TABLE IF NOT EXISTS "document_sequence" (
    "key"       TEXT NOT NULL,
    "last"      INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_sequence_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "customerAddress" TEXT;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "servicePeriodStart" DATE;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "servicePeriodEnd" DATE;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "agreementRef" TEXT;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3);
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "taxNote" TEXT;

ALTER TABLE "invoice_payment" ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT;
ALTER TABLE "invoice_payment" ADD COLUMN IF NOT EXISTS "receiptSentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_payment_receiptNumber_key" ON "invoice_payment"("receiptNumber");

-- Invoices already out of DRAFT were issued under the old scheme: mark them issued so they lock
-- and keep the numbers their customers already hold (INV-0001, INV-0007 on live).
UPDATE "invoice"
   SET "issuedAt" = COALESCE("sentAt", "createdAt")
 WHERE "kind" = 'INVOICE' AND "status" <> 'DRAFT' AND "issuedAt" IS NULL;
