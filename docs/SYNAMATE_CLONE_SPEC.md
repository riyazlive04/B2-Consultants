# Synamate → B2Consultants Clone Spec

**Goal:** reproduce Synamate's features — screens **and** connectivity — inside the B2Consultants
Next.js app. Scope chosen by the owner: **CRM & lead management, Funnels & landing pages,
Booking & invoicing, Email & SMS automation.** ("Copy all including the screens and connectivity.")

**Source:** Synamate is a **GoHighLevel (GHL) white-label**. Live account toured on 2026‑07‑11:
- URL shape: `app.synamate.com/v2/location/{locationId}/...`  (locationId `40rq2210I0idDREaOysb`)
- Account: **B2 Consultants / Reichelsheim** (Germany, GMT+2, currency **EUR**)
- Team seen: Riyaz Md, Ameenur Rahaman Servarr Basha, Asma Parveen, Nilofer Parveen
- Real data: 10,499 opportunities, €1.42M pipeline, funnels "LFMVP", "VSL", "Onboarding – Gold"

Screenshots captured (repo root): `synamate-dashboard.png`, `syn-contacts.png`, `syn-pipelines.png`,
`syn-calendars.png`, `syn-invoices.png`, `syn-funnels.png`, `syn-automation.png`.

---

## 1. Module inventory (what each screen contains)

### Sidebar (global nav)
Dashboard · Conversations · Calendars · Contacts · Pipelines · Payments · AI Studio · AI Agents ·
Marketing · Automation · Sites · Settings.  (AI Studio / AI Agents are out of the chosen scope.)

### Dashboard
KPI bento: Opportunities donut (Open/Won), Opportunity value by stage (bar), Conversion %,
Funnel + Stage-distribution by pipeline, revenue totals. Date-range picker, pipeline filter.

### Contacts (CRM)  → maps to B2 `Lead`
Sub-tabs: **Smart Lists · Bulk Actions · Custom Fields · Tasks · Companies.**
- Contact record: name/phone/email + **tags**, **user-defined custom fields**, owner, source,
  DND flags, **activity timeline** (notes, calls, emails, SMS, appointments, workflow events),
  associated opportunities, tasks, appointments, documents.
- Smart Lists = saved filtered segments. Bulk Actions = add/remove tag, add to workflow/campaign,
  send message, export. Companies = B2B org grouping. Tasks = per-contact to-dos.

### Pipelines (Opportunities)  → maps to B2 `pipeline`
Sub-tabs: **Opportunities (Kanban) · Pipelines (stage editor) · Bulk Actions.**
- Drag-drop **Kanban board** per pipeline. Pipeline seen: **LFMVP Funnel** with stages
  **Fresh Optins (7,857) → Strategy Call Booked (94) → Cancelled/Unqualified (2,023) → …**
- Opportunity card: contact, **Source**, **Value (€)**, status (Open/Won/Lost/Abandoned),
  inline actions (call, SMS, notes, task, appointment), owner avatar, next appointment chip.
- Per-stage totals (count + € value). List view, filters, sort, import, "Manage fields".

### Calendars  → maps to B2 `bookings` / `book`
Sub-tabs: **Calendar view · Appointment list view · Calendar settings.**
- Week/day/month grid, per-**user** filter, view-by-type (All/Appointments/Blocked slots),
  buffer time, "New" appointment/blocked-slot.
- Settings: calendar **types** (round-robin/collective/class/service), availability windows,
  durations, buffers, form + payment attach, confirmation/reminder notifications, team assignment.

### Payments  → partially maps to B2 `ledger` + `agreements`
Sub-tabs: **Invoices & Estimates · Documents & Contracts · Orders · Subscriptions ·
Payment Links · Transactions · Products.**
- Invoices: KPIs (Draft/Due/Received/Overdue €), table (Name, Number, Customer, Issue date,
  Amount, Status). Invoice editor: line items from Products, tax, discount, due date, send, pay
  online, recurring. Estimates convert → invoice. Products (one-time / recurring / SaaS).

### Sites  → **net-new** in B2
Sub-tabs: **Funnels · Websites · Stores · Webinars · Analytics · Blogs · Client Portal ·
Forms · Surveys · Quizzes.**
- Funnels seen: "Onboarding Funnel – B2 Consultants – Gold" (4 steps), "VSL Funnel" (9 steps).
- Funnel = ordered **steps** (pages), each a drag-drop page of sections/rows/elements; publish to a
  public URL/domain; steps can carry an opt-in form, order form, calendar, or upsell.
- **Forms / Surveys / Quizzes** = builders whose submissions create/att­ach a Contact and fire
  workflows. Forms embed on funnel steps or external sites.

### Marketing  → **net-new** (email) in B2
**Emails** (campaigns + templates + drag-drop email builder), Social Planner, Ad Manager,
Templates, Affiliate. In scope: **email campaigns + templates** (broadcast to a smart list/segment).

### Automation  → **net-new engine** in B2
Sub-tab: **Workflows** (+ Global Workflow Settings). Workflow folders seen: Calendar Booking
Automations, Conversion API Workflows, Payment/Product Automations, Pipeline Automations.
- Visual builder: **Trigger(s) → Actions** with branches/waits; per-workflow enrollment
  (Total/Active enrolled), status (Draft/Published). This is the "connectivity glue".

### Conversations  → extends B2 `whatsapp`
Unified **inbox** across channels (SMS, Email, WhatsApp, FB/IG, Web chat) threaded per contact;
send/receive, templates/snippets, assign, status. B2 today = WhatsApp/WATI only.

---

## 2. Connectivity map (the "connectivity" to copy)

**External integrations (GHL uses; B2 equivalents to wire):**
| Capability | GHL/Synamate | B2 today | To add |
|---|---|---|---|
| Payments | Stripe / PayPal | none | **Stripe** (invoices, payment links, subscriptions) |
| SMS/Voice | Twilio (LC Phone) | — | **Twilio** (SMS) [optional voice] |
| Email | Mailgun / SMTP | none | **SMTP / Resend / Mailgun** |
| WhatsApp | provider | **WATI** (done) | reuse WATI |
| FB/IG + Lead Ads | Meta | Meta lead webhook (done) | reuse; add messaging later |
| Funnel intake | FlexiFunnels webhook | done | replace with native Forms |
| Calendar sync | Google/Outlook | none | optional (ICS first) |
| Domains | funnel hosting | none | public route + custom domain |

**Internal cross-module flow (must replicate):**
```
Form/Funnel submit ─► create/update Contact (+tags, custom fields, source, UTM)
                      └► create Opportunity in a Pipeline stage
                         └► enroll in Workflow (trigger: form submit / stage change / booking / invoice)
                            ├► send Email / SMS / WhatsApp (from templates)
                            ├► wait / if-else branch / add-remove tag / update stage
                            ├► create Task / notify user
                            └► book Calendar slot  ─► on booking: reminder workflow
Invoice sent ─► on paid (Stripe webhook) ─► move stage / grant / send receipt / start subscription
```
Every module writes to a shared **activity timeline** on the Contact.

---

## 3. B2 mapping — reuse vs. net-new

**Reuse / extend (already solid in B2):**
- Lead-capture webhooks + idempotent `upsertIntakeLead` (Meta, FlexiFunnels).
- Discovery-call **booking** (public page + week calendar + slots + BANT + no-show sync).
- **WhatsApp/WATI** outbound + reminder cadence (`runDueReminders`, `/api/cron/whatsapp`).
- Double-entry **ledger** + `PendingPayment` + e-sign **Agreements** (→ Documents & Contracts).

**Net-new (do not exist):**
- Contact **tags**, **custom fields**, **activity timeline**, **tasks**, **companies**, smart lists.
- Opportunities **Kanban board** (drag-drop) + Pipeline/stage editor (today: read-only chart).
- **Invoicing** suite + **Products** + Stripe (payment links, subscriptions, transactions).
- **Sites**: funnel/page/**form**/survey builder + public hosting.
- **Email** channel + **campaigns/templates**; **SMS** (Twilio); unified **Conversations** inbox.
- **Automation/workflow engine** (visual trigger→action, enrollment, waits, branches).

---

## 4. Phased build plan (each phase ships working value)

1. **CRM foundation** — Contacts upgrade: tags, custom fields, notes/**activity timeline**, tasks,
   companies; **Opportunities Kanban** with drag-drop on the existing `Lead`/pipeline. (Highest
   leverage; unblocks everything else.)
2. **Forms & Funnels** — native form builder + submission→contact→opportunity; funnel/landing-page
   builder with public hosting; retire FlexiFunnels dependency.
3. **Invoicing & Payments** — Invoices, Estimates, Products, Payment Links, Subscriptions,
   Transactions; **Stripe** connect + webhooks; Documents & Contracts ← existing Agreements.
4. **Messaging channels** — add **Email** (SMTP/Resend) and **SMS** (Twilio) alongside WhatsApp;
   reusable message **templates**; unified **Conversations** inbox.
5. **Automation engine** — visual **Workflow** builder (triggers: form submit, stage change,
   booking, invoice paid, tag added; actions: send email/SMS/WA, wait, if/else, add/remove tag,
   update stage, create task, book) + enrollment engine on the existing cron seam.

Connectivity is layered in per phase (Stripe in 3, Twilio/SMTP in 4, workflow glue in 5).

> Build order rationale: 1 is the data spine every other module attaches to; 5 depends on 1–4
> existing so its actions have targets. Within each phase, DB migration → server actions → UI,
> matching B2 conventions (see `docs/DESIGN_SYSTEM.md` and the platform "how-to" reference).

---

## 5. Phase 1 — CRM foundation: data model

New Prisma models (extend, don't break, the existing `Lead`). Approach: keep `Lead` as the
**Contact** record and add tags/custom-fields/notes/tasks/company; introduce a proper
**Opportunity/Pipeline** layer for the Kanban, seeded from existing `Lead.stage` with write-through
so current pipeline metrics keep working.

```prisma
// ── Tags (GHL freeform contact tags) ──
model Tag {
  id        String   @id @default(cuid())
  name      String   @unique          // stored lowercased/trimmed
  color     String?                    // optional token key, else hashed default
  createdAt DateTime @default(now())
  leads     Lead[]   @relation("LeadTags")
  @@map("tag")
}
// Lead gets:  tags Tag[] @relation("LeadTags")

// ── User-defined custom fields ──
enum CustomFieldType { TEXT LONG_TEXT NUMBER DATE DROPDOWN MULTI_SELECT CHECKBOX PHONE EMAIL URL MONETARY }
enum CustomFieldObject { CONTACT OPPORTUNITY COMPANY }
model CustomFieldDefinition {
  id         String            @id @default(cuid())
  object     CustomFieldObject @default(CONTACT)
  name       String
  key        String            // slug, unique per object
  fieldType  CustomFieldType   @default(TEXT)
  options    Json?             // for DROPDOWN/MULTI_SELECT
  position   Int               @default(0)
  createdAt  DateTime          @default(now())
  @@unique([object, key])
  @@map("custom_field_definition")
}
// Values live as  Lead.customFields Json?  keyed by definition.key (GHL-style blob).

// ── Companies (B2B org grouping) ──
model Company {
  id           String   @id @default(cuid())
  name         String
  domain       String?
  phone        String?
  email        String?
  address      String?
  city         String?
  country      String?
  ownerId      String?
  owner        User?    @relation("CompanyOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  customFields Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  leads        Lead[]
  @@map("company")
}
// Lead gets:  companyId String?  + company Company?

// ── Notes (Contact "Notes" tab; timeline merges these + stageHistory + wa + bookings) ──
model ContactNote {
  id          String   @id @default(cuid())
  leadId      String
  lead        Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  body        String
  pinned      Boolean  @default(false)
  createdById String?
  createdBy   User?    @relation("NoteAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([leadId, createdAt])
  @@map("contact_note")
}

// ── Tasks (Contacts › Tasks tab + per-contact) ──
enum TaskStatus { OPEN COMPLETED }
model ContactTask {
  id           String     @id @default(cuid())
  leadId       String?
  lead         Lead?      @relation(fields: [leadId], references: [id], onDelete: Cascade)
  title        String
  body         String?
  dueAt        DateTime?
  status       TaskStatus @default(OPEN)
  completedAt  DateTime?
  assignedToId String?
  assignedTo   User?      @relation("TaskAssignee", fields: [assignedToId], references: [id], onDelete: SetNull)
  createdById  String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  @@index([status, dueAt])
  @@index([leadId])
  @@map("contact_task")
}

// ── Opportunities & Pipelines (drag-drop Kanban) ──
enum OpportunityStatus { OPEN WON LOST ABANDONED }
model Pipeline {
  id        String          @id @default(cuid())
  name      String
  position  Int             @default(0)
  isDefault Boolean         @default(false)
  createdAt DateTime        @default(now())
  stages    PipelineStage[]
  opps      Opportunity[]
  @@map("pipeline")
}
model PipelineStage {
  id          String        @id @default(cuid())
  pipelineId  String
  pipeline    Pipeline      @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  name        String
  position    Int
  // Optional bridge to the legacy enum so the seeded Sales pipeline can write-through to Lead.stage.
  legacyStage LeadStage?
  opps        Opportunity[]
  @@index([pipelineId, position])
  @@map("pipeline_stage")
}
model Opportunity {
  id            String            @id @default(cuid())
  leadId        String            // the Contact
  lead          Lead              @relation(fields: [leadId], references: [id], onDelete: Cascade)
  pipelineId    String
  pipeline      Pipeline          @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  stageId       String
  stage         PipelineStage     @relation(fields: [stageId], references: [id])
  name          String
  status        OpportunityStatus @default(OPEN)
  valueMinor    Int               @default(0)     // minor units (cents), currency below
  currency      Currency          @default(EUR)
  source        LeadSource?
  assignedToId  String?
  assignedTo    User?             @relation("OppOwner", fields: [assignedToId], references: [id], onDelete: SetNull)
  position      Int               @default(0)     // order within stage (for board sort)
  wonAt         DateTime?
  lostReason    String?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  @@index([pipelineId, stageId, position])
  @@index([leadId])
  @@map("opportunity")
}
```

**Seed / migration plan (Phase 1):**
1. Create a default **"Sales" pipeline** whose stages mirror the `LeadStage` enum in order
   (`legacyStage` set on each), plus mark it `isDefault`.
2. Backfill one `Opportunity` per existing `Lead`: `stageId` = stage whose `legacyStage == lead.stage`,
   `valueMinor` from won level / plan (else 0), `source`/`assignedToId` copied.
3. **Write-through:** when a board drag moves an Opportunity in the default Sales pipeline, also set
   `Lead.stage = newStage.legacyStage` and append a `LeadStageHistory` row — so existing
   `pipeline-metrics`, funnel, and reminder logic keep working unchanged. Non-default pipelines
   don't touch `Lead.stage`.

**Timeline (read-time aggregation):** the Contact record's Activity feed merges, newest-first:
`ContactNote`, `LeadStageHistory`, `WhatsAppMessage`, `DiscoveryOutcome`, `BookingRequest`,
`ContactTask` (completed), and (later phases) email/SMS/invoice/workflow events. No duplicate store.

**UI surface (Phase 1):**
- `/(app)/contacts` — Contacts list (table): search, tag filter, columns Contact/Phone/Email/
  Company/Created/Last activity/Tags; bulk actions (add/remove tag); Import CSV; Custom Fields tab;
  Tasks tab; Companies tab. (Coexists with the existing `people` staff section — different nav item.)
- `/(app)/contacts/[id]` — Contact record: left = details + tags + custom fields + owner; center =
  Activity timeline / Notes / Tasks / Appointments; right = message composer (WhatsApp today).
- `/(app)/opportunities` — Kanban board: pipeline switcher, draggable cards (name, source, value,
  owner, next-appointment chip, inline actions), per-stage totals, add opportunity, filters. The
  existing read-only `pipeline` page stays as the analytics view.
