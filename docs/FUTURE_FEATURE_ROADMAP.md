# Future feature roadmap — everything not already in flight

**Compiled:** 3 August 2026
**Status:** proposal · no code written
**Companion:** `Required_Document/08-completion-vs-prd.md` (what is already built) ·
`ROAD_TO_10.md` (the adoption plan this document must not jump ahead of)

---

## 0. What this document deliberately excludes

The following nine items are **already scheduled** and are not repeated here. This document
covers what comes *after* them.

| Excluded — in flight | Slot |
|---|---|
| Error tracking + uptime monitoring (Sentry) | Week 1 |
| Rate limiting on `/book`, `/f/*`, `/api/leads/pabbly`, `/api/wati` | Week 1 |
| Backups with one **tested** restore into a scratch database | Week 1 |
| Speed-to-lead alert (cron + threshold + Resend) | Week 1 |
| Attendance model | Weeks 2–3 |
| Revenue recognition, straight-line over program duration | Weeks 2–3 |
| 2FA on team logins, reusing the agreement OTP machinery | Weeks 2–3 |
| Dunning ladder (three-stage, keyed off instalment due date) | Week 4 |
| Weekly founder digest | Week 4 |

## 0.1 The rule this roadmap is subordinate to

> **Nothing here gets built until the existing loop runs in production with real users.**

The application already has 32 sections and the business uses about three. A 33rd section moves
neither the build score nor the live score. Every item below is worth building *eventually*;
none of them is worth building before Gate C (≥500 leads contacted, ≥200 call logs, two
non-founder users active on four of five working days).

Effort figures assume one engineer and are calendar estimates, not ideal-day estimates.

---

## 1. Tier 1 — Close the money loop

The app records money precisely and captures none of it automatically. 27 income rows over five
months, every one hand-keyed.

### 1.1 Payment gateway capture — **the highest-ROI item on this page**
**Effort:** 1 week · **Seam exists:** `finance-autopost.ts`, `finance-posting.ts`, `InvoicePayment`

Razorpay and Stripe appear in the codebase today only as *payment-method labels*. Build the
webhook: gateway event → `Income` row → balanced journal entry → instalment marked paid →
`PendingPayment` balance recalculated, all in one transaction, idempotent on the gateway's event id.

**Why first:** it deletes the largest recurring manual step, closes rubric gate C7 permanently, and
makes the dunning ladder shipping in Week 4 actually resolve — a paid instalment should silence its
own reminder without a human intervening.

**Watch:** the ledger posting must go through `postEntry`, never around it, and refunds must post a
reversal rather than a negative income row.

### 1.2 Bank statement import and reconciliation
**Effort:** 1–1.5 weeks · **Depends on:** 1.1 landing first

CSV or MT940 import, fuzzy-matched against ledger entries, with an explicit "unmatched" queue.
Today `CashPosition` is a number typed in weekly, and it goes stale — the audit found it 17 days
old. Reconciliation is what makes the ledger trustworthy enough to replace the founder's spreadsheet.

### 1.3 Refunds, credit notes and cancellations
**Effort:** 3–4 days

There is no first-class refund path. Today a refund would be entered as a negative figure
somewhere, which corrupts revenue, commission and LTV simultaneously. A credit note that reverses
the original posting, claws back the commission accrual and adjusts LTV is a small model and a
large correctness win.

### 1.4 GST / TDS and compliant invoicing
**Effort:** 1–2 weeks · **Needs:** an accountant's input, not just engineering

An Indian entity billing EUR customers has tax treatment the app currently ignores entirely.
Invoices exist; tax lines, HSN/SAC codes, place-of-supply rules and TDS deduction on contractor
payouts do not.

### 1.5 Forex gain/loss recognition
**Effort:** 3 days · **Seam exists:** `FxRate`, rate stamped per record

Every dual-currency row already stores the rate used at entry. What is missing is the realised
gain or loss when EUR actually lands in an INR account at a different rate. Small model, and it
is the difference between "roughly right" and "reconcilable".

### 1.6 Commission payout execution
**Effort:** 4–5 days · **Depends on:** 1.1

`CommissionPayoutRun` computes what is owed. Nothing pays it. A payout file (bank bulk-transfer
format) plus a payout confirmation that posts the expense closes the loop.

---

## 2. Tier 2 — Close the acquisition loop

### 2.1 Meta Ads / Instagram / YouTube API ingestion
**Effort:** 1 week · **Seam exists:** `AdSpend.externalRef` already joins `MarketingSource`

PRD3 §3.2 made awareness reach a number typed in weekly from three dashboards. Automate the pull
and you get, for free, the two numbers nobody in this business can currently state:
**cost per enrolled student, by campaign** and **return on ad spend, by campaign**.

This is the single most valuable *analytical* feature available, because it makes ad spend a
decision rather than a habit.

### 2.2 Zoom / Google Calendar integration
**Effort:** 1 week · **This is the one absent ER v2 entity**

Auto-provision a meeting on booking, two-way calendar sync so a founder's own calendar blocks
slots, and — the real prize — **derive attendance and no-shows from the meeting record** instead of
asking a human to remember. It compounds with the attendance model shipping in Weeks 2–3: one
supplies the schema, the other supplies the truth.

### 2.3 Call recording + AI transcription → auto-outcome
**Effort:** 1.5–2 weeks · **Seam exists:** `lib/anthropic.ts`, `call-note-extract.ts`

Record the discovery call, transcribe it, and have the model produce the `DiscoveryOutcome` draft,
the BANT dimension scores and a coaching scorecard for the caller. The human confirms rather than
composes.

**Why it matters more than it looks:** the audit's hardest gate is C5 — outcomes recorded per
call — and the reason it fails everywhere is that writing up a call is dull. Removing the writing
removes the reason it does not happen. Follow the house rule: the model drafts, a person commits,
and the model never writes a permissioned field.

### 2.4 Learned lead scoring
**Effort:** 1 week · **Needs:** three months of real outcome data first

Replace fixed BANT thresholds with weights learned from which sources, answers and timings actually
converted. The `bantShadowAvg` / `bantConfigVersion` instrumentation already in the schema exists
precisely so a new scorer can run in shadow before it takes over.

### 2.5 Lead deduplication and merge UI
**Effort:** 4 days

Ingestion dedupes on normalised phone across all three paths. What is missing is the human tool for
the cases the rule cannot decide — same person, two phone numbers. At 23,435 leads this is not
hypothetical.

### 2.6 Re-engagement campaigns for the backlog
**Effort:** 3 days · **Gated on:** WATI approval (currently parked)

23,435 leads, none contacted. Calling them is Track C. Messaging them at scale is an automation
that already exists — it needs approved templates and a source whitelist, not new code. Listed here
so it is not forgotten when WATI is un-parked.

---

## 3. Tier 3 — Delivery and retention

### 3.1 Derived student risk signal
**Effort:** 3 days · **Unblocked by:** the attendance model in Weeks 2–3

PRD2 §4.3 specified a manual Green/Amber/Red dropdown, and noted the rules would be defined later.
Once attendance exists, derive it: sessions missed, days since contact, task completion rate,
applications submitted versus expected at this day number. Keep the manual override — the derived
value should be the default, not the law.

### 3.2 Cohort and outcome analytics
**Effort:** 1 week

Time-to-first-interview, time-to-offer, completion rate, satisfaction — sliced by batch, by tutor,
by intake month. This answers "which tutor and which curriculum actually produce placements", which
no current screen can.

### 3.3 Automated satisfaction / NPS survey
**Effort:** 4 days · **Seam exists:** `SatisfactionScore`, Resend, public form infrastructure

PRD2 §4.5 explicitly deferred automation. Trigger at milestone completion and at program end,
write straight into the existing model.

### 3.4 Referral engine
**Effort:** 1 week

A student who received a German job offer is the cheapest and most credible lead source available,
and there is currently no machinery to ask them. Referral link per student, attribution to the
referring student, reward posted through `RewardGrant`.

### 3.5 Placement outcome tracking and case-study generation
**Effort:** 4 days

`JobApplication` already tracks applied → interview → selected. What is missing is the outcome
record that becomes marketing: company, role, salary band, consent to publish. This feeds Tier 2 —
placements are what make ads convert.

### 3.6 Curriculum and content management
**Effort:** 1.5 weeks

Modules and recordings are per-batch today, which means a curriculum improvement does not propagate
to the next cohort. A program-level curriculum that batches instantiate from would fix that.

### 3.7 Tutor scheduling and load balancing
**Effort:** 1 week

Tutor fees accrue per batch per level. Nothing shows a tutor's total load, availability, or
utilisation — which is how you discover you have over-committed one person only after they say so.

---

## 4. Tier 4 — Founder decision support

### 4.1 Scenario planner
**Effort:** 1.5 weeks · **Depends on:** revenue recognition (Weeks 2–3) landing first

"Hire a second closer at ₹X, double ad spend, drop Solo by ₹5,000" → projected runway, P&L and
break-even. Cash Health tells the founder where the business is. Nothing tells him where a decision
puts it. Every input already exists; this is a modelling layer over them.

### 4.2 Pipeline-weighted forecasting with seasonality
**Effort:** 1 week

The current 30-day forecast is pipeline value × close rate — a flat multiplication that ignores
stage, age and time of year. Weight by stage-specific historical conversion and correct for the
seasonal pattern the data will show after two quarters.

### 4.3 Anomaly detection instead of threshold badges
**Effort:** 1 week · **Seam exists:** `lib/anthropic.ts`, `notifications.ts`

"Show-up rate fell 30% against your six-week average, and it started the day the slot pattern
changed" is a different product from a red dot. Deterministic detection, model-written explanation,
with a deterministic fallback when keys are off.

### 4.4 Unit economics per level and per batch
**Effort:** 4 days · **Depends on:** 2.1 for the CAC half

CAC, LTV, LTV:CAC, contribution margin and payback period, per level and per intake. Every input
exists in the ledger and the funnel; nothing assembles them into the five numbers that decide what
to sell and what to retire.

### 4.5 Board / investor pack export
**Effort:** 3 days

One PDF: P&L, cash, funnel, cohort retention, headcount. Currently this is assembled by hand each
time it is needed.

---

## 5. Tier 5 — Platform

### 5.1 Integration test suite over the money layer, in CI
**Effort:** 1 week · **Rubric gate C14**

`src/server/` is largely untested and `ledger-period.integration.test.ts` proved the value the day
it was written — 3 of 6 assertions failed against the old `voidEntry`. Extend the same pattern over
posting, commission accrual, instalment state and archive void/repost, and run it against a
throwaway Postgres in CI.

### 5.2 Query bounding on growth tables
**Effort:** 3 days · **Rubric gate C10**

Roughly 15 unbounded `findMany` calls on `Lead`, `CallLog`, `WhatsAppMessage`, `ActivityLog` and
`Message`. Harmless at today's volume, and not harmless at 100,000 leads.

### 5.3 GDPR right-to-erasure and data export
**Effort:** 4 days

`ConsentRecord` captures consent properly. The other half — a lead or student asking to be exported
or erased — has no path at all, and the business sells to EU-bound customers with a German
operation. This is a compliance gap, not a feature.

### 5.4 Staging environment and feature flags
**Effort:** 3 days

Every engine currently ships behind a default-off `AppSetting`, which is a reasonable stand-in for
flags. What is missing is somewhere other than production to test a migration against real-shaped
data.

### 5.5 PWA / installable shell
**Effort:** 4 days · **Seam exists:** `lib/offline-calls.ts`

Offline call capture already queues to IndexedDB and syncs with the original timestamp. There is no
manifest and no service worker, so a telecaller cannot install the app or open it without signal.
The hard half is done.

### 5.6 Caching or read-replica layer
**Effort:** 1 week · **Only if** the Singapore VPS proves insufficient

Do not build this before measuring. The measured 205ms per query is a distance problem, and
co-locating the app with `ap-southeast-1` is expected to take a typical page from 1–1.6s to ~50ms.
Cache after that number is known, not before.

### 5.7 Audit log search and retention policy
**Effort:** 3 days

`ActivityLog` and the hash-chained `AuditEntry` grow without bound and are only browsable, not
searchable. Both matter the first time someone asks "who changed this figure, and when".

---

## 6. Tier 6 — Reach

| Feature | Effort | Note |
|---|---|---|
| Native mobile app for telecallers | 4+ weeks | Do 5.5 first and see whether it suffices |
| German-language UI (i18n) | 2 weeks | For GN tutors and students; the resume builder is already bilingual |
| Public API + outbound webhooks | 1.5 weeks | Makes B2 the system of record other tools read from |
| Self-serve tutor onboarding | 1 week | Only worth it past ~10 tutors |
| Student-facing session booking | 1 week | Extends `/book` to enrolled students choosing coaching slots |
| Multi-tenant / white-label | 6+ weeks | Only if the platform itself is ever sold. Architecturally invasive — decide before, never after |

---

## 7. Recommended sequence after the current four weeks

| When | Build | Why then |
|---|---|---|
| **Week 5–6** | **1.1 Payment gateway capture** | The dunning ladder shipping in Week 4 needs paid instalments to resolve themselves, or it will chase people who have already paid |
| **Week 7** | **1.3 Refunds and credit notes** | The first refund after gateway capture goes live will otherwise be entered wrongly, and it corrupts three metrics at once |
| **Week 8–9** | **2.1 Meta Ads ingestion + 4.4 unit economics** | Together they produce cost-per-student and ROAS. Neither is useful alone |
| **Week 10** | **5.1 Money-layer integration tests** | Do this before the ledger is carrying three months of real transactions, not after |
| **Week 11–12** | **2.3 Call transcription → auto-outcome** | Needs real calls to exist first, which is exactly what Weeks 1–10 are for |
| **Then** | 3.1 derived risk signal · 2.2 Zoom · 4.1 scenario planner | Each depends on something above it landing first |

**If only five things are ever built from this document:** payment gateway capture · Meta Ads
ingestion with unit economics · call transcription to auto-outcome · money-layer tests in CI ·
GDPR erasure.

The first three make money visible, the fourth keeps it correct, and the fifth is the one that
becomes urgent on somebody else's timetable rather than yours.
