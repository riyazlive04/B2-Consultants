# Flow refactor — changelog

Everything the refactor changed, 23 October 2026. Phases 1–4 produced
[01](./01-inventory.md)–[04](./04-refactor-plan.md); this records phases 5 and 6.

**Migrations applied: none, and none planned.** Both new lifecycles — the onboarding journey and
cohort readiness — are derived from existing columns on every render, so there is no schema change
to roll back and nothing to backfill.

---

## 1. Before and after, per flow

### Seating learners into a cohort — the founder's own example

| | Before | After |
|---|---|---|
| Where learners are added | each student's own record, one enrolment at a time | **the cohort's Roster tab**, as many at once as you like |
| Page loads to fill a 12-seat cohort | ~26 | **1 screen, 1 dialog** |
| What the empty Roster said | *"Seat students into this cohort from the Students board"* — un-clickable, and that board has no such control | the control itself |
| Can you tell if a cohort is ready to teach? | no | **yes** — a five-item checklist, each unmet item linking to its remedy |
| Starting a cohort | no such moment; a cohort was "active" from the instant it was saved | **Start cohort**, disabled with the reason on it until a plan, a teacher and a learner exist |
| Capacity rule | two checks disagreed — one counted members, the other members + seated enrolments | **one rule** (`seatCount`), used by both |

### Following one person from enquiry to class

| | Before | After |
|---|---|---|
| Screens to follow one person's progress | ~15 across 6 nav groups | **1** (`/onboarding`), or the rail on their own record |
| Screens showing where somebody has got to | **0** | the board, both person pages, and the wizard |
| Ways to find half-built records | **none** | the **Needs completing** tab |
| Doors to "add a student" | 6, in 4 nav groups, none of which said what to do next | **1 guided flow** (`/onboarding/new`); the other 6 still work and now feed the same board |
| Prompt at the sales → contract seam | a notification-bell item | on the rail, in context |
| Learnable from inside the app? | Agreements, Batches, Bookings, Contacts, Outreach, My Desk and Payments had **no guide entry at all** | **every section documented**, plus 6 cross-section walkthroughs |

### Knowing why a screen is empty

| | Before | After |
|---|---|---|
| A disarmed engine says so | only on Console → System → Not armed | **on the screen it affects**, with what is not happening and where to switch it on (8 screens) |
| Engine copy lives | once, in `server/not-armed.ts` | once, in `lib/engines.ts` — read by both consumers, with a test that fails if either stops reading it |
| Setup dead-end empty states | 20 of them described the fix in prose and offered no way to do it | **13 now carry the control**; the 5 genuine waiting states are named as deliberate |

---

## 2. Features removed

Each removed on explicit instruction, 23 October 2026.

| Feature | What went | What survives |
|---|---|---|
| **CV Studio** (G1) | all 4 routes, the API endpoints, the analysis libs, the document renderers | `Resume` / `ResumeReview` / `JobDescription` tables |
| **Automation** (G2) | the 4 builder routes and their components, `automation-actions`, `automation-metrics`, both dry-run modules | **the trigger engine**: `server/automation.ts`, `automation-queue.ts`, `lib/automation-quiet-hours.ts`, `lib/automation-types.ts`. The cron and 5 action modules still call `emitTrigger` |
| **Ledger screen** (G3) | the route and the 3 page-only read wrappers | **the whole posting engine.** Six modules still post through it; `getTrialBalance`, `getJournal` and `verifyAuditChain` still exist in `ledger-core.ts` |

**39 files deleted. No table dropped, no column removed, no data touched.**

One judgement call inside G2: `/automation/stage-messages` was about to be deleted with the rest,
but `runStageMessages()` fires on every outreach cron run and `lead-intake.ts` calls
`announceReturningOptIn` from the same module. That page was its only editor and there is no
Console panel for it. It was **re-homed to `/whatsapp/stage-messages`**, re-gated on the
`whatsapp` section, with a link added on `/whatsapp` — rather than silently breaking outbound
messaging that reaches real phone numbers.

**What the Ledger removal costs, stated plainly:** there is no longer any way to read the journal,
the trial balance, or the `AuditEntry` hash-chain verification from inside the app.
`verifyAuditChain` had no other caller, so the audit log's tamper-evidence is now unverifiable
through the UI. The functions remain callable from a script or a future screen.

---

## 3. Features merged or re-homed

| Before | After | Why |
|---|---|---|
| "Pipeline" in the nav opened `/opportunities` | **Pipeline → `/pipeline`**, and the deal board is its own entry called **Deals** | The nav entry was gated on `pipeline` while the route it opened ran `requireSection("opportunities")`. A founder who split the two produced a visible nav item that refused to open |
| `opportunities` was `offRail` | back on the rail as **Deals** | It was off the rail to avoid a duplicate door; once Pipeline pointed at `/pipeline` there was no duplicate left |
| Students → Batches tab mounted `BatchesManager` | **removed**; `/batches` is the only home | The same component was mounted twice over one set of cohorts. Also removes one query from every Students page load |
| `/automation/stage-messages` | `/whatsapp/stage-messages` | See above |

**Labels changed** (the section *keys* did not, so no saved access configuration was disturbed):
"Opportunities" → **"Deals"** in the nav, the page title, the page heading, the command palette
and the report object list.

---

## 4. Routes redirected

Bookmarks were preserved rather than broken.

| Old | New | Mechanism |
|---|---|---|
| `/students?tab=4` (the Batches tab) | `/batches?tab=0` | server redirect, ADMIN only — the tab never existed for anyone else |
| `/students?tab=batches` | `/batches?tab=0` | same |
| `/students?tab=5` (Import, which shifted down) | `/students?tab=4` | same |

**Deliberately not redirected:** `/german-note/members` → `/german-note/manage`. The plan proposed
it, and the code says otherwise — the first is a participant-facing community directory, the second
is an admin membership editor behind `requireAdmin()`. Redirecting would have sent tutors and
students to a screen that refuses them.

Also deliberately not merged: the two German Note cohort editors. `/german-note/manage` → Batches
uses its own `createBatch`/`updateBatch` (tutor-role-restricted, no dates or codes);
`/batches?tab=1` uses `upsertBatch` (dates, codes, any active team member as lead). Collapsing
them would quietly widen who may lead a German Note cohort, which is a product decision, not a
refactor. A cross-link was added instead, and the duplication is recorded.

---

## 5. New, added

| What | Where |
|---|---|
| **Onboarding board** — in flight / needs completing / stuck / reached class | `/onboarding` |
| **Guided flow** — one door, resumable, derived | `/onboarding/new` |
| **Journey rail** — where this person is, on their own record | `/contacts/[id]`, `/students/[id]` |
| **Cohort setup checklist** + **Start cohort** gate | `/batches/[batchId]` |
| **Writable Roster** — add many learners from the cohort | `/batches/[batchId]?tab=2` |
| **Cohort state on the board** — Draft / Ready to start / Completed, with what is missing | `/batches` |
| **"This is switched off" notices** | Bookings, WhatsApp, Agreements, Attendance, Payments, Finance, Pipeline, Students |
| **Role homes** for USER and TUTOR | `/` redirects |
| **Screenshot capture script** | `npm run guide:shots` |

### New modules

| Module | Kind | What it holds |
|---|---|---|
| `lib/journey-state.ts` | pure | 10 steps, 7 gaps, `LOST`, 13 next-action targets |
| `lib/journey-links.ts` | pure | the only place journey route strings live |
| `lib/engines.ts` | pure | all 16 engines' name, consequence and where-to-arm |
| `lib/batch.ts` (extended) | pure | `seatMechanism`, `seatCount`, `batchBlockers`, `activationBlockers`, `batchReadiness`, `canActivateBatch` |
| `server/onboarding-metrics.ts` | read | the board in a fixed 5 queries; one person's journey in 4 |
| `server/engine-status.ts` | read | per-screen engine checks, cached config only |
| `server/batch-seats.ts` | write | a **dispatcher** over the two existing seating actions, not a third writer |
| `server/batch-detail.ts` (extended) | read | readiness, blockers, `canActivate` — **zero extra queries** |

---

## 6. Bugs found and fixed on the way

None of these were the task; all were found by doing it.

| # | Bug | Found by |
|---|---|---|
| 1 | **Latent infinite redirect.** `/dashboard` denied → `/?denied=dashboard` → `/` redirects STUDENT to `/dashboard` → … Switching `dashboard` off for students would have bounced every student until the browser gave up. Fixed with a loop guard | writing the role homes |
| 2 | **`?denied=` was being swallowed** through role redirects, so a refused page silently bounced a telecaller to their desk with the reason stripped | same |
| 3 | **Two capacity checks disagreed over one column.** `seatEnrollment` counted members + seated enrolments; `claimSeat` counted members only, so a full German Note cohort would admit a ninth person with no warning. Unified in `seatCount()`; **live checked before shipping — all 20 German Note cohorts hold zero seated enrolments, so no live cohort's answer changed** | writing the seat rule |
| 4 | **A client component depended on a `server-only` module** — `SeatPicker` imported a type from `batch-detail.ts`. It worked only because `import type` is erased | the boundary scan |
| 5 | **`claimSeat` could suggest a cohort from the wrong business.** Its "next with room" query filtered on `level` but not `line`, which the one-table `Batch` unification made possible | writing C4 |
| 6 | **`tsconfig.json` had accumulated dead `include` paths**, which its own comment says to delete | `git diff` |
| 7 | Two misleading pointers on the cohort page; `/funnel`'s browser tab disagreeing with its nav label; `/my-desk`'s no-profile dead end with no way out; a garbled sentence on the timetable panel | reading the files |

---

## 7. Tests added

| File | Covers |
|---|---|
| `sections-structure.test.ts` | every section's href resolves, no two sections share a page, group sizes, **every section has a guide entry** |
| `batch-readiness.test.ts` | the five prerequisites, the three activation gates, the German Note exemption |
| `journey-state.test.ts` | steps reached by evidence, gaps outranking progress, out-of-order journeys |
| `engines.test.ts` | the 16 engines' shape, and that **both** consumers still read the registry |
| `empty-states.test.ts` | the 13 dead ends carry an action; the 5 waiting states carry an explanation |
| `onboarding-stages.test.ts` | the wizard's 6 stages cover the journey's 10 steps exactly once, in order |

**1,942 pass / 0 fail / 1 skipped** (the skip is the ledger integration suite, which needs
`LEDGER_TEST_DATABASE_URL`). Baseline before the refactor was 1,863.

---

## 8. Counts

| | Before | After |
|---|---|---|
| Pages | 77 | 74 |
| Nav sections | 38 | 35 |
| Files | — | **39 deleted**, 14 added |
| Migrations | 111 | **111** |
| Tests | 1,863 | **1,942** |
| Lint | clean | clean |
| Typecheck | exit 0 | exit 0 |

---

## 9. What was not verified

- **`next build` has not been run against this tree.** It OOM'd four times on a machine with
  ~500 MB free. The substitute was a repo-wide boundary scan: **0** non-async exports across the
  `"use server"` files, **0** client components value-importing a `server-only` module — the two
  things a build uniquely catches here. **Run a real build before deploying.**
- **No write has been executed against real rows.** Seating, the over-capacity prompt, the
  Activate gate and the capability refusals are proven by unit tests over the pure rules, not
  against data. They need either the local Postgres stack or a founder's hands.
- **The guide's screenshots have not been captured.** `npm run guide:shots` is written and its
  `--list` output verified, but it refuses to run against a non-local host by design: the images
  ship inside `public/`, so capturing them against live Supabase would publish real clients'
  names, numbers and fees. One local run with seeded data will produce all 18.

---

## 10. Round two — the structural problems (23 October 2026)

Of the 23 ranked problems, 15 were closed in the first pass. This round took the remaining 8.
**Five are now closed in code. Four need a schema change and are written up as reviewable
migrations in [`migrations/README.md`](./migrations/README.md) — none applied.**

### Closed in code

| # | What was wrong | What was done |
|---|---|---|
| **P4** | One deal, two status fields. 17 sites wrote `Lead.stage` and each had to remember to update the column, write history AND move the board card. **Two forgot the card** — `booking-automation.ts` and `outreach.ts` released an unconfirmed booking and left its card sitting in "Discovery Call Booked", claiming a call that had just been cancelled | One `writeLeadStage` seam does all three. Both bugs fixed. `lead-stage-writers.test.ts` fails if any file writes a stage without touching the board or its history |
| **P18** | `batches.manage` gates seating, is grantable to a head coach, and `/batches` — the only screen with a roster — was `requireAdmin()`. The grant could be given and never acted on | The section opens to HEAD; the page reads what you may *do* off the actions that will run. No create form, no edit/delete, no Plans tab for a non-admin. A visitor with neither admin nor the capability is bounced rather than shown a shell |
| **P1** | Two membership mechanisms, so every "who is in this batch" feature is written twice | The pure merge and the `BatchSeat` shape moved into `lib/batch.ts`; `server/batch-membership.ts` is the read seam (and now owns `listSeatCandidates`). `batch-membership.test.ts` names every module still reaching past it, and that list may only shrink |
| **P0b** | Six doors create a student and four ran the money backfill by hand. Three linked **income only**; the fourth also linked the **receivable** — so a converted lead's instalment plan stayed detached and "paid so far" read zero against a plan they had been paying for months | One `linkOrphanMoneyToStudent` does both halves, for every door. `nameKey` — which decides whose money is whose, and was defined **six** times identically — is now one function in `lib/name-key.ts` |
| **P16** | 45 bell items across 17 destinations, and **nothing at all** about cohort setup | A cohort with learners seated in it that still cannot teach now raises an item. Deliberately narrower than "every draft cohort": an alarm that is always on is an alarm nobody reads |

### Closed by making the fact visible

| # | What was wrong | What was done |
|---|---|---|
| **P10** | Marking a register is private; **publishing** is what fires the absence notices and moves every percentage. My Teaching — the screen a coach lives on — said nothing, so a marked-but-unpublished register looked exactly like a class nobody taught | A banner on My Teaching, suppressed when the founder has switched the publish step off (then marks are visible immediately and there is nothing to chase) |
| **P11** | `TeamProfile.logVariant` decides which My Desk somebody sees. It is not a role, a section or a capability, so an admin could set everything right and hand over a login that lands on a dead end | The access dialog now states whether a team profile is linked and which desk it produces, and links to the tab that owns it. Read-only there on purpose — the Team tab holds far more of that profile |
| **P17** | Two teaching homes, neither linking to the other | Cross-links both ways, each drawn only for somebody whose access would let them through |

### Re-examined and deliberately not "fixed"

| # | The finding | What the code said |
|---|---|---|
| **P9** | `LevelsPanel` mounted twice | **A false positive.** `/programs` renders the B2 half and `/german-note/manage` the German half — two datasets, one home each, documented as deliberate |
| **P9** | `CurriculumPanel` mounted twice | Genuinely the same component over the same data — but the inventory itself calls it "not a drift risk… pure navigation cost", and that screen's design note says plan + cohort + dates in one sitting was deliberate for the founders' workflow. **I removed it, then put it back**: trading a documented workflow for a tidier label is a bad trade. Both tabs now say they are the same list |
| **P6** | "A programme" spread over three screens | **Already solved.** `LevelsPanel` writes the price into the same `Product` row Payments → Products edits, so level + price + curriculum already share `/programs`. Only the missing foreign key remains, and that is migration **M2** |

### What the live audit found

`npm run migration:audit` (read-only) runs each proposal's own pre-flight query:

- **M2 is blocked by two real rows.** Two of three curriculum templates hold a level code that does
  not exist: `Guided` (should be `GUIDED`) and **`Gudied30` — a typo**. Neither can be matched to a
  programme by any screen that looks a level up by code, and nothing in the app could tell anybody.
  That is P6's missing foreign key, demonstrated.
- **M3 found zero drift** across 8 board cards — the new seam has held.
- **M4 would create exactly one row.** Live holds 23 cohorts and **zero** `BatchMember` rows, so
  German Note membership is entirely unused today. If that migration is ever going to happen, this
  is the cheapest moment it will ever be.
- **M1's backfill does nothing.** 7 invoices, 1 with a lead, and that lead never became a student.

---

## 11. Still open for the founder

| Question | Why it is not ours to answer |
|---|---|
| Should `batches.manage` and `requireAdmin` really differ? | **Partly answered by P18.** A head coach granted the capability can now open the cohort screen and work a roster, which is what the grant was for. What still differs is German Note: adding a member there is `requireAdmin()`, so the same head coach can seat a coaching client and not a GN learner. Whether *that* should differ is still a product call |
| Should the two German Note cohort editors be merged? | Merging widens who may lead a GN cohort (see §4). Worth noting from the live audit: German Note membership holds **zero rows**, so this is cheaper to settle now than later |
| **M1–M4: which migrations may be applied?** | The four schema changes in [`migrations/README.md`](./migrations/README.md), each with its SQL, its rollback and its measured live impact. M4 additionally needs you to pick **Option A or B** |
| The two bad curriculum level codes | `Guided` and `Gudied30` need correcting to `GUIDED` before M2 can be applied. A 10-minute data fix, but it is your data |
| The permission matrix still asks for a ledger view | The row is kept reporting `NOT_GATEABLE` on purpose, so the spec's unmet ask stays visible rather than vanishing with the screen |
