-- Wiring the approved `b2_book_order` WATI template into the app.
--
-- Additive only: one enum value, two nullable columns, one FK and two indexes. No existing row is
-- read, rewritten or backfilled.

-- The first touchpoint whose recipient is a VENDOR rather than a prospect or student.
ALTER TYPE "WhatsAppKind" ADD VALUE 'BOOK_ORDER';

-- Human-quotable order reference (BO-2026-0087) — what the publisher reads back to us. UNIQUE so
-- two concurrent allocations cannot collide on the same number; the allocator retries on 23505.
-- Nullable because existing orders have none and are numbered lazily on their first message.
ALTER TABLE "book_order" ADD COLUMN "orderRef" TEXT;
CREATE UNIQUE INDEX "book_order_orderRef_key" ON "book_order"("orderRef");

-- Which order a publisher message was about. SetNull like every other link on this table: a
-- message row must outlive the thing it referenced, because it is the record that it was sent.
ALTER TABLE "whatsapp_message" ADD COLUMN "bookOrderId" TEXT;
ALTER TABLE "whatsapp_message"
  ADD CONSTRAINT "whatsapp_message_bookOrderId_fkey"
  FOREIGN KEY ("bookOrderId") REFERENCES "book_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "whatsapp_message_bookOrderId_idx" ON "whatsapp_message"("bookOrderId");
