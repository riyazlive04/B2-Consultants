-- Instalment-plan pricing on a receivable.
--
-- The surcharge for paying in instalments is priced per plan length in the Founder Console
-- (AppSetting "instalmentPlans" — no table needed, it is config). What DOES belong on the row
-- is the snapshot: what this plan was charged and what interval built its schedule.
--
-- planExtra is deliberately NOT folded into totalFee. totalFee stays "the fee we agreed", so
-- the ~5 existing receivables keep their exact meaning and "total to collect" is a derived
-- fee + extra. Folding it in would restate history the moment the table is re-priced.
--
-- Additive + defaulted/nullable: every existing row stays valid with a zero surcharge.

ALTER TABLE "pending_payment"
    ADD COLUMN "planExtraInrMinor" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "planExtraEurMinor" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "intervalDays" INTEGER;
