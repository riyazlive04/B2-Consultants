# B2 Consultants — Founder Dashboard

Private internal dashboard (Next.js 14 + Postgres/Prisma + Better Auth). Specs live in the repo
root: three PRDs + `CONTEXT_B2_DASHBOARD.md`. All three phases are live:
**P1 Finance + Pipeline · P2 People + Students · P3 Funnel + Cash Health**, plus the booking
page (`/book`), the student portal (`/my-journey`), the gamified Arena, CV-check, and in-app
notifications.

## Run the production demo

```bash
docker compose up -d db        # Postgres on host port 5435
npm install
npm run db:deploy              # apply migrations
npm run db:seed                # create the four team logins (SEED_* env vars)
npm run db:demo                # ⟵ full production-style demo dataset (see below)
npm run build && npm start     # production server on :3000
```

### Without Docker

If a PostgreSQL installation exists on the machine (its server doesn't need to be
running or accessible — only the binaries are used), `npm run db:local` replaces
`docker compose up -d db`: it runs a project-local instance (data in `.pgdata/`,
gitignored) on the same port 5435 with the same `b2` user, so `.env.example`'s
`DATABASE_URL` works unchanged. Binaries are auto-discovered from the default
install path; set `PG_BIN` to override. Stop it with `npm run db:local:stop`.

```bash
npm run db:local               # instead of: docker compose up -d db
# ...then the same steps as above from `npm run db:deploy`
```

`npm run db:demo` **wipes all business data** (auth users survive) and seeds ~5 months of
coherent history anchored to today: income/expenses/pending payments, 68 leads with full stage
history + BANT outcomes, 14 students with milestone journeys and signals, daily-log streaks,
OKRs, weekly funnel snapshots, cash positions, payables and booking slots — so every page,
metric, badge and notification renders like a live business. It also resets all demo passwords
from `.env`. Re-run it any time the demo data gets messy; it refuses to run against a
non-localhost `DATABASE_URL` unless you pass `--force`.

### Demo logins (passwords in `.env`, `SEED_*_PASSWORD`)

| Login | Role | Sees |
|---|---|---|
| ameen@b2consultants.in | Admin | everything, incl. Finance + Cash + runway badge |
| karthick@b2consultants.in | Head | daily log, students, people |
| asma@b2consultants.in / nilofer@b2consultants.in | User | daily log + own pipeline |
| student.demo@b2consultants.in | Student | own journey portal only (Ravi Kumar) |

Always demo the **production build** (`npm run build && npm start`), never `next dev` —
dev mode compiles routes on demand and feels 10× slower than the real app.

## Deploy (VPS)

```bash
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npx tsx prisma/seed.ts
```

Set real values in the environment first: `BETTER_AUTH_SECRET` (generate: `openssl rand -hex 32`),
`BETTER_AUTH_URL` (public https URL), `POSTGRES_PASSWORD`, and strong `SEED_*_PASSWORD`s.
Do **not** run `db:demo` on the real deployment — it resets business data by design.

## Structure

- `docs/DESIGN_SYSTEM.md` — the "Daylight" design language: every colour/font/radius/component
  token. `globals.css` + `tailwind.config.ts` implement it; if a value isn't in the doc, it
  doesn't belong in the product.
- `docs/SALES-LOGIC.md` — funnel stages, BANT rules, formulas and 2026 benchmarks (source of truth)
- `prisma/schema.prisma` — FULL 3-phase data model (Phase 0 mandate; never refactor P1 tables later)
- `prisma/demo-data.ts` — one-command production-style demo dataset (`npm run db:demo`)
- `src/lib/rbac.ts` + `src/lib/sections.ts` — the one section/role access table; sidebar + page guards read from it
- `src/lib/signals.ts` + `src/components/ui/SignalBadge.tsx` — the shared Green/Amber/Red system
- `src/lib/gamification.ts` — pure XP/badges/quests engine, derived at read time from append-only history
- `src/lib/fx.ts` — daily ECB rate (frankfurter.app) cached in `fx_rate`; each money row stamps its rate
- `src/lib/format.ts` — INR `en-IN` / EUR `de-DE`, DD/MM/YYYY IST, minor-unit BigInt helpers
- `src/components/ui/` — MetricCard, DataTable (sort/filter/CSV), MoneyText, DateText, Sparkline, Modal, feedback (toast/confirm/confetti)

## Rules baked in

- Manual entry is the guaranteed core; ingest (Synamate/Razorpay/Sheets) is optional, flag-gated
  (`INGEST_ENABLED`), writes to the same tables with `source` + `manualOverride`.
- Audit tables (daily logs, milestone log, signal changes, lead stage history) are append-only —
  enforced by Postgres triggers, not just the service layer.
- Money is BigInt minor units (paise/cents), INR + EUR side by side, FX rate stamped per record.
- In-app notifications are the always-on notification centre. Outbound **WhatsApp** reminders (WATI,
  "Wave-2") are a separate opt-in layer — off by default (`WATI_ENABLED`), config-driven, and
  flag-gated; with it off every send is a no-op logged as `SKIPPED`. See the WhatsApp section
  (`/whatsapp`), `src/lib/wati.ts`, `src/server/whatsapp.ts`, and the `/api/cron/whatsapp` +
  `/api/wati/webhook` routes. No outbound **email** yet.
