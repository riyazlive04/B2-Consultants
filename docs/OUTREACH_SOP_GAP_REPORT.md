# Outreach Specialist SOP — Gap Report

Audit date: 2026-07-15
Source of truth: `Script for Outreach Specialist.docx` (Steps 1–23), extracted verbatim.
Checklist: `Outreach_SOP_QA_Checklist_and_ClaudeCode_Prompt.md` (Part 1, sections A–S).

> **STATUS: the blockers and majors below have been BUILT.** This document is preserved as the
> audit that motivated the work — it describes the codebase *before* the SOP engine existed.
> For what now exists and how to run it, see [`OUTREACH_SOP.md`](OUTREACH_SOP.md).
> Minors m1–m8 are addressed there too, except where noted as deliberately out of scope.

## Verdict

The **generic CRM underneath is strong** — lead intake, dedupe, BANT scoring, booking slots,
WATI plumbing, timezone handling and a workflow engine all exist and are carefully written.

The **SOP-specific outreach layer is essentially absent.** The 23-step lifecycle is not modelled
anywhere: there is no journey state, no step ladder, no SOP templates, no Qualified verdict, no
confirmation flags, and no Key Metrics surface. What exists is a set of adjacent generic features
that a human could use to approximate the SOP by hand.

| Status | Count | Meaning |
| --- | --- | --- |
| IMPLEMENTED | 4 | Meets the checklist item as written |
| PARTIAL | 13 | Related machinery exists but does not satisfy the item |
| MISSING | 40 | No corresponding code path |

**Coverage against the checklist: ~15%.**

The single highest-leverage fact: **there are zero WhatsApp templates in the codebase.**
`DEFAULT_TEMPLATE_MAP` is `{}` ([whatsapp.ts:179](src/lib/whatsapp.ts#L179)) — deliberately, because
B2's live WATI account has no approved discovery/booking templates. Every SOP message step
(3, 6, 13, 14, 15, 16, 19, 20, 21) therefore has no content to send.

---

## Section-by-section trace

### A. Opt-in & Lead Capture (Step 1) — PARTIAL

| Item | Status | Evidence |
| --- | --- | --- |
| Form captures Name + Contact Number | IMPLEMENTED | Publish gate enforces both: [forms-actions.ts:96-98](src/server/forms-actions.ts#L96-L98). Webhooks reject without them ([meta/route.ts:55](src/app/api/leads/meta/route.ts#L55)) |
| Writes a row in real time | IMPLEMENTED (DB, not Sheets) | `upsertIntakeLead` [lead-intake.ts:54](src/server/lead-intake.ts#L54) — the Lead table is the system of record; there is no Google Sheets sync |
| **Email notification to outreach specialist** | **MISSING** | `src/lib/email.ts` is never imported by any intake path. Its only 3 consumers are auth reset, invoices, and generic messaging. `notifications.ts` is in-app only and has no new-lead item |
| Email contains same data as row | **MISSING** | No email exists |
| Opt-in timestamp recorded | IMPLEMENTED | `Lead.createdAt` [schema.prisma:387](prisma/schema.prisma#L387). (`dateIn` is date-only and unusable for a 5-min SLA) |

### B. Reaction Time SLA (Step 2) — PARTIAL

| Item | Status | Evidence |
| --- | --- | --- |
| Measure time since opt-in, flag >5 min | **PARTIAL** | `signalForSpeedToLead` [signals.ts:38-47](src/lib/signals.ts#L38-L47) returns a colour for a pill. Nothing acts on it — no timer, no alert, no escalation |
| "Time Contacted" editable, stored IST | **PARTIAL** | `Lead.contactedAt` exists, stamped once idempotently by `markLeadContacted` [pipeline-actions.ts:148](src/server/pipeline-actions.ts#L148). Not freely editable; stored UTC (correct) but no explicit IST entry field |
| Branch <5 min → Step 3 / >5 min → Step 10 | **MISSING** | No branch logic anywhere |
| Visible alert near the 5-min threshold | **MISSING** | `notifications.ts` has no SLA item |

### C. WhatsApp Intro (Step 3) — MISSING

| Item | Status | Evidence |
| --- | --- | --- |
| `[Prospect's First Name]` / `[Your Name]` populate | **MISSING** | Zero templates. Grep for `\[Prospect` returns nothing. WATI substitutes server-side from a named param array ([whatsapp.ts:83-94](src/server/whatsapp.ts#L83-L94)) |
| Booking + video links correct | **MISSING** | Neither `optin.b2consultants.de/apply` nor `/lang` appears in the codebase |
| Send logged (timestamp + specialist) | IMPLEMENTED | `WhatsAppMessage.sentById` [schema.prisma:2065](prisma/schema.prisma#L2065); null = automated |
| No duplicate sends | **PARTIAL** | `throttleOk` [whatsapp.ts:373-392](src/server/whatsapp.ts#L373-L392) is a read-then-write race with no unique constraint, and is called **only** from the cron path. Every manual send button bypasses it entirely |

### D. First Call Script (Step 4) — MISSING

No call-script UI exists. `DiscoveryOutcome` records the *discovery* call outcome post-hoc; there is
no record of outreach call attempts at all.

### E–I. The booking-chase ladder (Steps 5–9) — MISSING

The 2h → follow-up → 1h → call → 2h → IGNORE ladder does not exist. Adjacent machinery:

- `discoFirstDelayHours: 2` ([whatsapp.ts:132](src/lib/whatsapp.ts#L132)) is a WhatsApp *reminder* delay, not a booking-check step, and does not branch.
- The workflow engine has a `WAIT` action ([automation.ts:66-75](src/server/automation.ts#L66-L75)) that could express the waits, but nothing wires the SOP into it.
- **There is no IGNORE / dormant state.** `LeadStage` ([schema.prisma:337](prisma/schema.prisma#L337)) has no terminal state for Step 9's "not booked → IGNORE". This is a dead-end branch (checklist S).

### J. Booking Verification Cross-check (Step 10) — MISSING

**No email-based lookup exists.** All five `bookingRequest.find*` call sites match by `id`,
`status`, or `createdAt` — never email. The Lead↔Booking link is written once at creation
([booking-actions.ts:157-161](src/server/booking-actions.ts#L157-L161)).

Two latent correctness bugs that the checklist's "false negative" item specifically asks about:

- **Email is never normalized.** [booking-actions.ts:46](src/server/booking-actions.ts#L46) trims but does not lowercase. `Ameen@X.com` ≠ `ameen@x.com`. The codebase lowercases emails elsewhere ([access-requests.ts:66](src/server/access-requests.ts#L66)), so this is an inconsistency.
- **Dedupe matches phone by exact string** ([lead-intake.ts:79](src/server/lead-intake.ts#L79)). `+91 98765 43210`, `+919876543210` and `09876543210` become three separate Leads — despite `libphonenumber-js` already being a dependency.

### K. BANT Qualification (Step 11) — PARTIAL

| Item | Status | Evidence |
| --- | --- | --- |
| Scoring model matches "New BANT" sheet | **PARTIAL — needs reconciliation** | Implemented in [booking-intake.ts:109-166](src/lib/booking-intake.ts#L109-L166), **not** in `src/lib/bant.ts` (which does not exist, despite [schema.prisma:1067](prisma/schema.prisma#L1067) pointing at it). Thresholds `>3 CONFIRM / ≥2 DOUBT / <2 CANCEL`. Despite the "Weighted BANT" name, `bantAvg` is an **unweighted mean** — B/A/N/T are 25% each |
| "Qualified" auto-calculates YES/MAYBE/NO | **PARTIAL** | `BantVerdict` `CONFIRM/DOUBT/CANCEL` is isomorphic to YES/MAYBE/NO but is never surfaced under that name, and the SOP's "Qualified" column does not exist |
| Score entry auditable | **MISSING** | No `scoredById` / `scoredAt` / model version. Retuning the score table silently mixes model generations in one averaged column |

Also note `DiscoveryOutcome` carries a **second, duplicate** set of BANT booleans
([schema.prisma:453-456](prisma/schema.prisma#L453-L456)), manually ticked post-call and never
reconciled with the `BookingRequest` BANT.

### L. Data Transfer to Key Metrics (Step 12) — MISSING

There is no Key Metrics surface. The generic bookings CSV covers ~6 of 14 columns and, notably,
**drops the CET time from the export** — it renders on screen but the column's export value is
IST-only ([BookingsTable.tsx:88-96](src/app/(app)/bookings/_components/BookingsTable.tsx#L88-L96)).
Missing entirely: Email, Phone, Qualified, Resp. for TOUCHPOINT, Resp. for DISCO, WhatsApp Sent,
WhatsApp Confirmed, Sales Call Confirmed, Highly Qualified.

Timezone conversion itself is **correct and DST-aware** ([format.ts:71-82](src/lib/format.ts#L71-L82),
`Europe/Berlin`). Minor: the UI label is hardcoded `"CET"` and is wrong during CEST (~7 months/yr).

### M–N. Disco Welcome + Confirmation (Steps 13–16) — MISSING

No templates, no ladder, no flags. The 36h/24h/12h offsets **cannot be expressed**:

- The workflow engine has no backward-from-appointment primitive — `WAIT` only counts forward from enrollment ([automation-types.ts:21-42](src/lib/automation-types.ts#L21-L42)).
- The WhatsApp layer's `bookingReminderLeadHours` looks close but **does not fire at discrete offsets**. [whatsapp.ts:462-483](src/server/whatsapp.ts#L462-L483) queries one broad window and throttles by the *minimum* gap, so `[36,24,12,10]` yields "≤4 sends, ≥10h apart, whenever cron happens to fire" — not T-36/T-24/T-12/T-10.
- `whatsappSent` / `whatsappConfirmed` / `salesCallConfirmed`: **zero grep hits.** The app knowingly documents this ([SALES-LOGIC.md:115-118](docs/SALES-LOGIC.md#L115-L118)).
- Pipeline stages "Strategy Call Booked" / "Pre-Qualified and Confirmed" / "SSS Call Confirmed" do not exist in `LeadStage`.
- **Confirmation detection has a false-positive bug.** Any inbound reply marks the thread `REPLIED` = "confirmed" ([wati/webhook/route.ts:111-114](src/app/api/wati/webhook/route.ts#L111-L114)). There is no `YES` keyword gate, so *"no thanks, not interested"* registers as a confirmation.
- No "2 call attempts logged before the 12h cancellation" concept.
- No RED row flag.

### O. Cancellation Flow (Steps 17–18) — MISSING

`BookingStatus.CANCELLED` exists as a value, but no SOP-driven cancel flow, no date/time
verification guard against cancelling the wrong appointment, no RED marking.

### P. Handoff to Discovery Specialist — **FAILS (security-relevant)**

> "'Highly Qualified' column is writable only by Discovery Specialist role (permission check)"

**This check does not hold.** `createOutcome`'s entire permission gate is
`await requireSection("pipeline")` ([pipeline-actions.ts:180](src/server/pipeline-actions.ts#L180)),
which by default admits every `USER` and `HEAD`. It then writes `highlyQualified` on **any lead** —
there is no ownership or assignment test.

The Outreach/Discovery boundary **is not an RBAC boundary at all.** Both people are `Role.USER`
([schema.prisma:27-33](prisma/schema.prisma#L27-L33) — roles are named after individuals, and
`USER // Asma / Nilofer` collapses both into one). The distinction exists only as
`DailyLogVariant` ([schema.prisma:1138](prisma/schema.prisma#L1138)), which is **never consulted by
any guard** — its only use is cosmetic tab-hiding at
[pipeline/page.tsx:72-82](src/app/(app)/pipeline/page.tsx#L72-L82). Server actions are POST
endpoints, not page renders, so the tab hiding enforces nothing.

`highlyQualified` is not cosmetic — it drives priority scoring, the HQ-rate metric, and gamification XP.

### Q. SSS Sequence (Steps 19–22) — MISSING

Entirely absent. No SSS confirmation ladder, no `salesCallConfirmed`, no "Upcoming SSS" cancellation
path, no personalized-video attachment placeholder.

### R. Zoom Link Retrieval — MISSING

No `zoomLink` field (zero grep hits), no calendar integration, no meeting-owner lookup, and no
"report to team ASAP" alert mechanism — that step is documentation only.

### S. Cross-cutting — PARTIAL

| Item | Status | Notes |
| --- | --- | --- |
| Triggers configurable, not hardcoded | **PARTIAL** | WATI cadence is DB-persisted and editable; the SOP ladder doesn't exist to configure |
| Timezone explicit everywhere | **IMPLEMENTED** — strongest area | UTC storage, exact IST (`+05:30`, no DST) [dates.ts:124-126](src/lib/dates.ts#L124-L126), DST-correct Berlin rendering, and a documented fix for IST-boundary misbucketing |
| Templates match SOP text exactly | **MISSING** | Nothing to diff |
| Role separation | **MISSING** | See P |
| Audit trail on every status change | **PARTIAL** | The tamper-evident hash-chained `AuditEntry` covers **finance only** — 7 call sites, all money. The funnel is covered by `LeadStageHistory` (stage changes only). `updateOutcome` mutates in place with **no history row**, so `highlyQualified` can be flipped false→true leaving zero trace. The contact timeline hardcodes `authorName: null` for OUTCOME/BOOKING/WHATSAPP rows |
| No dead-end states | **MISSING** | Step 9's IGNORE has no terminal state |
| Sync has no silent failure mode | **PARTIAL** | No sheets to sync. But **both cron routes fail closed to 503 when `CRON_SECRET` is unset** — and `docker-compose.yml` defaults it to empty, so out of the box every `WAIT` parks forever |

---

## Infrastructure finding: there is no autonomous clock

Every time-based SOP rule depends on an external HTTP cron. Verified independently:

- `automation-queue.ts:3` imports **only** `Queue` — never `Worker`. Repo-wide, the only `new Worker` hit is inside a comment.
- No `worker` script in `package.json`; `Dockerfile:23` is a single `node server.js`; `docker-compose.yml` has app/db/redis and no worker; no `vercel.json`.

BullMQ therefore contributes **zero scheduling** — it is a redundant "due at" store shadowing
`nextRunAt`, drained by the same cron that already does the authoritative Postgres poll. The module
documents this honestly ([automation-queue.ts:5-37](src/server/automation-queue.ts#L5-L37)):

> "Nothing here can wake itself up without an HTTP request landing on this process."

**Consequence for the SOP:** timing accuracy is bounded by external cron frequency (~5–15 min).
A 5-minute SLA cannot be enforced by a 15-minute cron. Any build must either tighten the cron
interval or run a real worker.

---

## Prioritized gap list

### Blockers — the SOP cannot run at all

| # | Gap | Fix |
| --- | --- | --- |
| B1 | No SOP journey state machine (Steps 2–23). No step ladder, no branch logic, no terminal states | New `OutreachJourney` + `OutreachStepLog` models and a step engine |
| B2 | Zero WhatsApp templates. All 9 message steps have no content | Ship the 9 SOP templates verbatim in-app with `[Bracket]` variable rendering |
| B3 | No `Qualified` YES/MAYBE/NO, no `whatsappSent`/`whatsappConfirmed`/`salesCallConfirmed` flags | Add to the journey model; derive Qualified from BANT |
| B4 | No Key Metrics surface (Step 12's 6 fields + 8 assignment/flag columns) | New Key Metrics view + correct CSV export |
| B5 | No appointment-relative scheduling. 36/24/12/10h offsets are inexpressible | Due-step computation from `slot.startsAt`, per-offset idempotency |
| B6 | No autonomous clock; cron 503s by default | Tighten cron cadence; document `CRON_SECRET` as required |

### Major — the SOP runs but incorrectly

| # | Gap | Fix |
| --- | --- | --- |
| M1 | **`highlyQualified` writable by the outreach role** (checklist P explicitly forbids) | Add a real role boundary; gate the server action |
| M2 | **Any reply counts as confirmation** — "not interested" marks confirmed | `YES` keyword gate for confirmation |
| M3 | No email cross-check (Step 10); email never lowercased | Normalized email lookup |
| M4 | Phone dedupe is exact-string; format variants split one human into 3 leads | Normalize via the already-present `libphonenumber-js` |
| M5 | No 5-min SLA alert | Journey-driven alert |
| M6 | Manual sends bypass all dedupe; no unique constraint | Unique constraint per (journey, step) |
| M7 | No outreach call-attempt log (Steps 4, 8, 16's "2 attempts") | `OutreachStepLog` with attempt counts |
| M8 | Qualification changes leave no audit trail | Step log with actor + timestamp |
| M9 | No IGNORE terminal state — dead-end branch | Add to journey phase |

### Minor

| # | Gap |
| --- | --- |
| m1 | CSV export drops CET time (visible on screen, absent from file) |
| m2 | `"CET"` label hardcoded; wrong during CEST ~7 months/year |
| m3 | `schema.prisma:1067` and `booking-intake.ts:157` point at a non-existent `src/lib/bant.ts` |
| m4 | "Weighted BANT" is an unweighted mean — verify against the New BANT sheet |
| m5 | BANT has no model-version stamp; retuning silently mixes generations |
| m6 | `STAGE_CHANGED` never fires from `pipeline-actions.ts` — only the Opportunity kanban emits it |
| m7 | `LEAD_WEBHOOK_DEBUG` logs lead PII to server logs (self-flagged TEMPORARY) |
| m8 | No Zoom link field or calendar integration; no "report to team" alert |

---

## What is genuinely good

Worth stating plainly, because the fix list above is long:

- **Timezone handling** is the strongest area — UTC storage, exact IST arithmetic, DST-correct CET, and a documented fix for a subtle IST-boundary misbucketing bug.
- **The WATI layer fails closed** — unmapped templates skip rather than send blanks, missing variables block the send with an explanatory message, opt-out is enforced, and the webhook is secret-checked, timing-safe and rate-limited.
- **The ledger's `AuditEntry`** is a real tamper-evident hash chain with advisory locking against fork races. The problem is only that the funnel doesn't use it.
- **The dedupe design** in `lead-intake.ts` is thoughtful (externalRef → phone → create, fill-blanks-only on redelivery). It just needs normalization.
