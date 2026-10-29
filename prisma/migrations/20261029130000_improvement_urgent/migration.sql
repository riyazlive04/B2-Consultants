-- ESCALATION: one flag on an improvement report.
--
-- PURELY ADDITIVE. A nullable-free boolean with a DEFAULT, which Postgres 11+ adds without
-- rewriting the table, so this is instant on a table of any size and takes no long lock.
--
-- `urgent` is set by the head coach or the founder (capability `improvements.escalate`) to say
-- "this one matters now", and the queue sorts on it ahead of status and severity.
--
-- WHY NOT JUST SET severity = 'BLOCKING': severity is the REPORTER's own answer to "how much is
-- this holding you up". It is the only honest signal of impact this module collects, and a
-- manager overwriting it would destroy that answer permanently. Who escalated and when is in the
-- activity log, which is where every other who-did-what in this app already lives.
--
-- WRITTEN BY HAND, like every other migration on this schema. `prisma migrate dev` must not be
-- pointed at this repo while `.env` is present at all: `.env` carries the LIVE Supabase URL and
-- the Prisma CLI prefers it over a shell-set DATABASE_URL, so the "local" migration lands on
-- production.

-- AlterTable
ALTER TABLE "improvement" ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
-- The queue's default order is urgent-first, so this is the index behind every page of it.
CREATE INDEX "improvement_urgent_createdAt_idx" ON "improvement"("urgent", "createdAt");
