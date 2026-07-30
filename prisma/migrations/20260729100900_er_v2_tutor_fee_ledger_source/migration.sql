-- ER v2 Track C — a ledger source type for tutor-fee accruals.
--
-- Additive enum value, safe for the same reason INVOICE and PAYMENT were: the
-- forbid_duplicate_live_source() trigger keys off (sourceType, sourceId) generically and
-- needs no change. Nothing reads this value until financePosting.tutorFeeAccrual is switched
-- on, which is off by default.

ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'TUTOR_FEE';
