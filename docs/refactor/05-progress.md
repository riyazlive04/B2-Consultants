# 05 — Execution progress

Phase 5 of the flow refactor. Live log against [04-refactor-plan.md](./04-refactor-plan.md).

**Checks after every step:** `npm test` · `npm run lint` · `npx tsc -p tsconfig.json --noEmit`
· plus a server/client boundary scan (see "Verification" below).

| | Baseline (`141cbfe`) | Now |
|---|---|---|
| Tests | 1863 pass / 0 fail / 1 skip | **1915 pass / 0 fail / 1 skip** (+92 added; 40 removed with CV Studio / Automation / Ledger) |
| Lint | clean | **clean** |
| Typecheck | exit 0 | **exit 0** |
| `"use server"` non-async exports | — | **0** of 67 files |
| Client components importing `server-only` | — | **0** of 286 files |
| Migrations applied | — | **none, and none planned** |

---

## Status

| Step | Wave | What | Status |
|---|---|---|---|
| A1 | Safety net | Section catalogue structural invariants | ✅ **Done** |
| A2 | Safety net | Pin the capacity disagreement | ✅ **Done** (folded into B3) |
| B1 | Pure logic | `lib/journey-state.ts` | ✅ **Done** |
| B2 | Pure logic | Batch readiness, derived | ✅ **Done** |
| B3 | Pure logic | The unified seat rule | ✅ **Done** |
| B4 | Pure logic | `server/batch-seats.ts` | ✅ **Done** |
| C1 | Cohort hub | Setup checklist on the cohort page | ✅ **Done** |
| C2 | Cohort hub | **Writable Roster — the fix for your example** | ✅ **Done** |
| C3 | Cohort hub | Cohorts created as DRAFT; Activate gate | ✅ **Done** |
| C4 | Cohort hub | `claimSeat` parity | ✅ **Done** — live checked first: 0 of 20 GN cohorts affected |
| D1 | The journey | `server/onboarding-metrics.ts` | ✅ **Done** |
| D2 | The journey | `/onboarding` board | ✅ **Done** |
| D3 | The journey | `JourneyRail` | ✅ **Done** |
| D4 | The journey | Rail on both person pages | ✅ **Done** |
| D5 | The journey | `/onboarding/new` guided wizard | ✅ **Done** |
| D6 | The journey | Income-form disclosure | ✅ **Done** |
| E1 | Navigation | Section catalogue changes | ✅ **Done** — `onboarding` added, Pipeline re-pointed, board renamed **Deals** |
| E2 | Navigation | Role homes for USER and TUTOR | ✅ **Done** |
| E3 | Navigation | Empty-state sweep | ✅ **Done** — 13 given an action, 5 named as deliberate waiting states |
| E4 | Navigation | Retire the duplicate doors | 🟡 **Partly** — Students→Batches retired with redirects; the two GN editors left, deliberately |
| E5 | Navigation | "This engine is off" banners | ✅ **Done** — 8 screens, one shared registry |
| E6 | Navigation | `/funnel` title fix | ✅ **Done** |
| F1 | App Guide | Guide schema + click paths | ✅ **Done** |
| F2 | App Guide | Screenshot capture script | 🟡 **Written, not run** — refuses a non-local host by design |
| F3 | App Guide | Entries for the 19 missing sections | ✅ **Done** — all 35 sections documented; the ratchet is now an invariant |
| F4 | App Guide | Journey walkthroughs | ✅ **Done** — 6 of 6 |
| G1 | Removals | **Remove CV Studio** | ✅ **Done** (approved 23 Oct) |
| G2 | Removals | **Retire Automation from the product** | ✅ **Done** (approved 23 Oct) |
| G3 | Removals | **Remove Ledger** (screen only; engine intact) | ✅ **Done** (approved 23 Oct) |
| H1–H3 | Handover | APP_MAP, DEV_MAP, CHANGELOG | ✅ **Done** |

---

## What now works that did not

### Your example: a cohort can be filled from the cohort

| | Before | After |
|---|---|---|
| Where learners are added | each student's own record, one enrolment at a time | **the cohort's Roster tab**, as many at once as you like |
| Page loads for a 12-seat cohort | ~26 | **1 screen, 1 dialog** |
| What the empty Roster said | *"Seat students into this cohort from the Students board"* — un-clickable, and that board has no such control | the control itself |
| Can you tell if a cohort is ready to teach? | no | **yes** — a five-item checklist, each unmet item linking to its remedy |
| Starting a cohort | no such moment — it was "active" from the instant it was saved | **Start cohort**, disabled with the reason written on it until a plan, a teacher and a learner exist |
| Seeing which cohorts are unfinished | open each one and find four empty tabs | **Draft / Ready to start** on the list itself, with what is missing beside the name |

### Your bigger complaint: the lead → class journey

| | Before | After |
|---|---|---|
| Screens to follow one person's progress | ~15 across 6 nav groups | **1** (`/onboarding`), or the rail on their own record |
| Screens showing where somebody has got to | **0** | board, both person pages, and the wizard |
| Way to find half-built records | **none** | **Needs completing** tab |
| Doors to "add a student" | 6, in 4 nav groups, none of which said what came next | **1 guided flow** (`/onboarding/new`) — the other 6 still work and now feed the same board |
| Prompt at the sales → contract seam | a notification-bell item | on the rail, in context |
| The one step with no door at all | creating a student from a signed client was only on their Contacts record, which nothing linked to | a **Create the student record** button, offered on the wizard exactly when it is the next thing |
| Learnable from inside the app? | 17 of 35 sections had **no guide entry at all** — including Agreements, Batches, Bookings, Contacts, Outreach, My Desk and Payments, every one of them a step in this journey | **all 35 documented**, plus **6** cross-section walkthroughs with the click path for every step |

### Role homes

`/` now redirects **USER → `/my-desk`** and **TUTOR → `/coaching`**, joining STUDENT and COACH. All
four carry `?onboarding=` and `?denied=` through.

### Why a screen is empty

| | Before | After |
|---|---|---|
| A disarmed engine says so | only on Console → System → Not armed | **on the screen it affects** — what is not happening, and where to switch it on (8 screens) |
| Where that wording lives | once, in `server/not-armed.ts` | once, in `lib/engines.ts`, read by both consumers — with a test that fails if either stops reading it |
| Setup dead ends | 20 described the fix in prose and offered no way to do it | **13 carry the control**; the other 5 are waiting on somebody else and say so |

### Navigation

| | Before | After |
|---|---|---|
| "Pipeline" in the sidebar | opened `/opportunities`, while being gated on the `pipeline` section — so splitting the two in Console produced a visible nav item that refused to open | opens `/pipeline`; the deal board is its own entry, **Deals** |
| Two sections pointing at one page | yes (`pipeline` + `opportunities`) | **none** — and the test that named the overlap is now an invariant |
| Cohort editors mounted twice | Students → Batches and `/batches` mounted the same component over the same rows | one home; the old tab's URLs redirect, and Students loads one query fewer |

---

## G1 + G2 + G3 · CV Studio, Automation and Ledger removed — done

Approved 23 Oct: *"yes remove both of these. I do not want this in the application."* and then
*"remove ledger aswell"*.

**39 files deleted. Routes 77 → 73. Sections 38 → 35.** All three had shipped `hidden: true`,
meaning off the nav *and* refused by the route for every role including ADMIN — so none of them had
been reachable, and no working feature was lost from anybody's screen.

### G1 — CV Studio, removed entirely

The page, `server/resume-actions`, `server/resume-metrics`, `server/job-descriptions` (which had
**no importer at all** — dead before this), `lib/resume-*`, `lib/cv-analysis`, the PDF and DOCX
renderers, `/api/resume/[id]/download`, `/api/cv-extract`, the catalogue entry and the guide entry.
Also the CV Diagnostic card on `/my-journey`, which was its only link anywhere.

**The `Resume`, `ResumeReview` and `JobDescription` tables are left in place.** Code removal is one
`git revert` away from undone; dropping rows is not.

### G2 — Automation retired, with the keep/delete line drawn more finely than planned

The plan said "remove the routes, keep the engine". Tracing the imports showed that line was too
coarse, so it moved:

| Deleted — builder only, 0 importers once the UI went | Kept — reached from live code |
|---|---|
| the 4 routes + their components | `server/automation.ts` — the trigger dispatcher |
| `server/automation-actions.ts` | `server/automation-queue.ts` |
| `server/automation-metrics.ts` | `lib/automation-quiet-hours.ts` (+ its test) |
| `server/automation-dryrun.ts` | `lib/automation-types.ts` |
| `lib/automation-dryrun.ts` (+ its test) | |

`server/automation.ts` stays because it is **not** builder code: `/api/cron/workflows` resumes
enrollments through it, and five live action modules — booking, contacts, forms, opportunities and
payments — call `emitTrigger` on it. With no builder, no new workflows can be created, so those
calls are inert; removing them would mean editing five live modules for no benefit.

### ⚠ One thing I stopped and changed rather than carry out

**Deleting `/automation/stage-messages` would have broken a live feature.** Stage messages are not
part of the workflow builder: `runStageMessages()` fires on **every `/api/cron/outreach` run**, and
`lead-intake.ts` calls `announceReturningOptIn` from the same module. That page was their **only**
editor — and there is no stage-messages panel in the Console.

So deleting it would have left a cron sending emails and WhatsApps to real prospects with **no way
for anybody to read or change the wording**. Given `testRecipient` is null and `WATI_ENABLED` is
true on live, those go to real numbers.

It is therefore **re-homed, not removed**: `/whatsapp/stage-messages`, gated on the `whatsapp`
section (Admin-only, as it always was), with a "Stage messages" link in the WhatsApp page header so
it is not another orphan route. The engine, the config reader and the writer are untouched — only
the door moved.

### Knock-on fixes the type system forced

`logActivity`'s `section` is typed `SectionKey`, so removing a section turns every stale reference
into a **build error rather than a silently mis-filed audit row** — which is precisely what that
typing is for. Two had to be re-pointed:

- `server/stage-messages-actions.ts` → `whatsapp` (follows the page), and its `revalidatePath`.
- `server/automation.ts` → `pipeline`, because every trigger the engine answers is a lead or deal
  event, so that is where a founder reading the log would look for the consequence. The actor is
  still the engine, which is what the Activity Log's Who filter keys off.

Plus: the restored form's back-link pointed at the deleted `/automation`; a `Breadcrumbs` doc
comment and a `lib/soft-delete.ts` comment both cited removed modules; and
`sections-structure.test.ts`'s guide-gap list shrank from 19 to 18.

### The hidden-section tests moved rather than dying with CV Studio

`sections.test.ts` had a seven-test block pinning the code-hidden override rule — "a hidden section
ships off, and an explicit Console `on` beats that default" — using `cv-check` as its fixture. That
rule is load-bearing and outlives any one section, so the block was **re-pointed to `ledger`**, now
the only code-hidden section left, with a note that un-hiding Ledger (proposed as D6) will need a
different fixture rather than a quiet deletion.

### G3 — Ledger removed too (approved 23 Oct, after the trade-off was put twice)

I recommended keeping it twice and was overruled, which is the founder's call to make. Removed.

**Only the screen.** `src/app/(app)/ledger/` is deleted, and the three page-only read wrappers went
with it (`getJournal`, `getTrialBalance`, `verifyAuditChain` in `server/ledger.ts`). **The posting
engine is untouched** — six modules still import from `server/ledger.ts` (finance-actions,
finance-autopost, commission-actions, equity-actions, invoice-posting, payments-actions), so every
rupee is still double-entry recorded exactly as before.

**What this costs, recorded plainly so it is not a surprise later:** there is no longer any way to
read the journal, the trial balance, or the `AuditEntry` hash-chain verification from inside the
product. `verifyAuditChain` had no other caller, so the tamper-evidence of the audit log is now
unverifiable through the UI.

**The capability is not deleted, only unexposed.** All three functions still exist in
`server/ledger-core.ts` and take a `LedgerDb`, so a script or a future screen can call them with no
new engine code. The door is closed, not bricked up.

Knock-ons handled: the `ledger` catalogue entry; **27 dead `revalidatePath("/ledger")` calls** across
9 server modules (all verified as standalone statements before removal — revalidating a route that
no longer exists is a no-op, but 27 references to a deleted page is rot); a stale generated type in
the 11-day-old `.next-localdemo` dist dir that referenced the deleted page (build output only, and
checked first that no running server uses that dir).

**The permission-matrix row was kept, not deleted**, which matters. That table is a *drift
reporter*: the spec still asks for a ledger view (`F R - - - - - -`), so the honest report is "the
spec asks for something the app no longer provides", not silence. The row now carries
`sections: []` — reading as `NOT_GATEABLE` on the Console grid — with a note saying what happened
and where the functions still live.

### The hidden-section tests, twice relocated then restructured

`cv-check` was the original fixture for the seven tests pinning the code-hidden override rule. G1
moved them to `ledger`; G3 removed that too, leaving **no code-hidden section anywhere**, so the
`resolveSections` half could no longer resolve against anything.

Rather than delete a live mechanism's only tests, the block was restructured into:

- the **access half**, tested synthetically — `sectionAllowed` is pure over a `ResolvedSection`, so
  a switched-off section can be built by hand. This is the half that decides whether a route opens.
- a **ratchet** — a test asserting no catalogue entry carries `hidden`, which fails with
  instructions to restore the fuller coverage if one is ever added again.

A mechanism with no test is how a toggle quietly stops working between the day it is needed and the
day it is tried.

---

## Bugs found and fixed along the way

| # | Bug | How it was found |
|---|---|---|
| 1 | **Latent infinite redirect.** `/dashboard` denied → `/?denied=dashboard` → `/` redirects STUDENT to `/dashboard` → … Switch `dashboard` off for Students and every student signing in would have bounced until the browser gave up. Reachable before any of my changes; adding the USER redirect would have opened a second one on the busiest role. Fixed with a loop guard: a role is only sent onward when its destination is not what it was just denied. | writing E2 |
| 2 | **`?denied=` was being swallowed.** Only `onboarding=1` was forwarded through the role redirects, so a refused page load would have bounced a telecaller to their desk with the reason stripped — the exact silent bounce the `?denied=` convention exists to prevent. | writing E2 |
| 3 | **Two capacity checks disagreed over one column.** `seatEnrollment` counted `members + seated enrolments`; `claimSeat` counted members only. A German Note cohort of target 8 holding 6 members and 2 seated enrolments is full — `claimSeat` saw 6 and would admit a ninth with no over-capacity prompt, while `seatEnrollment` refused. Rule unified in `seatCount()`, and **C4 then applied it server-side** after checking live: all 20 German Note cohorts hold zero seated enrolments, so the rule is now right without any existing cohort's answer changing. | writing B3 |
| 4 | **A client component depended on a `server-only` module.** `SeatPicker` imported `SeatCandidate` from `batch-detail.ts`. It worked only because `import type` is erased — one missing keyword from a build break, and the wrong dependency direction. The type moved to `lib/batch.ts`. | boundary scan |
| 5 | **`tsconfig.json` had accumulated dead `include` paths**, which its own comment says to delete (`.next-verify/types/**/*.ts`, plus one my build added). Restored to the documented two entries. | `git diff` |
| 6 | **`claimSeat` could suggest a cohort from the wrong business.** Its "next with room" fallback queried by `level` and `status` but not `line`. Level codes are line-specific in the catalogue today, so nobody has hit it — but after the one-table `Batch` unification it was one shared level code away from telling an admin to put a German learner in a coaching cohort, which `levelFitsBatchLine` would then refuse. | writing C4 |
| 7 | Two misleading pointers and one unused import on the cohort page; the `/funnel` browser tab disagreeing with its nav label; `/my-desk`'s no-profile dead end duplicated with no way out; a garbled sentence on the timetable panel (*"build one in to get its dates"*). | reading the files |

---

## Decisions taken while building (deviations from the design)

1. **Readiness and the seat rule went into the existing `src/lib/batch.ts`**, not two new files. That
   file already *is* the pure batch-rules module — `capacityBand`, `levelFitsBatchLine`,
   `batchTiming`, `defaultBatchChoice`. Three pure batch modules where one exists is the
   fragmentation this project is meant to reduce.
2. **An expired signing link is a gap, not a lost deal.** The design had it as an exit. It is
   recoverable, and the notification feed already words it that way: *"so the deal isn't lost to a
   dead link."*
3. **A stale `LOST`/`NO_SHOW` lead stage never overrides somebody who became a student.** Clients
   who no-showed an early call, came back and enrolled carry that stage on live data.
4. **Seat reads live in `batch-detail.ts`, writes in `batch-seats.ts`.** A `"use server"` file makes
   every export a callable endpoint, and a 500-row candidate list should not be one. This follows
   the split the codebase already uses.
5. **Seating is a loop, deliberately partial-success.** Each underlying action also logs activity,
   claims a seat under a row lock and queues the welcome. Eight of ten landing reports "8 seated, 2
   could not be: <reason>" rather than discarding eight good writes because the ninth lost a race.
6. **`/batches` checklist links were corrected against the code.** I had planned
   `/batches?edit=<id>` — no such URL exists, the batch form is a modal in local state. And
   `Batch.curriculumTemplateId` has exactly one writer in the app
   (`batch-timetable-actions.ts:168`), so attaching a plan *is* building the timetable from it.
   Writing the planned links would have reproduced the bug this project is fixing.
7. **Guide screenshot hotspots are percentages, not pixels**, so re-capturing at a different window
   size does not move the box off its target. Pixel offsets would rot the first time a button moved,
   and a guide whose arrows point at the wrong thing is worse than one with no pictures.
8. **Only the additive part of E1 shipped.** Adding the `onboarding` section is safe —
   `resolveSections` falls back to the catalogue for keys a saved config does not mention. Removing
   `cv-check`/`automation`, re-pointing `pipeline` and un-hiding `ledger` all touch the founder's
   saved config or remove features, so they stay behind the gate.

---

## Verification

**What was verified:** 1,915 unit tests (+92 new, all on the pure rules and the catalogue's own
invariants), lint, typecheck, and a repo-wide scan proving **0** non-async exports from any of the
67 `"use server"` files and **0** of 286 client components value-importing any of the 151
`server-only` modules.

**The App Guide ratchet did its job, then retired itself.** Adding the `onboarding` section made
`sections-structure.test.ts` fail, because the section had no guide entry yet — exactly what it is
for. Step F3 then emptied the known-gap list, so the ratchet has become the plain invariant it was
always heading for: **every section has a guide entry, or it does not ship.**

**What was NOT verified, and why:**

- ~~**`next build` could not be run.**~~ **It has now run, and passed** —
  `NEXT_DIST_DIR=.next-structverify`, exit 0, full route table, 74 routes including
  `/onboarding` and `/onboarding/new`. The only warning is a pre-existing `bullmq` dynamic-require
  notice from the library itself, reached through `automation-queue.ts`.

  It took five attempts. Four died on system RAM rather than the JS heap
  (`memory allocation of … bytes failed`, so `--max-old-space-size` does not help), and the fifth
  succeeded only with nothing else running — a concurrent `tsc` is enough to starve it on this
  machine. `tsc` itself OOM'd twice mid-session for the same reason and passes with
  `NODE_OPTIONS=--max-old-space-size=2048`.

  **Note for next time:** the build re-appended `.next-structverify/types/**/*.ts` to
  `tsconfig.json`, exactly the churn that file's own comment warns about. Removed; keep it to the
  documented two entries.
- **No write was executed against real rows.** The live `.env` points at Supabase, so seating, the
  over-capacity prompt, the Activate gate and the capability refusals are **unproven against
  data**. They need either your hands or the local Postgres stack. One **read-only** query was run
  against live, deliberately and as promised: the German Note seat audit that cleared gate C4.
- **The guide's screenshots have not been captured.** `npm run guide:shots` is written and its
  shot list verified, but it refuses a non-local host by design — the images ship inside
  `public/`, so capturing against live Supabase would publish real clients' names, numbers and
  fees into the repo. One local run with seeded data produces all 18.

---

## 🛑 Gates — both cleared

| Step | What it needed | How it was cleared |
|---|---|---|
| **C4** | `claimSeat` to count both mechanisms — the one live behaviour change | **Queried live first, read-only, as promised.** All 20 German Note cohorts hold **zero** seated enrolments, and zero would start refusing new members under the corrected count. So the rule is now right and no existing cohort's answer changed. A second fix went with it: the "next cohort with room" suggestion filtered on `level` but not `line`, so after the one-table `Batch` unification it could have named a coaching cohort. |
| **E1** (rest) | Re-point `pipeline`, add a door for the deal board | **No live data was touched.** `resolveSections` never takes `href` from the saved config — only `label`, `icon`, `group`, `order`, `enabled` and `roles` — so re-pointing a section is a code change with nothing to migrate. The deal board kept its `opportunities` **key** and gained the **label** "Deals", which is why every saved access setting and per-user override still applies to it. |

## Deliberately not done, and why

These were in the plan. Each was dropped or narrowed after reading the code, rather than silently.

| Plan item | What the code said | What was done instead |
|---|---|---|
| `/german-note/members` → the Manage tab | They are not the same screen. The first is a participant-facing community directory gated on `german-note`; the second is an admin membership editor behind `requireAdmin()`. | Nothing. Redirecting would have sent tutors and students to a screen that refuses them. |
| Merge the two German Note cohort editors | Two different write paths with two different rules about who may lead a cohort: `createBatch` accepts only a TUTOR, `upsertBatch` accepts any active team member and also carries dates and codes. | A cross-link from Manage to Batches & Plans, and this note. Collapsing them would quietly widen who may lead a German Note cohort — a product decision, not a refactor. |
| An `action` on all ~20 empty states | Five of them are **waiting** states, not dead ends: a coach cannot assign themselves a cohort, a student cannot publish their own timetable. | 13 given a real control; the 5 left with their explanation, and `empty-states.test.ts` records which are which and why. |
| Screenshots in the guide | The capture script has to run against local data. `.env` points at live Supabase, and these images ship inside `public/`. | The script is written and its shot list verified; it **refuses a non-local host** rather than publish real clients' names into the repo. One local run produces all 18. |

## Also worth knowing

- **Nothing is committed.** The working tree holds everything above. Standing guidance here is to
  commit only when asked, and the repo is on `master`, so I have neither branched nor committed.
  Say the word and each step goes in as its own commit on a branch, per the plan's convention.
- **The permission inconsistency in finding 3 is a decision for you.** `seatEnrollment` is gated on
  the `batches.manage` capability; `addExistingMember` is `requireAdmin()`. So a head coach granted
  `batches.manage` can seat a coaching client and cannot add a German Note member. The UI now tells
  the truth about it per line rather than drawing a control the server refuses — but whether the two
  *should* differ is a product call, not mine.
- **Phase 6 is written.** [`docs/APP_MAP.md`](../APP_MAP.md) is the plain-language map for you and
  the team — no code, no file paths. [`docs/DEV_MAP.md`](../DEV_MAP.md) is the developer map:
  architecture, the `lib`/`server` boundary, route → page → server → table per flow, where each
  lifecycle rule is enforced, and a checklist for adding a feature that fits.
  [`CHANGELOG.md`](./CHANGELOG.md) is the before/after record with step counts.
- **Both remaining verifications are now done** (24/10/2026). A local stack was stood up on
  Postgres :5435 with the demo dataset, the app run against it on port 3100, and the app walked
  by hand:
  - **The guide has its 18 screenshots**, captured from that local stack. Every name in them is
    made up.
  - **Seating is proven end to end against real records** - both mechanisms. A coaching cohort
    went 0/8 → 2/8 through the new Roster picker, and a German Note cohort 2 → 3 members, with
    the setup checklist ticking "at least one learner" as it happened.

### What walking the app turned up

Three bugs, none of which any automated check could have caught, because all three were STRINGS:

| # | Bug | How long it had been there |
|---|---|---|
| 1 | **Adding a German Note learner returned a 500, every time.** `claimSeat`'s row lock is raw SQL and still named `gn_batch`, merged into `batch` by the ER v2 alignment. It is the first statement the function runs, and both `addExistingMember` and `addNewMember` call it. | **Since 29/07/2026 - three months** |
| 2 | **`npm run db:demo` failed on its first statement**, same stale rename in a TRUNCATE list. So nobody could reset the demo dataset, or stand up a local copy - which is why this surfaced only now. | Since 29/07/2026 |
| 3 | **Three screens gave instructions that could not be followed.** Batches & Plans told the reader to seat from a student's profile, directly above my own empty state telling them to use the Roster; corrected, it was then wrong for German Note, whose cohort names are not links there. My Teaching still said seating lived on the Students board. | Mine, and pre-existing |

**Bug 1 corrects something I got wrong earlier in this document.** The migration audit found zero
`batch_member` rows on live and I read it as "German Note membership is entirely unused, so this
is the cheapest possible moment to change it". It is not unused. It has been *unusable*. Same
evidence, opposite meaning - and it is the reason M4 should not have been argued for on those
grounds.
- **Four migrations are written and waiting on you** —
  [`migrations/README.md`](./migrations/README.md), each with a runnable `.sql`, its rollback and
  its measured live impact. Two are ready (M1, M3), one is blocked on a 2-row data fix
  (`npm run fix:level-codes`), and one needs a design decision (M4: Option A or B).
