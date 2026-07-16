# Supabase migration — runbook

Moving `b2_dashboard` (local Postgres, port 5435) to Supabase.

## ✅ DONE — 16 Jul 2026

Project `vyuzqkzujjbgccfjhjcr` · ap-southeast-1 (Singapore) · **Postgres 17.6** · t4g.nano.

**1,405 rows migrated and verified table by table** (local total 1,405 = Supabase total 1,405).

| Check | Result |
|---|---|
| LMS | students 18 · enrollments 15 · batches 2 · modules 2 · recordings 5 · posts 6 · conversions 49 |
| Ledger | debits = credits = 325,385,096 — double-entry invariant intact |
| Triggers | 14/14 present and **enabled** (`tgenabled='O'`) |
| Append-only | `UPDATE journal_entry` → rejected: *"journal_entry is append-only"* |
| Data API | `SET ROLE anon; SELECT count(*) FROM lead;` → **permission denied** |
| RLS | 85/85 tables |

**Still to do:** point `.env` at Supabase (below), then rotate the DB password — it was
pasted in plaintext during setup.

---

## Connecting: read this before debugging a connection error

Three traps, each of which produces an error that points somewhere other than the cause.

**1. `db.<ref>.supabase.co` is IPv6-only.** Supabase dropped IPv4 on direct connections
(it is now a paid add-on). On an IPv4-only network you get:

```
could not translate host name "db.vyuzqkzujjbgccfjhjcr.supabase.co" to address
```

That reads like broken DNS or a dead project. It is neither — the name resolves fine, but
only to an AAAA record. **Use the pooler for everything:**

| Purpose | Host | Mode |
|---|---|---|
| App | `aws-0-ap-southeast-1.pooler.supabase.com:6543` + `?pgbouncer=true` | transaction |
| Migrations / scripts | `aws-0-ap-southeast-1.pooler.supabase.com:5432` | **session** |

The session pooler is the IPv4 stand-in for a direct connection: it holds one backend for
the session, so it carries DDL and `SET session_replication_role`. Verified — all 41
migrations deployed over it.

**2. The pooler username is `postgres.<project_ref>`, not `postgres`.** Get it wrong and
you get `FATAL: Tenant or user not found`, which sounds like the project is gone. It only
means the username did not carry the ref. (The same error appears if the *region* is
wrong — the tenant is looked up per-region.)

**3. Percent-encode the password.** `@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`.
A raw `@` is the credentials/host delimiter, so parsers read the host as
`<rest-of-password>@aws-0-…`, and you get a nonsense auth or DNS error.

### Rehearsal

Before touching the real project this was rehearsed against a scratch database:
1,403 rows / 59 tables, verified table by table.

---

## What is actually moving

Everything. All application data already lives in one Postgres database — there is no
second store to chase:

| | |
|---|---|
| **Rows** | ~1,403 across 59 populated tables (15 MB) |
| **LMS** | `student` 18 · `enrollment` 15 · `gn_batch` · `gn_module` · `gn_recording` · `gn_post` · `gn_workshop_conversion` 49 — **ordinary tables in the same database**, not a separate system |
| **Binaries** | `agreement.pdfBytes` + signature PNGs are `bytea` **in Postgres** — they travel with the data |
| **Not in Postgres** | Nothing server-side. No uploads dir, no S3, no second database. |

Two things a database migration does **not** move:

- **Class recordings are links, not files.** `GnRecording` stores a pasted
  Fathom/YouTube/Drive URL by design (see `src/lib/video-embed.ts`). Every link moves;
  the videos keep living in those third-party accounts. Keep them alive.
- **Redis holds nothing durable.** One `workflow-wait` queue of `{enrollmentId}` jobs.
  Postgres (`WorkflowEnrollment.nextRunAt`) is already the source of truth. Supabase has
  no Redis — leave `REDIS_URL` unset and the documented Postgres-polling path takes over.
- **Browser `localStorage`** (theme, nav state, WorkTracker counters, saved contact
  views) is per-device and deliberately not server data. Unchanged by the move.

---

## Why not `pg_dump | psql`

**Local dev runs Postgres 18; Supabase runs 17 or 15.** A full dump restored into an
older server is a downgrade — pg_dump emits DDL the target cannot parse. So the job is
split, which is better than a dump anyway:

| Part | How | Why |
|---|---|---|
| Schema | `prisma migrate deploy` — 41 migrations replay natively on the target | Recreates all 14 integrity triggers, append-only guards and ledger CHECKs as the **target's own version** compiles them |
| Data | `pg_dump --data-only` → COPY blocks | Version-portable; no DDL to misparse |

The load runs with `SET session_replication_role = replica`, which suspends user triggers
**and** FK checks for that session — necessary because a data-only load inserts in table
order, not FK order, and this schema's append-only triggers exist precisely to reject
writes like these. Supabase grants the `postgres` role this setting; `pg_restore
--disable-triggers` would need superuser, which Supabase does not give you.

*Verified after the rehearsal:* all 14 triggers came back `tgenabled = 'O'` (enabled), and
`UPDATE journal_entry SET narration=…` was correctly rejected with
`journal_entry is append-only`. The suspension is session-scoped and does not leak.

---

## Run it

```bash
# 0. local db must be up
npm run db:local

# 1. preflight — writes nothing, prints row counts on both sides
node scripts/migrate-to-supabase.mjs --target "<DIRECT_URL>" --dry-run

# 2. the real thing
node scripts/migrate-to-supabase.mjs --target "<DIRECT_URL>"
```

`<DIRECT_URL>` is the **direct** connection (**port 5432**), not the pooler (6543) —
migrations need session-level statements the transaction pooler cannot carry. The script
refuses a `:6543` target rather than failing halfway.

It will: preflight both ends → `migrate deploy` → **refuse a non-empty target** (use
`--force` to override) → dump data-only → load in one transaction → verify every table's
count → resync sequences → lock down the Data API.

Any failure during load rolls the whole transaction back: the target keeps no partial
data. A half-loaded double-entry ledger is worse than an empty one.

---

## Security: the Data API

**This is the biggest risk in the move, and it is not optional.**

Supabase auto-exposes the `public` schema over PostgREST and grants `anon` +
`authenticated` on tables created by `postgres` (via default privileges). Prisma creates
every table as `postgres`. Left alone, a project's **anon key — which ships in browser
bundles and is not a secret — can read `lead` (PII), `student`, `agreement` (home
addresses, IBANs), and the entire `journal_line` ledger.**

**Supabase helps here more than expected:** it ships an event trigger,
`ensure_rls -> rls_auto_enable`, that turns RLS on for every new table in `public`. That is
why the lockdown reported *"RLS newly enabled on 0 tables"* against the real project — the
tables already had it. The script's job there was to **assert** it, and to do the half
Supabase does *not* do: revoke the grants.

`scripts/supabase-lockdown.sql` closes this with two independent layers:

1. **REVOKE + ALTER DEFAULT PRIVILEGES** — the roles hold no privilege on anything in
   `public`, *including tables created later*. This layer protects a new table even
   before anyone remembers to re-run the script.
2. **RLS with zero policies** — deny-all, so if a GRANT ever reappears (dashboard click,
   restored default privilege), the table still yields nothing.

Prisma is unaffected: it connects as `postgres`, which **owns** these tables, and an owner
bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set (deliberately, it is not).
Authorization stays in `src/lib/rbac.ts`, server-side, where it already lives.

### ⚠️ Re-run the lockdown after every deploy

```bash
npm run db:lockdown      # idempotent; reads DIRECT_URL from .env
```

This started as a timestamped migration. **That was wrong, and it was caught within twenty
minutes**: migration `20260716142250_telecaller_call_log…` landed *after* the lockdown's
timestamp and its `call_log` table came out with RLS off. A migration protects only the
tables existing when it runs — every migration written afterwards silently ships an
exposed table. Hence: a re-runnable script, run last. It **asserts** at the end and fails
loudly if any table lacks RLS, so a forgotten table cannot pass quietly.

Also switch the Data API **off** in Project Settings → API. The app never calls it.

Verify by hand:

```bash
psql "<DIRECT_URL>" -c "SET ROLE anon; SELECT count(*) FROM lead;"   # expect: permission denied
```

---

## Cutover

1. Copy the two URLs from `.env.supabase.example` into `.env`.
   `DATABASE_URL` → pooler `:6543` **with `?pgbouncer=true`** (PgBouncer is in transaction
   mode; Prisma's prepared statements break without it). `DIRECT_URL` → `:5432`.
   `prisma/schema.prisma` already declares both — no schema change needed.
2. `npm run build && npm start`, then log in and check Finance, the LMS batches, and a
   student record render.
3. **`BETTER_AUTH_URL` must become the real public https origin.** While it points at
   localhost, password-reset and agreement-signing links in email go nowhere.
4. **Rotate every secret** in `.env` — WATI token, `CRON_SECRET`, webhook secrets,
   `BETTER_AUTH_SECRET`. They have lived in a local file.
5. Delete `.migration/data.sql` — it is a **plaintext dump of all PII**. Gitignored, but
   still on disk.

### The clock

The app has no internal clock; the cron endpoints need an external caller
(`/api/cron/outreach` **every minute** — that cadence *is* the SOP's timing resolution).
Supabase can finally do this itself with `pg_cron` + `pg_net` calling the route — but only
once the app is reachable at a public URL. **Hosting remains the blocker, not the DB.**

---

## Rollback

The local database is untouched by all of this — the migration only reads from it. To go
back, point `.env` at `postgresql://b2:b2@localhost:5435/b2_dashboard` and restart. Keep
the local database until Supabase has been running clean for a few days.
