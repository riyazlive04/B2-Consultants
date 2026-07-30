# Road to 10/10 — execution plan

**Status:** proposed · no code written yet
**Baseline:** Build 8.5/10 · Live 2.5/10 · Overall **4/10** (audit, 23 Jul 2026)
**Target:** Build 9.5 · Live 9.5 · Overall **10/10**
**Estimated effort:** ~9 weeks, one engineer, sequential. Phases 0–2 are non-negotiable and non-parallelisable.

This document is the design of record. Read §1 and §2 first — they define what "10" means and why
the plan spends its first three weeks writing almost no new features.

---

## 1. What 10/10 actually means

The audit scored two things separately, and they fail for different reasons:

- **Build** = is the code correct, fast, and safe? Today 8.5. The gap is a handful of specific
  defects, not a rewrite.
- **Live** = is the business actually running on it? Today 2.5. 23,434 leads, 0 ever contacted;
  0 call logs; 0 future booking slots; 2 of 18 WhatsApp messages delivered; the only person who
  logs in is the person who built it; and it is not deployed.

A 10 is not "more features." Every section in the app is already built. A 10 is:

> Every enabled section carries **real, current data**, produced by **someone other than the
> founder**, on a **deployed** instance, with **no money-layer defect** and **no screen slower
> than 1.5s**.

### 1.1 The rubric

Each phase below closes specific rows. Nothing is "done" on assertion — every gate is a query
you can run against production.

| # | Criterion | Today | Gate |
|---|---|---|---|
| C1 | Deployed at a real hostname, secrets rotated | ✗ | `BETTER_AUTH_URL` is not localhost; Supabase password rotated |
| C2 | Non-founder daily active use | ✗ (69 of 79 sessions are Ameen) | ≥2 non-admin users with sessions on ≥4 of the last 5 working days |
| C3 | Leads are worked in the app | ✗ (0 contacted) | ≥500 leads with `contactedAt`; ≥200 `CallLog` rows |
| C4 | Booking funnel is live | ✗ (0 future slots) | ≥14 days of future `OPEN` slots at all times; every `BookingRequest` has a `leadId` |
| C5 | Discovery outcomes recorded | ✗ (0 rows) | ≥1 `DiscoveryOutcome` per completed call, ≥30 total |
| C6 | Agreements close in-app | ✗ (OTP never sends) | ≥3 agreements reach `SIGNED` via the app |
| C7 | Money is captured, not re-keyed | partial (manual only) | Every won deal has an `Income` row within 48h of payment |
| C8 | Ledger is the source of monthly P&L | ✗ (latent period bug) | Ledger monthly P&L equals Finance monthly P&L, to the paise, for 3 consecutive months |
| C9 | Cash truth is current | ✗ (17 days stale) | `CashPosition` never older than 7 days; committed one-time outflows shown |
| C10 | No unbounded query on a growth table | ✗ (194 unbounded `findMany`) | No `findMany` without `take`/aggregate on `Lead`, `CallLog`, `WhatsAppMessage`, `ActivityLog`, `Message` |
| C11 | p95 page render < 1.5s | ✗ (~3–5s on Pipeline) | Measured on the deployed instance, not localhost |
| C12 | Engines are armed and observable | ✗ (all default-off, none configured) | ≥4 engines enabled; a silent-skip alert exists on the home page |
| C13 | One surface per job | ✗ (4 duplicate groups) | ≤22 sections enabled; each duplicate group has one winner |
| C14 | Money layer has tests | ✗ (`src/server/` untested) | `ledger-core` + posting covered by an integration suite that runs in CI |

**10/10 = all 14 green, sustained for 30 days.** C2 and C3 are the ones that will actually be
hard; everything else is engineering.

---

## 2. The governing principle

> **Nothing new gets built until the existing loop runs in production with real users.**

The audit's central finding is that this app has ~30 well-built sections and the business uses
about three. Adding a 31st section moves the Build score by nothing and the Live score by nothing.
The only work that raises the rating is work that gets data flowing.

Concretely, for Phases 0–2: **no new tables, no new sections, no new integrations.** The only
schema change permitted is the one in Phase 2.3, and it is additive.

---

## 3. Phase 0 — Ship it (Week 1, ~4 days)

Nothing else in this document counts until Phase 0 lands. An undeployed app scores 0 on Live
regardless of how good the code is.

### 0.1 Deploy (1 day)
`docker-compose.prod.yml` was verified working on 17 Jul; migrations were moved out of the build
(that was the P1001 blocker). This is a deployment task, not an engineering one.

- Provision the VPS, point a real hostname at Caddy
- `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
- Set `BETTER_AUTH_URL` to the real origin; verify sign-in from a second device
- Confirm the cron sidecar is ticking: `docker compose logs cron` should show all six routes

### 0.2 Rotate secrets (0.5 day)
The Supabase password is still the original and currently lives in a `.env` on a laptop, alongside
`.migration/data.sql`. Rotate it, delete the dump, re-point `DATABASE_URL` at the **pooler** with
the password `%40`-encoded (the direct `db.<ref>` host is IPv6-only and will not resolve).

### 0.3 Fix WATI (1 day) — **unblocks revenue**
Two independent faults, both live:

- `WATI_ENABLED="true"` is in `.env` but the running process doesn't see it — 6 messages skipped
  as recently as 20 Jul with `"WhatsApp sending is off (WATI_ENABLED not set)"`. Deployment fixes
  the process; add a **boot assertion** so a misconfigured flag fails loudly instead of no-opping.
- 7 messages skipped with `"No WATI template configured for …"`. Map the approved templates in
  `AppSetting("watiTemplateCatalog")`. The submission pack already exists
  (`WhatsApp_Templates_UTILITY_Submission_Pack.docx`); this is a mapping task, not a build task.

**Acceptance:** send one real `AGREEMENT_OTP` end to end and watch it reach a phone.
Until this passes, **no student can sign an agreement**, because signing requires the OTP.

### 0.4 Rolling booking slots (0.5 day) — **unblocks the funnel**
There have been zero future `OPEN` slots since 15 Jul. `/book` shows an empty calendar. Slots are
hand-created via `booking-actions.ts:448` and simply ran out.

- Add `ensureBookingSlots()` to `runDailyMaintenance()` (`/api/cron/daily`, hourly, already running)
- Generate a rolling 21-day window from the founder's configured weekly pattern; idempotent, never
  touches `BOOKED` or `BLOCKED` slots
- Same treatment for `SssSlot` (currently 0 rows — the sales-call layer has no calendar at all)

### 0.5 Backfill the 3 orphaned bookings (0.5 day)
All 3 existing `BookingRequest` rows have `leadId = null` and `qualified = undefined` despite BANT
scores of 4, 3, 4. They predate the link fix. Run the linking + qualification path over them so the
BANT→Qualified metric has correct data in it.

### 0.6 Committed outflows on Cash Health (0.5 day)
A ₹3,00,000 `ONE_TIME` payable was entered on 20 Jul against a ₹6,45,000 bank balance. It appears
in **nothing**: not break-even (`payable-frequency.ts:30` returns 0 for `ONE_TIME`, correctly), not
burn (it's a `Payable`, not yet an `Expense`), not "due this month" (`nextDueDate` is null).
Cash Health reports ~3.4 months runway; the true figure is ~1.8.

Add a **Committed outflows** tile — sum of `ACTIVE` + `ONE_TIME` payables — and a second runway
figure net of it. Do **not** change `monthlyEquivalentMinor`; excluding one-offs from break-even is
correct and well-argued.

> **Gate 0:** C1 green. `/book` shows bookable slots. One WhatsApp OTP delivered to a real phone.
> Cash Health shows the ₹3L commitment.

---

## 4. Phase 1 — One loop, with real people (Weeks 2–3)

This is the phase that decides whether the project succeeds. It is mostly **not** coding.

### 4.1 The loop
Pick the single path that makes money and make only that path work:

> **Lead → first call logged → booked → discovery outcome → agreement signed → payment recorded**

Everything not on this path is out of scope for two weeks.

### 4.2 Method
- Sit with Nilofer and Asma while they work a real day in the app. Not a demo — their actual list.
- Every field they hesitate on, hover over, or skip: **delete it or default it.** Do not explain it.
- Every screen they don't open in a full day: it is not part of the loop. Hide it for now.
- Ship a fix the same day. Two weeks of daily 30-minute iterations beats one big redesign.

### 4.3 Likely work (discovered, not pre-specified)
Based on the audit, expect these to surface:

- **`My Desk` renders empty** — its data source is `CallLog`, which is 0. It will populate the
  moment C3 starts moving, but verify the empty state doesn't read as "broken."
- **Offline call capture** — already built (IndexedDB queue, `calledAt` as the one client-trusted
  clock). The telecallers work from phones with patchy signal. Test it in the field on day 1; its
  migration is currently marked LOCAL-ONLY and needs production sign-off.
- **Speed-to-lead** — `contactedAt` is the field that makes C3 measurable and is currently null on
  all 23,434 rows. Make setting it a *side effect* of logging a call, never a separate action.

### 4.4 Lead triage
23,434 leads is not a work queue, it is a graveyard. 12,904 are `NEW_LEAD` and 8,095 are already
`LOST`. Before asking anyone to "work the leads," define the slice worth calling — most recent
N days, or a specific `leadSource` — and give the desk a list of ~50/day, not 23,000.

> **Gate 1:** C2, C3, C5 green. ≥500 leads contacted, ≥200 call logs, ≥30 discovery outcomes,
> two non-admin users active on 4 of 5 working days. If this gate fails, **do not proceed** —
> repeat Phase 1. Every later phase assumes people are using the app.

---

## 5. Phase 2 — Correctness and speed (Week 4)

Now that people are using it, make it correct and fast. Ordered by measured impact.

### 5.1 Kill the unbounded lead queries (1.5 days) — C10, C11
`pipeline-metrics.ts:290` pulls **15,339 rows / 2.6 MB** on every Pipeline render, then issues two
`IN (15,339 ids)` queries — measured at 2.2s of DB time to produce a 5-item list and an 8-item list.

- Replace with a SQL-side score + `ORDER BY … LIMIT 20`. The scoring rules (`STAGE_WEIGHT`, BANT,
  idle days) translate directly to a `CASE` expression or a small materialised view.
- `reports-metrics.ts:107` pulls all 23,434 leads into JavaScript to group them — replace with
  `groupBy`. Same at `:144` and `:187`.
- Sweep the other 191 unbounded `findMany` calls. Most are on small tables (`user`, `teamProfile`,
  `level`) and are fine. **Only fix the ones on `Lead`, `CallLog`, `WhatsAppMessage`,
  `ActivityLog`, `Message`, `JournalLine`** — the tables that grow without bound.
- Add a lint rule or a CI check so a new unbounded query on those tables fails the build.

### 5.2 Fix the ledger period asymmetry (1 day) — C8
`voidEntry` (`ledger-core.ts:192`) dates its reversal `opts.on` (today) while the restated entry
keeps the original's date. The all-time trial balance is correct — it sums VOID lines too, by
design — but **any period-scoped read** double-counts the original in its own month and shows a
phantom negative in the current one. Confirmed live: ₹45,000, June overstated, July understated.

- Date the reversal to the **original entry's date** when that period is open
- When the period is locked, keep today's date **and** date the restatement to today too — never
  split a correction across periods
- `voidEntry` writes via `journalEntry.create` directly, bypassing the `PeriodLock` check that
  `postEntry` enforces. Route it through the same guard.

This must land before C8 is attempted in Phase 5.

### 5.3 Money-layer tests (1.5 days) — C14
`prisma/verify-ledger.ts` is a genuinely good adversarial suite, but it asserts the trial balance
*balances* — and a mis-dated reversal balances perfectly. **Balance is not correctness.** The 484
unit tests never reach `ledger-core.ts` because `src/server/` is `server-only` and can't be
`tsx`-tested.

- Add an integration suite against a throwaway Postgres (the `scripts/local-db.mjs` harness already
  exists) covering: post → edit → delete → period-scoped P&L, and asserting the **monthly** figures,
  not just the totals
- Wire it into CI alongside `npm test`

### 5.4 Resume download ownership check (0.5 day)
`api/resume/[id]/download/route.ts:26` checks section access but not record ownership; CV Studio is
granted to `STUDENT` by default. `api/agreements/[id]/pdf/route.ts:56-63` does this correctly —
copy that pattern.

> **Gate 2:** C10, C11, C14 green. Pipeline p95 under 1.5s on the deployed instance.
> The ledger integration suite passes.

---

## 6. Phase 3 — Arm the engines (Weeks 5–7)

Every engine in this app ships `enabled: false` and the founder has **never saved a config** —
`AppSetting` holds 6 rows, none of them a section or engine config. This is why ~40% of the
engineering delivers nothing today.

### 6.1 Build the observability first (1 day) — do this before enabling anything
The WhatsApp layer was broken for weeks and nobody knew, because failures record as `SKIPPED` and
nothing surfaces them. Before arming any engine:

- Add a **silent-skip counter** to the home page: any engine that no-ops more than N times in 24h
  raises a card. Reuse `computeNotifications`.
- Add engine health to `/api/health`: last successful tick per cron route

### 6.2 Then one engine per week, in this order
Each gets one week: enable Monday, watch all week, only then proceed. Do not batch.

| Week | Engine | Config | Why this order |
|---|---|---|---|
| 5 | Booking confirmations + reminders | `bookingRules` | Lowest risk, highest immediate return (show-rate) |
| 5 | Discovery reminders | `whatsapp` | Same cron, same templates, directly attacks no-show |
| 6 | Outreach SOP ladder | `outreachConfig.enabled` | 23 steps, verbatim from the SOP; needs the 1-min cron already running |
| 7 | Auto-cancel + promote-next | `bookingRules.autoCancelEnabled` | **Destructive** — arm last, and only after the confirm path has a week of clean data |

Automation workflows stay off. It is both code-hidden and default-off, and it overlaps the Outreach
SOP; decide in Phase 4 which one survives before arming either.

> **Gate 3:** C12 green. ≥4 engines enabled, silent-skip alerting live, no engine has skipped
> silently for more than 24h without surfacing.

---

## 7. Phase 4 — One surface per job (Week 8)

The Synamate clone bolted a full GoHighLevel onto a working bespoke app. Four parallel systems now
exist for the same four jobs. Each is well built; together they mean a telecaller opening the app
has to guess which of four screens is their job.

The Founder Console was built precisely to resolve this and has never been used. Use it.

| Job | Keep | Switch off | Rationale |
|---|---|---|---|
| Track a prospect | **Pipeline** | Opportunities | 1 opportunity vs 23,434 leads. Keep Contacts as the detail view only |
| Capture a lead | **`/book` + Pabbly relay** | Forms, Funnels | FlexiFunnels already does this and is already paid for |
| Operator's day | **My Desk** | Daily Log (fold in), Arena | Daily Log's numbers belong on the desk, not a second screen |
| Messaging | **WhatsApp** | Conversations | `EMAIL_ENABLED` and `SMS_ENABLED` are both false — it is an empty inbox by configuration |

Also: **un-hide Ledger** once §5.2 lands (it is the audit surface for C8), and leave Automation
hidden pending the §6.2 decision.

Net: ~8 sections off the sidebar. **No code is deleted** — this is Console configuration, fully
reversible, which is exactly what that 3,701-line module was built for.

> **Gate 4:** C13 green. ≤22 sections enabled. Sidebar fits without scrolling.

---

## 8. Phase 5 — Close the loop on money (Week 9)

### 8.1 Payment capture (2 days) — C7
Every rupee currently enters by hand. There is no gateway, no bank feed. 27 income rows over 5
months is survivable; it will not survive growth, and it is the reason Finance drifts the moment
the founder gets busy.

- Wire the payment link the business already uses into `/api/leads`-style intake, writing `Income`
  with `source` + `externalRef` for idempotent de-dupe (the unique constraint already exists)
- If no gateway is in play, the fallback is a **daily prompt**: "3 deals moved to WON this week with
  no Income row" on the home page. Cheap, and it closes the gap.

### 8.2 Ledger-backed P&L (2 days) — C8
The stated end-state is "the dashboards read the ledger." Today Finance reads `Income`/`Expense`
directly and the Ledger is a parallel view — which is why the §5.2 defect was invisible.

- Add a monthly P&L built from `JournalLine`, period-scoped
- Show it beside the Finance figure with a reconciliation delta; **the delta must be ₹0**
- Run for 3 consecutive months before declaring C8 green

### 8.3 Cash freshness (0.5 day) — C9
`CashPosition` is 17 days stale and runway is computed from it. Add a weekly prompt on the home
page when the latest position is older than 7 days. The `cashStale` flag already exists — surface it.

> **Gate 5:** C7, C8, C9 green. Ledger and Finance agree to the paise for 3 months.

---

## 9. What NOT to build

The highest-leverage part of this plan. Each of these is a real, plausible next feature that would
lower the score:

| Don't build | Why |
|---|---|
| Anything in Automation | Overlaps Outreach SOP. Decide which survives before touching either |
| More Console configurability | 3,701 lines already exist and zero configs have been saved. The bottleneck is decisions, not options |
| CV Studio AI review | No `ANTHROPIC_API_KEY`, 0 resumes, and it is not on the revenue loop |
| Conversations email/SMS | Two integrations off by config, an empty inbox, and WhatsApp already carries the traffic |
| A 31st section | Every section built so far has moved Live by ~0 |
| Fixing all 194 unbounded queries | Only the ~15 on growth tables matter. The rest is churn |
| Rewriting the Synamate CRM surfaces | They're well built. Switch them off, don't refactor them |

---

## 10. Sequencing and risk

```
Wk 1   Phase 0  Ship it              ├ Gate 0 ─ blocking
Wk 2-3 Phase 1  One loop, real users ├ Gate 1 ─ BLOCKING. Repeat if failed.
Wk 4   Phase 2  Correctness + speed  ├ Gate 2
Wk 5-7 Phase 3  Arm the engines      ├ Gate 3
Wk 8   Phase 4  One surface per job  ├ Gate 4
Wk 9   Phase 5  Close the money loop ├ Gate 5
Wk 10-13        Sustain 30 days      └ 10/10
```

**The one real risk is Gate 1.** Everything from Phase 2 onward is tractable engineering with a
known answer. Whether two telecallers will actually adopt a new system for their daily work is not
an engineering question, and it is the only thing standing between 4/10 and 10/10. If Gate 1 fails
twice, the correct response is to narrow the loop further — one person, one screen, one metric —
not to build more.

**Second risk: latency.** Measured DB round-trip from the dev laptop is 188ms, and every page is
`force-dynamic` with no caching. On a VPS colocated with the Supabase region this should fall to
5–20ms and most of C11 solves itself. If the VPS is *not* colocated, §5.1 alone will not be enough
and Phase 2 needs a caching pass added.

---

## 11. Score trajectory

| After | Build | Live | Overall |
|---|---|---|---|
| Today | 8.5 | 2.5 | **4** |
| Phase 0 | 8.5 | 4 | **5.5** |
| Phase 1 | 8.5 | 6.5 | **7** |
| Phase 2 | 9.5 | 7 | **8** |
| Phase 3 | 9.5 | 8 | **8.5** |
| Phase 4 | 9.5 | 9 | **9.5** |
| Phase 5 + 30 days | 9.5 | 9.5 | **10** |

The Build score barely moves until Phase 2 and then stops. The Live score is the whole game.
