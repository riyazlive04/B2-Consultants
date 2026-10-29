# Self-hosted Supabase — runbook

Moving production off **hosted Supabase** (`vyuzqkzujjbgccfjhjcr`, ap-southeast-1, Postgres 17.6)
onto a **self-hosted Supabase stack** on the production VPS (`srv2064204`, 187.127.172.211,
Mumbai 2, Ubuntu 26.04, 2 vCPU / 7.7 GB / 96 GB).

Companion to [`SUPABASE_MIGRATION.md`](./SUPABASE_MIGRATION.md), which moved local → hosted in
July 2026 and whose connection traps still apply to the *source* side of this move.

> **Status: ✅ EXECUTED 29 Oct 2026.** `https://b2app.sirahagents.com` is live on the self-hosted
> stack. 5,622 rows migrated and verified table by table; query latency **~60 ms → 0.58 ms median**.
> Maintenance window 14:37–14:39 UTC (~2 min, not the 20 estimated — everything was pre-warmed).
> The old cloud project is **still intact and must stay paused, not deleted** (§11, §14).
>
> Three traps below (§3a) were found only by running this, not by reading it. If you repeat this
> on another environment, they will bite in the same order.

---

## 1. What is actually being moved

This matters more than it sounds, because it determines what can break. An audit of the codebase
(29 Oct 2026) found the app's dependence on Supabase-the-platform is **a Postgres server, and
nothing else**:

| Supabase feature | Used by this app? | Evidence |
|---|---|---|
| Postgres | **Yes — entirely** | Prisma over the wire protocol |
| Auth (gotrue) | No | Better Auth, own tables, own session cookie |
| Data API (PostgREST) | No | `anon`/`authenticated` revoked by `scripts/supabase-lockdown.sql` |
| Realtime | No | no `@supabase/supabase-js` anywhere in `src/` |
| Edge Functions | No | — |
| Storage | **Configured nowhere** | no compose file sets `SUPABASE_URL`; `storageConfig()` returns `null` and the three upload routes answer 503 |

Two consequences worth stating plainly:

**The schema is portable with no edits.** All 117 migrations are vanilla Postgres — no
`CREATE EXTENSION`, no `auth.uid()`, no RLS policies, no Supabase-only roles. `supabase-lockdown.sql`
was already written to skip its role grants when `anon`/`authenticated` are absent. So the schema
is recreated on the target by replaying migrations natively, exactly as it was in July.

**There are no stored objects to migrate.** Every private file already lives in Postgres as bytes
(`AgreementAttachment`, improvement recordings) precisely *because* there was no private object
store. They travel in the database dump. Storage is a greenfield opt-in — see §12.

### Why the full stack anyway

You chose the complete stack over a trimmed one. That is a legitimate call — Studio is a real tool
and a half-stack you have to reason about is worse than a whole one you don't. It costs ~4.3 GB of
7.7 GB and eleven services to keep alive, so this runbook caps every one of them and hardens the
two that are dangerous by default.

Two pieces of good news found while preparing: upstream **dropped the Logflare/Vector analytics
service** (historically the main crash-loop culprit), and `supabase/postgres:17.6.1.136` matches
your hosted version *exactly*, so this is not a version jump.

---

## 2. What you gain and what you take on

**Gain — latency, and it is not small.** Measured 22 Oct inside the app container: **~60 ms** per
round trip to hosted Supabase. Loopback Postgres is well under 1 ms. The telecaller desk fires 7+
queries to render a greeting; today that is ~420 ms of pure network wait per page, and it becomes
single-digit milliseconds. This is the largest performance change available to this app and it
needs no code.

**Take on — four things that were someone else's job:**

1. **Backups.** Hosted Supabase took daily backups and PITR. Nothing does now until you make it so.
   `scripts/backup-verify.mjs` exists and works, but runs from your laptop via Task Scheduler and
   dumps *from* the pooler. §13 moves it.
2. **Upgrades.** Postgres minor versions and the ten service images are yours to bump.
3. **Being up.** The database and the app now share a failure domain, a kernel and 7.7 GB. If the
   box goes, both go.
4. **Being exposed.** Covered next, because it is the one that bites silently.

---

## 3. Read this first — three traps that fail silently

Each one reports success and leaves you worse off than an error would.

### Trap 1 — the published demo keys

`supabase/docker/.env.example` ships a **working** `ANON_KEY` and `SERVICE_ROLE_KEY`. They are not
`your-super-secret`-style placeholders: they are valid HS256 JWTs signed by the example
`JWT_SECRET`, with `"iss": "supabase-demo"`, and they are in every copy of the Supabase repo in
existence.

A stack on the defaults is not "insecure pending hardening" — it is a database that anyone can
read and write as `service_role`, which is `BYPASSRLS`. The lockdown's `anon` revocation does not
touch it. Everything in `lead`, `agreement` and `journal_line` is readable by whoever portscans
you first.

`scripts/gen-supabase-keys.mjs` generates the replacements and, importantly, **verifies** them:

```bash
npm run supabase:keys            # fresh secrets, printed as an .env block
npm run supabase:keys:verify     # re-derive from JWT_SECRET and check what is deployed
```

The verifier checks the signature *and* the `iss` claim — because the demo key's signature is
perfectly valid for the demo secret. A signature check alone would pass it.

### Trap 2 — `COMPOSE_FILE` disables the override file

Normally a `docker-compose.override.yml` beside `docker-compose.yml` is auto-loaded. Upstream's
`.env` sets `COMPOSE_FILE=docker-compose.yml`, and that replaces the whole file search —
auto-override included.

So you copy the hardening overlay into place, run `docker compose up -d`, and Compose reports
complete success **having applied none of it**. Postgres and the Data API sit on `0.0.0.0` with no
memory limits, and nothing warns you, because from Compose's point of view you have an unused file
in a directory. Fix, in `.env`:

```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml
```

(`:` on Linux. `;` on Windows — if you ever run this on the laptop, a colon fails with "cannot find
the file", naming both files as one.)

### Trap 3 — `ports:` merges rather than replaces

Compose **replaces** `command` and `networks` but **appends** `ports`. Binding `api-gw` to
`127.0.0.1` in an override therefore does *not* unbind upstream's `0.0.0.0` — you get both, and
the public one is what a scanner finds. Verified during preparation: the naive overlay left
`0.0.0.0:8000`, `0.0.0.0:5432` and `0.0.0.0:6543` wide open.

`deploy/supabase/docker-compose.override.yml` uses the `!override` YAML tag on every `ports` block
to force replacement. **Deleting that tag silently re-exposes the port.**

### The check that catches all three

Never trust that the overlay applied. Trust this:

```bash
cd /root/supabase/docker
docker compose config | grep -c mem_limit          # expect 11 — a 0 means trap 2
docker compose config | grep -B3 'published:'      # every entry must show host_ip: 127.0.0.1
JWT_SECRET=... ANON_KEY=... SERVICE_ROLE_KEY=... node scripts/gen-supabase-keys.mjs --verify
```

---

## 3a. Three more traps, found by executing

These are not hypothetical. Each one stopped the migration dead on the first attempt.

### `REALTIME_DB_ENC_KEY` must be exactly 16 characters

Realtime feeds it straight into `:crypto` as an **`aes_128_ecb`** key, and AES-128 takes a
**16-byte** key. A 32-char value dies at boot in a restart loop with:

```
** (ErlangError) Erlang error: {:badarg, {~c"api_ng.c", 246}, ~c"Bad key size"}
```

which reads like a broken image rather than a bad value. Upstream's own default is the 16-char
literal `supabaserealtime` — that is the tell. `gen-supabase-keys.mjs` now emits 16.

Ten of eleven services were healthy with realtime crash-looping, and since **nothing in this app
uses realtime**, it would have been easy to shrug at. Don't: a permanently restarting container
burns CPU and masks the next real failure.

### `pg_dump` must be restricted to `--schema=public`

This is the one asymmetry that makes "the July migration, reversed" not quite true. When the
source was a plain local Postgres, `public` was effectively all there was. With a **Supabase
source**, `--data-only` also dumps that project's internal schemas — `auth`, `storage`,
`realtime`, `supabase_migrations` — owned by `supabase_admin` and managed by the *target* stack's
own migrations. The load fails:

```
ERROR: permission denied for table schema_migrations
```

Even with permission it would be **wrong**: those rows describe the source stack's internal
bookkeeping, and overwriting a different stack's copy with them is how you get a Supabase install
that no longer boots. `migrate-to-supabase.mjs` now passes `--schema=public` permanently. The app
lives entirely in `public` (Better Auth included — it is *not* gotrue's `auth` schema).

### `prisma migrate deploy` leaves the target non-empty

A migration **seeds the `level` catalogue** (9 rows, deterministic ids `lvl_*`). So the script's
"target must be empty" guard trips immediately after the schema step:

```
ERROR: target already holds 9 rows (level=9).
```

`--force` is *not* the answer: the source holds the same 9 ids, so the `COPY` hits a PK violation
and rolls the whole load back — safe, but still stuck. Let the source be authoritative by emptying
every data table first, preserving only `_prisma_migrations` (which records what ran on *this*
server; copying the source's copy would claim migrations that never executed here):

```sql
SET client_min_messages = warning;
SET session_replication_role = replica;   -- suspends FK order + append-only triggers
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  LOOP EXECUTE format('TRUNCATE TABLE %I CASCADE', t); END LOOP;
END $$;
```

---

## 4. Prerequisites

### 4a. Add swap — do this first

The box has **7.7 GB and zero swap**. Eleven new containers alongside Next.js on 2 vCPU with no
swap means any spike is an instant OOM kill, and the kernel chooses the victim — it does not know
that `b2-app-1` is the thing customers are looking at.

```bash
ssh -i ~/.ssh/b2-vps root@187.127.172.211
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab      # survives reboot
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
free -h                                               # confirm: Swap 4.0Gi
```

`swappiness=10` keeps Postgres's working set in RAM; the swap is an OOM shock absorber, not a
place to run from.

### 4b. The shared network

```bash
docker network create b2_data
```

Both compose projects declare it `external: true`, so neither owns it and `docker compose down` on
either side cannot take the other's networking with it. If it is missing, `up -d` fails loudly —
which is correct. A network auto-created empty would put the app and the database on separate
islands that never see each other.

### 4c. Have on hand

- The **current** `DIRECT_URL` (hosted Supabase session pooler, `:5432`) — this is the migration
  *source*. The `:6543` transaction pooler cannot serve `pg_dump`.
- PostgreSQL **18** client tools on the laptop (`pg_dump`/`pg_restore`/`psql`), or `PG_BIN` set.
  Already present at `C:\Program Files\PostgreSQL\18`.
- A verified recent backup (`npm run db:backup`). The newest in `backups/` is 24 Oct — take a
  fresh one.

---

## 5. Stand up the stack

```bash
ssh -i ~/.ssh/b2-vps root@187.127.172.211
cd /root && git clone --depth 1 https://github.com/supabase/supabase
cd /root/supabase/docker && cp .env.example .env
```

Copy the overlay up from the repo (from the laptop):

```bash
scp -i ~/.ssh/b2-vps deploy/supabase/docker-compose.override.yml \
    root@187.127.172.211:/root/supabase/docker/docker-compose.override.yml
```

Generate secrets **on the laptop** (`npm run supabase:keys`) and paste the block into
`/root/supabase/docker/.env`, replacing each key it names. Then set, in the same file:

```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml   # trap 2 — do not skip

# gotrue runs but is unused. An open signup endpoint minting rows in auth.users is
# pure liability, so close it.
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=false
ENABLE_PHONE_SIGNUP=false
ENABLE_ANONYMOUS_USERS=false

# Studio is reached through an SSH tunnel (§5b), so these stay loopback.
SUPABASE_PUBLIC_URL=http://localhost:8000
API_EXTERNAL_URL=http://localhost:8000/auth/v1
SITE_URL=https://b2app.sirahagents.com

STUDIO_DEFAULT_ORGANIZATION=B2 Consultants
STUDIO_DEFAULT_PROJECT=b2
```

Bring it up and **verify the hardening actually applied**:

```bash
docker compose config | grep -c mem_limit        # 11
docker compose config | grep -B3 published:      # all host_ip: 127.0.0.1
docker compose up -d
docker compose ps                                # all healthy; give db ~60s on first boot
ss -tlnp | grep -E '8000|5432|6543|5433'         # every line must say 127.0.0.1, never 0.0.0.0
```

That last command is the one that would have caught trap 3. Run it even when you are sure.

### 5b. Studio

No public exposure. From the laptop:

```bash
ssh -i ~/.ssh/b2-vps -N -L 8000:127.0.0.1:8000 root@187.127.172.211
```

then `http://localhost:8000`, with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`. Envoy's basic auth
is the *entire* gate — no second factor, no rate limit, no lockout. Putting it on a public domain
means one guessable password stands between the internet and the ledger. Use the tunnel.

---

## 6. Freeze writes

Everything from here changes data. The app must not be writing.

```bash
cd /root/b2
docker compose -f docker-compose.vps.yml --env-file .env.production stop app cron
```

**Stop `cron` too, and stop it deliberately.** WATI is armed with `testRecipient` null, so a cron
tick during the migration sends real WhatsApp messages to real client numbers off a database that
is about to be replaced — and those sends are not reversible.

Caddy stays up and serves 502. That is the intended face of the maintenance window.

---

## 7. Schema and data

Run from the **laptop**, in the repo, against a tunnel to the new database:

```bash
ssh -i ~/.ssh/b2-vps -N -L 5433:127.0.0.1:5433 root@187.127.172.211   # leave running
```

> **Move `.env` aside first.** It holds the LIVE hosted `DATABASE_URL`, and a `prisma migrate
> deploy` here has been observed to take `.env` over a shell-set variable — which points the
> migration at production instead of the target. `scripts/migrate-to-supabase.mjs` pins both vars
> explicitly when it shells out, but this failure has happened before and the cost of belt-and-
> braces is one `mv`.

```bash
mv .env .env.hosted.bak
```

Then, with `SOURCE` = hosted session pooler and `TARGET` = the tunnel:

```bash
export SOURCE_DATABASE_URL='postgresql://postgres.vyuzqkzujjbgccfjhjcr:<pw%40encoded>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
export TARGET='postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5433/postgres'

npm run db:supabase -- --target "$TARGET" --dry-run     # preflight, writes nothing
npm run db:supabase -- --target "$TARGET"
```

The script is the same one that did local → hosted in July, pointed the other way, and it does the
right things in the right order:

1. `prisma migrate deploy` replays all 117 migrations **natively on the target**, so every trigger,
   append-only guard and ledger CHECK is compiled by the target's own Postgres. This is why no
   schema dump is involved and why a version mismatch could not hurt you.
2. Refuses a non-empty target unless `--force`, so it cannot double-load.
3. `pg_dump --data-only` → version-portable `COPY` blocks.
4. Loads in **one transaction** with `session_replication_role = replica`, suspending the
   append-only triggers and FK ordering that exist to reject exactly these writes. Either every
   table lands or the target stays empty.
5. Re-counts every table and fails on any mismatch.
6. Runs `supabase-lockdown.sql`.

**The lockdown is not optional here, and it is no longer belt-and-braces.** PostgREST is a live
HTTP reader of the `public` schema on this stack. Re-run it after *every* future
`prisma migrate deploy` — a migration only protects tables that exist when it runs, which is why
it is a re-runnable script and not a migration (see the header of `supabase-lockdown.sql`).

---

## 8. Verify before cutting over

Do not skip to §9 because §7 printed success.

```bash
psql "$TARGET" -c "SELECT count(*) FROM lead;"       # 8
psql "$TARGET" -c "SELECT count(*) FROM student;"    # 7
psql "$TARGET" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"  # 116

# ── Double-entry invariant. USE THE BASE COLUMNS. ──
# `debitMinor`/`creditMinor` are per-currency and do NOT balance on their own — the ledger holds
# INR and EUR side by side, so summing across them is meaningless and looks alarmingly broken
# (observed: an 87,227,934-minor "gap" that is purely an artefact of mixing currencies).
# `baseDebitMinor`/`baseCreditMinor` are fx-normalised and ARE the invariant.
psql "$TARGET" -c 'SELECT sum("baseDebitMinor"), sum("baseCreditMinor") FROM journal_line;'
# verified equal on both sides: 21799097138871

# Triggers present AND enabled ('O'), not merely present. Compare SCHEMA-QUALIFIED:
# the self-hosted target legitimately has 4 MORE than hosted — storage.buckets.* from a newer
# storage-api. The 25 in `public` are what must match.
psql "$TARGET" -c "SELECT n.nspname, c.relname, t.tgname FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal ORDER BY 1,2,3;"

# Append-only actually bites. (`memo` does not exist — the column is `narration`.)
psql "$TARGET" -c "UPDATE journal_entry SET narration='x';"
#   expect: journal_entry is append-only: only status and reversalOfId may be updated
psql "$TARGET" -c "DELETE FROM lead_stage_history;"
#   expect: Table lead_stage_history is append-only: DELETE is not allowed

# Data API sees nothing.
psql "$TARGET" -c "SET ROLE anon; SELECT count(*) FROM lead;"   # expect: permission denied
```

Compare the counts against the same queries on hosted. The base-currency ledger sum is the one
that matters most: it is a single number that a partial load cannot fake.

---

## 9. Cut over

Edit `/root/b2/.env.production`:

```ini
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@supabase-db:5432/postgres?schema=public&connection_limit=15
DIRECT_URL=postgresql://postgres:<POSTGRES_PASSWORD>@supabase-db:5432/postgres?schema=public
```

Both now point at the same place. The split existed because PgBouncer could not hold the
session-level advisory lock `migrate deploy` takes; connected straight to Postgres, every
connection is already a session. They remain two variables because the Prisma schema and
`src/lib/env.ts` both require them, not because they differ.

`connection_limit=15` replaces the pooler's `8`: `max_connections` is 120, the app is the only
consumer, and there is no PgBouncer to be gentle with. Note the app connects **directly to
`supabase-db`, not through supavisor** — Prisma has its own pool, and the hop would add latency and
a second place for connections to vanish.

Ship the updated compose file and restart:

```bash
scp -i ~/.ssh/b2-vps docker-compose.vps.yml root@187.127.172.211:/root/b2/docker-compose.vps.yml
ssh -i ~/.ssh/b2-vps root@187.127.172.211 \
  'cd /root/b2 && docker compose -f docker-compose.vps.yml --env-file .env.production up -d'
```

No rebuild and no new image: this is an env + compose change only. `APP_IMAGE` does not move.

---

## 10. Confirm

```bash
curl -s https://b2app.sirahagents.com/api/health          # {"status":"ok"}
docker compose -f docker-compose.vps.yml ps               # app healthy, cron ticking
docker compose -f docker-compose.vps.yml logs --tail=50 cron
free -h                                                    # headroom sane, swap barely touched
```

Then in the app, by hand: sign in, open **My Desk**, open **Finance → Income**, open a student.
Reads and writes both, because a read-only check passes against a database with no write
privileges.

Latency sanity check — expect a large drop from ~60 ms:

```bash
docker exec b2-app-1 node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{await p.\$queryRaw\`SELECT 1\`;const t=[];for(let i=0;i<12;i++){const s=process.hrtime.bigint();await p.\$queryRaw\`SELECT 1\`;t.push(Number(process.hrtime.bigint()-s)/1e6)}t.sort((a,b)=>a-b);console.log('median',t[6].toFixed(2),'ms')})()"
```

Measure with a warm loop like this, not `/api/health`'s `latencyMs` — that number is not the
per-query RTT and has misled this project before.

---

## 11. Rollback

Cheap for as long as you do not let hosted Supabase go.

**Within the window (nothing written yet):** put `.env.production`'s two URLs back to the pooler,
`up -d`. Done — hosted still holds everything.

**After writes have landed on the new database:** they must come back, or be lost. Dump from
self-hosted, load into hosted with the same script reversed, then flip the URLs. This is why §14
says keep the hosted project **paused, not deleted**, for at least two weeks.

The abort points are clean: §5 changes nothing (the stack is just sitting there), §7 touches only
the target, and until §9 production is still reading hosted Supabase.

---

## 12. Storage — off by default, and a decision to make once

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are left **unset** in `docker-compose.vps.yml`, which
reproduces today's behaviour exactly: `storageConfig()` returns `null`, the upload routes answer
503, and nothing regresses. Recommended until someone actually wants it.

To turn it on, understand what `SUPABASE_URL` is first. `publicUrl()` does not merely fetch — its
output is **written into `MediaAsset.url`** and handed to browsers for `next/image`. So:

- It must be a **public, browser-reachable origin**. `http://api-gw:8000` produces rows of URLs
  that resolve for no one, while the upload reports success.
- It is **baked into every row at upload time**. Changing it later orphans every stored image.
  Choose the hostname once, before the first upload.

And publishing the gateway publishes *everything behind it*, PostgREST at `/rest/v1` included.
Allow only the public-object path, in `Caddyfile`:

```caddyfile
media.sirahagents.com {
	encode zstd gzip

	# ONLY public object reads. Everything else — /rest/v1, /auth/v1, Studio — is not
	# published. Without this matcher, a media domain is a public Data API.
	@public path /storage/v1/object/public/*
	handle @public {
		reverse_proxy api-gw:8000
	}
	handle {
		respond 404
	}
	header Strict-Transport-Security "max-age=31536000"
}
```

Caddy must also join `b2_data`, and `api-gw` must be added to it in the overlay (it currently is
not — only `db` is). Then set `SUPABASE_URL=https://media.sirahagents.com` and
`SUPABASE_SERVICE_ROLE_KEY` to the generated `service_role` key.

Storage data lives at `/root/supabase/docker/volumes/storage` and is **not** in the Postgres dump.
Back it up separately.

---

## 13. Backups — now genuinely yours

This is the single biggest thing hosted Supabase was doing for you. Until it is done, the position
is worse than before the move.

`scripts/backup-verify.mjs` already does the right job — dump, restore into a scratch database,
count rows, fail loudly — but it runs from the laptop against the pooler. Move it to the box:

- Point it at `127.0.0.1:5433` (the loopback-published `db`).
- Schedule it on the VPS (systemd timer or the existing cron container), not on a laptop that
  travels.
- **Copy the dump off the box.** A backup on the same disk as the database is not a backup. The
  box has 92 GB free and a dump is ~2 MB, so retention is a non-issue; getting it *elsewhere* is
  the point.
- Include `volumes/storage` if §12 is ever enabled.
- `PGDATA` is a bind mount at `/root/supabase/docker/volumes/db/data`. **Never run
  `docker compose down -v` in that directory** — and know that even without `-v`, that path is a
  directory on disk that an `rm -rf` of the checkout would take with it.

Verify a restore before you believe any of it. "Backups are enabled" is not a backup —
`OPERABILITY_PLAN.md` made that point and it is more true now.

---

## 14. After

- Keep the hosted Supabase project **paused, not deleted**, for ≥2 weeks (§11).
- **Rotate the hosted credentials anyway.** They have lived in `.env` files and in this migration's
  shell history, and a paused project still has a database behind it.
- Delete `.migration/data.sql` — it is a full plaintext dump of production, including PII and
  IBANs. `migrate-to-supabase.mjs` writes it and does not clean it up.
- Restore `.env` on the laptop (`mv .env.hosted.bak .env`) **only after** deciding what it should
  now contain. It currently points at hosted.
- Update `docs/DEPLOYMENT.md` and `b2-supabase-migration` notes — "LIVE DB IS SUPABASE (cloud)" is
  no longer true, and that belief is load-bearing in several places.
- Watch `free -h` and `docker stats` over the first week. The memory budget in the overlay header
  is calculated, not measured.

---

## Traps index

| # | Trap | Symptom | Where |
|---|---|---|---|
| 1 | Demo `ANON_KEY`/`SERVICE_ROLE_KEY` | Stack works perfectly; anyone can read it as `service_role` | §3 |
| 2 | `COMPOSE_FILE` kills auto-override | `up -d` succeeds, hardening silently absent | §3 |
| 3 | `ports:` appends, not replaces | `127.0.0.1` binding added *beside* the public one | §3 |
| 4 | `.env` beats shell `DATABASE_URL` | `migrate deploy` hits LIVE hosted Supabase | §7 |
| 5 | Cron left running during migration | Real WhatsApp sends off a doomed database | §6 |
| 6 | `SUPABASE_URL` as an internal name | Uploads succeed; every stored URL is unreachable, permanently | §12 |
| 7 | `down -v` in the Supabase directory | Destroys `PGDATA` | §13 |
| 8 | No swap | Random OOM kill; kernel may pick the app | §4a |
| 9 | `REALTIME_DB_ENC_KEY` ≠ 16 chars | realtime restart-loops on "Bad key size" | §3a |
| 10 | `pg_dump` without `--schema=public` | Load aborts: permission denied on `schema_migrations` | §3a |
| 11 | A migration seeds `level` | "target already holds 9 rows"; `--force` then PK-violates | §3a |
| 12 | Summing `debitMinor` across currencies | Ledger looks broken by ~87M; use the `base*` columns | §8 |

## Actual outcome, 29 Oct 2026

| | Before (hosted) | After (self-hosted) |
|---|---|---|
| Query latency (median, warm, n=12) | ~60 ms | **0.58 ms** (min 0.37, max 2.32) |
| `/api/health` | ok | ok, `db: up`, `latencyMs: 5` |
| Rows | 5,622 / 83 tables | 5,622 — verified table by table |
| Migrations applied | 116 | 116 |
| `public` triggers enabled | 25 | 25 |
| Base-currency ledger | 21799097138871 | 21799097138871 |
| Memory | 0.15 GB containers | 1.7 GB used / 6.0 GB available, swap 372 K |
| Downtime | — | ~2 min (14:37–14:39 UTC) |

Still open, in priority order:

1. **§13 backups.** The only remaining regression against hosted. `npm run db:backup` works
   against the new database through the tunnel (verified, 1.67 MB), but it is still manual and
   laptop-side. Nothing takes a scheduled backup of production right now.
2. **Rotate the hosted credentials** and keep that project paused (§14).
3. The `retention` cron reads stale (~41 h). Pre-existing, unrelated to this move — same class of
   gap as the `agreements` entry missing from `STALE_AFTER_MINUTES`.
