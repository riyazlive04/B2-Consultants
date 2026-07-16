-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_INTRO';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_FOLLOWUP';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_DISCO_WELCOME';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_DISCO_CONFIRM_1';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_DISCO_CONFIRM_2';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_DISCO_CANCEL';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_SSS_CONFIRM_1';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_SSS_CONFIRM_2';
ALTER TYPE "WhatsAppKind" ADD VALUE 'SOP_SSS_CANCEL';
