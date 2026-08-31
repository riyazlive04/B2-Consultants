-- Discovery Specialist Level 2: the no-show chase on the day of the call, and the two SSS
-- confirmation rungs (6h message, 3h call) the flowchart has and the ladder did not.
--
-- Additive enum values only; nothing here inserts a row carrying one.
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_NOSHOW_CALL_1';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_NOSHOW_CALL_2';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'DISCO_NOSHOW_MSG';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'SSS_CONFIRM_3';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'SSS_CONFIRM_CALL';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'SOP_SSS_CONFIRM_3';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'SOP_DISCO_NOSHOW';
