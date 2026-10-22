-- Class reminders: two new WhatsApp touchpoints and the link that makes them de-duplicable.
--
-- Additive only. Hand-written for the same reason as the migration before it: `migrate dev`
-- generates destructive drop-and-re-add diffs for enum changes on this schema.

-- Two values, added separately so each is idempotent on a re-run.
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'CLASS_REMINDER';
ALTER TYPE "WhatsAppKind" ADD VALUE IF NOT EXISTS 'CLASS_REMINDER_COACH';

-- Which class a message is about. SetNull like every other target on this table: a message row
-- must survive deletion of the thing it referenced, or the WhatsApp history develops holes.
ALTER TABLE "whatsapp_message" ADD COLUMN IF NOT EXISTS "classSessionId" TEXT;

-- (classSessionId, kind) is the exact shape of the engine's dedupe read: "how many rungs has
-- this class already fired, and for whom".
CREATE INDEX IF NOT EXISTS "whatsapp_message_classSessionId_kind_idx"
    ON "whatsapp_message"("classSessionId", "kind");

DO $$ BEGIN
    ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_classSessionId_fkey"
        FOREIGN KEY ("classSessionId") REFERENCES "class_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
