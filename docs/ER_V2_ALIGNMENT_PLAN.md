# ER v2 Alignment — Build Plan

**Source of truth for the target:** `Required_Document/B2Consultants_ER_Diagram_v2.mermaid`
**Source of truth for today:** `prisma/schema.prisma` (~90 models) + the `src/server/*-metrics.ts` read layer
**Status:** plan only — nothing in here is built yet. Decisions D1–D7 need founder sign-off before Track A starts.
**Written:** 2026-07-29

---

## 0. What this plan is, and what it deliberately is not

The audit found **21 of 54** ER-v2 entities built as-drawn or richer, **22** present in a
different shape (a column, a JSON blob, a config key, or a computed function), and **11**
absent. This plan closes the gaps that cost the business an answer it cannot get today, and
explicitly declines the ones where the current design is better than the diagram.

**The organising principle:** the diagram is a *requirements* document, not a *schema*
document. Where the app already answers the question the entity exists to answer — and
answers it more precisely — we update the diagram, not the database. Where the app cannot
answer the question at all, we build.

### Not being built, and why

| Entity | Decision | Reason |
|---|---|---|
| `FINANCE_RECORD` | **Decline** | Double-entry `LedgerAccount`/`JournalEntry`/`JournalLine` + `PeriodLock` already is the finance record, and it *balances*. A per-batch/per-workshop rollup table would be a second source of truth that drifts. Batch/workshop P&L becomes a **ledger slice** (Track C.4), not a stored row. |
| `DASHBOARD_METRIC` | **Decline** | Every figure is computed in `*-metrics.ts` from history. Storing them creates staleness with no upside. (Perf is a Supabase RTT problem — see `docs/` perf baseline — not a compute problem, so caching would not fix what people think it fixes.) |
| `CASH_RUNWAY` | **Decline as a table** | `CashPosition` stores the *observations* (bank balance history); `getRunwaySnapshot()` derives burn and runway. Storing a derived runway row means a stale runway badge the day after an expense lands. |
| `ROLE` / `ACCESS_PERMISSION` as tables | **Decline** | `Role` is a Prisma enum wired into Better Auth, `RewardRule.roles[]`, `sections.ts`, and every `requireSection`/`requireCapability` guard. Converting it to a table is a whole-app refactor whose entire payoff — flexible per-person access — is already delivered by `User.sectionAccess` + `User.capabilities` + `AppSetting("sectionsConfig")`. **Action: amend the ER diagram** to show the config-backed model. |
| `ZOOM_MEETING` | **Defer** | There is no Zoom or Calendar integration to provision against. `OutreachJourney.zoomLink` and `GnEvent.joinUrl` are honest today. Build the table *with* the integration (Track K), never before. |
| `ACHIEVEMENT` | **Decline** | Badges are derived from `AppSetting("gamificationRulesets")` + `RewardGrant`. A row per unlocked badge is a denormalisation of a pure function over append-only history. |

Everything else is built, in the tracks below.

---

## 1. Architecture the plan must obey

These are not suggestions — every track below is designed around them, and a PR that breaks
one gets rejected on sight.

### 1.1 The four layers

```
src/lib/<domain>.ts          PURE. No prisma, no session, no fetch. Every input is an
                             argument. Unit-tested with node:test, no database.
                             e.g. lib/tutor-fee.ts, lib/bant.ts, lib/agreement-state.ts

src/server/<domain>.ts       Server-only reads. `cache()`-wrapped. Compose pure lib fns
src/server/<domain>-metrics.ts  over prisma queries. NEVER "use server".

src/server/<domain>-actions.ts   "use server". EVERY export is a public RPC endpoint —
                             so every export starts with an rbac guard, validates with
                             zod, writes, logs activity, revalidates.

src/app/(app)/<section>/     RSC page + _components/*.tsx client islands.
```

**The rule that matters:** business rules live in `lib/` as pure functions so they can be
tested without a database and reused by seed scripts, cron routes and the UI without
drifting. `lib/tutor-fee.ts` is the model to copy — read it before writing Track C.

### 1.2 Money

Integer minor units in `BigInt`. INR paise is base. Dual-currency rows carry
`amountInrMinor` + `amountEurMinor` + `fxRateUsed` (INR per 1 EUR, **stamped at entry** so
history never re-prices). Anything single-currency is INR paise and says so in its name.

### 1.3 Ledger posting

Money that moves gets a **balanced journal entry**. The seam is:

```
server/<domain>-actions.ts          →  builds a DraftEntry via …
server/finance-posting.ts           →  pure draft builders (no "use server", so seed
                                       scripts import them too)
server/ledger-core.ts               →  posts / voids, enforces balance at COMMIT via a
                                       deferred constraint trigger
```

New posting rules go in `finance-posting.ts`, **never** inline in an action, and each new
rule ships **behind a `financePosting.*` flag** in `config-schema.ts` defaulting to `false`
— the same shape as `commissionAccrual`. A posting rule that cannot be switched off cannot
be safely deployed onto a live ledger.

### 1.4 Guards

```ts
const session = await requireAdmin();               // founder-only writes
const session = await requireSection("students");   // section-gated reads/writes
await requireCapability("finance.write");           // privileged write inside a section
```

Every new privileged write adds a **capability key** to `lib/capabilities.ts` *and* the guard
in the same PR. A key without a guard is a permission that means nothing.

### 1.5 Activity + audit

Every write calls `logActivity(session, {...})` (`server/activity-log.ts`) — plain,
append-only, indexed for the founder's filters. Finance writes *additionally* append to the
hash-chained `AuditEntry`. Do **not** feed high-frequency writes to `AuditEntry`: it takes a
global advisory lock per append.

### 1.6 Soft delete

Nine core models use `deletedAt`/`deletedById` with **explicit** `deletedAt: null` filtering
at every read site (no Prisma middleware, on purpose). New user-deletable entities follow
the same pattern via `lib/soft-delete.ts` and get an Archived tab. Reference/config tables
(`Level`, `QualificationQuestion`) use `active: boolean` instead — they are never "deleted",
only retired, because history points at them.

### 1.7 Migrations against a live Supabase

The live database **is Supabase** and there is no local rollback copy. Therefore:

- Every migration is **expand → backfill → contract**, in *three separate deploys*.
  Add nullable column → dual-write and backfill → only then enforce/`NOT NULL`/drop old.
- New FKs land **nullable** with `onDelete: SetNull`. No `NOT NULL` on a column with
  existing rows, ever, in the same migration that adds it.
- Renames (`gn_batch` → `batch`) use `ALTER TABLE ... RENAME` in raw SQL so **data survives**
  — never Prisma's default drop-and-create. Verify the generated SQL by hand before applying.
- Migrations run with `DIRECT_URL` (session-level advisory locks; PgBouncer can't hold them).
- Backfills are **idempotent scripts** in `prisma/` (see `backfill-booking-links.ts`), run
  manually, logged, re-runnable.
- Triggers (append-only guards, balance checks) are hand-written SQL inside the migration —
  Prisma does not manage them and will not drop them if they're not in the model.

### 1.8 Feature exposure

Anything user-facing that isn't ready ships as `hidden: true` in `SECTION_CATALOGUE`
(route unreachable, nav hidden, console can re-enable) — the `ledger` section is the
precedent. Engines ship **OFF by default** behind an `AppSetting` flag.

---

## 2. Decisions needed before Track A (D1–D7)

Blocking. Each changes the shape of the work materially.

| # | Question | Options | Recommendation |
|---|---|---|---|
| **D1** | One `Batch` table for both business lines, or a separate B2 batch? | (a) unify — rename `gn_batch` → `batch`, add `businessLine`; (b) new `CoachingBatch` beside `GnBatch` | **(a) unify.** GN already has *two* batch worlds (`GnBatch` rows vs `GnWorkshopConversion.batchA1/A2/B1` free text). A third would make it three. |
| **D2** | Do B2 coaching students actually sit in batches, or is coaching 1:1? | — | Founder must answer. If coaching is genuinely 1:1, `Enrollment.batchId` stays nullable forever and Track A shrinks to the GN unification only. **The diagram asserts batches; the app's behaviour suggests 1:1.** |
| **D3** | Is the tutor fee owed **per batch per level** (a lump the trainer invoices) or **per student**? | — | `lib/tutor-fee.ts` implements per-batch-per-level (rate × headcount). Confirm before persisting it as a payable. |
| **D4** | Should approved tutor fees **post to the ledger** as an accrual, or stay a report? | — | Recommend accrual, **flag-off by default** (`financePosting.tutorFeeAccrual`), mirroring commissions. |
| **D5** | Can qualification questions be reworded/reweighted *after* leads have answered? | (a) versioned questions, answers pin a version; (b) edit in place | **(a) versioned.** BANT verdicts drive real money decisions; a silent reweight would rewrite why we called someone. |
| **D6** | Is `Student` or `Enrollment` the anchor for money & contracts? | — | Diagram says Enrollment. App says Student. Recommend **add `enrollmentId` alongside `studentId`** (both, nullable) rather than moving — a student on 3 levels needs per-level attribution, but existing rows have no enrollment to point at. |
| **D7** | Do students get OKRs (diagram says yes; app says team-only)? | — | Low value; recommend **decline** and amend the diagram, unless the student portal is meant to be a goal-tracking product. |

---

## 3. Track A — The delivery spine: `Batch`

**Closes:** `BATCH`, `ENROLLMENT }o--|| BATCH`, `TEAM_MEMBER ||--o{ BATCH`, and the
"two GN batch worlds" problem flagged in `docs/GN_FOUNDER_WORKFLOW_INTEGRATION.md`.
**Why first:** `SESSION`, `TASK`, `TUTOR_FEE` and batch P&L all hang off it. Nothing else in
the delivery half of the diagram can be built until a batch is a real, shared thing.

### A.1 Schema

Rename, don't recreate:

```prisma
enum BatchLine { B2 GERMAN_NOTE }

model Batch {                        // was GnBatch, @@map("batch") ← RENAMED from "gn_batch"
  id             String      @id @default(cuid())
  line           BatchLine   @default(GERMAN_NOTE)   // every existing row is GN
  code           String?     @unique                 // "A1", "B10" — the founders' label
  name           String
  level          String                              // Level.code
  tutorId        String?
  tutor          User?       @relation("BatchTutor", …)
  status         GnBatchStatus @default(ACTIVE)
  targetStrength Int         @default(8)
  startDate      DateTime?   @db.Date                // NEW — diagram's start_date
  endDate        DateTime?   @db.Date
  notes          String?

  members     BatchMember[]      // was GnBatchMember
  enrollments Enrollment[]       // NEW — the B2 seat
  sessions    Session[]          // Track B
  tutorFees   TutorFee[]         // Track C
  recordings  GnRecording[]
  posts       GnPost[]
  modules     GnModule[]
  @@index([line, status])
}

model Enrollment {
  …
  batchId String?
  batch   Batch? @relation(fields: [batchId], references: [id], onDelete: SetNull)
  @@index([batchId])
}
```

### A.2 Migration sequence (3 deploys)

1. **Expand.** Raw SQL: `ALTER TABLE gn_batch RENAME TO batch;` + rename its indexes and the
   FK constraint names; add `line`, `code`, `start_date`, `end_date` (all nullable /
   defaulted). Add `enrollment.batch_id` nullable. Prisma models updated to match. **No data
   moves.** Existing GN reads keep working because the model fields are unchanged.
2. **Backfill.** `prisma/backfill-batches.ts` — idempotent:
   - set `line = 'GERMAN_NOTE'` on every pre-existing row;
   - parse `GnWorkshopConversion.batchA1/batchA2/batchB1` free-text labels, `upsert` a
     `Batch` per distinct (label, level) with `line = 'GERMAN_NOTE'`, and record the mapping
     in a new nullable `batchA1Id/batchA2Id/batchB1Id` FK trio on the conversion;
   - report every label it could **not** resolve to stdout. Do not guess. An unresolved
     label stays free text and is surfaced in the UI as "unlinked".
3. **Contract.** Only once the report is clean: make the free-text columns read-only in the
   UI (keep the data as the historical snapshot, like `BookOrder.shipToAddress`).

### A.3 Server + UI

- `server/batches.ts` — `listBatches({line, status})`, `getBatch(id)`, `batchRoster(id)`.
- `server/batch-actions.ts` — `createBatch`, `updateBatch`, `assignTutor`, `seatEnrollment`,
  `unseatEnrollment`. Guard: `requireAdmin()` for GN (unchanged), `requireSection("students")`
  + new capability `batches.manage` for B2.
- UI: German Note → Batches panel keeps working untouched (it now reads `Batch` where
  `line = GERMAN_NOTE`). New **Students → Batches** tab renders `line = B2`, with a "Seat in
  batch" control on the enrollment row.
- `lib/sections.ts`: no new section — this rides inside `students` and `german-note`.

### A.4 Flow — seating a B2 student

```
Students → open enrollment → "Seat in batch"
  → client island posts to seatEnrollment(enrollmentId, batchId)
     → requireSection("students") + requireCapability("batches.manage")
     → zod: both ids present
     → guard: batch.line must match the enrollment's level kind
              (COACHING_TIER → B2, GERMAN_LEVEL → GERMAN_NOTE) — service-validated,
              exactly like isKnownLevel() in book-order-actions.ts
     → guard: batch.members.count < targetStrength, else warn-and-confirm (not a hard block —
              the founders overfill deliberately)
     → prisma.enrollment.update({ batchId })
     → logActivity("batch.seat", section "students", summary "Seated Priya Sharma in A1 Evening")
     → revalidatePath("/students"); revalidatePath("/german-note")
```

### A.5 Tests

- `lib/__tests__/batch-rules.test.ts` — pure: level-kind ↔ batch-line compatibility, capacity
  banding. No DB.
- Backfill script asserted against a copy of the workshop labels from `seed-workshops.ts`.
- Browser: seat a student, confirm the GN batches panel is byte-identical to before.

---

## 4. Track B — Sessions and tasks

**Closes:** `SESSION`, `SESSION ||--o{ TASK`, `TASK_COMPLETION`, `SESSION ||--o| RECORDING`.
**Depends on:** Track A.

### B.1 Schema

`GnEvent` already carries the diagram's exact session-type enum
(`KICKOFF/COACHING/LINKEDIN/QA/OPEN_MARKET`). Promote it:

```prisma
model Session {                 // was GnEvent, @@map("session") — NOTE: collides with the
                                // Better Auth session table's @@map("session").
                                // → use @@map("class_session"). See the LedgerAccount/Account
                                //   precedent in the schema header comments.
  id        String @id @default(cuid())
  batchId   String
  batch     Batch  @relation(…)
  title     String
  type      GnEventType @default(LIVE_CLASS)
  startsAt  DateTime
  durationMins Int?
  joinUrl   String?
  recordingId String?  @unique          // NEW — SESSION ||--o| RECORDING
  recording   GnRecording? @relation(…)
  tasks     SessionTask[]
  …
}

model SessionTask {                     // NOT ContactTask — that is the CRM to-do
  id        String @id @default(cuid())
  sessionId String
  session   Session @relation(fields:[sessionId], references:[id], onDelete: Cascade)
  type      SessionTaskType             // WATCH_VIDEO | APPLY_JOB | HOMEWORK | OTHER
  title     String
  description String?
  dueAt     DateTime?
  recordingId String?                   // WATCH_VIDEO → which recording
  orderIndex Int @default(0)
  completions SessionTaskCompletion[]
}

model SessionTaskCompletion {
  id        String @id @default(cuid())
  taskId    String
  studentId String
  status    TaskCompletion @default(PENDING)   // reuse the existing YES/NO/PENDING enum
  completedAt DateTime?
  note      String?
  @@unique([taskId, studentId])
}
```

**Naming is load-bearing.** `ContactTask` is a CRM to-do on a Lead; `SessionTask` is
coursework. Collapsing them would put a sales follow-up in a student's homework list.

### B.2 Retiring the placeholder fields

`Enrollment.lastTaskAssigned` (string) and `lastTaskCompleted` (enum) are the current
stand-in. Keep them, and make them **derived-on-write**: when a `SessionTaskCompletion` lands,
update the two columns so every existing tracker/read-path keeps working with no change.
Delete them only in a later contract migration, once nothing reads them.

### B.3 Flow — a class happens

```
Tutor: German Note → Batch → Schedule → "Add class"        [createSession]
   → requireSection("german-note"); tutor may only touch their own batch
   → Session row, type LIVE_CLASS, startsAt UTC (displayed IST + CET)

Tutor after class: paste Fathom link                        [createRecording — EXISTS]
   → GnRecording row; NEW: link session.recordingId

Tutor: "Assign task" on the session                          [createSessionTask]
   → SessionTask (WATCH_VIDEO → recordingId | HOMEWORK → free text)
   → fan-out: one SessionTaskCompletion(PENDING) per current BatchMember
      (materialised, not computed — a student who joins later gets rows via a backfill
       on seat, so "what did I miss" is answerable)

Student: /my-journey → Tasks                                 [completeSessionTask]
   → status YES + completedAt
   → write-through to Enrollment.lastTaskCompleted
   → logActivity("task.complete", section "students")

Coach: Students → at-risk radar
   → reads open SessionTaskCompletion count per enrollment; feeds signalColour prompts
```

### B.4 Video progress — already better than the diagram

`GnRecordingWatch` (high-water `watchedPct`, `positionSecs`, `durationSecs`,
`lastHeartbeatAt`, `selfReported`) exceeds `VIDEO_PROGRESS`. **No work.** A `WATCH_VIDEO`
task auto-completes when `watchedPct >= config.watchCompleteThreshold` — one new pure fn in
`lib/video-progress.ts`, no new storage.

---

## 5. Track C — `TutorFee` as a record, and batch P&L

**Closes:** `TUTOR_FEE`, `TEAM_MEMBER ||--o{ TUTOR_FEE`, `BATCH ||--o| FINANCE_RECORD`.
**Depends on:** Track A. **Blocked by:** D3, D4.

Today the *rule* exists and is tested (`lib/tutor-fee.ts`, `lib/__tests__/tutor-fee.test.ts`)
but the *record* does not, so "what did this trainer earn for this batch, and did we pay it"
is unanswerable. The fix is to persist the output of the pure function, not to reimplement it.

### C.1 Schema

```prisma
enum TutorFeeStatus { DRAFT APPROVED PAID CANCELLED }

model TutorFee {
  id        String @id @default(cuid())
  batchId   String
  batch     Batch  @relation(…)
  trainerId String?
  trainer   User?  @relation("TutorFeeEarner", …, onDelete: SetNull)
  level     String                       // Level.code, snapshotted
  studentsCount Int                      // headcount AT COMPUTE TIME — the whole point
  ratePerHeadInrMinor BigInt             // resolved band, snapshotted
  amountInrMinor      BigInt             // = rate × headcount, snapshotted
  overrideAmountInrMinor BigInt?         // founder override; null = use the computed figure
  overrideReason String?
  status    TutorFeeStatus @default(DRAFT)
  computedAt DateTime @default(now())
  approvedAt DateTime?
  paidAt     DateTime?
  postedEntryId String?                  // ledger accrual, when the flag is on
  @@unique([batchId, level])             // one fee per batch per level; recompute updates it
  @@index([trainerId, status])
}
```

**Snapshot, don't join.** `ratePerHead` and `studentsCount` are frozen at compute time for
the same reason `Agreement.data` is frozen and `BookOrder.shipToAddress` is snapshotted: a
student joining next month must not silently re-price a fee already approved.

### C.2 Flow

```
Console → Tutor Fees → "Recompute for <month>"        [recomputeTutorFees]
  requireCapability("finance.write")
  for each Batch where status=ACTIVE and line=GERMAN_NOTE:
     headcount = batch.members.count
     rate      = tutorRatePerHeadRupees(level, headcount, await getTutorFeeConfig())   ← PURE, EXISTS
     amount    = tutorFeeForBatchInrMinor(level, headcount, config)                    ← PURE, EXISTS
     upsert TutorFee, but ONLY when status = DRAFT
       (APPROVED/PAID rows are immutable — recompute skips them and reports the skip)
  logActivity("tutorfee.recompute")

Founder reviews the table (shows tutorFeeBandLabel() so the tier is visible, not just the
total — the founders' sheet shows the tier) → "Approve"    [approveTutorFee]
  status → APPROVED
  IF financePosting.tutorFeeAccrual.enabled:
     draft = tutorFeeAccrualDraft(fee)          ← NEW in server/finance-posting.ts
        Dr  5xxx COGS — Tutor fees   (isCogs: true)
        Cr  2xxx Accounts payable
     postedEntryId = await postEntry(draft)      ← ledger-core, balanced at COMMIT
  ELSE: no ledger effect — the report is still correct, it just isn't accrued.

"Mark paid" → status PAID + paidAt.  (Cash movement is an Expense row as today; the accrual
is the *liability*, the Expense is the *payment*. Do not post both to the same account.)
```

### C.3 Why `@@unique([batchId, level])` and not per-month

The founders' rate is *per level per batch*, not monthly (D3 confirms). A batch running A1
then A2 produces two rows. A recompute after someone joins updates the DRAFT row in place —
which is why approval freezes it.

### C.4 Batch P&L — a ledger slice, not a table

`server/batch-pnl.ts`:

```
revenue = Σ Income where enrollment.batchId = X   (needs Track E's enrollment link, or
                                                   Income.enrollmentId which already exists)
cogs    = Σ TutorFee(amount) for the batch
        + Σ BookOrder(paidAmount) for its seated students
gross   = revenue − cogs
```

This deliberately mirrors `lib/gn-workshop-pricing.ts` (already verified against the
founders' May/March workbooks — see the GN Workshops note). **Reuse those pure functions;
do not write a second margin formula.**

---

## 6. Track D — Configurable qualification questions

**Closes:** `QUALIFICATION_QUESTION`, `LEAD_ANSWER`, `LEAD_SCORE`.
**Blocked by:** D5. **Highest risk in the plan.**

Today the questionnaire is **18 hardcoded columns** on `BookingRequest` with weights in
`lib/bant.ts`. The founders cannot add, remove or reweight a question without a migration —
and BANT feeds the outreach SOP's Qualified verdict, which decides who gets called.

### D.1 Schema

```prisma
enum BantDimension { BUDGET AUTHORITY NEED TIMELINE NONE }
enum QuestionKind  { TEXT LONG_TEXT SELECT MULTI_SELECT BOOLEAN NUMBER }

model QualificationQuestion {
  id        String @id @default(cuid())
  key       String                       // stable slug: "readyToInvest" — matches the CURRENT column
  version   Int    @default(1)
  text      String                       // the wording shown on the form — the evidence
  helpText  String?
  kind      QuestionKind @default(SELECT)
  options   Json?                        // [{value,label,score}] — score 0–5, the weighted layer
  dimension BantDimension @default(NONE)
  weight    Int    @default(1)
  required  Boolean @default(false)
  orderIndex Int   @default(0)
  active    Boolean @default(true)
  @@unique([key, version])
}

model LeadAnswer {
  id         String @id @default(cuid())
  leadId     String
  bookingRequestId String?
  questionId String                      // pins the VERSION answered (D5)
  answerRaw  String
  score      Int?                        // 0–5, resolved from options at submit time
  createdAt  DateTime @default(now())
  @@unique([bookingRequestId, questionId])
  @@index([leadId])
}
```

`LEAD_SCORE` stays **columns on `BookingRequest`** (`bantScore`, `bantAvg`, `bantVerdict`) —
it is 1:1 with the booking and splitting it buys nothing. Add `bantConfigVersion` so a
verdict records which question set produced it.

### D.2 Cutover — the part that must not go wrong

This changes the **live public booking form** and the input to the outreach engine.

1. **Seed verbatim.** `prisma/seed-qualification-questions.ts` reproduces the current 18
   questions, their option lists and their 0–5 scores *exactly* as `lib/bant.ts` implements
   them today. Not "equivalent" — identical.
2. **Shadow-score.** Refactor `lib/bant.ts` to expose `scoreFromAnswers(answers, questions)`
   as a pure function beside the existing column-based scorer. Run **both** on every submit;
   write the catalogue result to a `bantShadowAvg` column and log any disagreement. Ship this
   and let it run over real traffic.
3. **Replay history.** A script re-scores every existing `BookingRequest` through the new path
   from its stored columns. **Zero disagreements is the gate to step 4.** Any disagreement is
   a seeding bug, not a rounding artefact.
4. **Flip the form.** `/book` renders from the catalogue (`server/qualification.ts`), writes
   `LeadAnswer` rows **and** keeps writing the 18 columns (dual-write). `bant.ts` reads the
   catalogue path.
5. **Contract, much later.** Only once no read path touches them, mark the 18 columns
   read-only. Consider never dropping them — they are a cheap frozen snapshot.

**Do not skip step 3.** The outreach engine's Qualified verdict routes real humans to real
calls; a silent scoring change is a business incident, not a bug.

### D.3 Admin UI

Console → **Qualification** — list, reorder (drag), add/edit, toggle active, live preview of
the public form, and a "what would this change?" panel that re-scores the last 100 bookings
under the draft configuration before saving. Editing a question with existing answers
**creates version N+1**; it never mutates the answered version (D5).

---

## 7. Track E — Enrollment as the contract anchor

**Closes:** `ENROLLMENT ||--|| EMI_PLAN`, `ENROLLMENT ||--o{ BOOK_ORDER`,
`ENROLLMENT ||--|| AGREEMENT`, `LEAD ||--o| ENROLLMENT`.
**Blocked by:** D6. Low risk, high value — do it early, in parallel with A.

Three tables hang off `Student` where the diagram says `Enrollment`. With a student on
3 German levels, "which level was this agreement for / these books for / this EMI plan for"
is a guess.

### E.1 Schema — additive only

```prisma
model Agreement      { enrollmentId String?  enrollment Enrollment? @relation(…, onDelete: SetNull) }
model BookOrder      { enrollmentId String?  enrollment Enrollment? @relation(…, onDelete: SetNull) }
model PendingPayment { enrollmentId String?  enrollment Enrollment? @relation(…, onDelete: SetNull) }
model Enrollment     { leadId String?        lead Lead? @relation(…, onDelete: SetNull) }   // direct, not via Student
```

`studentId` **stays** on all three. Nothing is moved; a second, sharper link is added.

### E.2 Backfill — `prisma/backfill-enrollment-links.ts`

Match on `(studentId, level)`:

- exactly one enrollment at that level → link it;
- zero, or more than one → **leave null** and print the row. Do not guess. A wrongly attributed
  agreement is worse than an unattributed one.

Then surface unlinked rows in the UI as "not linked to a level" with a manual picker, so the
tail gets cleaned by the people who know the answer.

### E.3 EMI plan

`PendingPayment` + `Instalment` already **is** `EMI_PLAN` + `PAYMENT`. Add
`levelsTaken Int?` and `numEmis Int?` (both derivable from `Instalment` count, stored only
because the diagram's `2 per level` rule is an input the founder sets at plan creation, not
an output). **No new table.**

---

## 8. Track F — Marketing source, ad spend, insights

**Closes:** `MARKETING_SOURCE`, `AD_SPEND` (generalised), `INSIGHT` (as a report).

Today: `LeadSource` enum (a coarse channel) + `Lead.utm` JSON + `GnWorkshopAdSet`
(German-Note workshops only, INR only). "What did this campaign cost us per enrolled
student" cannot be answered.

### F.1 Schema

```prisma
model MarketingSource {
  id        String @id @default(cuid())
  channel   LeadSource                  // reuse the enum — it IS the channel taxonomy
  campaign  String
  externalRef String?                   // Meta campaign id / UTM campaign value
  line      BatchLine?                  // which business this campaign sells
  active    Boolean @default(true)
  leads     Lead[]
  adSpends  AdSpend[]
  @@unique([channel, campaign])
}

model AdSpend {                          // generalises GnWorkshopAdSet beyond GN workshops
  id        String @id @default(cuid())
  sourceId  String?
  workshopId String?                     // kept: GN's per-workshop ad sets still work
  label     String?
  periodStart DateTime @db.Date
  periodEnd   DateTime @db.Date
  amountInrMinor BigInt @default(0)
  amountEurMinor BigInt @default(0)      // diagram asks for EUR|INR; GnWorkshopAdSet was INR-only
  fxRateUsed  Decimal @db.Decimal(14,6)
  reach       Int @default(0)
  linkClicks  Int @default(0)
  attended    Int @default(0)
  @@index([sourceId, periodStart])
}

model Lead { marketingSourceId String?  marketingSource MarketingSource? @relation(…) }
```

`GnWorkshopAdSet` is **renamed** to `AdSpend` (raw SQL rename, data preserved) and gains the
EUR + source columns. The GN workshop panel keeps reading it via `workshopId`.

### F.2 `INSIGHT` is a report, not a table

`server/insights-metrics.ts` — per source, per period:

```
spend        = Σ AdSpend.baseTotalMinor
leads        = count(Lead where marketingSourceId = X)
bookings     = count(BookingRequest via those leads)
enrolments   = count(Enrollment via Student via those leads)
revenue      = Σ Income for those enrolments
CPL          = spend / leads          CAC = spend / enrolments       ROAS = revenue / spend
band         = HIGH | LOW  ← vs the median across sources in the period, NOT a magic constant
```

Rendered on **Reports → Attribution**. Storing an `INSIGHT` row would be a cached division.

---

## 9. Track G — Workshops and registrations

**Closes:** `WORKSHOP` (generalised), `WORKSHOP_REGISTRATION`,
`WORKSHOP_REGISTRATION }o--|| LEAD`.

Today `GnWorkshop` has `name` + `month` + `status`; attendance is an **integer** on the ad
set; only *converted* people get a row, and that row does not link to a `Lead`. So
"who attended and didn't buy, and can we re-target them" is unanswerable — which is
precisely the follow-up motion the pipeline has a `SENT_TO_WORKSHOP` /
`WORKSHOP_FOLLOWUP` stage for.

```prisma
model Workshop {                  // was GnWorkshop, renamed gn_workshop → workshop
  …existing…
  line             BatchLine @default(GERMAN_NOTE)
  landingPageUrl   String?
  whatsappGroupLink String?
  scheduledAt      DateTime?
  registrations    WorkshopRegistration[]
}

model WorkshopRegistration {
  id         String @id @default(cuid())
  workshopId String
  leadId     String?                       // SetNull — a registration outlives a merged lead
  name       String
  email      String?
  phone      String?
  registeredAt DateTime @default(now())
  attended   Boolean @default(false)
  attendedAt DateTime?
  source     Source @default(NATIVE_FORM)
  @@unique([workshopId, leadId])
  @@index([workshopId, attended])
}
```

**Flow:** registration form (a native `Form`, no new builder) → `lib/lead-intake.ts` idempotent
upsert (the *same* path the webhooks use — `source = NATIVE_FORM`) → `Lead` +
`WorkshopRegistration` → attendance marked in bulk from the panel → `GnWorkshopConversion`
gains `registrationId` so the P&L rollup can finally say "N attended → M converted" from
rows rather than a typed-in integer.

---

## 10. Track H — Placement: JD, CV linkage, match

**Closes:** `JOB_DESCRIPTION`, `STUDENT ||--o{ CV`, `CV_JD_MATCH`,
`JOB_APPLICATION` FKs to CV + JD.

```prisma
model JobDescription {
  id String @id @default(cuid())
  title String  company String  location String?  url String?
  language String @default("EN")
  text     String
  createdById String?
  createdAt DateTime @default(now())
  applications JobApplication[]
  reviews      ResumeReview[]
}

model Resume         { studentId String?  student Student? @relation(…, onDelete: SetNull) }   // NEW
model ResumeReview   { jobDescriptionId String?  jobDescription JobDescription? @relation(…) } // NEW; jdText stays as the frozen snapshot
model JobApplication { resumeId String?  jobDescriptionId String? }                            // NEW
```

`ResumeReview` **is** `CV_JD_MATCH` (`scoreOverall` 0–100 + `result` JSON suggestions). It
gains an optional JD link; `jdText` stays as the snapshot because a JD can be edited and the
review must show what was actually matched.

**AI constraint:** the review runs through `lib/anthropic.ts` (raw HTTP, keys-off) and
**must** degrade to the deterministic analyser. A model never writes a permissioned field —
`scoreOverall` is advisory, and `JobApplication.status` stays human-set.

---

## 11. Track I — Program milestones

**Closes:** `MILESTONE` (per-program, with `target_day`), `MILESTONE_PROGRESS`.

```prisma
model ProgramMilestone {
  id String @id @default(cuid())
  levelCode String                     // Level.code — per program, as the diagram wants
  key       Milestone                  // reuse the existing 7-value enum as the stable key
  name      String
  targetDay Int                        // day-N of the 90/120-day tracker
  orderIndex Int @default(0)
  active    Boolean @default(true)
  @@unique([levelCode, key])
}

model MilestoneProgress {
  id String @id @default(cuid())
  enrollmentId String
  milestoneId  String
  status  MilestoneProgressStatus @default(NOT_STARTED)   // NOT_STARTED | IN_PROGRESS | ACHIEVED
  achievedAt DateTime?
  @@unique([enrollmentId, milestoneId])
}
```

`Enrollment.currentMilestone` and the append-only `MilestoneLog` **stay** — the log is the
audit trail and nothing may weaken it. `MilestoneProgress` is materialised on enrolment
(one row per active milestone for that level) and updated by the same action that writes
`MilestoneLog`, so "is Priya on track for day 45" becomes answerable without replaying the log.

`targetDay` vs `enrollmentDate` gives the at-risk radar a real deadline instead of a vibe.

---

## 12. Track K — Zoom (deferred)

Build **only** alongside a real Zoom/Google Calendar integration:

```prisma
model ZoomMeeting {
  id String @id @default(cuid())
  provider String @default("zoom")
  externalId String? @unique
  joinUrl String  startUrl String?  calendarEventId String?
  hostUserId String?
}
```

linked from `BookingRequest`, `SssSlot`, `Session`. Until the integration exists, a nullable
FK pointing at nothing is worse than the string that at least holds a working link.

---

## 13. Sequencing

```
      ┌─ Track E (enrollment FKs) ──────────────┐  low risk, unblocks attribution
      │                                          │
Track A (Batch) ─┬─ Track B (Sessions/Tasks) ────┤
                 └─ Track C (TutorFee + P&L) ────┤
                                                  │
      ┌─ Track F (MarketingSource/AdSpend) ──────┤
      └─ Track G (Workshop/Registration) ────────┤   F and G share the attribution story
                                                  │
Track D (Qualification) ──────────────────────────┤   independent; longest cutover
Track H (JD/CV) ──────────────────────────────────┤   independent
Track I (Milestones) ─── needs E ─────────────────┘
```

**Suggested order:** E → A → C → G → F → B → I → D → H. D is last despite its value because
its shadow-scoring window should run over as much real traffic as possible, and because
nothing else depends on it.

Each track is independently shippable and independently revertible. No track leaves the
database in a state where the previous deploy would fail — that is what the expand/backfill/
contract discipline in §1.7 buys.

---

## 14. Definition of done, per track

A track is done when **all** of these are true:

1. Migration applied to Supabase via `DIRECT_URL`, with the generated SQL read by a human
   first (especially any `RENAME`).
2. Backfill script run, its unresolved-rows report **empty or explicitly signed off**.
3. Pure rules live in `src/lib/*.ts` with `node:test` coverage that runs with no database.
4. Every new server action has: an rbac guard, a zod schema, `logActivity`, `revalidatePath`.
5. New capability keys added to `lib/capabilities.ts` *with* their guards.
6. Any new ledger posting is behind a `financePosting.*` flag defaulting to `false`, and
   `prisma/verify-ledger.ts` still passes.
7. Soft-delete or `active` handling decided and filtered **explicitly** at every read site.
8. Browser-verified against a **local** Postgres (`scripts/local-db.mjs start` on :5435 — the
   Docker DB is gone; never `docker compose up -d db`), not against Supabase.
9. `Required_Document/B2Consultants_ER_Diagram_v2.mermaid` updated to match what was actually
   built — including the entities we declined, annotated with why.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| **BANT scoring changes silently** (Track D) | Shadow-score + full historical replay must show **zero** disagreements before the form flips. §6.2 step 3 is a hard gate. |
| **`gn_batch` → `batch` rename loses GN data** | Raw `ALTER TABLE ... RENAME`, never Prisma's drop-and-create. Read the generated SQL. Snapshot the table first. |
| **Live Supabase, no rollback** | Expand/backfill/contract in three deploys. Nothing destructive in the same deploy as anything additive. |
| **Backfill guesses wrong** (Tracks A, E, G) | Every backfill leaves ambiguous rows **null** and prints them. Manual resolution in the UI. Never a heuristic match on money or contracts. |
| **Two batch worlds becomes three** | D1 must be answered "unify" before any code is written. |
| **Tutor fee double-counted** | The accrual (`Cr Accounts payable`) and the cash payment (`Expense`) hit different accounts. `verify-ledger.ts` must be extended with an assertion for this before the flag is switched on for anyone. |
| **Scope creep into a rewrite** | Every track is additive. No track moves an existing FK, drops a column in its first deploy, or changes a read path's semantics without a shadow period. |
| **None of this ships** | The app has no public deployment and 23k leads with near-zero contact. **This plan is worth less than deploying and adopting what already exists** — see `docs/ROAD_TO_10.md`. Sequence it behind that, not in front of it. |
