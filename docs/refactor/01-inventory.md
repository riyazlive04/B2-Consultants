# 01 — Discovery and inventory

**Phase 1 of the flow refactor. Read-only: no application code was changed to produce this.**

Repo: `B2-Consultants/` (the nested app — the outer folder is a scratch/asset directory).
Branch `master`, at `141cbfe`. Dated 23 Oct 2026.

---

## 0. Scale, and one correction to the brief

| | |
|---|---|
| TypeScript/TSX files under `src/` | 1,003 |
| Page routes (`page.tsx`) | 77 |
| API routes (`route.ts`) | 44 (39 under `/api`, 5 token-scoped file routes) |
| Server-action / server-query modules (`src/server/*.ts`) | 215 (~67,000 lines) |
| Prisma models | 124 |
| Prisma enums | 95 |
| Nav sections | 38, in 8 groups |
| Roles | 6 (`ADMIN`, `HEAD`, `USER`, `STUDENT`, `TUTOR`, `COACH`) |
| Capabilities (fine-grained write permissions) | 13 |
| Unit tests | 103 test files |
| E2E suites | `e2e/` (Playwright, 5 finding areas) |

**A correction worth making before we go further.** The brief says the app was "built feature by feature
without anyone designing the overall flow". That is true of several individual journeys — section 4 of
the next document will show it — but it is *not* true of the app as a whole, and planning as if it were
would mean rebuilding things that already exist and work:

- There **is** a designed information architecture. [`src/lib/sections.ts`](../../src/lib/sections.ts) is a
  591-line section catalogue with an 8-group taxonomy, a documented "no group holds more than five items
  for any one role" rule, and a written rationale for each grouping decision — including a regrouping
  done on 22 Oct 2026 that split "Classroom" out of "My Work" for exactly that reason.
- There **is** a shared service layer. All business logic lives in `src/server/*`, split
  `*-actions.ts` (writes) / `*-metrics.ts` (reads). Pages are thin: most are 20–200 lines of layout
  calling server functions. There is no page-level duplicated business logic of the kind the brief
  anticipates.
- There **is** a permission model with a drift reporter.
  [`src/lib/permission-matrix.ts`](../../src/lib/permission-matrix.ts) encodes the spec's role matrix and
  Console → Access Matrix reports where live config disagrees with it.
- There **are** role-based home screens for three of the six roles
  ([`src/app/(app)/page.tsx:71-75`](<../../src/app/(app)/page.tsx#L71-L75>)).

So the work ahead is narrower and more surgical than "redesign the app": it is **closing specific
disconnected journeys**, giving core entities **real lifecycle states**, and **retiring genuine
duplicates**. The three biggest of those are identified in §5 below.

---

## 1. Feature inventory

Columns: the roles that hold the section by default; the route; the server modules behind it; the main
entities; and notes flagging duplicates, hidden features and dead ends.

"Backend" is almost always a **server action module**, not an HTTP endpoint — this app uses Next.js
server actions, so `src/server/*` *is* the API surface. The 44 `route.ts` files are webhooks, crons,
file downloads and public intake only (listed in §2.4).

### 1.1 Finance group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 1 | Finance overview + P&L | ADMIN | `/finance` | `finance-metrics`, `annual-metrics`, `finance-actions` | Income, Expense, PendingPayment | 719-line page |
| 2 | — Income entry & list | ADMIN | `/finance?tab=income` | `finance-actions` | Income, JournalEntry | `finance.write` capability |
| 3 | — Expense entry & list | ADMIN | `/finance?tab=expenses` | `finance-actions`, `expense-categories` | Expense | Categories are founder-config |
| 4 | — Pending payments | ADMIN | `/finance?tab=pending` | `finance-metrics`, `payment-allocation` | PendingPayment, Instalment | |
| 5 | — Commission | ADMIN | `/finance?tab=commission` | `commission-metrics` | TelecallerPayout | Also at `/telecaller` (#9) |
| 6 | — Archived (restore) | ADMIN | `/finance?tab=archived` | `archive-metrics` | all soft-deleted | Shared `ArchivedGroups` |
| 7 | Cash Health (runway, receivables, equity, payables) | ADMIN | `/cash` | `cash-metrics`, `equity-metrics` | CashPosition, Payable, EquityContribution | 470-line page, 4 tabs |
| 8 | Ledger / journals / trial balance | ADMIN | `/ledger` | `ledger`, `ledger-core` | JournalEntry, JournalLine, LedgerAccount | **HIDDEN** (`hidden: true`) — unreachable by route |
| 9 | Bonus & Commission board | ADMIN, HEAD | `/telecaller` | `telecaller-metrics`, `telecaller-actions` | TelecallerPayout, TeamProfile | Nav-only; nothing links in |
| 10 | Invoices & estimates | ADMIN | `/payments` | `payments-metrics`, `payments-actions`, `invoice-posting` | Invoice, InvoiceLineItem, InvoicePayment | |
| 11 | — Invoice editor | ADMIN | `/payments/new`, `/payments/[id]` | `payments-actions`, `document-numbers` | Invoice, DocumentSequence | |
| 12 | — Products & pricing | ADMIN | `/payments?tab=products` | `payments-actions` | Product, Level | Prices live **only** here |
| 13 | — Subscriptions | ADMIN | `/payments?tab=subs` | `payments-actions` | Subscription | |
| 14 | Public invoice view / pay | — (token) | `/i/[token]` | `payments-metrics` | Invoice | Unauthenticated |

### 1.2 My Work group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 15 | My Desk — L1 (appointment setter) | ADMIN, HEAD, USER | `/my-desk` | `l1-desk-metrics` | Lead, CallLog, AppointmentSlot | Variant chosen by `TeamProfile.logVariant`, **not** role |
| 16 | My Desk — L2 (discovery specialist) | ″ | `/my-desk` | `l2-desk-metrics` | Lead, CallLog, DiscoveryOutcome | ″ |
| 17 | My Desk — Owner desk | ″ | `/my-desk` | `owner-desk` | Lead, CallLog | ″ |
| 18 | — Own commission tile | ″ | `/my-desk` | `commission-metrics` | TelecallerPayout | |
| 19 | — Offline call capture | ″ | `/my-desk` | `offline-call-sync` | CallLog | IndexedDB queue |
| 20 | My Daily Log | HEAD, TUTOR, COACH | `/daily-log` | `people-metrics`, `daily-log-capture` | DailyLog | USER deliberately excluded |
| 21 | Student dashboard (front door) | STUDENT | `/dashboard` | `student-portal`, `catch-up`, `attendance-checkin` | Student, ClassSession, SessionAttendance | `personal: true` — STUDENT only even for ADMIN |
| 22 | My Journey (scoreboard) | STUDENT | `/my-journey` | `student-portal`, `student-agreements`, `student-payments` | Enrollment, MilestoneProgress, Agreement | `personal: true` |
| 23 | Arena (XP, badges, quests) | ADMIN, HEAD, USER | `/arena` | `gamification` | RewardGrant, RewardRule | |
| 24 | App Guide | all 6 | `/guide` | `guide-content` (lib) | — | Static content |
| 25 | Executive home | ADMIN, HEAD, USER | `/` | 10 modules incl. `head-coach-snapshot`, `funnel-health` | many | 481 lines; redirects STUDENT/TUTOR/COACH away |
| 26 | Profile & theme | all 6 | `/profile` | `profile-actions`, `theme-actions` | User | Not a section; reached from avatar |
| 27 | Work-time tracker | ADMIN, HEAD, USER | `/` + shell | `work-time` | WorkDay | Shell widget |
| 28 | Quick record (income/expense) | ADMIN | shell modal | `finance-actions` | Income, Expense | `QuickRecordModal` |
| 29 | Command palette (Ctrl-K) | all | shell | `api/command-palette` | Lead, Student, Invoice | |
| 30 | Notification bell | all | shell | `notifications` | derived | |

### 1.3 Classroom group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 31 | My Classroom (timetable, recordings, coursework) | STUDENT | `/classroom` | `student-classroom`, `attendance-checkin` | ClassSession, GnRecording, SessionTask | `personal: true` |
| 32 | — Self check-in | STUDENT | `/classroom`, `/dashboard` | `attendance-checkin-actions` | SessionAttendance | Window-bounded |
| 33 | — Absence reason | STUDENT | `/dashboard` | `absence-reason-actions` | SessionAttendance | Asked, never required |
| 34 | My Teaching (This week · To mark · Cohorts · My students) | ADMIN, HEAD, COACH, TUTOR | `/coaching` | `coaching-desk` | Batch, ClassSession, Enrollment | Scoped by `Batch.tutorId` + `Enrollment.coachId` |
| 35 | Attendance desk (register) | ADMIN, HEAD, COACH, TUTOR | `/attendance` | `attendance-board`, `attendance-actions` | SessionAttendance, ClassSession | **3rd place to mark attendance** |
| 36 | Batches & Plans — Coaching cohorts | ADMIN | `/batches?tab=0` | `batches`, `batch-actions` | Batch | `BatchesManager` — **also on `/students`** |
| 37 | Batches & Plans — German Note cohorts | ADMIN | `/batches?tab=1` | `batches`, `batch-actions` | Batch | `BatchesManager` — **also on `/german-note/manage`** |
| 38 | Batches & Plans — Plans (curriculum templates) | ADMIN | `/batches?tab=2` | `curriculum`, `curriculum-actions` | CurriculumTemplate, CurriculumItem | `CurriculumPanel` — **also on `/programs`** |
| 39 | Batch detail — Timetable | session-scoped | `/batches/[batchId]` | `batch-detail`, `batch-timetable-actions` | ClassSession | Build-from-plan dialog |
| 40 | Batch detail — Resources | ″ | ″ | `resources`, `resource-actions` | Resource | Link-based |
| 41 | Batch detail — Roster | ″ | ″ | `batch-detail`, `attendance` | Enrollment | **READ-ONLY. Dead end — see §5.3** |
| 42 | Sprint leaderboard | ADMIN, HEAD, COACH, TUTOR, STUDENT | `/leaderboard` | `leaderboard`, `sprint-log` | SprintWeek, SprintLogEntry | Names stripped server-side by `viewFor` |

### 1.4 Sales group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 43 | Opportunity board (drag-drop kanban) | ADMIN, HEAD, USER | `/opportunities` | `opportunities-metrics`, `opportunities-actions` | Opportunity, Pipeline, PipelineStage | **The "Pipeline" nav item lands here** |
| 44 | — Pipeline/stage config | ″ | `/opportunities/pipelines` | `opportunities-actions`, `pipeline-reshape` | Pipeline, PipelineStage | |
| 45 | Lead pipeline board | ADMIN, HEAD, USER | `/pipeline` | `pipeline-metrics`, `pipeline-actions` | Lead, DiscoveryOutcome | **NOT on the nav** (566 lines, 24 inbound links) |
| 46 | — Leads table + create | ″ | `/pipeline?tab=leads` | `pipeline-actions.createLead` | Lead | **Duplicate of #49** |
| 47 | — Discovery call outcomes | ″ | `/pipeline` | `pipeline-actions`, `qualification` | DiscoveryOutcome, LeadAnswer | `outreach.qualify` capability |
| 48 | — Aging / archived | ″ | `/pipeline` | `ageing`, `archive-metrics` | Lead | |
| 49 | Contacts (CRM) | ADMIN, USER | `/contacts` | `contacts-metrics`, `contacts-actions.createContact` | Lead, Company, Tag | **Duplicate `Lead` writer — see §5.2** |
| 50 | — Companies | ″ | `/contacts?tab=companies` | `contacts-actions` | Company | |
| 51 | — Tasks | ″ | `/contacts?tab=tasks` | `contacts-actions` | ContactTask | |
| 52 | — Custom fields | ″ | `/contacts?tab=fields` | `contacts-actions` | CustomFieldDefinition | |
| 53 | — Contact record (activity, notes, tasks, opps) | ″ | `/contacts/[id]` | `contacts-metrics`, `prospect-history` | Lead, ContactNote, Opportunity | |
| 54 | Bookings calendar + requests | ADMIN, HEAD, USER | `/bookings` | `booking-metrics`, `booking-actions` | BookingRequest, AppointmentSlot | 582 lines, 6 tabs |
| 55 | — Confirm-or-cancel queues | ″ | `/bookings` | `confirm-loop-config`, `confirmation-reply` | BookingRequest | Engine ships **off** |
| 56 | — SSS slot calendar | ″ | `/bookings?tab=sss` | `sss-slots`, `sss-actions`, `slot-release` | SssSlot, SlotRelease | |
| 57 | — Availability editor | ″ | `/bookings/availability` | `founder-config` | AppSetting | |
| 58 | Public booking page | — | `/book` | `booking-intake`, `booking-actions` | BookingRequest, Lead | Unauthenticated |
| 59 | Outreach SOP queue (23 steps) | ADMIN, USER | `/outreach` | `outreach`, `outreach-actions`, `outreach-engine` | OutreachJourney, OutreachStepLog | `offRail` — also a Pipeline tab |

### 1.5 Marketing group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 60 | Website (list) | ADMIN | `/sites` | `sites-metrics` | Site | `sites.manage` to write |
| 61 | — Site editor | ADMIN | `/sites/[id]` | `sites-actions` | Site, SitePage | |
| 62 | — Page builder | ADMIN | `/sites/[id]/pages/[pageId]` | `sites-actions`, `media-actions` | SitePage, SitePageRevision, MediaAsset | |
| 63 | — Public site render | — | `/s/[slug]/[[...path]]` | `sites-metrics` | SitePage | Unauthenticated |
| 64 | Funnels (list) | ADMIN, USER | `/funnels` | `funnels-metrics` | Funnel | |
| 65 | — Funnel builder | ″ | `/funnels/[id]` | `funnels-actions`, `snippets-actions` | Funnel, FunnelStep, SectionSnippet | |
| 66 | — Public funnel steps | — | `/p/[slug]`, `/p/[slug]/[step]` | `funnels-metrics` | FunnelStep | Unauthenticated |
| 67 | Forms (list) | ADMIN, USER | `/forms` | `forms-metrics` | Form | |
| 68 | — Form builder | ″ | `/forms/[id]` | `forms-actions` | Form | |
| 69 | — Public form | — | `/f/[slug]` | `forms-metrics` | FormSubmission, Lead | Unauthenticated |
| 70 | WhatsApp — history | ADMIN | `/whatsapp` | `whatsapp-metrics` | WhatsAppMessage | |
| 71 | WhatsApp — settings | ADMIN | `/whatsapp?tab=settings` | `whatsapp-actions`, `founder-config` | AppSetting | |
| 72 | WhatsApp — opt-outs & test | ADMIN | `/whatsapp?tab=optouts` | `whatsapp-actions` | WhatsAppOptOut | |
| 73 | Conversations — unified inbox | ADMIN | `/conversations` | `messaging-metrics`, `messaging-actions` | Message | Email + SMS + WhatsApp |
| 74 | — Templates | ADMIN | `/conversations?tab=templates` | `messaging-actions` | MessageTemplate | |
| 75 | — Settings | ADMIN | `/conversations?tab=settings` | `messaging-actions` | AppSetting | |

### 1.6 Students group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 76 | Students — 90/120-day tracker | ADMIN, HEAD, USER | `/students` | `students-metrics` | Enrollment, SprintWeek | 361-line page |
| 77 | — Weekly update | ″ | `/students?tab=weekly` | `weekly-report` | Enrollment | |
| 78 | — All students & totals | ″ | `/students?tab=all` | `students-metrics`, `students-actions` | Student, Enrollment | Create student here |
| 79 | — Book orders (German Note) | ″ | `/students?tab=books` | `book-order-metrics`, `book-order-actions` | BookOrder | |
| 80 | — **Batches** | ″ | `/students?tab=batches` | `batches` | Batch | **`BatchesManager` again — dup of #36** |
| 81 | — CSV import | ″ | `/students?tab=import` | `student-import-actions` | Student, Enrollment | |
| 82 | Student record | ″ | `/students/[id]` | `students-metrics`, `weekly-report` | Student, Enrollment, MilestoneLog | |
| 83 | — **Seat into a batch** | ″ | `/students/[id]` | `batch-actions.seatEnrollment` | Enrollment.batchId | **ONLY writer. See §5.3** |
| 84 | — Enrolment, milestones, signals | ″ | `/students/[id]` | `students-actions`, `milestone-progress` | Enrollment, SignalChangeLog | |
| 85 | — Termination / discontinue | ″ | `/students/[id]` | `termination`, `termination-report` | Enrollment | |
| 86 | — Create portal login | ″ | `/students/[id]` | `students-actions.createStudentLogin`, `login-credentials` | User, Student | |
| 87 | Agreements list | ADMIN, HEAD, USER | `/agreements` | `agreement-metrics` | Agreement | |
| 88 | — Draft / new | ″ | `/agreements/new` | `agreement-actions`, `agreement-state` | Agreement, AgreementBody | `agreements.issue` |
| 89 | — Agreement detail (issue, void, co-sign, attach, timestamp) | ″ | `/agreements/[id]` | 7 `agreement-*` modules | Agreement, AgreementSigner, AgreementAttachment, AgreementEvent | 477 lines |
| 90 | — Bulk send | ″ | `/agreements/bulk` | `agreement-templates` | Agreement | |
| 91 | — Templates | ″ | `/agreements/templates`, `/[id]` | `agreement-template-actions` | AgreementTemplate, AgreementTemplateVersion | |
| 92 | — Public signing page | — (token) | `/agreement/[token]` | `agreement-core`, `agreement-sign` | Agreement, AgreementSigner | Unauthenticated |
| 93 | — Enrol prompt after signing | ″ | `/agreements/[id]` | `agreement-enrol` | Student, Enrollment | Closes the signed→student gap |
| 94 | German Note — Financials | ADMIN, HEAD, TUTOR | `/german-note` | `german-note-metrics`, `german-note-workshops` | Workshop, GnWorkshopConversion | `germanNote.finance` capability |
| 95 | — Community feed | ″ | `/german-note?tab=community` | `german-note-actions` | GnPost, GnComment, GnLike | |
| 96 | — Manage: Batches | ADMIN | `/german-note/manage` | `german-note-actions` | Batch | **`BatchesManager` again — dup of #37** |
| 97 | — Manage: Members | ADMIN | `/german-note/manage?tab=members` | `german-note-actions` | **BatchMember** | **2nd membership model. See §3.1** |
| 98 | — Manage: Tutors | ADMIN | `/german-note/manage?tab=tutors` | `tutor-fees`, `tutor-fee-actions` | TutorFee, User | |
| 99 | — Manage: Levels | ADMIN | `/german-note/manage?tab=levels` | `levels`, `level-actions` | Level | **`LevelsPanel` — dup of #113** |
| 100 | — Manage: Costs | ADMIN | `/german-note/manage?tab=costs` | `batch-costs-metrics` | Batch, Level | |
| 101 | — Members (standalone) | ADMIN, HEAD, TUTOR | `/german-note/members` | `german-note-metrics` | BatchMember, GnPendingJoiner | **Overlaps #97** |
| 102 | — Batch classroom / schedule / discussion | ″ | `/german-note/[batchId]` | `german-note-metrics` | ClassSession, GnRecording, GnPost | 4th attendance surface |
| 103 | — Workshop detail + P&L | ADMIN (+cap) | `/german-note/workshops/[workshopId]` | `german-note-workshops` | Workshop, WorkshopRegistration | |
| 104 | CV Studio — builder | ADMIN, HEAD, STUDENT | `/cv-check` | `resume-actions`, `resume-metrics` | Resume, ResumeReview | **HIDDEN** (`hidden: true`) |
| 105 | — AI review | ″ | `/cv-check` | `resume-actions`, `cv-analysis` | ResumeReview | ″ |
| 106 | — Resume download | ″ | `/api/resume/[id]/download` | `resume-actions` | Resume | ″ |

### 1.7 Insights group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 107 | Reports (pivot builder + Excel export) | ADMIN, HEAD, USER | `/reports` | `reports-metrics`, `insights-metrics` | configurable | Row-level scoped |
| 108 | — Scheduled report | ADMIN | `/console` | `scheduled-report` | AppSetting | Configured in Console, not here |
| 109 | Funnel Report (conversion) | ADMIN | `/funnel` | `funnel-metrics`, `funnel-actions` | WeeklyFunnelSnapshot, AdSpend | Renamed from "Conversion Funnel"; page `metadata.title` still says the old name |

### 1.8 Admin group

| # | Feature | Roles | Route | Backend | Entities | Notes |
|---|---|---|---|---|---|---|
| 110 | Founder Console — 6 groups, ~24 panels | ADMIN | `/console` | 14 modules | AppSetting + many | 604 lines. Panels: Access · Sections · Access Matrix · Per-person rules · Commission · Instalment Plans · Payment Types · Expense categories · Invoicing · Cash targets · Tutor Fee · Qualification · Call Distribution · Availability · Zoom links · Confirm-or-cancel · Lead Webhook · Agreements · Delivery defaults · Daily Targets · Gamification · Goals · Rewards · Not armed · Alerts & Chasing · Leaderboard · Why students stop · Maintenance |
| 111 | Users — Daily logs board | ADMIN | `/people` | `people-metrics` | DailyLog | |
| 112 | — OKRs | ADMIN | `/people?tab=okrs` | `goals` | OKR, Goal | |
| 113 | — Team & org chart | ADMIN | `/people?tab=team` | `people-actions` | TeamProfile | |
| 114 | — Duplicates | ADMIN | `/people?tab=dupes` | `duplicates-metrics`, `duplicates-actions` | Lead, Student, User | |
| 115 | — Users & access (invite, suspend, grants) | ADMIN | `/people?tab=users` | `users-actions`, `access-requests`, `invite-actions` | User, UserInvite | `users.manage` |
| 116 | Programs — Programmes (coaching tiers + GL account) | ADMIN | `/programs` | `levels`, `level-actions` | Level | **`LevelsPanel` — dup of #99** |
| 117 | — Curriculum | ADMIN | `/programs?tab=curriculum` | `curriculum`, `curriculum-actions` | CurriculumTemplate | **`CurriculumPanel` — dup of #38** |
| 118 | Activity Log (who did what, when) | ADMIN | `/activity` | `activity-metrics`, `activity-log` | ActivityLog | `locked` — can't be disabled or granted away |
| 119 | Automation — workflow list | ADMIN | `/automation` | `automation-metrics` | Workflow, WorkflowFolder | **HIDDEN** |
| 120 | — Workflow builder + dry run | ADMIN | `/automation/[id]` | `automation-actions`, `automation-dryrun` | Workflow, WorkflowEnrollment | ″ |
| 121 | — Settings | ADMIN | `/automation/settings` | `founder-config` | AppSetting | ″ |
| 122 | — Stage messages | ADMIN | `/automation/stage-messages` | `stage-messages`, `stage-messages-actions` | MessageTemplate | ″ |

### 1.9 Non-section pages

| # | Feature | Roles | Route | Notes |
|---|---|---|---|---|
| 123 | Login | — | `/login` | Role-aware post-login redirect |
| 124 | Coach sign-in landing | — | `/coach` | Thin redirect shim |
| 125 | Tutor sign-in landing | — | `/tutor` | Thin redirect shim |
| 126 | Student portal landing | — | `/portal` | Thin redirect shim |
| 127 | Invite acceptance | — (token) | `/invite/[token]` | |
| 128 | Forced password change | authenticated | `/change-password` | `mustChangePassword` gate |
| 129 | Forgot / reset password | — | `/forgot-password`, `/reset-password` | |

### 1.10 Background engines (no screen of their own)

All 16 are armable from **Console → System → Not armed**
([`src/server/not-armed.ts`](../../src/server/not-armed.ts)). Each ships **disarmed**.

| # | Engine | Cron | Notes |
|---|---|---|---|
| 130 | Cron heartbeat / dead-man's switch | `/api/cron/daily` | |
| 131 | Availability publishing | — | |
| 132 | Email sending (Resend) | — | `SENT` ≠ delivered |
| 133 | WhatsApp sending (WATI) | `/api/cron/whatsapp` | Test recipient currently null → real numbers |
| 134 | Confirm-or-cancel loop | `/api/cron/daily` | |
| 135 | Student welcome | — | Fires on seating |
| 136 | Class reminders | `/api/cron/daily` | |
| 137 | Lead intake | `/api/intake/lead`, `/api/leads/*` | |
| 138 | Speed-to-lead alert | `/api/cron/alerts` | |
| 139 | Dunning (3-stage) | `/api/cron/daily` | |
| 140 | Agreement reminders | `/api/cron/agreements` | |
| 141 | Retention / 90-day purge | `/api/cron/retention` | |
| 142 | Commission accrual | `/api/cron/daily` | |
| 143 | Tutor fee accrual | `/api/cron/daily` | |
| 144 | Invoice posting | `/api/cron/daily` | |
| 145 | Auto-create opportunity | — | |
| 146 | Outreach SOP engine | `/api/cron/outreach` | Needs a 1-minute cron |
| 147 | Workflow engine | `/api/cron/workflows` | Automation is hidden |
| 148 | Daily-log EOD capture | `/api/cron/daily-log` | |
| 149 | Zoom meeting reconciler | `/api/cron/daily` | |

---

## 2. Screen and route inventory

### 2.1 How each section is reached

Measured by scanning every `.tsx`/`.ts` under `src/` for string references to each route, excluding
`sections.ts` itself. "NAV" means a section catalogue entry points at it.

| Route | On nav? | Inbound links | Reached how |
|---|---|---|---|
| `/` | no | 0 | App logo; post-login default for ADMIN/HEAD/USER |
| `/finance` | **NAV** | 18 | Nav; home KPI cards; cash age analysis |
| `/cash` | **NAV** | 11 | Nav; home; shell runway badge |
| `/ledger` | NAV (hidden) | 10 | **Unreachable** — `hidden: true` refuses the route |
| `/payments` | **NAV** | 6 | Nav; command palette |
| `/telecaller` | **NAV** | 1 | **Nav only** (the 1 is a `revalidatePath`) |
| `/my-desk` | **NAV** | 8 | Nav; shell greeting pill |
| `/daily-log` | **NAV** | 6 | Nav; home; head-coach students card |
| `/dashboard` | **NAV** | 10 | Nav; `/` redirect for STUDENT |
| `/my-journey` | **NAV** | 11 | Nav; `/classroom`; `/dashboard`; login |
| `/arena` | **NAV** | 5 | Nav; home; daily log; profile |
| `/guide` | **NAV** | 1 | Nav; `/dashboard` |
| `/classroom` | **NAV** | 12 | Nav; `/dashboard`; `/my-journey` |
| `/coaching` | **NAV** | 14 | Nav; `/` redirect for COACH; batch detail back-link |
| `/attendance` | **NAV** | 8 | Nav; back-link registry |
| `/batches` | **NAV** | 14 | Nav; catch-up card; teaching sessions |
| `/batches/[batchId]` | no | 14 | `BatchesManager` rows; `/coaching`; `/attendance` |
| `/leaderboard` | **NAV** | 5 | Nav |
| `/opportunities` | **NAV** ("Pipeline") | 9 | Nav; `/pipeline`; contact record |
| `/opportunities/pipelines` | no | 1 | `/opportunities` board |
| `/pipeline` | **no** | **24** | **In-page links only** — booking detail, my-desk, home, funnel health, recent wins |
| `/contacts` | **NAV** | 29 | Nav; conversations; automation builder |
| `/contacts/[id]` | no | 29 | Contacts table; inbox; opportunity board |
| `/bookings` | **NAV** | 13 | Nav; my-desk L1; opportunity dialog |
| `/bookings/availability` | no | 1 | `/bookings` only |
| `/outreach` | NAV (`offRail`) | 5 | Pipeline tab; opportunities; owner desk |
| `/sites` … `/sites/[id]/pages/[pageId]` | **NAV** | 6 | Nav; site editor chain |
| `/funnels`, `/funnels/[id]` | **NAV** | 4 | Nav; funnels list |
| `/forms`, `/forms/[id]` | **NAV** | 3 | Nav; forms list |
| `/whatsapp` | **NAV** | 2 | **Nav only** |
| `/conversations` | **NAV** | 4 | Nav; contact record |
| `/students` | **NAV** | 31 | Nav; batch detail; coaching; enrol prompt |
| `/students/[id]` | no | 31 | Students board; coaching; contact record |
| `/agreements` + 5 sub-routes | **NAV** | 22 | Nav; agreement nav component |
| `/german-note` + 5 sub-routes | **NAV** | 32 | Nav; batch detail; coaching |
| `/cv-check` | NAV (hidden) | 4 | **Unreachable** |
| `/reports` | **NAV** | 3 | Nav |
| `/funnel` | **NAV** | 6 | Nav; funnel health row |
| `/console` | **NAV** (locked) | 16 | Nav; deep links from 8 screens |
| `/people` | **NAV** | 10 | Nav |
| `/programs` | **NAV** | 3 | **Nav only** (all 3 are `revalidatePath`) |
| `/activity` | **NAV** (locked) | 3 | Nav |
| `/automation` + 3 sub-routes | NAV (hidden) | 11 | **Unreachable** |
| `/profile` | no | 4 | Avatar menu |

### 2.2 Routes with no in-app entry point

| Route | Why |
|---|---|
| `/f/[slug]` | Public form — reached from ads/website |
| `/p/[slug]`, `/p/[slug]/[step]` | Public funnel — ads |
| `/s/[slug]/[[...path]]` | Public website — organic/ads |
| `/i/[token]` | Invoice link — emailed |
| `/agreement/[token]` | Signing link — emailed/WhatsApped |
| `/book` | Public booking — funnel CTA |

These are correct as-is: they are the *inbound* edge of the system.

### 2.3 Tab inventory (the real screen count)

Many "screens" are tabs. Counting tabs as screens, the app has roughly **135 distinct surfaces** behind
38 nav entries. The heaviest:

| Page | Tabs | Lines |
|---|---|---|
| `/console` | ~24 panels in 6 groups | 604 |
| `/finance` | 6 | 719 |
| `/bookings` | 6 | 582 |
| `/pipeline` | 5 | 566 |
| `/students` | 6 | 361 |
| `/cash` | 4 | 470 |
| `/coaching` | 4 | 379 |
| `/contacts` | 5 | 133 |
| `/payments` | 5 | 150 |
| `/german-note/manage` | 5 | 62 |

### 2.4 API routes (44)

Not user-facing screens. Grouped:

- **Webhooks (inbound):** `/api/wati/webhook`, `/api/twilio/webhook`, `/api/resend/webhook`,
  `/api/leads/meta`, `/api/leads/pabbly`, `/api/leads/b2consultants`, `/api/intake/lead`
- **Crons (9):** `agreements`, `alerts`, `daily`, `daily-log`, `outreach`, `retention`, `whatsapp`, `workflows`
- **Polling:** `/api/leads/poll`, `/api/leads/poll-recent`, `/api/conversations/poll`, `/api/notifications`
- **Files:** `/api/agreements/[id]/pdf`, `.../document/file`, `.../attachments/[id]`,
  `/api/agreements/templates/[versionId]/{file,preview}`, `/api/resume/[id]/download`,
  `/api/export/[entity]`, `/api/media/upload`, `/api/form-upload`
- **Misc:** `/api/auth/[...all]`, `/api/health`, `/api/command-palette`, `/api/work-time`,
  `/api/cv-extract`, `/api/classroom/timetable/[batchId]`, `/api/observability/client-error`,
  `/api/people/[id]/termination-report`, `/api/agreements/[id]/timestamp`
- **Token-scoped file routes (outside `/api`):** `/agreement/[token]/{pdf,copy,attachment}`,
  `/i/[token]/pdf`, `/i/[token]/receipt/[number]`

---

## 3. Entity inventory

124 models. Below are the ones that carry **flow** — status, dates, ownership, prerequisites. The full
ER diagram goes in `02-current-state.md`.

### 3.1 Delivery core (the batch/teaching flow)

**`Batch`** — [`prisma/schema.prisma`](../../prisma/schema.prisma), `@@map("batch")`

| Field | Flow significance |
|---|---|
| `line: BatchLine` | `B2` \| `GERMAN_NOTE` — **decides which membership model applies** |
| `status: GnBatchStatus` | **`ACTIVE` \| `ARCHIVED` only. No `DRAFT`/`READY`/`COMPLETED`.** |
| `level: String` | `Level.code`, service-validated against `line` |
| `tutorId: String?` | **nullable** — a batch can run with no teacher |
| `curriculumTemplateId: String?` | **nullable** — a batch can run with no syllabus |
| `startDate`, `endDate` | **both nullable** |
| `targetStrength: Int @default(8)` | A target, not a cap — over-filling is deliberate |
| `sprintStartDate` | Drives the 90/120-day sprint |

Relations: `members BatchMember[]`, `enrollments Enrollment[]`, `events ClassSession[]`,
`resources Resource[]`, `modules GnModule[]`, `recordings GnRecording[]`, `posts GnPost[]`,
`pendingJoiners GnPendingJoiner[]`, `tutorFees TutorFee[]`, plus 3 workshop-conversion relations.

> **The single most important structural fact in this document.** `Batch` has **two parallel
> membership relations**:
> - `Enrollment.batchId` (nullable, `onDelete: SetNull`) — used by the **B2** line
> - `BatchMember` (join table, `@@unique([batchId, studentId])`) — used by the **German Note** line
>
> They are written by different actions, from different screens, by different code paths, and
> neither is aware of the other. Nothing in the schema says which one applies; `line` does, by
> convention only.

**`Enrollment`** — one student's purchase of one programme

| Field | Flow significance |
|---|---|
| `status: StudentStatus` | `ACTIVE` \| `COMPLETED` \| `DROPPED` \| `PAUSED` + `statusChangedAt` |
| `batchId: String?` | **The B2 seat.** Only writer: `seatEnrollment` from `/students/[id]` |
| `programLevel: String` | `Level.code` — `SOLO`/`GUIDED`/`ELITE` for B2 |
| `duration: ProgramDuration`, `programEndDate` | 90/120 days, or LIFETIME |
| `coachId`, `closerId`, `assignedCoach` | **Three ownership fields**, two FKs and one free-text legacy |
| `currentMilestone: Milestone` | Lifecycle *inside* the programme |
| `signalColour: Signal?` | Manual G/A/R, set by ADMIN/HEAD |
| `discontinueReason/Note/ById` | Termination record |

> Note: there is an unused `EnrollmentStatus` enum (`ACTIVE`/`COMPLETED`/`FAILED`) that belongs to
> `WorkflowEnrollment`, not `Enrollment` — `Enrollment.status` is `StudentStatus`. Easy trap.

**`BatchMember`** — GN seat. Four fields: `batchId`, `studentId`, `addedAt`, `id`. No status, no
history. Deleting is a hard delete (`german-note-actions.ts:360`).

**`CurriculumTemplate`** → **`CurriculumItem`** — the syllabus ("Plan")

- `CurriculumTemplate`: `line`, `name`, `levelCode?`, `sprintDays?`, `active`
- `CurriculumItem`: `weekNumber`, `orderIndex`, `title`, `framework?`, `type`, `delivery`,
  `durationMins?`, `dayOfWeek?`, `startTime?` — `@@unique([templateId, weekNumber, orderIndex])`
- Items are the *pattern*; sessions are the *instances*.

**`ClassSession`** — one actual class

| Field | Flow significance |
|---|---|
| `batchId` (required, `Cascade`) | Sessions die with the batch |
| `curriculumItemId?` | Link back to the plan row it was generated from |
| `startsAt`, `durationMins?`, `joinUrl?` | |
| `attendanceOpensAt/ClosesAt/OpenedById/GraceMins` | The self-check-in window |
| `attendancePublishedAt/ById` | **Publishing is the gate** — notices fire on publish, not on marking |
| `recordingId?` (`@unique`) | One recording per session |

**`SessionAttendance`**, **`SessionTask`**, **`SessionTaskCompletion`**, **`Resource`** hang off
`ClassSession`. `Resource` has exactly one of three scopes (curriculum / batch / session) and a
`visibleToStudents` flag filtered **in the query**, not the view.

### 3.2 Sales core

**`Lead`** — the single prospect record, surfaced as both "Lead" (`/pipeline`) and "Contact" (`/contacts`)

| Field | Flow significance |
|---|---|
| `stage: LeadStage` | **17 values** — `NEW_LEAD` → … → `WON`/`LOST`/`NO_SHOW` |
| `assignedToId` | Drives My Desk; was the cause of a historic "empty desk" bug |
| `source: LeadSource`, `wonLevel`, `paymentPlan` | |
| `deletedAt` | Soft-delete / archive |

Children: `LeadAnswer`, `LeadEmail` (history, newest wins), `LeadScoreEvent`, `LeadStageHistory`,
`ContactNote`, `ContactTask`, `Opportunity`, `OutreachJourney`, `BookingRequest`, `Enrollment`, `Student`.

**`Opportunity`** — a *second* representation of the same deal

| Field | Flow significance |
|---|---|
| `leadId` (required, `Cascade`) | Always belongs to a Lead |
| `pipelineId`, `stageId`, `position` | Its own board coordinates |
| `status: OpportunityStatus` | `OPEN`/`WON`/`LOST`/`ABANDONED` |
| `valueInrMinor`, `valueEurMinor`, `fxRateUsed` | |

`PipelineStage.legacyStage: LeadStage?` is the bridge: moving an Opportunity mirrors back onto
`Lead.stage` via `src/server/opportunity-sync.ts`. **Two status fields for one deal, kept in step by
code.**

**`BookingRequest`**, **`AppointmentSlot`**, **`SssSlot`**, **`SlotRelease`**, **`DiscoveryOutcome`**,
**`CallLog`**, **`OutreachJourney`** → **`OutreachStepLog`** complete the sales side.

### 3.3 Contract & money core

**`Agreement`** — `status: AgreementStatus` is the app's **only well-formed lifecycle**:
`DRAFT → SENT → VIEWED → SIGNED` with `DECLINED`/`VOIDED`/`EXPIRED` as exits. Derived in one pure
function (`src/lib/agreement-state.ts`) rather than trusted from the column. Children:
`AgreementBody`, `AgreementSigner`, `AgreementAttachment`, `AgreementEvent`.

**`Invoice`** — `status: InvoiceStatus`, `kind: InvoiceKind`, numbering drawn at **issue** from
`DocumentSequence` (drafts get `DRAFT-xxxx`). Issued = locked.

**`Income`**, **`Expense`**, **`PendingPayment`** → **`Instalment`**, **`Payable`**,
**`JournalEntry`** → **`JournalLine`** → **`LedgerAccount`**, **`PeriodLock`**, **`CashPosition`**,
**`EquityContribution`**, **`FxRate`**.

**`Level`** — `kind: LevelKind` (`COACHING_TIER` locked/seeded, `GERMAN_LEVEL` founder-added,
`GERMAN_BUNDLE`, `OTHER`). **`Product`** carries the price, keyed by `levelCode @unique`.

### 3.4 People core

**`User`** — `role: Role` (6), `status: UserStatus`, `sectionAccess` (JSON overrides),
`capabilities` (JSON overrides), `mustChangePassword`, `themePreference`.

**`Student`** — `code @unique`, `userId @unique` (the portal login link), `leadId` (provenance).

**`TeamProfile`** — the *org* record, separate from `User`. `logVariant: DailyLogVariant` is what
decides which My Desk a telecaller sees — **not** their role. Also carries pay, commission share,
termination and successor.

### 3.5 Lifecycle summary — the gap

| Entity | Has a real lifecycle? |
|---|---|
| `Agreement` | **Yes** — 7 states, pure derivation, transition rules |
| `Invoice` | **Yes** — draft/issued/paid, numbering locked at issue |
| `Enrollment` | Partial — 4 statuses + `currentMilestone`, but no entry gate |
| `Opportunity` | Partial — 4 statuses, but duplicated by `Lead.stage` |
| `Lead` | Weak — 17 flat stages, no guards |
| **`Batch`** | **No** — `ACTIVE`/`ARCHIVED` only |
| `ClassSession` | Implicit — derived from `attendancePublishedAt` |
| `CurriculumTemplate` | No — `active: Boolean` |
| `Student` | Via `Enrollment.status` only |

---

## 4. Role and permission inventory

### 4.1 The three layers

1. **Role** (`User.role`, 6 values) — the coarse default.
2. **Section** (38 keys) — which screens open. Resolved by
   `resolveSections()` merging the founder's `SectionsConfig` JSON over the code catalogue, then
   `sectionAllowed()`. Per-user overrides in `User.sectionAccess` beat role defaults.
3. **Capability** (13 keys) — which privileged writes are allowed once inside. Per-user overrides in
   `User.capabilities`.

The access rule is one function, [`sectionAllowed`](../../src/lib/sections.ts), used by both the server
guard and the admin checkbox grid — so there is no mirror to drift. Four questions in order: section
off? → `personal` page? → per-user override? → role list?

### 4.2 Sections by role (code defaults)

| Section | ADMIN | HEAD | USER | STUDENT | TUTOR | COACH | Flag |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| finance | ✓ | | | | | | |
| cash | ✓ | | | | | | |
| ledger | ✓ | | | | | | `hidden` |
| payments | ✓ | | | | | | |
| telecaller (Bonus & Commission) | ✓ | ✓ | | | | | |
| my-desk | ✓ | ✓ | ✓ | | | | |
| daily-log | | ✓ | | | ✓ | ✓ | |
| dashboard | | | | ✓ | | | `personal` |
| my-journey | | | | ✓ | | | `personal` |
| classroom | | | | ✓ | | | `personal` |
| coaching (My Teaching) | ✓ | ✓ | | | ✓ | ✓ | |
| attendance | ✓ | ✓ | | | ✓ | ✓ | |
| batches | ✓ | | | | | | + `requireAdmin()` |
| leaderboard | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| arena | ✓ | ✓ | ✓ | | | | |
| guide | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| pipeline → `/opportunities` | ✓ | ✓ | ✓ | | | | see G1 |
| contacts | ✓ | | ✓ | | | | |
| opportunities | ✓ | ✓ | ✓ | | | | `offRail` |
| bookings | ✓ | ✓ | ✓ | | | | |
| outreach | ✓ | | ✓ | | | | `offRail` |
| sites | ✓ | | | | | | |
| funnels | ✓ | | ✓ | | | | |
| forms | ✓ | | ✓ | | | | |
| whatsapp | ✓ | | | | | | |
| conversations | ✓ | | | | | | |
| students | ✓ | ✓ | ✓ | | | | |
| agreements | ✓ | ✓ | ✓ | | | | |
| german-note | ✓ | ✓ | | | ✓ | | |
| cv-check | ✓ | ✓ | | ✓ | | | `hidden` |
| reports | ✓ | ✓ | ✓ | | | | |
| funnel (report) | ✓ | | | | | | |
| console | ✓ | | | | | | `locked` |
| people (Users) | ✓ | | | | | | |
| programs | ✓ | | | | | | + `requireAdmin()` |
| activity | ✓ | | | | | | `locked` |
| automation | ✓ | | | | | | `hidden` |

Group sizes per role (max 5 rule): ADMIN sees the most at 8 in Admin+Finance combined but no single
group exceeds 5 for any role — the rule holds.

### 4.3 Capabilities (all default ADMIN-only)

| Key | What it gates |
|---|---|
| `finance.write` | Income, expenses, pending payments, cash balances, payables |
| `pipeline.configure` | Monthly target, lead assignment, deleting leads/outcomes |
| `users.manage` | Invite, edit access, suspend, delete; access requests |
| `rewards.approve` | Reward scan, grant status, telecaller payouts |
| `agreements.issue` | Create, update, issue, void, resend an agreement |
| `outreach.qualify` | Set "Highly Qualified" (the Discovery Specialist's verdict) |
| `germanNote.finance` | **A read key** — GN Financials tab + workshop P&L |
| `sites.manage` | Publish the public website, forms, funnels |
| `batches.manage` | `seatEnrollment` / `unseatEnrollment` (creating batches stays ADMIN) |
| `qualification.manage` | Qualification question config |
| `commission.firstCall` | First-call commission share |
| `commission.discovery` | Discovery commission share |
| `commission.closer` | Closer commission share |

### 4.4 Gaps and inconsistencies

| # | Gap | Evidence | Impact |
|---|---|---|---|
| G1 | **Nav label vs destination.** The nav item keyed `pipeline` is labelled "Pipeline" but `href` is `/opportunities`. The route at `/opportunities` runs `requireSection("opportunities")`, not `"pipeline"` — so a user granted `pipeline` and denied `opportunities` is bounced from their own nav item. | `sections.ts` (`key: "pipeline", href: "/opportunities"`); `app/(app)/opportunities/page.tsx` | Config-dependent dead link. Both default to the same roles, so it only bites if the founder splits them. |
| G2 | **`/pipeline` is off the nav entirely** yet is a 566-line board with 24 inbound links. There is no section whose `href` is `/pipeline`. | §2.1 | The screen a telecaller works in all day has no door of its own. |
| G3 | **`/batches` is ADMIN-only but `batches.manage` exists.** A HEAD granted `batches.manage` can seat students — but only from `/students/[id]`, since `/batches` runs `requireAdmin()` on top of the section. | `app/(app)/batches/page.tsx:46-47`; `capabilities.ts:145` | The capability is real but half-reachable. Documented as deliberate in the page comment. |
| G4 | **`SPEC_CONFLICT` rows.** The spec names 8 roles; the app has 6. Where two collapsed spec roles get different access (e.g. Agreements is `E` for one and `-` for another), the app cannot express it as a role default at all — only per-user. | `permission-matrix.ts:19-22` | Known and reported in Console → Access Matrix. Needs a role-model decision, not a code fix. |
| G5 | **Three hidden sections ship unreachable**: `ledger`, `cv-check`, `automation`. All three are fully built, have inbound links from live code, and 404-equivalent (`requireSection` redirects home). | `sections.ts`; §2.1 | Intentional, but `automation` has 11 inbound links pointing into a dead section. |
| G6 | **`TeamProfile.logVariant` is load-bearing but is not a permission.** Which My Desk you see — L1, L2 or Owner — comes from the org record, not the role. A USER with no `TeamProfile` gets an explainer page. | `my-desk/page.tsx` ("No team profile linked to your login", ×2) | A real role-shaped behaviour that the access UI cannot show or set. |
| G7 | **`germanNote.finance` is a read capability in a catalogue documented as "privileged writes".** | `capabilities.ts:108` | Acknowledged in the comment; the odd one out because GN money is a *tab*, and sections need an `href`. |
| G8 | **Batch detail is not section-gated at all** — it uses `requireSession()` and lets `getBatchDetail` decide by ownership. Correct for COACH (who has neither `students` nor `german-note`), but it means the page is the one screen whose access is invisible to the Console. | `batches/[batchId]/page.tsx:36-38` | Deliberate; worth documenting rather than changing. |
| G9 | **`/funnel` page title still reads "Conversion Funnel"** while the nav says "Funnel Report" — the rename was applied to the catalogue, not the page metadata. | `funnel/page.tsx` `metadata.title` | Cosmetic; the browser tab and nav disagree. |

---

## 5. Duplicates and disconnections (flagged, as the brief requires)

### 5.1 Same component mounted on two or three pages

| Component | Mounted on | Consequence |
|---|---|---|
| `BatchesManager` | `/batches` (×2: B2 + GN tabs), `/students?tab=batches` | **Three doors** to create a cohort |
| `CurriculumPanel` | `/batches?tab=plans`, `/programs?tab=curriculum` | **Two doors** to write a syllabus |
| `LevelsPanel` | `/programs`, `/german-note/manage?tab=levels` | **Two doors** to the level catalogue (deliberately split by `LevelKind`, but the same panel) |

To be fair to the code: these are **re-mounts of one component reading one server function**, not
re-implementations. There is no second copy of the logic to drift. The problem is purely
navigational — the user cannot tell which door is "the" door.

### 5.2 Two writers for one entity

| Entity | Writer A | Writer B | Difference |
|---|---|---|---|
| `Lead` | `contacts-actions.createContact` (`/contacts`) | `pipeline-actions.createLead` (`/pipeline`) | A always sets `stage: "NEW_LEAD"`; B takes a stage and can set `wonLevel`/`paymentPlan` |
| Batch membership | `batch-actions.seatEnrollment` → `Enrollment.batchId` (`/students/[id]`) | `german-note-actions` → `BatchMember` (`/german-note/manage`) | Different tables, different screens, no shared concept |
| Deal stage | `Lead.stage` (`/pipeline`) | `Opportunity.stageId` (`/opportunities`) | Mirrored by `opportunity-sync.ts` |
| Attendance | `/attendance` desk | `/coaching` "To mark" **and** `/german-note/[batchId]` Schedule | Three surfaces, one `SessionAttendance` |

### 5.3 The batch example from the brief, verified

The brief's example is accurate, and sharper than stated:

1. **Create a cohort** — `/batches?tab=0` (or `/students?tab=batches`, or `/german-note/manage`).
   `upsertBatch` ([`batch-actions.ts:62`](../../src/server/batch-actions.ts)) requires nothing but a
   name, level and line. It is `ACTIVE` immediately, with no tutor, no syllabus, no dates, no roster.
2. **Attach a syllabus** — a different tab (`/batches?tab=2`) writes the template; the batch's own page
   has a "build from plan" dialog that generates sessions from it. Two steps, two screens.
3. **Seat students** — **only** from `/students/[id]`, one enrolment at a time, via a dropdown
   ([`StudentDetailClient.tsx:50-100`](<../../src/app/(app)/students/[id]/_components/StudentDetailClient.tsx#L50-L100>)).
   Filling a 12-seat cohort means 12 separate page loads.
4. **The batch hub tells you to go somewhere that isn't where the control is.** The Roster tab's empty
   state reads *"Seat students into this cohort from the Students board"*
   ([`batches/[batchId]/page.tsx:148-150`](<../../src/app/(app)/batches/[batchId]/page.tsx#L144-L152>)),
   and the footer repeats it. But the Students **board** (`/students`) has no seating control — it is on
   each student's **record** (`/students/[id]`). The pointer is both un-clickable and inaccurate.
5. **German Note does it differently**, through `BatchMember` from its own Members screen — so "how do
   I add someone to a batch" has two unrelated answers depending on the line.

### 5.4 The "what's next" gap, counted

Of **64** `EmptyState` usages in the app, **11** carry an `action` and **53** do not. The component
supports `action` ([`ui/kit.tsx:370-390`](../../src/components/ui/kit.tsx#L370-L390)); most callers
don't pass one.

Many of the 53 are legitimately terminal — "No overdue balances", "No duplicates found", "Your queue is
clear", "Nothing archived". But roughly **20 are setup dead ends**, where the user needs to do something
and the screen offers no way to do it:

`Nobody seated yet` (batch roster) · `No batches yet` · `No programmes to run a batch for` ·
`No curriculum yet` · `No sessions yet` · `No timetable yet` · `No cohorts yet` (My Teaching) ·
`No students assigned to you` · `No cohort assigned to you` (Attendance) · `No classes scheduled yet`
(student Classroom) · `Nothing priced yet` (Products) · `No custom fields` · `No templates` ·
`No conversations yet` · `No pages yet` (site) · `No website yet` · `No subscriptions` ·
`No team profile linked to your login` (×2, My Desk) · `No workshops yet` · `The Arena is empty` ·
`No quests are configured`

---

## 🛑 Gate 1 — summary

1. The app is **larger than the brief assumes**: 77 pages, ~135 surfaces behind 38 nav sections, 124 Prisma models, 215 server modules, 6 roles, 13 capabilities.
2. **The brief's premise needs one correction**: a deliberate IA *does* exist (`src/lib/sections.ts`, 8 groups, documented rules, last regrouped 22 Oct 2026), as does a clean shared service layer (`src/server/*`, actions/metrics split) and a permission model with a drift reporter. Planning as if none of that existed would mean rebuilding working parts.
3. **The brief's example is nonetheless correct, and worse than stated.** Seating a B2 student into a cohort is possible from exactly one place — each student's own record page — one student at a time. The batch's own Roster tab is read-only and points you at "the Students board", which does not have the control.
4. **`Batch` has two parallel membership mechanisms**: `Enrollment.batchId` for B2, `BatchMember` for German Note. Different tables, different screens, nothing in the schema marking which applies. This is the deepest structural issue found.
5. **`Batch` has no lifecycle.** `status` is `ACTIVE | ARCHIVED`. `tutorId`, `curriculumTemplateId`, `startDate` and `endDate` are all nullable, so an `ACTIVE` batch with no teacher, no syllabus, no dates and no students is fully legal and indistinguishable from a running one.
6. **Only `Agreement` and `Invoice` have well-formed lifecycles.** `Lead` has 17 flat stages with no guards; `CurriculumTemplate` has a boolean.
7. **One deal has two status fields** — `Lead.stage` and `Opportunity.stageId` — kept in step by `opportunity-sync.ts`, surfaced as two kanban boards (`/pipeline`, `/opportunities`).
8. **`/pipeline` has no nav entry** (24 inbound links, 566 lines), while the nav item *labelled* "Pipeline" points at `/opportunities`.
9. **`Lead` has two creation paths** with different field sets: `createContact` (always `NEW_LEAD`) and `createLead` (any stage, plus `wonLevel`/`paymentPlan`).
10. **Three panels are mounted on two or three pages each** (`BatchesManager` ×3, `CurriculumPanel` ×2, `LevelsPanel` ×2). Re-mounts, not re-implementations — a navigation problem, not a logic one.
11. **Attendance can be taken from three places**; the register is published from one, and publishing (not marking) is what fires notices.
12. **Three fully built sections ship unreachable**: Ledger, CV Studio, Automation (`hidden: true`). Automation still has 11 inbound links into a dead section.
13. **Sixteen background engines all ship disarmed**, surfaced in Console → System → Not armed. This is a strength — but it means "the feature is built" and "the feature runs" are different questions for most of the app.
14. **53 of 64 empty states offer no next step**; ~20 of those are genuine setup dead ends.
15. **Role-based homes exist for 3 of 6 roles** (STUDENT → `/dashboard`, TUTOR → `/german-note`, COACH → `/coaching`). ADMIN, HEAD and USER share `/`, where USER gets the thinnest version — their real desk is `/my-desk`.
16. **Which My Desk you see is decided by `TeamProfile.logVariant`, not your role** — a load-bearing behaviour the access UI cannot see or set.
17. **`/telecaller`, `/whatsapp` and `/programs` are nav-only** — nothing in the app links to them.
18. **Six routes have no in-app entry point by design** (public form, funnel, site, invoice, signing, booking) — correct as the inbound edge.
19. **Nine permission gaps** catalogued in §4.4, of which G1 (nav key vs route key) and G4 (`SPEC_CONFLICT`, 8 spec roles onto 6 app roles) are the two that need a decision rather than a fix.
20. **Known conflicts already tracked elsewhere**: `docs/CONFIGURABLE_LEVELS_PLAN.md` (awaiting D1–D4), `Required_Document/07` (Head Coach access, student money). Those should feed Phase 3 rather than be rediscovered.

**Please confirm:**
- Is anything missing from the feature inventory (§1, 149 features)?
- Do you accept the correction in §0 — that the IA and service layer already exist, so Phase 3 should be surgical rather than a full redesign?
- Are the three hidden sections (Ledger, CV Studio, Automation) to be treated as **kept-but-off**, or as candidates for removal?
