-- The hostname a contact came in through, observed from the request that created them.
--
-- Nullable with no default and no backfill, deliberately. NULL means "not observed" and is the
-- state every one of the 23,429 Synamate-imported leads will stay in forever; the WhatsApp
-- domain gate treats NULL as "let it through" precisely so enabling the gate cannot silence
-- them. A default of '' would have destroyed that distinction on day one.
ALTER TABLE "lead" ADD COLUMN "originDomain" TEXT;
