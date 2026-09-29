-- Step 6b: the booking chase also goes out by email, not WhatsApp alone.
--
-- Two additive enum values. Postgres allows ALTER TYPE ... ADD VALUE inside a transaction
-- (PG12+) provided the new value is not USED in that same transaction, which is why this
-- migration only declares them and nothing here inserts a row carrying one.
ALTER TYPE "OutreachChannel" ADD VALUE IF NOT EXISTS 'EMAIL';
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'FOLLOWUP_EMAIL';
