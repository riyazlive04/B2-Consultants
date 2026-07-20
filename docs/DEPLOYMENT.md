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

1. A VPS (Hostinger / any) with Docker Engine + the Compose plugin.
   - `docker --version` and `docker compose version` both work.
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
