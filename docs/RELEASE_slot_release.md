# Release runbook — confirm-or-cancel visibility + `slot_release`

Commit **`e6f8f05`** on `feat/agreements-esign`. Production is
<https://b2app.sirahagents.com> (VPS `31.97.227.151`, `/root/b2`), database is Supabase
`ap-southeast-1`. General deploy mechanics live in [DEPLOYMENT.md](DEPLOYMENT.md); this file is
only what is specific to **this** release.

Run the steps in order. Steps 1–2 are safe to do well ahead of 3–5.

---

## 0. Decide what goes in the image

`docker build` uses the **working tree, not git**. Anything uncommitted is still shipped. At the
time of writing the tree also carries an unrelated, uncommitted email-preflight change
(`src/server/messaging-actions.ts` `sendTestEmail`, `src/app/(app)/conversations/_components/ChannelSettings.tsx`,
`scripts/resend-preflight.mjs`, the `email:preflight` script in `package.json`).

You chose to **include** it. Nothing to do — just know it is in the image and has not been tested.
To exclude it instead: `git stash push -- <those four paths>` before step 3, and `git stash pop`
after.

---

## 1. Apply the migration to Supabase

Additive only — one table (`slot_release`), one enum (`SlotReleaseReason`), two nullable FKs, no
change to any existing table. **Safe to run before the code ships**: the currently-running image
never queries it. The reverse is not true — the new code breaks without it, so this must not be
skipped or run after.

```bash
cd B2-Consultants
npm run db:deploy            # prisma migrate deploy, uses DIRECT_URL from .env
npx prisma migrate status    # expect: "Database schema is up to date!"
```

If `migrate deploy` reports drift rather than a clean apply, **stop** and look — do not use
`migrate reset` against Supabase under any circumstances.

---

## 2. Confirm it landed

```bash
npx prisma db execute --stdin <<'SQL'
SELECT to_regclass('public.slot_release') AS table_present;
SQL
```

---

## 3. Build the image locally

The VPS is 1 vCPU with **no swap** — building there will OOM or thrash. Always build here and ship
the result.

```bash
cd B2-Consultants
docker build -t b2-app:slot-release .
docker save b2-app:slot-release | gzip > /tmp/b2-app-slot-release.tar.gz
```

---

## 4. Ship and restart

```bash
scp -i ~/.ssh/b2-vps /tmp/b2-app-slot-release.tar.gz root@31.97.227.151:/root/b2/
ssh -i ~/.ssh/b2-vps root@31.97.227.151
cd /root/b2
gunzip -c b2-app-slot-release.tar.gz | docker load
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml ps        # app healthy, cron running
docker compose -f docker-compose.prod.yml logs --tail=40 app
```

The boot env-guard (`src/lib/env.ts`) throws on a misconfigured production environment, so a
container that starts at all has passed it. If it exits immediately, read the message — it names
the exact variable.

---

## 5. Verify (safe — touches nothing)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://b2app.sirahagents.com/login          # 200
curl -s -o /dev/null -w "%{http_code}\n" https://b2app.sirahagents.com/bookings       # 307 -> /login
curl -s -X POST https://b2app.sirahagents.com/api/cron/whatsapp \
  -H "x-cron-secret: $CRON_SECRET" | jq .run.bookings
```

That last call is the whole feature in one line. Expect:

```json
{ "enabled": false, "reason": "Confirmation loop is off - enable auto-cancel in Booking rules", ... }
```

`enabled: false` is correct until step 6 — it proves the route, the schema and the engine are all
live. Then sign in and check:

- **Bookings** — week calendar, legend shows "Held, unconfirmed" and "Freed this week"
- **Bookings → Cancelled slots** — empty, with its explanatory empty state
- **Bookings → Manage availability** → `/bookings/availability` loads as a page with its jump-nav
- **Console → Sales ops → Confirm-or-cancel** — the panel, reading the live windows
- the footer — "Developed by Sirah Digital" — on every page

---

## 6. Arm the loop — read this first

**Check what it could act on before switching it on.** The engine releases upcoming, unconfirmed
bookings per the configured windows; on a database with real bookings that is a real cancellation
and a real message to a real prospect.

```sql
-- anything > 0 here is a booking the loop may cancel once armed
SELECT count(*) FROM booking_request b
JOIN appointment_slot s ON s.id = b."slotId"
WHERE b.status = 'BOOKED' AND b."confirmedAt" IS NULL AND s."startsAt" > now();
```

Then **Console → Sales ops → Confirm-or-cancel**: set the three windows, tick
*"Ask for confirmation, and release the slot if nobody answers"*, Save.

Two things still gate any outbound message, by design:

1. `WATI_ENABLED` must be `"true"` in the production environment.
2. `BOOKING_CONFIRM_REQUEST` must be mapped to an **approved** WATI template.

Until both hold, nobody is asked — and because the engine refuses to treat silence as a "no"
without a *delivered* request naming the slot, nothing is cancelled either. That is deliberate.
The run summary now says so rather than staying silent: `… · N left alone (never reached them)`.

Also check `watiConfig.testRecipient` on live. It is currently set to `917806966124`, which
redirects **every** outbound WhatsApp to that number — useful for a first live test, wrong for
real operation.

---

## Rollback

```bash
ssh -i ~/.ssh/b2-vps root@31.97.227.151 'cd /root/b2 && docker images b2-app --format "{{.Tag}}\t{{.CreatedAt}}"'
# then re-tag the previous image and `up -d` again
```

Leave `slot_release` in place on rollback — the old code neither reads nor writes it, and dropping
it would lose the release history recorded while the new code was live.
