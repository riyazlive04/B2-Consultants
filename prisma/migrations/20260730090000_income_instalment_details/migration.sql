-- Instalment plan details on income entries.
--
-- When a payment is recorded as an INSTALMENT, the form now also asks how many instalments the
-- fee is split into and what extra amount was added for choosing the plan. Both are captured
-- alongside the entry; the received amounts stay the money that actually arrived, so nothing
-- here touches the ledger posting. Additive + nullable/defaulted: every existing row is valid.

ALTER TABLE "income"
    ADD COLUMN "instalmentCount" INTEGER,
    ADD COLUMN "instalmentExtraInrMinor" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "instalmentExtraEurMinor" BIGINT NOT NULL DEFAULT 0;
