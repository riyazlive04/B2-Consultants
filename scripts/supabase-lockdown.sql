--- Supabase lockdown — deny the Data API everything. RE-RUNNABLE BY DESIGN.
---
--- Run:  npm run db:lockdown          (after EVERY `prisma migrate deploy` on Supabase)
--- migrate-to-supabase.mjs runs it automatically as its final step.
---
--- ─────────────────── Why this is a script, not a migration ───────────────────
---
--- It started as a timestamped migration. That was wrong, and it was caught within
--- twenty minutes: a new migration (20260716142250_telecaller_call_log...) landed
--- AFTER the lockdown's timestamp, and its `call_log` table came out with RLS off.
--- A migration protects only the tables that exist when it runs; every migration
--- written afterwards silently ships an exposed table. So the lockdown has to be
--- idempotent and re-run after each deploy instead.
---
--- ─────────────────── Why this matters here ───────────────────
---
--- Supabase auto-exposes `public` over PostgREST and grants `anon` + `authenticated`
--- on tables created by `postgres` via ALTER DEFAULT PRIVILEGES. Prisma creates every
--- table as `postgres`. Without this, a project's anon key — which ships in browser
--- bundles and is not a secret — reads `lead` (PII), `student`, `agreement`
--- (home addresses, IBANs) and the whole `journal_line` ledger.
---
--- Two independent layers, because either alone is one mistake from open:
---   1. REVOKE + ALTER DEFAULT PRIVILEGES — the roles hold no privilege on anything in
---      `public`, now or on tables created later. This layer alone protects a new table
---      even before anyone remembers to re-run the script.
---   2. RLS with zero policies — if a GRANT ever reappears (a dashboard click, a
---      restored default privilege, a hand-run script), deny-all still stands.
---
--- Prisma is unaffected: it connects as `postgres`, which OWNS these tables, and an
--- owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set (deliberately, it is not).
--- Authorization stays in src/lib/rbac.ts, server-side, where it already lives.
---
--- Safe on local dev: `anon`/`authenticated` do not exist there, so layer 1 is skipped
--- by the role guards. Local Prisma connects as `b2`, the owner, so RLS is a no-op.

--- ─────────────────── 1. Revoke the Data API roles ───────────────────

DO $$
DECLARE
  r text;
  owner_role text := current_user;  -- `postgres` on Supabase, `b2` locally
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      RAISE NOTICE 'role % absent (not Supabase) — skipping revoke', r;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', r);

    -- The durable half: tables created by FUTURE migrations inherit no grant.
    -- Without this, the next `prisma migrate deploy` creates an exposed table.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', owner_role, r);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', owner_role, r);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', owner_role, r);

    RAISE NOTICE 'revoked % (incl. default privileges for future tables)', r;
  END LOOP;
END $$;

--- ─────────────────── 2. RLS deny-all on every table ───────────────────

--- No CREATE POLICY anywhere: RLS enabled with zero policies denies every row to every
--- non-owner role. That is the point — nothing legitimate talks to this database except
--- the app's own server-side Prisma connection, which owns the tables.
DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'  -- Prisma bookkeeping; carries no business data
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.oid = format('public.%I', tablename)::regclass AND c.relrowsecurity
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS newly enabled on % table(s)', n;
END $$;

--- ─────────────────── 3. Assert, do not hope ───────────────────

--- Fail loudly if anything in `public` is still unprotected, so a deploy that
--- introduces a table cannot quietly leave it readable.
DO $$
DECLARE
  gaps text;
BEGIN
  SELECT string_agg(relname, ', ' ORDER BY relname) INTO gaps
  FROM pg_class
  WHERE relkind = 'r'
    AND relnamespace = 'public'::regnamespace
    AND NOT relrowsecurity
    AND relname <> '_prisma_migrations';

  IF gaps IS NOT NULL THEN
    RAISE EXCEPTION 'lockdown incomplete — tables without RLS: %', gaps;
  END IF;

  RAISE NOTICE 'verified: every table in public has RLS enabled';
END $$;
