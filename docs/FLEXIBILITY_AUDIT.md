# B2 Consultants — Application Flexibility Audit
## What a founder can change without a developer, and what is hardcoded

*App-wide sweep (17 Jul 2026) of every business rule, rate, threshold, enum and magic number, classified by how it can be changed. Method: five parallel code audits across Finance, Sales/CRM, Outreach/Messaging, LMS/Gamification, and Access/Config-infrastructure, with file:line evidence.*

---

## The governing rule (read this first)

**The config system makes *values and membership* flexible; it keeps *structure* as code.** You can tune almost any number, rate, label, threshold, or who-can-do-what without a deploy. But adding a new *kind of thing* — a new pipeline stage, a new commission leg, a new role, a new outreach step, a new metric — is almost always a code change, and often a database migration too.

Said differently:
- **Flexible** = a value inside a fixed shape (the XP for "deal won", the booking buffer, a product's price, who holds `finance.write`).
- **Not flexible** = the shape itself (the *set* of lead stages, the *structure* of the commission split, the *list* of roles, the *steps* of the SOP).

Three classifications used throughout:
- **FLEXIBLE** — editable at runtime, no code change (an `AppSetting` config doc, a DB row a UI edits, or a tunable value).
- **PARTIALLY FLEXIBLE** — some knobs are config but the shape is fixed; OR config exists with a hardcoded gap; OR editable in DB/code but **not surfaced in any UI**; OR a money rule with **no effective-dating** so edits silently re-price history.
- **NOT FLEXIBLE** — a hardcoded constant, enum, or business rule; changing it needs a code edit + deploy (and frequently a Prisma migration).

---

## The six patterns behind every finding

1. **Prisma enums are the hardest floor.** Roles, lead stages, program levels, payment methods, trigger types, WhatsApp kinds, GN products — all Postgres enums. Changing one is a migration *plus* edits to every zod schema and hardcoded literal list that mirrors it (several are duplicated across 3–4 files).
2. **"Looks like config, is a bare `const`."** A handful of business-critical rate cards and curves sit in `.ts` constants right next to fully-configurable siblings — the clearest traps (§4). Commission rates, the GN cost model, the Skool level curve, program durations.
3. **Effective-dating exists for exactly one config.** Only `gamificationRulesets` versions by date. Every other edit is latest-wins and **retroactive** — change a rate and all history re-prices on the next recompute. Commission is the worst case: hardcoded *and* re-prices history.
4. **Config with no UI.** Some settings are defined, defaulted, and read at runtime, but no screen edits them — the auto-disqualify toggle and rejection-email template are the standout: live in production, editable only by hand-editing a JSON row in the database.
5. **No config audit trail.** `AppSetting` carries only `updatedAt` — no actor, no prior value, no history. The hash-chained `AuditEntry` exists but is wired *only* to the financial ledger. Every config change is a blind overwrite.
6. **Three ₹8-lakh targets, three thresholds sets.** The same figure or concept is re-hardcoded in several places (the monthly target; profit/pace signal bands), so "change our target" or "retune the health colours" is not one action.

**Headline counts:** ~55 distinct NOT-flexible rules, ~30 partially-flexible. The concentrations are **the notification centre** (entirely hardcoded), **the outreach SOP** (structure + text all code), **BANT scoring** (all code), and **the enum layer** (every domain).

---

# PART 1 — NOT FLEXIBLE (needs a developer + deploy)

## 1.1 Finance, money & commissions

| Feature | Where | To change today | Note |
|---|---|---|---|
| **Commission rates** (`bothCallsPct 5 / splitPct 3 / closerPct 4`) | `commission-metrics.ts:18-22` | Edit const + deploy | `closerPct` literally commented `PLACEHOLDER, confirm with client`. No config, no UI. |
| **Commission split *structure*** | `commission-metrics.ts:70-100` | Rewrite the if/else ladder | Even if rates were config, the shape (both-calls / split / first-only / closer-on-top) is baked into control flow. |
| **Runway target "₹8L/mo"** | `cash-metrics.ts:180` (`TARGET_INR = 80_000_000`) | Edit constant | Does **not** read the editable `MonthlyTarget` — a *second* target number. |
| Signal bands — profit/attainment 80/50, runway 6/3 mo, speed-to-lead 5/60 min | `signals.ts:20-47` | Edit `signalFor*` | Runway band **re-hardcoded independently** in `notifications.ts:378`. |
| FounderPulse pace band (75/100) & projected band (80/100) | `FounderPulse.tsx:191,238` | Edit inline | **Two more threshold sets**, inconsistent with `signals.ts`. |
| Chart-of-accounts → posting maps (level→income acct, category→expense acct, method→asset acct) | `chart-of-accounts.ts:82-147` | Edit switch statements | Account *codes/types* are code-owned. |
| Invoice numbering (`INV`/`EST`, 4-digit pad, no yearly reset) | `payments-actions.ts:136-145` | Edit | Can't change format/prefix. |
| Payable freq→monthly divisors; `ONE_TIME`→0 in break-even; 60-month projection cap; "due-soon underfunded" = 2× cover within 7 days | `cash-metrics.ts:16-24,154,186` | Edit | Break-even + runway rules. |
| Cash-stale = 7 days; receivable "next 30 days" | `cash-metrics.ts:72,111` | Edit | 7-day dup'd in `notifications.ts:392`. |
| FX last-resort fallback = ₹90/EUR | `fx.ts:7` | Edit constant | Real rate ~₹110; only used when API down + cache empty. |
| Money enums: PaymentMethod, PaymentType, ExpenseCategory, Currency, PayableFrequency, LedgerAccountType, LedgerSourceType | `schema.prisma:208-235,2415-2447` | Migration + ~5 zod edits | A new currency or expense category touches many files. |
| `BASE_CURRENCY = INR` / dual-currency INR+EUR only | `ledger-core.ts:30`; `schema.prisma:2423` | Migration + broad refactor | A 3rd currency is a project, not config. |
| **No GST/tax subsystem at all** | (absent) | New account + posting + migration | Per-invoice `taxPercent` exists but never posts to the ledger and has no tax account. |

## 1.2 Sales, CRM, pipeline & qualification

| Feature | Where | To change today | Note |
|---|---|---|---|
| **BANT scoring model** — per-answer weights, `DIMENSION_MET_AT = 3`, verdict cutoffs (`avg>3`→confirm, `≥2`→doubt, `<2`→cancel), dimension composition | `booking-intake.ts:109-177` | Edit consts + deploy | The entire qualification engine. The `<2`→CANCEL cutoff is what fires auto-disqualify. Comment says "retune by editing the numbers" — i.e. code. |
| **Booking intake questions & options** (`INTAKE_OPTIONS`) | `booking-intake.ts:15-101` | Edit + deploy | Founder cannot add/rename a qualification question. (Contrast the native Form builder, which is DB-driven.) |
| **`LeadStage` enum — the real sales pipeline** (15 stages) | `schema.prisma:380-398`; re-listed `pipeline-actions.ts:18` | Migration + code | The editable pipeline board is a *mirror* bridged to this enum (see §2.2 P3). |
| Lead priority scoring & deal-risk auto-flags (`STAGE_WEIGHT`, idle 7/5/10-day rules) | `pipeline-metrics.ts:280-335` | Edit | The whole "call these first" algorithm. |
| Stage bucket lists (`INTERESTED_STAGES`, `OPEN_STAGES`) — what counts as pipeline value | `pipeline-metrics.ts:17-20,274` | Edit | |
| Avg-fee learning (`FEE_LEVELS`, 24-mo window, 60s TTL) | `pipeline-metrics.ts:93-96` | Edit | GN levels excluded by design. |
| Enums: LeadSource, Source, ProgramLevel, PaymentPlan, CallOutcome, CallLogOutcome, OpportunityStatus, BantVerdict, BookingStatus, SlotStatus, InvoiceKind/Status, ProductInterval, SubscriptionStatus, CustomFieldType | `schema.prisma` (many) | Migration + code | Several duplicated across 3–4 files (LeadSource in 4). |
| Appointment "types" = 30 or 60 min only; slot buffer clamp 15–240; 180-day booking cap | `booking-actions.ts:289,313` | Edit | Appointment types are two hardcoded durations, not a config table. |
| Booking rate limit (5/10min) + honeypot field; hardcoded stage transitions; IST +5:30 fixed | `booking-actions.ts:74,109,180,318` | Edit | |
| Native Form field-type palette (7 types) + Lead-field mapping | `sites-types.ts:9-34` | Edit | Form *content* is DB-editable; the field *types* are fixed. |

## 1.3 Outreach, messaging & notifications

| Feature | Where | To change today | Note |
|---|---|---|---|
| **The 23-step outreach SOP ladder** (order, channel, anchor, SLA key) | `outreach-sop.ts:299-475` + enum `schema.prisma:2626` | Edit array + migration | The whole ladder is code keyed off a closed enum. The UI exposes only enable/auto-send/SLA — never the steps. |
| **The 9 SOP WhatsApp template bodies** (`TPL_*`) | `outreach-sop.ts:70-160` | Edit + deploy | Verbatim `const` strings; even changing "20 min" to "30 min" or the apply URL is a deploy. |
| SOP variable allowlist (6 bracketed tokens); call scripts; step-anchor model (4 shapes); ladder decision logic | `outreach-sop.ts:26-33,177-266,281`; `outreach-engine.ts:173-341` | Edit | |
| SOP step → WhatsAppKind routing map | `server/outreach.ts:446-456` | Edit | |
| **`WorkflowActionType`** (8 actions, closed — no `SEND_WHATSAPP`) | `automation-types.ts:11` | Edit union + executor | The workflow engine can't send WhatsApp today. |
| **`TriggerType`** (6 triggers, closed) | `automation-types.ts:3` + `schema.prisma:1060` | Migration + wire `emitTrigger` | Founder can't add an automation trigger. |
| **`WhatsAppKind`** (22 touchpoints, closed) + `WHATSAPP_AVAILABLE_VARS` pool | `whatsapp.ts:14,98` + `schema.prisma:2185` | Migration + code | Founder can't add a new touchpoint kind or a new template variable. |
| **The entire notification centre** — "recent = 3 days", severity per rule, every threshold (runway <6/<3, behind-target day>15 & <50%, stalled 10d, payables 7d, radar 14d, final-sprint ≤21d, 7 PM log cutoff, quest nudge ≥60%), 45s cache | `notifications.ts` (throughout: `:44,342,378-455`) | Edit | **No `AppSetting` exists for notifications** — every rule is a code constant. Largest single hardcoded surface. |
| Email/SMS token allowlist (4 tokens) + HTML wrapper styles | `messaging.ts:12-25` | Edit | Adding `{{company}}` needs code. |
| Status-reconcile windows (72h, ±5min), WATI status mapping | `server/whatsapp.ts:31,339,365` | Edit | |
| Prospect-facing timezone = Asia/Kolkata everywhere | `server/outreach.ts:217`; `server/whatsapp.ts` | Edit | |

## 1.4 LMS, German Note & gamification

| Feature | Where | To change today | Note |
|---|---|---|---|
| **Skool community level curve** (points→level 1-9) | `german-note-metrics.ts:73` (`LEVEL_THRESHOLDS`) | Edit array + deploy | **The most surprising hardcode** — the employee gamification curve next door is fully console-editable and effective-dated; this parallel curve is a bare const with no UI. |
| **Program durations 90d/120d** (Guided/Elite) + sprint grid (13/18 weeks) | `students-actions.ts:57-64,303` | Edit + migration | Pure magic numbers gating `programEndDate` and the sprint plan. |
| **Binary video "watched"** (no watch-%) | `GnRecordingWatch`; `german-note-actions.ts:636` | Schema + code | Switching to %-based progress is a data-model change. |
| Ad-spend allocation formula & all P&L identities (COGS/GP/NP/ROAS) | `german-note-workshops.ts:68-89,155-157` | Edit | Even split across AD conversions; not tunable. |
| GN leaderboard windows (7/30-day) | `german-note-metrics.ts:421` | Edit | |
| Default coach fallback "Karthick" | `students-actions.ts:94` | Edit | |
| Enums: ProgramLevel, ProgramDuration, Milestone, SprintStatus, StudentStatus, GnEventType, GnWorkshopProduct, GnConversionStatus, GnVideoProvider, GnPostCategory | `schema.prisma` (many) | Migration + code | New session type, video provider, product bundle, or milestone = migration. |
| `PRODUCT_LEVELS` (bundle composition) | `gn-workshop-pricing.ts:27` | Edit | A1_A2 → [A1,A2] is code. |
| Resume A4/Letter page geometry | `resume-docx.ts:27` | Edit | |
| Gamification IST offset, query scan caps (3000/5000), `LOG_FIELDS` dup | `server/gamification.ts:27-85` | Edit | |

## 1.5 Access control & structure (the code-truth layer)

| Feature | Where | To change today | Note |
|---|---|---|---|
| **The 5 roles** (ADMIN/HEAD/USER/STUDENT/TUTOR) | `schema.prisma:27` | Migration + edit 4 mirrored lists | Roles duplicated in `sections.ts:16`, `console-actions.ts:214`, `users-actions.ts:48`, reward schema. |
| **Section existence** (a section exists because a route exists — key/href/phase) | `sections.ts:35-47` | New Next.js route + code | Founder can't invent a section; can only relabel/reorder/hide/re-role existing ones. |
| **The 6 capability keys** (`finance.write`, `pipeline.configure`, `users.manage`, `rewards.approve`, `agreements.issue`, `outreach.qualify`) | `capabilities.ts:36-93` | Add key + wire a guard | A key without a server-action guard grants nothing. |
| Icon & group vocabularies (31 icons, 4 groups) | `sections.ts:22-32` | Edit + lucide mapping | Founder picks from the list. |
| The access rule itself (enabled → per-user override → role default) | `sections.ts:173`; `capabilities.ts:112` | Code | Single source of truth so UI mirrors server. |
| ADMIN omnipotence; last-admin / self-demotion rails | `capabilities.ts:117`; `users-actions.ts:124` | Code | Safety rails. |
| **`AppSetting` shape** (key/value/updatedAt only) | `schema.prisma:2162` | Migration | No versioning/audit/effective-date column possible without a migration. |
| Config document *shapes* (which knobs exist in each config) | `config-schema.ts` (zod) | New schema field + UI + reader | Values inside a doc are flexible; the field set is fixed. |

---

# PART 2 — PARTIALLY FLEXIBLE

## 2.1 Config exists, but no UI edits it (DB hand-edit only)

| Feature | Where | The gap |
|---|---|---|
| **Auto-disqualify toggle + rejection-email subject/body** | `config-schema.ts:270-295`; read+sent `booking-actions.ts:169,194` | The fields exist, default, and **send a real email** on a BANT "CANCEL" — but the only editor (`updateBookingRules`) writes just the 3 window fields. To change the rejection template you hand-edit the `bookingRulesConfig` JSON row. |
| **PipelineStage.probability** (weighted-forecast %) | `schema.prisma:730`; read `opportunities-metrics.ts:132` | Column is read and displayed ("weighted at X%") but **no server action writes it**. Settable only via DB/seed. |

## 2.2 Tunable values inside a fixed shape

| Feature | Where | What's fixed |
|---|---|---|
| **GN workshop rate card** (`GN_LEVEL_COST` — books ₹1,300; tutor ₹7k/8k/12k) | `gn-workshop-pricing.ts:44-48` | Per-conversion override columns are editable (any single deal is flexible), but the **standard rate card every non-overridden row derives from is code-only**. Global "tutor B1 → ₹14k" = a deploy. |
| **Batch capacity** (`targetStrength`) | `schema.prisma:1705`; `german-note-actions.ts:94` | Per-batch value editable in the manage UI; the **default 8 and the max-100 cap are hardcoded, and it's advisory — not enforced.** The spec's "max 8" is a soft target. |
| **Outreach SLA windows** (5min/2h/…/36/24/12h) | defaults `outreach-sop.ts:515`; `outreachConfig` | Values editable in Outreach → Settings; the **set of SLA keys is fixed**, each clamped `>0` (can't disable a window), and **no effective-dating** (a change re-anchors all in-flight journeys). |
| **WATI cadence** (delays, repeats, max counts, lead-day arrays) | defaults `whatsapp.ts:194`; `watiConfig` | Numbers editable in WhatsApp → Settings; the **cadence *shape* is fixed** — tune existing knobs, can't add a new cadence rule. Several engine windows (no-show 14d/7d, sprint 21d, EMI 20h, take caps) are **not exposed** at all. |
| **Per-workflow WAIT** | `server/automation.ts:95` | `waitMinutes` per step is editable; the 60-min default + loop guard are code. |
| EMI plan (count 1–24, interval default 30, ≤180) | `emi-actions.ts:22-32` | Per-plan inputs flexible; defaults/caps hardcoded. |
| Pipeline avg-fee | `pipeline-metrics.ts:85` | `pipelineAvgFeeInr` editable; the 24-mo window + TTL are code. |
| `defaultCountry` | `whatsapp.ts:267` | Picks from 7 hardcoded countries. |
| Invoice `taxPercent` | `schema.prisma:901`; `InvoiceEditor.tsx:62` | Per-invoice % editable, but **no company-wide default GST rate**, and tax **never posts to the ledger** (no tax account). |

## 2.3 The vocabulary pattern (values flexible, the *set* is code)

Across gamification, goals, and rewards the founder freely combines metric × threshold × copy — but the **vocabulary is a hardcoded `as const`/enum**:

| Vocabulary | Where | Adding a new *entry* |
|---|---|---|
| `COUNTABLE_METRICS` / `STUDENT_BADGE_METRICS` (the metrics badges/goals/quests can use) | `gamification.ts:90-152` | Code — must map to real history in the engine |
| `QUEST_FIELDS` (daily-log fields a quest can pin to) | `gamification.ts:189-205` | Code (14 columns) |
| `RewardTrigger` union (7 kinds) / `RewardKind` (3) / `REWARD_WINDOWS` (3) | `rewards.ts:40-77` | Code |
| `GoalMetric` / `GoalPeriod` (MONTH/QUARTER/YEAR) / `GoalScope` (COMPANY/USER) | `goals.ts:21-33` | Code/enum — `Goal.metric` is text (no migration) but the selectable list is code-bound |
| `MILESTONE_ORDER` (the 7 student milestones) | `gamification.ts:339` + `Milestone` enum | Enum migration + edit |
| STAGE_MOVED XP keys (bound to `LeadStage`) | `gamification.ts:262` | Can't score a stage that doesn't exist in code |
| Resume section *types* (9), fonts (3), page sizes (2) | `resume-template.ts:17-37` | Code (unknown ids silently dropped) |
| GN `GN_LEVELS` allowed batch levels (A1/A2/B1/B2) | `german-note-actions.ts:38` | Enum migration + const edit |

## 2.4 Pipeline board — editable, but bridged to the enum

| Aspect | Status |
|---|---|
| Rename/reorder/add cosmetic stages & extra boards | **FLEXIBLE** (`pipeline.configure`) |
| The default "Sales" pipeline's stages | **Can't be deleted** — "bridged to the sales workflow" (`opportunities-actions.ts:324`) |
| Write-through to `Lead.stage` | **Only fires for the default pipeline** — non-default boards silently don't update the lead's real stage (`opportunities-actions.ts:91`) |
| Net | You can build cosmetic boards; the *operative* workflow is the `LeadStage` enum. |

## 2.5 Effective-dating & infrastructure gaps (cross-cutting)

| Gap | Detail |
|---|---|
| **Only gamification is effective-dated** | `gamificationRulesets` versions by `effectiveFrom` (`gamification.ts:453`). **Every other config is latest-wins and retroactive.** Editing `pipelineAvgFeeInr`, `runwayGrowthRatePct`, or back-dating a ruleset re-prices history on recompute. |
| **Commission = hardcoded AND re-prices history** | `commission-metrics.ts:130` recomputes from the *current* const each read, so retuning any rate silently restates every past month. The one money rule that is both hardcoded and non-stamped. (Income/Expense/Payout/RewardGrant all correctly stamp their rate.) |
| **No config audit trail** | `AppSetting` has only `updatedAt` — no actor, no prior value. `AuditEntry` (hash-chained) is wired **only** to the ledger; zero config writes are audited. |
| **The ₹8L target lives in 3+ places** | Editable `MonthlyTarget` row; hardcoded `TARGET_INR` for runway (`cash-metrics.ts:180`); literal `80000000` fallback copy-pasted in `pipeline-metrics.ts:270`, `notifications.ts:412`, `FounderPulse.tsx:182`. "Change our target" ≠ one action. |
| **Env-flag features need ops, not a founder** | `EMAIL_ENABLED`, `WATI_ENABLED`, `SMS_ENABLED`, `AI_REVIEW_ENABLED`, `INGEST_ENABLED`, `CRON_SECRET`. Each pairs a redeploy-only env flag with a founder-editable `paused` toggle — so "turn email on" is half-ops, half-config. |
| **WATI reminders ignore quiet hours** | The workflow engine honours `workflowSettings.quietHours`; `runDueReminders` has no such check — a founder who set quiet hours would expect all outbound to respect them. |

---

# PART 3 — The traps ("looks like config, isn't")

The highest-value findings, because they're the ones most likely to surprise someone who assumes the app is configurable. Each sits next to a fully-configurable sibling:

1. **Commission rates** (`commission-metrics.ts:18`) — hardcoded, no UI, re-prices history. Next to fully-configurable Reward rules.
2. **GN workshop rate card** (`gn-workshop-pricing.ts:44`) — per-deal overridable, global card code-only. Next to per-conversion editable prices.
3. **Skool community level curve** (`german-note-metrics.ts:73`) — bare const, no UI. Next to the console-editable, effective-dated employee curve.
4. **Program durations 90/120** (`students-actions.ts:60`) — magic numbers. Next to a rich configurable student journey.
5. **BANT scoring** (`booking-intake.ts:109`) — the entire qualification model in constants. Next to the DB-driven native Form builder.
6. **Auto-disqualify + rejection email** (`config-schema.ts:276`) — config that exists but has no editor.
7. **The notification centre** (`notifications.ts`) — every threshold hardcoded, no config doc at all.

---

# PART 4 — For contrast: what IS flexible (no code)

So the picture isn't lopsided — a large surface is genuinely self-serve:

- **Gamification** — all XP, streaks, levels, employee + student badges, quests, student journey. Effective-dated. (Console)
- **Goals & Rewards** — any metric×target×period×scope; any of 7 reward triggers, amounts, roles, approvals. (Console)
- **Access** — per-section role defaults, per-user section + capability overrides, suspend/invite. (People → Users & access)
- **Booking window** — buffer, min-notice, max-advance. (Bookings)
- **Products & pricing** — free-entry INR+EUR, intervals. (Payments) *No hidden/"elite secret price" mechanism exists — prices are plain rows.*
- **Pipelines** — board labels, order, extra boards; contact custom fields; tags; forms; funnels; invoices. (CRM)
- **Money entry** — income, expenses, pending payments, cash position, payables, monthly targets, runway growth override, pipeline avg-fee. (Finance/Cash/Pipeline)
- **Messaging** — Email/SMS templates (full CRUD); WATI template mapping + cadence + pause; channel from/pause. (Conversations/WhatsApp)
- **Outreach** — engine enable, per-step auto-send, SLA values, sender name. (Outreach)
- **Automation** — build/edit workflows from the fixed trigger+action palette; global engine settings. (Automation)
- **Resume/ATS** — sections, style, the whole scoring rubric. (CV Studio)

---

## Recommended priorities (if the goal is "more dynamic")

Ordered by leverage — matches the config-ification the German Note blueprint already proposes (`GN_FOUNDER_WORKFLOW_INTEGRATION.md` §3):

1. **Commission rules → effective-dated config.** Highest value: it's money, it's hardcoded, and it silently re-prices history. Use the gamification ruleset pattern.
2. **GN cost model → config** (books/tutor rate card, effective-dated). Same pattern; already in the GN blueprint.
3. **A notification-settings config doc.** The single largest hardcoded surface; today no threshold is tunable.
4. **BANT scoring → config** (weights + verdict cutoffs), and surface the **auto-disqualify + rejection email** that already exist but have no UI.
5. **Config audit trail.** Point config writes at the existing `AuditEntry` chain — changing a commission rate or a booking rule is exactly what it's for.
6. **Unify the ₹8L target** to one source, and give the health-signal bands a single config home.

**The structural ceiling to accept:** roles, section/route existence, capability keys, and enum *sets* (stages, products, trigger types, milestones) will always need code — that's the deliberate line between "tune the business" (config) and "change what the app is" (development). The work is moving the *rate cards and thresholds* across that line, not the *structure*.

---

*Audit prepared 17 Jul 2026. Companion to `GN_FOUNDER_WORKFLOW_INTEGRATION.md` (which config-ifies the commission + GN-cost items above) and `B2Consultants_Spec_vs_Build_Reconciliation.md`.*
