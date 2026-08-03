# Deploying B2 Consultants to a VPS with Docker

This is the production runbook. The stack is four containers behind one domain:

| Container | Role | Public? |
|-----------|------|---------|
| `caddy`   | TLS termination + reverse proxy, auto Let's Encrypt cert | ports 80/443 |
| `migrate` | one-shot `prisma migrate deploy`, runs then exits | no |
| `app`     | the Next.js standalone server | no — only Caddy reaches it |
| `cron`    | ticks `/api/cron/*` (the app has no internal clock) | no |

**The database is not in this stack.** It is Supabase (`ap-southeast-1`). There is
deliberately no bundled Postgres — the old local volume is gone, and reintroducing one
would silently create an *empty* database that looks like it works.

---

## Put the VPS in Singapore. This is a performance decision, not a preference.

Because the database is remote, **every page render is a chain of network round trips**,
and the length of one round trip is set entirely by the distance between the app and
`ap-southeast-1`. Nothing in the code can shorten it.

Measured from a laptop in India against the production pooler on 2 Aug 2026:

| Operation | From India (~4,300 km) | Co-located in Singapore |
|---|---|---|
| One `SELECT 1` | **205 ms** | ~1–5 ms |
| Auth chain (3 sequential queries) | **~615 ms** | ~15 ms |
| A typical page (auth + its own data) | **1–1.6 s** | ~50 ms |

The app is a server-rendered Next.js app: a page cannot finish until its queries finish,
and queries that depend on each other cannot be parallelised away. So what matters is
**how many queries deep a page goes, multiplied by the round trip.** Co-locating the app
with the database divides that entire second column by roughly forty.

This is why "the app feels slow" is usually a hosting-location bug, not a code bug. Host
anywhere else — a European or US VPS, or a laptop — and every page inherits a
multi-hundred-millisecond tax per query that no amount of query tuning will recover.

**Pick a region in or adjacent to Singapore:**

| Provider | Region to choose |
|---|---|
| Hostinger | Singapore |
| DigitalOcean | `sgp1` |
| Vultr / Linode | Singapore |
| AWS Lightsail | `ap-southeast-1` |

**Verify before you commit to a host.** From the candidate VPS, measure the real
round trip to the pooler rather than trusting the datacentre label:

```bash
# Sub-10ms is what you are looking for. Triple digits means the wrong region.
time psql "$DATABASE_URL" -c 'SELECT 1'
```

If you ever move the database, move the app with it — they belong in the same region.

---

## What the app needs to run (architecture facts)

- **No filesystem writes.** CV parsing and PDF rendering both happen in memory, so the
  `app` container runs `read_only: true`. There is no upload volume to back up.
- **No Redis / no worker.** BullMQ is only a durable due-store; without `REDIS_URL` the
  app falls back to Postgres polling, which is the source of truth anyway. We do not run
  a redis service.
- **Env is validated at boot** (`src/lib/env.ts`, via `src/instrumentation.ts`). Five
  vars are required; get one wrong and the container refuses to start with a specific
  message instead of failing silently at runtime.

---

## Prerequisites

1. A VPS **in Singapore** (Hostinger / any) with Docker Engine + the Compose plugin.
   - `docker --version` and `docker compose version` both work.
   - The region is not negotiable if you want the app to feel fast — see
     "Put the VPS in Singapore" above for the measured reason.
2. A domain (e.g. `app.b2consultants.in`) with a **DNS A record already pointing at the
   VPS IP.** Caddy cannot issue a certificate until DNS resolves. Verify:
   `dig +short app.b2consultants.in` returns the VPS IP.
3. Ports **80 and 443** open in the VPS firewall (80 is needed for the ACME challenge
   AND the http→https redirect, even though the app is https-only).
4. The Supabase pooler connection strings (see the env template).

---

## First deploy

```bash
# 1. Get the code onto the VPS
git clone <repo-url> b2 && cd b2
git checkout <deploy-branch>

# 2. Create the real env file (git-ignored, never committed)
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production        # fill in every REQUIRED value — see notes below

# 3. Generate the two secrets it asks for
openssl rand -base64 32     # -> BETTER_AUTH_SECRET
openssl rand -base64 32     # -> CRON_SECRET

# 4. Build and start everything
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 5. Watch it come up. Order: migrate runs to completion, THEN app, THEN caddy + cron.
docker compose -f docker-compose.prod.yml logs -f
```

### Filling in `.env.production` — the three things that trip people up

1. **Use the POOLER host, not the direct one.** The URL Supabase shows first
   (`db.<ref>.supabase.co`) is IPv6-only and will not connect from most VPS hosts. Use
   `aws-0-ap-southeast-1.pooler.supabase.com`, with username `postgres.<ref>`.
   - `DATABASE_URL` → port **6543** (`?pgbouncer=true&connection_limit=10`) — runtime. Keep
     `connection_limit` at 10+, NOT 1: this is a long-running server and each page fires many
     queries at once, so `=1` serialises them into a `P2024` connection-pool timeout.
   - `DIRECT_URL` → port **5432** — migrations only (pgbouncer can't hold the migrate lock).
2. **Percent-encode the DB password.** A literal `@` must become `%40` or the URL parser
   misreads the host.
3. **`BETTER_AUTH_URL` = `https://<your-domain>`, no trailing slash.** It is the base for
   password-reset, invite and agreement-signing links; a wrong value emails broken links
   to real users. The boot check rejects `http://`, `localhost`, and a trailing `/`.

---

## Verifying the deploy

```bash
# App health (proxied through Caddy over real TLS):
curl -fsS https://app.b2consultants.in/api/health
# -> {"status":"ok","db":"up","latencyMs":<n>}
#
# CHECK latencyMs, not just "ok". This is the round trip from the app to the
# database, and it is the number the whole app's speed is built on:
#   < 10 ms    correct — app and database are co-located
#   > 100 ms   WRONG REGION. The deploy works but every page pays this per query.
#              Rebuild the VPS in Singapore; no code change will fix it.

# Container states — migrate should be "Exited (0)", the rest "Up (healthy)":
docker compose -f docker-compose.prod.yml ps

# Cron is ticking (quiet on success; you'll see errors only if the app is unreachable):
docker compose -f docker-compose.prod.yml logs cron --tail 20

# Prove a cron route answers (from the VPS, using your CRON_SECRET):
curl -fsS -H "x-cron-secret: $CRON_SECRET" https://app.b2consultants.in/api/cron/outreach
```

Then in a browser: load the domain, sign in, and confirm you are NOT bounced with an
"Invalid origin" error (that means `BETTER_AUTH_URL` is wrong).

---

## Post-deploy wiring

- **Point inbound webhooks at the new origin.** Pabbly's B2 action →
  `https://<domain>/api/leads/pabbly`. Same for WATI / Resend / Twilio / Meta once their
  keys are set in `.env.production`.
- **Rotate the Supabase password.** It has been in plaintext locally; rotate it in the
  Supabase dashboard, update `DATABASE_URL` + `DIRECT_URL` in `.env.production`, then
  `docker compose ... up -d` to pick it up. (You chose deploy-first; do this promptly.)
- **Re-run the Supabase lockdown after any future migration** — see
  `docs/SUPABASE_MIGRATION.md`.

---

## Updates (redeploy after a code change)

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`migrate` re-runs automatically and applies only new migrations before `app` restarts.
Because `app` gates on `migrate` completing successfully, a bad migration aborts the
rollout instead of booting new code against the old schema.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `app` exits immediately, log says "Invalid production environment" | a required env var is missing/malformed | read the listed problems; fix `.env.production` |
| `migrate` fails `P1001: can't reach database` | `DIRECT_URL` uses the IPv6-only direct host, or wrong port | use the `:5432` pooler host |
| `migrate` fails on the advisory lock / prepared statement | `DIRECT_URL` points at the `:6543` pooler | it must be the `:5432` session pooler |
| Browser: "Invalid origin" on sign-in | `BETTER_AUTH_URL` ≠ the URL in the address bar | set it to the exact https origin, no trailing slash |
| Emails contain `localhost:3000` links | `BETTER_AUTH_URL` unset (shouldn't happen — boot check blocks it) | set it and redeploy |
| TLS cert never issues | DNS not pointing at the VPS yet, or port 80 blocked | fix DNS/firewall; optionally enable Caddy's ACME staging CA while testing |
| Cron logs show `HTTP 503` | `CRON_SECRET` mismatch between `app` and `cron` (they read the same var, so this means it's unset) | set `CRON_SECRET` and redeploy |
| Automations not firing but cron is quiet | working as intended — engines are OFF by default in Console settings | enable them in the app |

---

## Observability

Until this existed, a production error reached the founders only when a client emailed. Three
pieces, all optional and all keys-off — the app runs identically without any of them, it is just
blind.

### Error tracking

Set `SENTRY_DSN` (plus optional `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`) and redeploy.

There is **no Sentry SDK**. `lib/observability.ts` POSTs an envelope to Sentry's HTTP endpoint
directly, following the same keys-off seam as `lib/anthropic.ts` and `lib/email.ts` — no webpack
plugin, no build-time dependency, nothing that can break `next build`.

What is captured:

| Source | Previously |
|---|---|
| Every `/api/cron/*` failure | an unlogged 500 |
| Every `daily-maintenance` sub-job failure | a message in a JSON blob nobody read |
| `unhandledRejection` / `uncaughtException` | nothing at all |
| Browser errors hitting the app error boundary | `console.error`, seen by nobody |

Errors are **always** recorded in an in-process ring buffer (last 50) whether or not the DSN is
set, and the Founder Console → Maintenance → System health card shows them. That is the half that
works on day one; Sentry is what survives a container restart.

Two safety behaviours worth knowing: outbound events are capped at 30/minute (a crash loop must
not become a self-inflicted DoS or burn the quota the *one* interesting error needed), and every
message, stack frame and context value is scrubbed for `postgres://` URLs, bearer tokens and
key-shaped strings before it leaves. Prisma puts the full connection string into its error
messages by default; shipping the production password to a SaaS in order to learn the database was
unreachable would be worse than the blindness.

### Uptime

`/api/health` already proved the web process could reach Supabase. It now also reports per-cron
last-success ages and a recent error count.

**But a URL pinger is the wrong tool here.** Every engine in this app runs only when something
external calls a cron route, so the container can be green for a week while nothing has actually
happened. Set `UPTIME_HEARTBEAT_URL` to a Healthchecks.io / BetterStack / Cronitor check URL: each
job pings it **after a successful run**, and silence is the alert. That is what catches "the cron
sidecar died", which nothing inside the app can notice — the code that would notice is the code
that isn't running.

`{job}` in the URL is substituted with the job name, so one variable can drive per-job checks.

### Cron cadence

The sidecar (`docker/cron/entrypoint.sh`) now ticks seven routes:

| Route | Cadence | Why |
|---|---|---|
| `outreach` | every minute | the SOP's 5-minute SLA |
| `alerts` | every 5 min | speed-to-lead; the engine's own cooldown decides send frequency, so a tight tick is timelier without being noisier |
| `workflows` | every 5 min | automation enrolments |
| `whatsapp` | every 15 min | reminders + booking confirmations |
| `daily-log` | every 15 min | idempotent EOD auto-save |
| `daily` | hourly | housekeeping, dunning, the digest |
| `retention` | daily 03:00 | archive purge |

---

## Backups

`npm run db:backup` — dump, restore into a scratch database, compare row counts per table, drop
the scratch, prune old dumps. **Non-zero exit on any mismatch.**

The restore is the point. A dump that has never been restored is a file you believe in, and the
belief only gets tested on the day it matters.

```bash
npm run db:backup                 # the full loop (~17s against Supabase ap-southeast-1)
npm run db:backup:dump-only       # faster, and NOT a tested backup
node scripts/backup-verify.mjs --keep-scratch --retain 30
```

Requirements:

- **`DIRECT_URL`, not the pooler.** `pg_dump` needs a session-level connection to hold a
  consistent snapshot; PgBouncer on `:6543` cannot give it one, and the failure is a confusing
  mid-dump error rather than a clean refusal. The script checks and explains this up front.
- **`BACKUP_SCRATCH_URL` must be a different server.** It defaults to the local instance
  `npm run db:local` manages. The script refuses to run if the scratch host matches the source —
  a restore onto production is a way to destroy the thing you are protecting.
- PostgreSQL client tools. On Windows they install to `C:\Program Files\PostgreSQL\<v>\bin` and
  are **not** on `PATH`; the script finds them itself, or set `PG_BIN`.

Dumps land in `backups/` (gitignored — each one is a full plaintext-equivalent copy of production
including lead PII and the ledger) and are pruned after 14 days by default.

Schedule it with `scripts/run-backup-verify.ps1` (Task Scheduler) or the equivalent cron entry.
Alert on the exit code — a backup that fails silently is the same problem as one that was never
tested.
