# Operability plan — weeks 1–4

**Written:** 3 Aug 2026
**Scope:** eight items, in the order they unblock each other.
**Premise:** a production error currently reaches the founders only when a client emails. Everything
downstream of that is harder to debug than it needs to be, so observability goes first.

---

## Where this starts from

Three of the eight items are **upgrades, not greenfield builds**. Recon before writing any code:

| Item | What already exists | So the work is |
| --- | --- | --- |
| Rate limiting | `lib/rate-limit.ts` — fixed-window counter, already wired to `/book` (5/10min), `/f/*` (8/10min), pabbly (120/min), wati (300/min) | Replace the algorithm, add a second (global) dimension, return a real `Retry-After` |
| Founder digest | `server/scheduled-report.ts` — six numbers, weekly/monthly, email only, ships off | Add WhatsApp, add period-over-period deltas, put speed-to-lead in the six |
| Dunning | `server/payment-email-reminders.ts` — one stage, 72h cooldown, dedupes by reading `Message.subject` | Three stages, durable per-stage state, WhatsApp escalation |
| Error tracking | nothing | Build |
| Uptime | `/api/health` (DB ping + channel arming) exists; nothing watches it | Build the watcher half |
| Backups | nothing | Build |
| Speed-to-lead alert | `lib/outreach-sla.ts` computes the verdict; nothing alerts on it | Build the alert half |
| Attendance | nothing — `TutorFee.headcount` is `batch.members + batch.enrollments` (roster, not attendance) | Build |
| Revenue recognition | nothing — `Income.date` is cash-in, recognised on day 1 | Build |

**Design constraint inherited from the codebase, and honoured throughout:** every engine ships
**off**, degrades to a no-op when unconfigured, and never throws into a request path. The app has no
clock of its own — nothing here runs unless an external scheduler lands an HTTP request on a cron
route. That is why each item below names the cron that ticks it.

---

## Week 1 — make an incident visible

### 1. Error tracking + uptime monitoring

**Decision: no `@sentry/nextjs`.** This codebase already has a precedent for exactly this shape —
`lib/anthropic.ts` speaks raw HTTP to a vendor, keys-off by default, with a deterministic fallback
when the key is absent. Sentry's *envelope* endpoint is a stable documented HTTP API. Taking the SDK
would add a build-time dependency, an auto-instrumentation layer that rewrites the Next build, and a
webpack plugin — for a feature whose entire job is "POST a JSON envelope when something throws".
The seam is ~150 lines and cannot break the build.

**Build:**

- `lib/observability.ts`
  - Parses `SENTRY_DSN` into `{ origin, projectId, publicKey }`. Malformed or absent → the module
    reports `armed: false` and every capture becomes a no-op. Keys-off is the default.
  - `captureException(err, ctx)` / `captureMessage(msg, ctx)` — builds a Sentry envelope
    (`{}\n{"type":"event"}\n{event}`), POSTs to `{origin}/api/{projectId}/envelope/` with a
    3-second `AbortSignal.timeout`. **Never throws, never awaits in a request path** (fire-and-log).
  - Scrubs before send: a fixed denylist over `ctx` keys (`password`, `token`, `secret`, `authorization`,
    `apiKey`, `cookie`, `dsn`, `connectionString`) plus a regex sweep of the message/stack for
    `postgres://…`, `Bearer …` and long hex/base64 runs. Connection strings and WATI tokens live in
    error messages in this app; shipping them to a third party would be worse than the blindness.
  - Local circuit breaker: max 30 events/minute in-process. A crash loop must not become a
    self-inflicted DoS on Sentry, and the 31st event of the same minute is not information.
  - `recordLocalError()` — mirrors every capture into an in-memory ring buffer (last 50) *and*
    increments a counter, so the health endpoint and console can show error volume even with the DSN
    unset. This is the part that works on day one, before anyone signs up for Sentry.
- `instrumentation.ts` — register `process.on("unhandledRejection")` and `"uncaughtException"`
  handlers that capture. Today these are silent.
- Capture at the seams that already swallow errors: `daily-maintenance.safe()` (currently stores the
  message in a JSON blob nobody reads), every `/api/cron/*` handler, the webhook routes, and
  `app/(app)/error.tsx` via a client → `/api/observability/client-error` hop.
- **Uptime = dead-man's switch, not a pinger.** An external service pinging `/api/health` tells you
  the web process is up; it tells you nothing about whether the crons are running — which, in an app
  where every engine is cron-ticked, is the failure that actually costs money. So:
  - `server/uptime.ts` — `recordCronRun(job, outcome)` writes `{ lastRunAt, lastOkAt, consecutiveFailures }`
    to `AppSetting("cronHeartbeat")`, and `pingHeartbeat(job)` GETs an optional
    `UPTIME_HEARTBEAT_URL` (BetterStack / Healthchecks.io style) **only after** the run succeeded.
    Miss the ping → the external monitor pages someone. That covers "the container is up but the
    cron task died", which a URL pinger cannot see.
  - `/api/health` gains `crons` (per-job age + failure streak) and `errors` (count in the last hour).
    Still booleans and integers only — no schema, no counts of business data, safe unauthenticated.
- Founder Console → **System health** panel: channel arming, per-cron last-run age, recent error
  ring buffer, and whether the DSN is set. The point is that "off" and "on but broken" stop being
  indistinguishable from inside the app.

**Env added:** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `UPTIME_HEARTBEAT_URL` — all
optional, all keys-off.

### 2. Rate limiting

The existing limiter is a **fixed window**, which permits a 2× burst across a boundary: 5 requests at
09:59:59 and 5 more at 10:00:00 is 10 in one second against a "5 per 10 minutes" rule. For `/book`
that is 10 slots gone.

**Build:**

- Rewrite `lib/rate-limit.ts` as a **token bucket**: `capacity` (burst) + `refillPerSec` (sustained).
  `takeToken(key, rule)` returns `{ ok, retryAfterSec, remaining }`.
  `rateLimitOk()` stays as a thin compat wrapper so the 14 existing call sites keep working
  unchanged — this is a swap of the algorithm underneath them, not a 14-file migration.
- `RATE_RULES` — one named table of the public-surface rules, so the numbers are reviewable in one
  place instead of being magic numbers spread across route files.
- **Two dimensions per endpoint**, because per-IP alone is the wrong shape for two of these four:
  - `/book`, `/f/*` — per-IP (abuse is distributed-ish) **and** a global cap (a botnet still can't
    drain the slot calendar).
  - `/api/leads/pabbly`, `/api/wati` — these arrive from *one* vendor IP, so a per-IP limit is
    effectively a global limit that also breaks the moment the vendor changes egress IP. Key on the
    **shared-secret / tenant identity** where present, fall back to IP, and keep a global ceiling.
- `tooManyRequests(retryAfterSec)` — a real `429` with `Retry-After`. Pabbly and WATI both honour it
  and will re-deliver; the current bare 429 tells them nothing and drops the lead.
- Unit tests: burst-then-drain, refill over time, boundary behaviour (the bug being fixed).

### 3. Backups with one tested restore

"Backups are enabled" is not a backup. The deliverable is a script that **restores and counts**.

`scripts/backup-verify.mjs`:

1. `pg_dump` from `DIRECT_URL` (not the pooler — pooled connections break `pg_dump`), custom format,
   to `backups/b2-<utc-stamp>.dump`.
2. Read per-table row counts from the **source** via `pg_class`/`count(*)`.
3. Create a scratch database (`b2_restore_check_<stamp>`) on the **local** PG 18 instance — never on
   Supabase; a restore that lands on the production server is a way to lose the thing you're
   protecting.
4. `pg_restore` into it.
5. Count every table again and **diff**. Any table whose restored count ≠ source count fails the run.
6. Drop the scratch DB. Prune dumps older than the retention window.
7. Non-zero exit on any mismatch, so a scheduled task can alert on it.

PG 18 is installed at `C:\Program Files\PostgreSQL\18` (not on `PATH`) — the script resolves the
binaries itself and says so clearly when it can't find them.

`scripts/run-backup-verify.ps1` wraps it for Task Scheduler, matching the existing
`run-cron-daily.ps1` convention.

### 4. Speed-to-lead alert

The cheapest item, and the one aimed at the number that comes up in every client conversation:
23,435 leads, effectively none contacted.

`lib/outreach-sla.ts` already computes the verdict per lead (5-minute clock + window obligation) and
is unit-tested. What's missing is anything that *acts* on a breach.

**Build:**

- `lib/speed-to-lead.ts` — **pure**. Takes rows + threshold + now, returns
  `{ breaches, worstAgeMins, byOwner, uncontactedTotal }`. Pure so the threshold can be argued about
  under `tsx --test` without a database, same as every other rule in this codebase.
- `server/speed-to-lead-alert.ts` — queries leads that opted in within the lookback and have no
  `SPOKE` CallLog, applies the pure function, and emails the recipients over the existing Resend
  seam. Cooldown in `AppSetting` so a standing backlog doesn't mail every tick. Logs a system
  activity row either way, so "we'd have alerted" is visible before the channel is armed.
- Config `speedToLeadAlert` (Zod, founder-editable, **ships off**): enabled, threshold minutes,
  min breaches to alert, cooldown minutes, recipients, and whether to count the standing backlog or
  only newly-arrived leads. The last one matters: with 23,430 uncontacted leads, "alert on any
  breach" fires forever and gets muted on day two. Default is **new arrivals only**.
- New route `/api/cron/alerts` — the daily cron is hourly, and a 5-minute SLA needs a tighter tick.
  Documented at `*/5`.

---

## Weeks 2–3 — the correctness holes

### 5. Attendance

`TutorFee.headcount` is `batch._count.members + batch._count.enrollments` — the **roster**. The fee
is therefore paid against who *enrolled*, not who *showed up*, and nothing in the schema records the
latter. Two other things are blocked behind it: a derived (rather than hand-set) risk signal, and
no-show rates.

**Build:**

- Schema: `enum AttendanceStatus { PRESENT, LATE, ABSENT, EXCUSED }` and
  `model SessionAttendance { sessionId, studentId, status, minutesAttended?, note?, markedById?, markedAt, autoMarked }`,
  unique on `(sessionId, studentId)`.
  **Materialised on assignment**, mirroring the deliberate choice already made for
  `SessionTaskCompletion`: a derived "who's missing" set has no memory of who was expected at a
  session that has since changed roster.
- `lib/attendance.ts` — **pure**: attendance rate, no-show rate, consecutive-absence streak, and a
  `deriveAttendanceSignal()` returning GREEN/AMBER/RED against founder-set thresholds. Unit-tested.
- `server/attendance.ts` — `ensureAttendanceRows(sessionId)` (backfills the roster, idempotent),
  `markAttendance`, `markAllPresent`, plus batch- and student-level metrics.
- UI, deliberately thin: an attendance sheet on each past session in the German Note schedule panel
  (mark-all-present then correct the exceptions — the only interaction a tutor will actually do),
  and an attendance column on the batch member list.
- **Tutor fee stays roster-based.** Attendance is now *recorded and shown beside* the fee
  (`attendedHeadcount` on the fee row) so the gap is visible, but changing the basis of a fee the
  founders have signed off on is a pricing decision, not a bug fix. Flagged for their call.

### 6. Revenue recognition

A 120-day Elite program collected on day 1 currently books 100% of its revenue on day 1. Every
margin number shown to a client is wrong, and wrong in the direction they notice at month four.

**Build — straight-line, not a deferred-revenue engine.** Explicitly not building: schedule rows per
period, GL postings, or a revenue-recognition ledger account. Straight-line over program duration is
enough to make the number defensible, and the ledger already has enough moving parts.

- `lib/revenue-recognition.ts` — **pure**. Given `{ amountMinor, startDate, endDate|duration }` and a
  window, returns recognised / deferred / not-yet-started, computed by **days elapsed ÷ total days**.
  Rules that fall out and are pinned by tests:
  - `LIFETIME` (Solo) has no end date → recognised **immediately**. There is no service period to
    spread over; pretending there is would be a fabrication.
  - A window entirely before the start recognises 0; entirely after recognises the full amount.
  - Recognition is clamped to `[0, amount]` and the whole-life sum is exactly the amount — no
    rounding drift, because the last day takes the remainder rather than its own rounded share.
- `server/revenue-recognition.ts` — joins `Income` → `Enrollment` for the service period, falling
  back to the income date when unlinked (an unlinked income has no program to spread over — this is
  stated, not silently assumed).
- Surfaced in Finance as **Cash collected / Recognised / Deferred**, never replacing the cash number.
  Both are true and they answer different questions; substituting one for the other is how this goes
  wrong in the opposite direction.

---

## Week 4 — the first thing that looks like value

### 7. Dunning ladder

Resend is built and idle. One reminder exists; it dedupes by *string-matching its own subject line*
against the `Message` table, which breaks the moment anyone rewords the subject.

**Build:**

- Schema: `model DunningEvent { instalmentId, stage, channel, sentAt, messageId?, outcome }`,
  unique on `(instalmentId, stage)`. Durable per-stage state, so the ladder is a fact in the
  database rather than an inference from a subject line, and a stage can never fire twice.
- Three stages keyed off `Instalment.dueDate` (offsets founder-editable):
  - **Stage 1 — `T-3`**, upcoming: friendly, no pressure.
  - **Stage 2 — `T+1`**, missed: direct, states the amount and the date it was due.
  - **Stage 3 — `T+7`**, final: firm, names the consequence, and CCs the founder.
- Stages are **strictly ordered and non-skipping**: an instalment discovered already 10 days overdue
  gets stage 3 only — not 1, 2 and 3 in one tick. That is the failure mode that makes an automated
  ladder feel like a bug to the person receiving it.
- Paid instalments are excluded at query time, and the run re-checks payment state immediately
  before sending. Chasing someone who has already paid is worse than not chasing at all.
- Config `dunningConfig` (ships **off**): enabled, three day-offsets, channel per stage
  (EMAIL / WHATSAPP / BOTH), founder CC address, per-run send cap.
- **Per-run send cap** (default 50): the first armed run faces the entire backlog at once. A cap
  turns a mailbomb into a queue that drains over days.
- Ticked from the daily cron, once per IST day.

### 8. Weekly founder digest

Exists; six numbers; email only; weekly. The upgrade is about it staying in someone's head when they
haven't logged in for a week.

- **Deltas.** A number without last week's number beside it is not a signal. Every row gains a
  period-over-period change with direction.
- **The six numbers change.** Out: "expenses" (already implied by net). In: **speed-to-lead** —
  uncontacted leads and the 5-minute hit rate. That is the number the whole week-1 alert exists to
  move, and it belongs in the thing the founders actually read.
- **WhatsApp delivery**, over the existing WATI seam, because the founders read WhatsApp and not
  email. Gated on template approval — WATI requires a pre-approved template for business-initiated
  messages, so this ships behind a config flag and falls back to email until the template clears.
- Monday 09:00 IST default is already correct.

---

## What ships off

Everything with a side effect. Explicitly:

| Setting | Default | Why |
| --- | --- | --- |
| `SENTRY_DSN` | unset | Sends data to a third party |
| `UPTIME_HEARTBEAT_URL` | unset | Outbound ping |
| `speedToLeadAlert.enabled` | `false` | Sends real email |
| `dunning.enabled` | `false` | Sends real email/WhatsApp to paying students |
| `scheduledReport.enabled` | `false` | Already off; unchanged |
| Rate limits | **on** | The only item here that ships armed — it protects, it doesn't emit |
| Attendance / revenue recognition | **on** | Read-only; they record and display, they don't send or post |

## Test strategy

Pure modules get `tsx --test` unit tests, matching the existing 37 test files:
`rate-limit`, `speed-to-lead`, `attendance`, `revenue-recognition`, `dunning-ladder`, `observability`
(scrubbing + DSN parsing). Server modules that need a database are verified by hand against the
local PG instance, not mocked — the existing convention.
