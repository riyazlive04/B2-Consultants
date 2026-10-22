# Student & Tutor dashboard — implementation plan, and what was built

**Status:** Stages 1–4 **built, typechecked, lint-clean, tests green** (1852 pass / 0 fail). One migration written and validated, **not yet applied to Supabase**. See §0.
**Source:** "App Walkthrough" call, 14 Oct 2026 (61 min) — founders + Karthik + Abdul. The second half (@31:50 → @1:01) is the student/tutor dashboard discussion.
**Goal:** close the gap between what the founders asked for on that call and what the 22 Oct deploy actually shipped.

**Read §0 first** for what is done and what is outstanding. §1 is what already existed. §2 is the design reasoning, with one correction. §2a is the Stage 2 audit the plan required before any schema change. §3 is the staged delivery, annotated with what each stage actually shipped.

---

## 0. State of play

| Stage | What it is | Status |
|---|---|---|
| 1 | Cohort benchmarking + conversion ratio | **Built.** No migration. 19 new tests. |
| 2 | Enrolment lifecycle — the discontinue button, with a reason | **Built.** One additive migration, written and dry-run, **not applied**. 24 new tests. |
| 3 | Student-side submission follow-up | **Built.** No migration. 20 new tests. |
| 4.1 | Timetable as a document (+ calendar feed) | **Built.** 15 new tests. |
| 4.2 | Register escalation at 24h | **Built.** Founder-configurable. |
| 4.3 | Pre-class task prompt | **Built.** 9 new tests. |
| 4.4 | Weekly progress report | **Built.** No migration. 23 new tests. Its *shape* is an assumption — see §3 Stage 4. |

**Outstanding, and each needs a person rather than a commit:**

1. **The migration is not applied, and I could not apply it.** `prisma/migrations/20261022170000_enrollment_discontinue_reason/` adds three nullable columns, one foreign key and one index to `enrollment`. It was dry-run inside a transaction against the local Postgres on `:5435` (21 enrolments read back, then rolled back — nothing changed anywhere), and `prisma migrate status` against live confirms it is the **only** one of 110 migrations outstanding. `npm run db:deploy` was refused by the sandbox as a production deploy; running `npx prisma migrate deploy` instead would be the same action with the wrapper removed, so it was not attempted.

   **Run `npm run db:deploy` yourself, BEFORE shipping the image** — the compose `migrate` service is a separate build and silently ships stale. Nothing in Stages 2 or 4 works until it has run: the discontinue dialog, the churn breakdown and the student record's "stopped on" block all read columns that do not exist yet.
2. **Two of the three Stage 0 items turned out not to need a decision at all** — §3 Stage 0 now carries the answers. What is genuinely still open is the two garbled transcript passages, which need the recording.
3. **`minCohort` ships at 5.** A cohort of fewer than five students will show "not enough students on this cohort yet" instead of an average. If the real cohorts are six to ten, as described on the call, that is right. If any live cohort is four, the founders should see the suppression copy before a student does. The Console can lower it to 3 but no further — §5.1 explains why 3 and not 2.
4. **§3 Stage 4.4's shape wants ten minutes of a founder's attention.** It is read-only over existing data, so reshaping it costs only the rework.

---

## 1. What is already built (do not rebuild)

The call was a walkthrough, so the founders restated a lot that already exists. Confirmed present:

| Asked on the call | Already in code |
|---|---|
| 90-day countdown starts at **sprint start**, not coaching day 1 (@32:59) | [`curriculum.ts:210`](../src/lib/curriculum.ts#L210) anchors `sprintStartYmd` to the last live session |
| Guided 90 / Elite ("LA") 120 days (@34:08) | `CurriculumTemplate.sprintDays`, per level |
| 2 or 3 classes in a week depending on plan (@34:20) | [`CurriculumItem.weekIndex`](../prisma/schema.prisma#L3054) is deliberately not derived from `orderIndex`, precisely so a week can hold two or three |
| Tasks weekly, not daily (@35:51) | `SprintWeek` is the unit |
| Coach assigned **student-wise, not batch-wise** (@35:02) | `Enrollment.coachId` — per enrolment, so per student by construction |
| No student-vs-student by name (@39:55) | [`viewFor`](../src/server/leaderboard.ts) strips names server-side; `visibility: "ANONYMISED"` |
| Wins box — HR connection / HR interview / offer (@47:22) | `SprintLogKind` = `HR_CONNECTION` / `HR_INTERVIEW` / `APPLICATION_REVIEWED` / `WIN` |
| Attendance in the app, off the sheet (@43:54) | Attendance section + self check-in window + publish gate |
| Who has not watched the recording within 24h (@43:54) | [`CatchUpState`](../src/lib/recording-access.ts#L105) `OVERDUE`, driven by `config.catchUpHours` |
| Tutor sets how long recordings stay visible | `RECORDING_ACCESS_DAY_CHOICES` — 7/14/30/60/90/lifetime |
| Journey stages editable, add/update (@17:09) | [`studentJourneySchema`](../src/lib/config-schema.ts), config-driven |

**Per-plan class counts (@34:20, "you need to fix it") is data entry in Console, not code.** The schema already expresses it; somebody needs to enter which plan gets two and which gets three.

---

## 2. Why the remaining four were not one-line changes

### Wrinkle A — the cohort average cannot be computed where you would expect

The founders' central ask (@40:55, @41:29) was to compare a student against the **cohort average**, never against a named classmate. The anonymisation half was built. The average half could not be bolted onto it, because `viewFor` does three things on the way to a student's browser:

- replaces every other student's `name` with `anonLabel(i)` and blanks `studentId` / `enrollmentId`;
- **reduces every other student's `breakdown` to `total` alone** — the per-metric lines are dropped;
- trims the list to `config.topN`.

So by the time the client holds the view, the data an average needs is already gone. That is the privacy design working as intended and **must not be weakened**.

**Built as decided:** the aggregate is computed inside `getLeaderboard`, over the *full* cohort, *before* `viewFor` runs, and carried on `LeaderboardView` as its own field. `viewFor` passes it through untouched.

**Built as decided — minimum cohort floor.** An aggregate normally leaks nothing about an individual, but in a cohort of two, "the cohort average excluding you" *is* one named classmate's score. The comparison is suppressed below a floor (`config.minCohort`, shipping at **5**) and the page says "not enough students on this cohort yet" instead.

Two things were added beyond the plan, both because writing it exposed them:
- the floor is **hard-floored at 2 in the reader as well as the schema**, so no hand-edited `AppSetting` row and no older stored blob can produce an average over one student;
- the floor is **one function** (`cohortPublishable`), asked by both the per-metric averages and the pooled ratio. Two independent floors would have meant one half of the card publishing what the other half hides.

### Wrinkle B — ~~`DISCONTINUED` touches 21 server files~~ **the enum was misread**

**This wrinkle was wrong, and the correction is the most useful thing in this document.**

The plan read [`EnrollmentStatus`](../prisma/schema.prisma#L1807) — `ACTIVE | COMPLETED | FAILED` — and concluded that a fourth value was needed. That enum belongs to **`WorkflowEnrollment`**, the automation table that walks a lead through a workflow. It has nothing to do with students.

`Enrollment.status` is **`StudentStatus`**, and it has carried four values from the beginning:

```prisma
enum StudentStatus { ACTIVE  COMPLETED  DROPPED  PAUSED }
```

So **`DROPPED` already existed**, `statusChangedAt` already recorded when the status moved, and `setEnrollmentStatus` in `students-actions.ts` already set both with a `logActivity` entry. Three consequences:

1. **No enum migration, and therefore no destructive-migration risk.** The plan's fear — `migrate dev` generating a drop-and-re-add for an enum change, as it has in this repo before — does not apply. What shipped is three *nullable columns*: `discontinueReason`, `discontinueNote`, `discontinuedById`.
2. **The finance invariant was already true**, not something to be carefully preserved. No finance path reads enrolment status at all — revenue recognition reads `enrollmentDate` / `programEndDate` / `duration` for *dates*, and dunning filters `pendingPayment.status`. Discontinuing could not void a receivable even before this change. That is now **asserted by a test** (§2a), which is the only way it stays true.
3. **The real gap was never the enum.** It was that DROPPED carried no *reason* (so the churn breakdown the founders asked for in the same breath, @39:42, was a column of nulls), that only an Admin could reach it (not the coach who knows), and that several call sites did not filter it at all.

**Built as decided — discontinuing is not a refund.** §8 of the agreement is explicit that withdrawal earns no refund, so a student who walks away still owes the instalments they signed for. That sentence now appears on the discontinue dialog, on the student record and in the Console panel, because the coach pressing the button is reasonably worried it cancels an invoice.

### Wrinkle C — the conversion ratio is not a leaderboard metric

The founders also asked for a ratio: applications + networking → interviews (@40:55, @42:09). It does not fit `LeaderboardMetric`, which is a *scoring* type — `defaultPoints` × count, capped per week by `defaultWeeklyCap`. A ratio has no units, cannot be capped and cannot be summed. Adding a key to `LEADERBOARD_METRIC_KEYS` would feed a meaningless number into `scoreStudent`.

**Built as decided:** the ratio is an **insight shown beside the board, not a scored metric in it.** Same server pass, separate field, no change to `scoreStudent`.

Three decisions the implementation forced, each documented at its call site:
- the ratio is computed from the **raw** counts, not the capped ones. The cap exists to stop a self-reported quantity box dominating a *ranking*, and this is not a ranking: a student who really sent 300 applications for one interview has a 0.3% problem, and capping the denominator at 25/week would report it as 4% — flattering, and the opposite of the coaching signal the question was asked to get;
- an empty denominator is **null, never 0%**. "You reached out and nothing came back" is a problem to work on; a student who has not started must not be told that about themselves;
- the cohort figure is **pooled, not averaged**. Averaging each student's percentage would give a student with four applications the same weight as one with two hundred.

### Wrinkle D — `SprintStatus.PENDING` already means two different things

`SprintStatus` is `PENDING | ACHIEVED | MISSED`, and `PENDING` covered both "the student never submitted" and "submitted, coach has not judged it". `notifications.ts` already worked around this with `status: "PENDING", actual: { not: null }`, and `SprintCheckIn.tsx` had its own copy of the complementary test — **twice, in two arms of one expression, and an earlier version had it on only one of them.** That was a live bug: a week whose target was prose stayed PENDING after the student answered, so the form reopened empty, and a second submission silently replaced the first. Nobody saw either.

**Built as decided: derive, do not migrate.** `actual == null` is the test, promoted into one named predicate in `lib/sprint-check-in.ts` and used from all four ends — the coach's queue, the student's form, the submit action's guard, and the desk's column. No new enum value, no migration.

Finding, while doing it: the coach's "sprint check-ins overdue" notification filtered on `status: "PENDING"` alone, so it counted the weeks a student **had** answered and told the coach "the actual has not been recorded" — untrue of exactly those rows, which were also being reported a few lines below as "waiting on you". One week, two contradictory descriptions. Fixed by the same predicate.

---

## 2a. The Stage 2 audit

The plan required this before touching the schema: every server file that queries enrolments, and whether a departed student belongs in or out. 21 files query `prisma.enrollment`. The useful split is not per file but **per question**, because the same file answers more than one.

| Question | Correct answer | Was it right? |
|---|---|---|
| **Does a dropped student still owe money?** `revenue-recognition`, `instalment-settlement`, `dunning`, `payments-metrics`, `finance-posting`, `finance-autopost` | **YES — in.** §8: withdrawal earns no refund. | ✅ Right already, and right *by construction*: none of these reads enrolment status. Now asserted by a test. |
| **Did the sale happen?** `funnel-metrics` (enrolments by date), `annual-metrics` (opening balance), `batchPnl` revenue | **In.** Money received stays received; a sale that later churned was still a sale. | ✅ Right. `annual-metrics` already handled DROPPED explicitly. |
| **Is the student on the leaderboard?** `leaderboard.ts` | **Out.** | ✅ Already filtered `status: "ACTIVE"`. |
| **On the coach's caseload?** `coaching-desk` students, `notifications` | **Out.** | ✅ Already filtered. |
| **Able to check in to a class?** `attendance-checkin` | **Out.** | ✅ Already filtered. |
| **In the active-student counts and the 90/120 tracker?** `students-metrics` | **Out** of the active set, **in** the lifetime set. | ✅ Already right. |
| **On the REGISTER for a class?** `attendance.getAttendanceSheet`, `getBatchAttendance` | **Out of future registers, IN on any register that already has a mark for them.** | ❌ **Was wrong — fixed.** Neither read filtered status, so a coach was asked every Saturday to mark a student who had stopped coming and the register could never read "complete". |
| **Occupying one of the cohort's seats?** `batches` (×2), `batch-detail`, `coaching-desk` | **Out.** | ❌ **Was wrong — fixed.** `_count: { enrollments: true }` was unfiltered, so a cohort of ten that lost two read as ten of ten — *full* — and the capacity band refused the replacements the founders had already sold. |
| **On the batch roster a coach reads?** `batch-detail.roster` | **In, with their status shown.** | ✅ Right. A coach opening a cohort needs to see who left. Only the *seat count* over that list was wrong. |
| **Counted as a seat in the batch P&L?** `tutor-fees.batchPnl` | **In.** Left deliberately. | ✅ Right. They paid, and the tutor taught them; a P&L that forgot them would understate both sides. |

Two rules came out of this, each named once in `lib/enrollment-lifecycle.ts` so the 21 call sites ask rather than re-decide:

- **`occupiesSeat(status)`** — false for DROPPED and COMPLETED, true for ACTIVE and **PAUSED**. A paused student is coming back; their seat is theirs.
- **`belongsOnRegister(status, hasMark)`** — the subtle one, and the reason it is a function rather than a query filter. A student who dropped in week six *attended* weeks one to five. Filtering them out of the roster would have removed their marks from those sheets and from the `markedCount` / `complete` figures computed from them — quietly rewriting the history of a class that was taught. So a departed student stays on any register that already has a mark for them, and comes off the ones that do not, which is exactly the future.

**PAUSED behaviour was deliberately left alone.** Every existing call site filters `status: "ACTIVE"`, so a paused student is already off the desks; the registers already showed them, and they still do. Changing that would have been a second, unasked-for behaviour change riding along inside this one.

---

## 3. Staged delivery, as built

### Stage 0 — run down, and two of the three dissolved

1. **CV Studio — NOT a code conflict. One toggle, no deploy.** ✅ resolved

   `resolveSections` reads `enabled: locked ? true : (s?.enabled ?? !hiddenByCode)`. A code-hidden section ships off, and an explicit `enabled: true` saved from **Console → Sections** overrides that default — `offRail` is cleared in the same breath, so the link returns to the nav rather than the route opening with no way to reach it. So there is nothing stale in the code and nothing to deploy: if the founders want students in CV Studio, they switch it on in Console and it stays on.

   That rule was load-bearing for the decision and **was untested**, which is why the answer felt risky. It now has seven tests in `lib/__tests__/sections.test.ts`, including that a saved row for a *different* section cannot switch it on by accident, that nobody — not even ADMIN — reaches it while hidden, and that enabling it does not hand it to USER, who is not on its role list.

2. **Per-plan class counts — confirmed pure data entry, with one trap worth knowing.** ✅ resolved

   Where: **Programs → Curriculum**, or **Batches → Plans** (the same `CurriculumPanel`, two doors). A week holds however many rows carry its Week Nr; `planTimetable` emits one session per row and passes `weekNumber` straight through. No code is involved in making a week hold two or three.

   **The trap:** `strictlyAfter` never places two sessions on the same date — deliberately, so a week with two Saturday rows cannot double-book. The consequence is that the second Saturday row is dated **a week later while its Week Nr still says the earlier week**, and the student's timetable groups by Week Nr while the register and the weekly report bucket by date. So: give every class in a week its own day.

   **And it is not cosmetic.** The sprint starts at the date of the LAST live session — Annexure A has it commencing immediately after the final Q&A rather than at a fixed offset — so adding a third class to the final taught week **moves the sprint start, the 90/120-day clock, and the window the leaderboard counts over.** Four tests in `lib/__tests__/curriculum.test.ts` pin all of this, including the spill and the sprint-start shift.

3. **Two garbled passages — still open, and genuinely needs the recording.** ⬜

   @43:32 (recordings vs attendance) and @49:26 (averages for a sales call). There is no transcript in the repo and I have no audio, so there is nothing here to work from. Thirty seconds of re-listening each still beats inferring a requirement — and @49:26 is the one that might change Stage 1, since "averages for a sales call" could mean a figure for the *sales* team rather than the cohort benchmark that was built.

### Stage 1 — cohort benchmarking + conversion ratio ✅

Purely additive: no migration, and no change to any existing number.

- `lib/leaderboard.ts` — `cohortPublishable` (the floor, in one place), `cohortAggregate` (mean **and** median per enabled metric), `benchmarkAgainst` (per-metric delta), `conversionRatio`, `cohortConversionRatio` (pooled). Pure and dependency-free, like the rest of that file.
- `server/leaderboard.ts` — both computed in `getLeaderboard` across the full cohort; `aggregate` and `cohortRatio` on `LeaderboardView`, a per-row `ratio` stripped by `viewFor` exactly as `breakdown` is.
- `app/(app)/leaderboard/_components/CohortBenchmark.tsx` — "you vs cohort average" for a student, cohort averages for staff, the ratio as an insight line, and the suppression copy below the floor. Rendered rather than hidden, so a coach who set the floor can see that the floor is what they are looking at.
- `console/_components/LeaderboardPanel.tsx` — "Average needs _N_ students".
- `lib/__tests__/leaderboard-cohort.test.ts` — 19 tests: the floor at 0/1/2/4/5, both halves refusing together, the mean/median split on an outlier, the average over the *capped* figure, the zero denominator, and the pooled-not-averaged ratio.

Mean and median both ship because one student with an offer (200 points) moves an eight-person mean by 25 on its own, and a student reading only the mean would conclude they were behind a cohort that is mostly level with them.

**Unchanged, as promised:** `scoreStudent`, `rankRows`, the metric catalogue.

### Stage 2 — enrolment lifecycle ✅ (the only migration)

1. **Audit first** — §2a above, written before the schema was touched.
2. **Schema:** three nullable columns on `enrollment` plus a `SET NULL` foreign key and one `(status, discontinueReason)` index. Hand-written migration; **no `ALTER TYPE`** (see Wrinkle B). No `discontinuedAt` — `statusChangedAt` is the one clock, and a second would be free to disagree with it.
3. **`lib/enrollment-lifecycle.ts`** — the predicates, the shipped reason vocabulary, `decideDiscontinue` (validates against the configured list; refuses an off-list reason rather than storing it, so the breakdown stays totalable) and `tallyReasons`.
4. **Console → "Why students stop"** — founder-editable reasons, an "Other → free text" switch, and `coachMayDiscontinue`. Removing a reason stops it being *offered*; it does not rewrite the enrolments already carrying it.
5. **`discontinueEnrollment` / `restoreEnrollment`** — reason required, `logActivity` on both, reversible, and authorised per enrolment: Admin and Head always, the owning coach when the founder allows it. Deliberately not "any coach" — a supervisor's desk lists every active enrolment, and seeing a caseload is not the right to end someone else's student's programme.
6. **The coaching desk** — the button on the student's row, plus a **"Recently stopped"** list (30 days) with the reason beside each name and a "Put back". Without that list a coach who pressed the wrong row had nowhere to go: the student had vanished from the only screen they can reach. The list sits *outside* the empty-caseload branch, because a coach whose last student just left has an empty caseload and the most urgent reason to be there.
7. **The churn breakdown** (@39:42) — on the Students board, in the "Dropped this month" and "Enrolled all time" popups, computed from rows that pass was already reading. Both windows, because one month of churn on a business this size is an anecdote.
8. **The call-site fixes** from §2a — seats and registers.
9. `lib/__tests__/enrollment-lifecycle.test.ts` — 24 tests, including the **structural assertion that no finance file reads enrolment status.** There is no type that can express "this file must not branch on enrolment status", so the test reads the files. If it ever fails, read it before fixing it: it is the thing standing between a coach pressing Discontinue and a receivable quietly disappearing.

### Stage 3 — student-side submission follow-up ✅

- **`lib/sprint-check-in.ts`** — `checkInState` returns one of `NOT_STARTED` / `AWAITING_STUDENT` / `OVERDUE` / `AWAITING_COACH` / `JUDGED`, and the two Prisma filters (`AWAITING_COACH`, `UNANSWERED`) that are the query form of the same question. Used by the coach's notifications, the student's bell, the student's form and the submit action's guard — which replaced **three** separate guards with one.
- **The student is now nagged**, which they never were: an open week is an invitation, an overdue one is a different request, and the form re-labels its note field to **"What got in the way?"** on an overdue week. Same field, same `SprintWeek.note`; a second form would be a second place for the answer to land.
- **The IST day now comes from the server** (`StudentPortal.todayKey`). The component compared against `new Date()`, which is the browser's clock in the browser's timezone — a student opening the app from Berlin at 9pm is already on the next IST day, and would have been shown a different week than their coach was being nagged about.
- **`unansweredStreak` + `isConcerning`** (3 weekends) — the end of the ladder. It surfaces a pill on the coach's desk, in the row that holds the discontinue button. **Nothing auto-discontinues**; the founders were explicit that the stage move stays manual (@37:54).
- The desk's sprint column now says **whose move it is** — "your verdict" vs "unanswered since 12 Oct" — and the banner counts the two separately instead of adding them together and calling the total "waiting on you".
- 20 tests, including that the two Prisma filters still say the same thing as the two predicates. Nothing in the type system ties an object spread into a `where` clause to a function beside it; that test is the tie.

### Stage 4 — four small surfaces

- **Timetable as a document** (@15:36, @16:33) ✅ — `documents/timetable-pdf.tsx` + `api/classroom/timetable/[batchId]`, built on `@react-pdf/renderer` which already drives the agreement, invoice and offboarding PDFs. **No join links on it**, deliberately: the file gets printed, forwarded and mailed, and a Zoom URL in it is a door into a live class for whoever ends up holding it. The route never queries the requested batch — it loads the *reader's* own classroom and looks for the cohort inside it, so a batch id in a URL is never authorisation, and a student who is not in it gets a 404 rather than a 403.
  The plan called an `.ics` feed "the cheaper cousin and worth offering alongside", so it ships too, as `?format=ics` on the same route — a query parameter rather than a second route specifically so the permission check cannot be implemented twice and drift. `lib/ics.ts` is hand-written (the whole format needed here is six properties and three escaping rules; a dependency for that would be a supply-chain surface for forty lines) and carries 15 tests over the exclusive all-day `DTEND`, the escape order, and octet-counted folding that will not split a multi-byte character.
- **Register escalation at 24h** (@43:54) ✅ — as the plan noted, the existing reminder is already *stricter* than asked: it fires as soon as a taught `LIVE` session has no attendance rows. So this is not a new reminder, it is the **second rung**: past `registerEscalationHours` (founder-editable, default 24) the same item changes its wording, goes to `risk`, sets `escalated` and says what it costs — until the register is marked, those students have no attendance percentage and the drop-risk signal cannot see them. One item with two rungs, not two items: the stale classes are a *subset* of the unmarked ones, and two counts would overlap in a way nobody reading a bell can reconcile.
- **Pre-class task prompt + notify** (@46:34) ✅ — `tasksDueBefore` / `taskPromptLine` in `lib/class-reminder.ts`, riding the class alert that already goes out rather than becoming a reminder of its own: a student who gets "your class starts in an hour" and, separately, "you have two tasks outstanding" has to work out that the second is about the first. One query for all five sessions in the window, not one per session. An **undated** task counts as due by the next class — `dueAt` is nullable and most tasks carry none, so excluding them would have made the prompt silent in exactly the common case.
- **Weekly progress report** (@33:47) ✅ — `lib/weekly-report.ts` (pure) + `server/weekly-report.ts` + a **Week by week** card under the sprint tracker on the student record. The tracker is the editor that sets each week's target; this is the read of what the records say the student actually did in that week, beside what they said. Nothing is stored, and every number comes from the same table, column and date field the leaderboard scores — `appliedAt` not `createdAt`, `occurredOn` not `createdAt`, `ACTIVE` spread into the self-reported reads — so the report and the board cannot put one student's same work in two different weeks.

  Five queries whatever the sprint's length, bucketed into weeks in memory: the obvious per-week implementation would have been 65 round trips to Singapore at ~205ms each, on a page a coach opens before every call.

  Two rules it enforces that are worth knowing about. **A dash is not a zero:** a week in which no register was taken has *no* attendance percentage, because reporting 0% would show a coach their own outstanding register back as their student's absence. And the denominator is *marked* classes, not held ones — three classes of which one was marked is "1 of 1", not "1 of 3". **The trend is null in three separate situations** (the first week, a week still running, and a week whose predecessor is still running), because comparing a half-finished week against a complete one would show a student having a perfectly normal Tuesday as sharply down, every Tuesday.

  **Its SHAPE remains an assumption.** The plan said to confirm it with the founders first and that was the right instinct — it is the vaguest ask of the set. It is read-only over pre-existing data, so reshaping it costs only the rework. Recordings are deliberately absent: `resolveWatchTruth` decides "watched" and is not a column, so that one metric cannot be a grouped count and the student's own classroom keeps owning it.

---

## 4. Sequencing rationale

Stage 1 first because it is additive, carries no migration, cannot change an existing number, and is what the founders actually spent the call asking for. Stage 2 second and alone, because it is the only migration — and the audit was written before the schema was touched, which is what caught the enum misreading in Wrinkle B. Stage 3 after 2. Stage 4 is independent of all of them.

One invariant held across the whole build: **nothing here may make the leaderboard disagree with the screen that owns the underlying number.** `lib/leaderboard.ts` opens by saying a board whose attendance column contradicts the attendance page is worse than no board. An average, a ratio and a discontinued student were three fresh chances to break that, which is why all three are computed from the same source the owning screen reads, rather than stored — and why the cohort average is taken over the *capped* figure the board actually scored, not the raw count.

A second invariant emerged while building, and is worth naming because it caught three real bugs: **when two screens ask the same question, they must call the same function.** The seat count, the register roster and the two halves of `PENDING` were each being decided in two or more places, and in every case the copies had already drifted.


---

## 5. What a review pass over the finished build caught

Four findings, all in work that had already typechecked, linted and passed its tests. Each is recorded because the *class* of mistake is the useful part, not the line.

### 5.1 The cohort floor permitted a cohort of two — the leak it was built to stop

`cohortPublishable` hard-floored `minCohort` at **2**, two lines under a comment explaining that a cohort of two leaks everything. Both were written in the same sitting; the prose was right and the number was wrong.

The arithmetic: a student reading the board knows their **own** per-metric line exactly, so from the cohort mean they can recover the sum of everybody else's — `mean × size − mine`. The question is therefore not how large the cohort is but how large **the cohort minus the reader** is, and `size − 1 = 1` is not an aggregate at all. It is one named classmate's breakdown with two arithmetic steps in front of it.

Fixed: `HARD_MIN_COHORT = 3`, in the reader, in the Zod schema (`min(3)`) and in the Console's input. Three publishes a *pair*, and a pair cannot be resolved into its members. The test now asserts every (size, configured floor) combination below it, including the negative and zero cases a hand-edited `AppSetting` row could produce.

**The lesson:** a privacy floor has to be derived from what the reader already knows, not from the size of the group. "Is this an aggregate" was the wrong question; "is this an aggregate *to this reader*" was the right one.

### 5.2 The capacity **gate** still counted students who had left

Stage 2 fixed `filled` on the batch board, the batch detail screen and the teaching desk — and missed `seatEnrollment` in [`batch-actions.ts`](../src/server/batch-actions.ts), which is the one place capacity is actually *enforced*.

That left the system in a state worse than before the fix: the cohort card read "8/10 seated" while seating a ninth student still returned `OVER_CAPACITY:10:10`. The display and the rule disagreed about the same cohort, so the symptom the founders would have reported — "it says there is room and then refuses" — would have been harder to diagnose than the original bug.

Fixed, along with two more sites the same grep found: `rosterSize` in [`attendance-board.ts`](../src/server/attendance-board.ts) and in [`attendance.ts`](../src/server/attendance.ts). Both are compared against registers that no longer list a departed student, so counting them would have produced a cohort reading "5 of 6 marked" over a sheet showing five rows with every one of them marked — a register that can never be completed, on the screen whose entire job is to list outstanding registers.

One site was deliberately **left** unfiltered: `deleteBatch`'s guard asks "has anyone ever been in this cohort", not "is anyone in it now". `Enrollment.batchId` is `onDelete: SetNull`, so deleting a batch whose students all dropped would not error — it would quietly unseat them and erase where they had been. Filtering there would have made exactly the cohorts most worth keeping the easiest to delete. It now carries a comment saying so, because the next person to run this grep will otherwise "fix" it.

**The lesson:** when a value is both displayed and enforced, the enforcement is the one that matters, and it is usually in a different file from the display. Fixing the display alone converts a wrong number into two disagreeing numbers.

### 5.3 The discontinue guard held by coincidence rather than by rule

`mayDiscontinue` refused a non-Admin unless `enrollment.coachId === session.user.id`. A STUDENT would have been refused — but only because a student's user id does not happen to sit in a `coachId` column. That is a data accident, not a rule: a staff account later converted to a student login, or a `coachId` filled from the wrong id, would walk straight through it.

Now refused by role, first, before anything else is considered. "Almost certainly refused" is the wrong standard for the single action that ends a programme.

### 5.4 Two placeholder values shipped into the summary

`buildWeeklyReport` returned `achieved` and `missed` from an expression ending `&& false` — scaffolding written while the row shape was still moving. `0` and `0` are perfectly plausible numbers, so nothing failed. Caught on a read-through, not by a test, because no test had been written for those two fields yet.

Fixed to read `status`, and the fix is itself the interesting part: `checkInState` deliberately collapses ACHIEVED and MISSED into one `JUDGED` value, because for "whose move is it" they *are* the same answer. For this summary they are opposites. A derived value that is right for one question can be wrong for the next, and the only defence is asking which column actually distinguishes the two things being counted.

### Areas checked and found clean

- **The money.** No file in revenue recognition, instalment settlement, dunning, payment metrics or either posting path reads enrolment status, by relation filter or by comparison. Asserted by test, and the assertion's patterns were re-read against the real shapes they claim to match.
- **`"use server"` export arity.** Every export in `students-actions.ts` is async apart from one `type`. (`tsc` does not catch this; `next build` does.)
- **The register's history.** A student who dropped in week six keeps their marks on weeks one to five, and `markedCount` / `complete` / `noShowRate` stay correct — they are computed from marked rows, which that student is still in. A student seated through *both* routes (a `BatchMember` seat and a dropped `Enrollment`) correctly stays on the register, because their German Note seat has no status and is still active.
- **The browser clock.** No `new Date()` comparison survives in the sprint check-in component or its server action; both read the IST day resolved on the server.
- **Query cost.** The pre-class task query runs only when the alert window actually holds a session, which is rare — not on every page load. The teaching desk's widened `sprintWeeks` read is the same single round trip it was, with a few more scalar rows per student.
