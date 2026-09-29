-- The founder's full opt-in flow (25/08/2026): a second WhatsApp chase and a third booking
-- check, email counterparts for the three disco notices, and a not-qualified branch.
--
-- Additive enum values only. Postgres allows ALTER TYPE ... ADD VALUE inside a transaction
-- (PG12+) provided the new value is not USED in the same transaction; nothing here inserts.
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'FOLLOWUP_WHATSAPP_2';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'CHECK_3';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_WELCOME_EMAIL';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_REJECT_MSG';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_REJECT_EMAIL';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_CANCEL_EMAIL';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'SOP_FOLLOWUP_2';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'SOP_NOT_QUALIFIED';
