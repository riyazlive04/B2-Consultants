-- Payments: products become the programmes, and an invoice gets a currency of its own.
--
-- 1. `product.levelCode` ties a product to the `Level` catalogue (the B2 coaching tiers and the
--    German Note course levels). One product per programme; one-off items keep it NULL, and a
--    unique index allows any number of NULLs.
-- 2. An invoice is now ISSUED in a currency. Everything that was rupees-only grows its euro
--    counterpart so the document can print in either without the KPI cards, the ageing or the
--    ledger - all of which aggregate in rupees - having to re-convert at today's rate.
-- 3. Existing rows are back-filled from the rate each one was already stamped with
--    (`invoice.fxRateUsed`), so no figure moves: every live invoice was issued in INR, and its
--    euro side is exactly the conversion that was being computed for display anyway.

-- ── 1. Products name their programme ────────────────────────────────────────────────
ALTER TABLE "product" ADD COLUMN "levelCode" TEXT;
CREATE UNIQUE INDEX "product_levelCode_key" ON "product"("levelCode");

-- ── 2. The currency an invoice is issued in ─────────────────────────────────────────
CREATE TYPE "InvoiceCurrency" AS ENUM ('INR', 'EUR');

ALTER TABLE "invoice"
  ADD COLUMN "currency"         "InvoiceCurrency" NOT NULL DEFAULT 'INR',
  ADD COLUMN "subtotalEurMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "discountEurMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "taxEurMinor"      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "taxLabel"         TEXT;

-- Back-fill the euro side at the invoice's OWN stamped rate, never today's.
UPDATE "invoice" SET
  "subtotalEurMinor" = ROUND("subtotalInrMinor" / "fxRateUsed")::BIGINT,
  "discountEurMinor" = ROUND("discountInrMinor" / "fxRateUsed")::BIGINT,
  "taxEurMinor"      = ROUND("taxInrMinor"      / "fxRateUsed")::BIGINT
WHERE "fxRateUsed" > 0;

-- An issued invoice that charged tax already named it; one that charged none says so with NULL.
UPDATE "invoice" SET "taxLabel" = 'Tax' WHERE "taxPercent" > 0;

ALTER TABLE "invoice_line_item"
  ADD COLUMN "unitPriceEurMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "levelCode"         TEXT;

UPDATE "invoice_line_item" li SET
  "unitPriceEurMinor" = ROUND(li."unitPriceInrMinor" / i."fxRateUsed")::BIGINT
FROM "invoice" i
WHERE i."id" = li."invoiceId" AND i."fxRateUsed" > 0;

CREATE INDEX "invoice_line_item_levelCode_idx" ON "invoice_line_item"("levelCode");

ALTER TABLE "invoice_payment"
  ADD COLUMN "amountEurMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "currency"       "InvoiceCurrency" NOT NULL DEFAULT 'INR',
  ADD COLUMN "fxRateUsed"     DECIMAL(14,6);

-- Each receipt inherits the rate its invoice was stamped with - the rate in force when the money
-- was agreed - rather than being valued at whatever the euro is worth on migration day.
UPDATE "invoice_payment" p SET
  "amountEurMinor" = ROUND(p."amountInrMinor" / i."fxRateUsed")::BIGINT,
  "fxRateUsed"     = i."fxRateUsed"
FROM "invoice" i
WHERE i."id" = p."invoiceId" AND i."fxRateUsed" > 0;
