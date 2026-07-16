# Outreach Specialist SOP — implementation

Implements `Script for Outreach Specialist.docx` (Steps 1–23) against the QA checklist in
`Outreach_SOP_QA_Checklist_and_ClaudeCode_Prompt.md`. The audit that motivated this is
[`OUTREACH_SOP_GAP_REPORT.md`](OUTREACH_SOP_GAP_REPORT.md).

## The idea in one paragraph

**The SOP is a human-executed process, so the engine's job is to say WHAT to send, to WHOM, WHEN —
not to send behind the specialist's back.** Every step materialises as a row with the message
already rendered; the specialist reads it, copies it, marks it sent. Admin can flip individual
steps to auto-send, but every step is manual by default and the engine itself ships disabled.

## Where things live

| File | Responsibility |
| --- | --- |
| [`src/lib/outreach-sop.ts`](../src/lib/outreach-sop.ts) | The SOP as data — 9 message templates **verbatim**, call scripts, step definitions, SLA defaults, `qualifiedFromBant` |
| [`src/lib/whatsapp-submission.ts`](../src/lib/whatsapp-submission.ts) | The same 9 messages translated into WATI/Meta's dialect (`{{name}}`), + category calls, samples, and a linter for Meta's mechanical rules |
| [`scripts/whatsapp-templates-docx.ts`](../scripts/whatsapp-templates-docx.ts) | Generates `WhatsApp_Templates_for_Approval.docx` — the submission pack (`npm run docs:whatsapp`) |
| [`src/lib/outreach-engine.ts`](../src/lib/outreach-engine.ts) | The ladder, as **pure functions**. No prisma, no clock — `now` is always a parameter |
| [`src/server/outreach.ts`](../src/server/outreach.ts) | DB shell: journey lifecycle, Step 10 cross-check, rendering, `runDueOutreach` |
| [`src/server/outreach-actions.ts`](../src/server/outreach-actions.ts) | Server actions. Every status change is attributed + timestamped |
| [`src/server/outreach-metrics.ts`](../src/server/outreach-metrics.ts) | The queue + the Key Metrics sheet |
| [`src/server/outreach-notify.ts`](../src/server/outreach-notify.ts) | Step 1's opt-in email to the specialist |
| [`src/app/(app)/outreach/`](<../src/app/(app)/outreach/>) | Queue · Key Metrics · Closed · Settings |
| [`src/app/api/cron/outreach/route.ts`](../src/app/api/cron/outreach/route.ts) | The scheduler seam |

The pure/DB split is deliberate: it is what lets every SLA boundary be tested at
T−1min / T / T+1min without a database or a fake timer.

## Data model

`OutreachJourney` — one per Lead, holding the columns the SOP has and the CRM didn't: `qualified`
(YES/MAYBE/NO), `whatsappSent`, `whatsappConfirmed`, `salesCallConfirmed`, `highlyQualified`,
`respTouchpointId`, `respDiscoId`, `zoomLink`, `redFlag`, `sssAt`, `contactedAt`.

`OutreachStepLog` — one row per (journey, step). **`@@unique([journeyId, step])` is the idempotency
guarantee** the checklist asks for repeatedly. It's a DB constraint, not a read-then-write check,
so concurrent cron runs cannot double-send. Step 16's two required call attempts are separate
enum values for exactly this reason.

Every branch terminates: `IGNORED` (Step 9), `CANCELLED` (17/22), `CLOSED_NOT_HQ` (18),
`COMPLETED`. No dead ends.

## Running it

1. **Outreach → Settings → "Run the outreach engine"** (admin). Off by default.
2. **Backfill journeys** for leads captured before the engine existed. Idempotent.
3. **Point a cron at the engine — every minute:**

```cron
* * * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/outreach
```

`CRON_SECRET` is **required** — the route fails closed (503) without it, and `docker-compose.yml`
defaults it to empty. The app has no autonomous clock: BullMQ is present but no `Worker` is ever
constructed, so nothing wakes itself up. **Cron cadence is the engine's timing resolution — a
15-minute cron cannot police a 5-minute SLA.** (The 5-minute window is only ever *reported* late,
never enforced wrongly: `reactionState` reads the real clock.)

Auto-send additionally needs the WATI layer armed *and* a template mapped per touchpoint. Until
then a ticked step stays in the queue for manual sending — which is the designed fallback, not a
failure.

## Templates

Transcribed **verbatim**, including curly apostrophes (U+2019), the 🇩🇪 emoji, `*bold*` markers,
`<<INSERT ZOOM LINK HERE>>`, and trailing spaces. The checklist requires a character-diff against
the SOP to pass, so **do not "tidy" this text** — straightening a quote is a real regression.

Variables keep the SOP's own bracket syntax (`[Prospect’s First Name]`) rather than `{{name}}`,
because the specialist reads these next to the printed SOP. `unresolvedVars()` is a fail-closed
gate: a step with leftovers is blocked, never sent with a blank.

### Getting them approved

`npm run docs:whatsapp` regenerates **`WhatsApp_Templates_for_Approval.docx`** (repo root) — the
pack B2 signs off and pastes into WATI. It contains all nine templates in Meta's format, the
approval + go-live checklist, and the wiring guide.

The bodies in that pack are **derived from the SOP constants, never retyped** — `submissionBody()`
runs the real substitution over the real template, and a test asserts the prose is identical once
variables are stripped. So the pack cannot drift from what the app sends. Re-run the script after
any template change.

**One touchpoint per template, strictly.** The app binds exactly one WATI template per
`WhatsAppKind`, so the nine SOP messages get nine kinds (`SOP_INTRO` … `SOP_SSS_CANCEL`). Pointing
two steps at one kind would send the intro's text where the follow-up's belonged — silently, with
no type error. A test pins the 1:1 mapping, and two more pin the variable contract in both
directions (every declared variable is offered by its touchpoint, and every offered variable is
used).

### Known Meta issues in the SOP text

`lintTemplate()` checks Meta's mechanical rules — body length, adjacent/leading/trailing variables,
undeclared parameters. Two real problems surfaced, and neither is auto-fixed, because changing what
a prospect reads is B2's decision:

- **Step 3 (intro) — likely rejection.** The SOP's first two lines are `Hi [Prospect’s First Name]`
  / `[Your Name] here from B2 Consultants.` — two variables with only a line break between them,
  and a newline is not static text. The pack carries a `proposedFix` that adopts the SOP's *own*
  Step 13 phrasing ("Hi X, this is Y from B2 Consultants"), so it's B2's house style, not invented.
- **Step 20 — body ended on `{{zoom_link}}`.** Meta rejects a body ending in a variable. One
  closing line is appended via `BODY_SUFFIX`; it's the only place the submitted text departs from
  the SOP, it's additive, and the pack calls it out.

The test suite's stance: a template may lint dirty **only** if it carries a `proposedFix`. Any new
lint failure fails the build.

## Verification

```bash
npm test                # 112 pure tests — SLA boundaries, branches, templates, submission pack
npm run verify:outreach # 37 assertions — the checklist's 5 journeys against a real DB
npm run docs:whatsapp   # regenerate the approval pack; prints a lint report per template
```

`verify:outreach` drives the checklist's Step 6 scenarios end-to-end: golden path, slow reply →
IGNORE, ghost → cancelled + RED, BANT NO → straight to Step 17, HQ NO → no SSS message ever fires,
plus idempotency (three ticks = one tick, and the DB constraint blocks a duplicate).

## Decisions worth knowing

**Email aliasing is deliberately NOT folded** ([`normalizeEmail`](../src/lib/outreach-engine.ts)).
Case and whitespace are unambiguous and we fix both. But `+` sub-addressing and dot-insensitivity
are Gmail conventions, not standards — `a.b@yahoo.com` and `ab@yahoo.com` are different mailboxes.
Folding them turns a false negative into a false positive, which is worse here: it would
cross-check one prospect's booking against another's lead. The SOP's own Ctrl+F is a literal
match, so case+whitespace folding is already strictly more reliable than the manual process.

**The reaction branch is decided once.** An intro that has gone out is proof the FAST path was
taken, so the ladder stays on it even if `contactedAt` was never stamped and 5 minutes have
elapsed. Re-deriving it from the clock would re-anchor Check 1 to "now" and silently move a
deadline already set. (A unit test pins this.)

**"Qualified" reuses the BANT thresholds** rather than inventing a second scale, so the SOP's
"Qualified" and the CRM's `BantVerdict` can never disagree — same decision, two names.
`bantScoreAtQual` stamps the score the verdict was taken on, so re-tuning the model can't rewrite
history.

**`redFlag` is its own field**, so "mark the row RED" can never silently overwrite a status column.

## Fixes made to existing code

| Gap | Fix |
| --- | --- |
| **M1** — `highlyQualified` writable by anyone with the pipeline screen | New `outreach.qualify` capability, guarded in `pipeline-actions` + `outreach-actions`. Checked only when the value *changes*, so ordinary outcome entry still works. A capability rather than a new Role because this app's roles are named after people (`USER` = "Asma / Nilofer" collapses both SOP roles into one) |
| **M2** — any inbound reply counted as confirmation | `isConfirmationMessage` YES-gate in the WATI webhook, rejecting negations first. `REPLIED` (a delivery fact) is now distinct from *confirmed* (a decision). Which flag it sets follows the journey's phase |
| **M3** — booking email never lowercased | `.toLowerCase()` in the booking schema |
| **M4** — phone dedupe was exact-string | Normalized through the already-present `libphonenumber-js`. `+91 98765 43210` / `919876543210` / `09123456780` now resolve to one lead — verified live through the webhook |
| **A** — no opt-in notification | `outreach-notify.ts`. Fire-and-forget: capture must never fail because Resend is down |
| **m1/m2** — CSV dropped CET; "CET" hardcoded | Key Metrics exports every column, and the zone label is computed (`CET`/`CEST`) rather than assumed |

### One bug found by testing, worth remembering

The phone-dedupe SQL originally used `regexp_replace(phone, '\D', '', 'g')` inside a template
literal. **JS cooks `\D` to a bare `D` before Postgres ever sees it**, so the query stripped literal
"D" characters instead of non-digits — matched nothing, and silently duplicated every lead it was
meant to merge. It typechecked, and it read correctly. Only driving a real prospect through the
live webhook exposed it. It now uses `'[^0-9]'`, which needs no backslash and cannot be mangled.

## Known gaps (deliberate)

- **Zoom link is entered by hand** per prospect. Real Google Calendar integration (§R) — matching
  the meeting by date/time/prospect, and alerting when calendar access is missing — is not built.
  The templates fail closed without a link rather than sending `<<INSERT ZOOM LINK HERE>>`.
- **Steps 17/22 cancel the appointment in this app**, not in Synamate's calendar. There is no
  Synamate API integration; the SOP's manual calendar step still applies.
- **BANT model not reconciled against the "New BANT 210725" sheet** (m4). The thresholds match
  Ameen's stated rule (>3 / 2–3 / <2), but despite the "Weighted BANT" name `bantAvg` is an
  *unweighted* mean — B/A/N/T are 25% each. If the sheet specifies dimension weights, this needs
  a pass.
- **`STAGE_CHANGED` still doesn't fire** from `pipeline-actions` (m6) — pre-existing, untouched.
- **`LEAD_WEBHOOK_DEBUG` still logs lead PII** (m7) — pre-existing, self-flagged TEMPORARY.
