-- O4 — forced password change after an admin-set password.
--
-- One nullable-free boolean with a default. Additive and non-rewriting in the way that matters:
-- the DEFAULT false is a metadata-only change in Postgres (a constant default is not written into
-- existing rows since PG 11), so all existing users read `false` — nobody is retroactively forced
-- to change a password they chose themselves.
--
-- Rollback is DROP COLUMN.
ALTER TABLE "user" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
