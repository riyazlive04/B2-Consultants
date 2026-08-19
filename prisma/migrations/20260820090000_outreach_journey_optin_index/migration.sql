-- The speed-to-lead report scopes by opt-in window rather than by row creation, so this column
-- is now the filter on a ~23k-row table. CONCURRENTLY is deliberately NOT used: prisma migrate
-- runs each migration in a transaction, and the table is small enough that the brief lock is
-- unnoticeable.
CREATE INDEX IF NOT EXISTS "outreach_journey_optInAt_idx" ON "outreach_journey"("optInAt");
