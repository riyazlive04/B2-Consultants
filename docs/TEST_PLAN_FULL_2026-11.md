# B2 Consultants - Full Application Test Plan

**Written for: the person executing the tests (founder, QA tester, or a developer doing a
pre-release sweep). No knowledge of the codebase is assumed. Every case says what to do and what to
expect.**

Built on 1 November 2026 against the live code: 79 pages, 43 API routes, 89 server-action modules,
134 database models, 6 roles, 37 sections, 17 engines.

> **Already one finding, before you start.** The engine registry declares **seventeen** engine keys,
> and its own header comment still says "THE SIXTEEN ENGINES". One was added without the prose
> following it. File that as `Class: DOC` and check whether the Console panel's count reads 17.

This is a **discovery instrument**, not a sign-off checklist. Cases are written so that a failure
tells you *which rule* broke. Two parts do work a feature test cannot: **Part 4 (FLEX)** asks
whether each rule can be *changed* without a developer, and lists the ones that cannot as a
prioritised feature register; **Part 5 (Logical-fix probes)** surfaces behaviour that is
wrong-but-working - the kind a feature test passes straight over.

---

## 0. How to use this document

### 0.1 Case anatomy

| Column | Meaning |
|---|---|
| **ID** | `<AREA>-<NNN>`. Stable - never renumber. Quote it in bug reports. |
| **P** | P1 = blocks a decision, loses data, or shows one person another person's data. P2 = wrong before go-live. P3 = polish. |
| **T** | **F**unctional, **N**egative, **B**oundary, **I**ntegration, **P**ermissions, **V**alidation, **U**I, **L**ogic (implemented as designed, but the design is arguably wrong), **S**ecurity |
| **Case** | Preconditions in *italics*, then the steps. |
| **Expected** | The single observable outcome. If you cannot tell pass from fail from this text, file that as a doc bug. |
| **Status** | `[ ]` Not run, `PASS`, `FAIL`, `BLOCKED`, `DRIFT` (works, but not as written here - record how) |

### 0.2 Before you file a single bug: three false-alarm filters

Most "broken" reports against this app have turned out to be one of these. Check in this order.

1. **Is the engine armed?** Open **Console -> System -> Not armed**. Seventeen engines ship OFF on
   purpose - nothing should start messaging clients or writing to the books because it was
   installed. An off engine looks identical to a broken feature. That list names what is *not*
   happening while each is off and where to switch it on. Cases below that need an engine say so;
   arm it, or mark the case `BLOCKED`.
2. **Is it a waiting state?** "No cohorts yet" on a coach's screen means nobody has assigned them
   one. The screen is right; it is waiting on somebody else's data.
3. **Is the data actually there?** The live `lead` table has held as few as 7 rows. An empty board
   is not a broken board. Confirm the fixture exists (0.4) before calling a count wrong.

### 0.3 Environment - and the one thing that will cost you a day

> **`.env` in `B2-Consultants/` points at LIVE production Postgres.** Never run
> `prisma migrate deploy` or `migrate dev` with a shell-set `DATABASE_URL` and expect it to win -
> **`.env` wins** for the Prisma CLI, and that has already put a migration on production by
> accident. To work locally, move `.env` aside, or use a script that takes the datasource
> explicitly.

**Local test stack - the only place destructive cases may run:**

```sh
cd B2-Consultants
npm run db:local                                    # Docker Postgres on :5435
npx tsx scripts/local-demo-admin.ts                 # ADMIN seat, prints the password
npx tsx scripts/local-demo-admin.ts --role=HEAD     # repeat for USER, COACH, TUTOR, STUDENT
npx tsx scripts/seed-role-logins.ts                 # tutor + GN student portal logins
NEXT_DIST_DIR=.next-qa npx next build
NEXT_DIST_DIR=.next-qa npx next start -p 3100
```

Rules of the room:

- **Check whether a dev server is already running before you build.** A dev server owns `.next`; a
  bare `next build` beside it corrupts that directory. Always build out-of-band with
  `NEXT_DIST_DIR=`.
- Start the server **detached**, not through a piped shell job - the piped pattern dies with exit
  255.
- Browser automation shares **one Chrome profile directory**. If a browser check hangs, another
  session is holding the lock.
- **Against production** (`https://b2app.sirahagents.com`): read-only cases only, plus Finance
  cases voided immediately after. Production messages real people and the ledger is append-only.
  Every case marked **[LOCAL ONLY]** must never run there.
- **`WATI_ENABLED` can be `"true"` with no test recipient set**, which means outbound WhatsApp goes
  to **real phone numbers**. Before any messaging case, confirm the fence, or mark `BLOCKED`.
- The e2e suite's own fence file (`e2e/fence.local.json`) lists the only contacts a test may type.
  Honour it manually too.

### 0.4 Fixture data every area assumes

Create once, reuse. Prefix everything `QA-` so cleanup is a search.

| # | Fixture | Needed by |
|---|---|---|
| F1 | One login per role: ADMIN, HEAD, USER (telecaller), COACH, TUTOR, STUDENT | all Permissions cases |
| F2 | Two TeamProfiles whose `logVariant` is DISCOVERY_SPECIALIST and APPOINTMENT_SETTER | DESK |
| F3 | Three leads: one webhook-sourced (no "entered by"), one entered by hand, one assigned to the USER seat | PIPE, DESK |
| F4 | A saved availability pattern plus generated slots across two weeks | BOOK |
| F5 | One B2 cohort (plan, coach, start date, timetable, 2 learners) and one German Note batch | BATCH, CLS, GN |
| F6 | One Product per level, each with a price. Live has had **0 products**, which empties the invoice picker | FIN |
| F7 | One agreement template with a saved countersignature and marked signature fields | AGR |
| F8 | One student with an instalment plan, one payment recorded, one instalment overdue | FIN, STU |
| F9 | One published form, one published funnel, one published site page | MKT, PUB |
| F10 | One Improvement report carrying an attachment and a recording | ADM |
| F11 | One agreement in each derived state: NOT_REQUIRED, AWAITING_PAYMENT, READY_TO_SEND, SENT, VIEWED, SIGNED, EXPIRED, COMPLETED | AGR |
| F12 | One qualification question set (BANT dimensions covered) | QUAL |

### 0.5 Defect report template

```
ID:        the case that found it, e.g. FIN-042
Severity:  P1 / P2 / P3
Role:      which login
Screen:    URL + tab
Expected:  one line
Actual:    one line
Repro:     numbered, from a fresh login
Engines:   which were armed (screenshot Console -> System -> Not armed)
Data:      the record ids involved
Class:     BUG (code is wrong) | LOGIC (code matches the spec, the spec is wrong)
           | DATA (records are wrong) | CONFIG (a switch or setting) | DOC (the app is
           right and this document is wrong)
```

**The `Class` field is the point of the exercise.** A run that returns 40 BUGs and no LOGIC entries
has not been read carefully enough. Parts 4 and 5 exist to produce the LOGIC entries - Part 4 for
"this rule should be editable and is not", Part 5 for "this rule is editable and is wrong".

### 0.6 Coverage map

| Part | Area | Prefixes (cases) | Total |
|---|---|---|---|
| 1 | Cross-cutting | AUTH 34, NAV 45, XC 60 | 139 |
| 2 | Section by section | HOME 9, DESK 22, CONT 19, PIPE 21, DEAL 12, BOOK 33, OUT 25, QUAL 14, AGR 50, ONB 17, STU 27, BATCH 26, CLS 33, GN 21, FIN 73, MKT 38, INS 22, ADM 65, PORT 12 | 539 |
| 3 | Public surfaces, API, cron | PUB 20, API 45, CRON 20 | 85 |
| 4 | **Flexibility and configurability** | FLEX 118 | 118 |
| 5 | Logical-fix probes | LOGIC 70 | 70 |
| 6 | Non-functional | PERF 11, A11Y 11, SEC 16, DATA 13 | 51 |
| | **Total** | | **1,002** |

Note that several cases are themselves sweeps - NAV-044 alone is 6 roles across 37 sections,
FLEX-040 enumerates every config key in the codebase, and SEC-003 covers every detail page and file
endpoint. Executed in full, the document is a few thousand individual checks.

**Two parts answer questions the others cannot.** Part 4 asks, rule by rule, whether the founders
can change it themselves. It holds a 39-row register of every config document in the app with the
screens each one must move, the five ways a settings knob goes silently dead, a prioritised 19-row
register of rules that are still hardcoded (18 with the knob to add written out, plus one list of
locks that must *stay* locked), and the cost of adding a new *kind* of thing. Part 5 asks whether a
rule that works is the right rule.

---

# Part 1 - Cross-cutting

Run Part 1 first. A failure here invalidates results everywhere else, so do not proceed past a P1
failure in AUTH or NAV.

## 1.1 AUTH - sign in, sign out, passwords, invites

*All cases start signed out, in a fresh private window.*

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| AUTH-001 | P1 | F | Sign in at `/login` with the ADMIN seat | Lands on `/`, founder home renders | [ ] |
| AUTH-002 | P1 | F | Sign in at `/portal` with the STUDENT seat | Lands on `/my-journey`; heading names the student portal | [ ] |
| AUTH-003 | P1 | F | Sign in at `/tutor` with the TUTOR seat | Signs in; tutor-worded heading | [ ] |
| AUTH-004 | P1 | F | Sign in at `/coach` with the COACH seat | Signs in; coach-worded heading | [ ] |
| AUTH-005 | P2 | L | Sign in at `/portal` using the ADMIN seat | Succeeds, lands on the ADMIN home. The four doors are copy, not gates. Confirm that is intended and that no door refuses a valid credential | [ ] |
| AUTH-006 | P2 | U | On `/login`, confirm the copy is role-neutral | Students and tutors land here too, so the wording must not say "team". The four-way copy-pasted brand pane was deleted - it must not have returned | [ ] |
| AUTH-007 | P1 | N | Correct email, wrong password, three times | Refused each time with the same message; no hint that the email exists | [ ] |
| AUTH-008 | P1 | S | Sign in with an email that has no account | Same message and similar response time as AUTH-007 - no user-enumeration oracle | [ ] |
| AUTH-009 | P1 | B | Submit the sign-in form 8 times in 10 seconds | Rate limited (429 or a visible "try again shortly"), never a 500 | [ ] |
| AUTH-010 | P1 | F | Open `/login` while already signed in | Redirected home, no ping-pong | [ ] |
| AUTH-011 | P1 | N | Corrupt the session cookie by one character, reload `/login` | The session is *validated*, not merely detected: you land on the sign-in form, not an infinite redirect | [ ] |
| AUTH-012 | P1 | F | Visit `/finance` signed out, then sign in | Redirected to `/login`, and **after signing in you land on `/finance`** - the intended destination is preserved | [ ] |
| AUTH-013 | P2 | F | `/forgot-password` with a real address | Confirmation shown; a reset email arrives (needs the email engine armed) | [ ] |
| AUTH-014 | P1 | S | `/forgot-password` with an address that has no account | Identical confirmation screen - no disclosure | [ ] |
| AUTH-015 | P1 | F | Follow the emailed link to `/reset-password?token=...`, set a new password | Succeeds; the old password is refused; the new one works | [ ] |
| AUTH-016 | P1 | N | Re-use the same reset token | Refused as used or expired | [ ] |
| AUTH-017 | P1 | N | Edit one character of the reset token | Refused; no partial acceptance | [ ] |
| AUTH-018 | P2 | F | `/forgot-password` while signed in | Bounced home, not offered a reset | [ ] |
| AUTH-019 | P1 | F | *An admin sets a user's password from Users & access.* Sign in as that user | Forced to `/change-password` before any app route renders | [ ] |
| AUTH-020 | P1 | N | From the forced `/change-password`, type `/finance` in the address bar | Still bounced back to `/change-password` | [ ] |
| AUTH-021 | P1 | F | Complete the forced change | Lands in the app; the flag clears; the next sign-in goes straight in | [ ] |
| AUTH-022 | P1 | V | On `/change-password`, submit a 4-character password | Rejected, with the policy stated | [ ] |
| AUTH-023 | P1 | N | Open `/change-password` with no session | Sent to sign in - you cannot change a password you are not holding | [ ] |
| AUTH-024 | P1 | F | Create an invite for a new USER, open `/invite/<token>`, set a password | Account created with the invited role; signs in | [ ] |
| AUTH-025 | P1 | N | Open the same invite link a second time | Refused - single use | [ ] |
| AUTH-026 | P1 | N | Open `/invite/<random-token>` | Generic "not valid"; no indication of what the token nearly was | [ ] |
| AUTH-027 | P2 | F | Open a valid invite while already signed in | Bounced home | [ ] |
| AUTH-028 | P1 | F | Suspend a user who has a live session; have them reload | Signed out immediately - live sessions are deleted on suspend, the badge is not decorative | [ ] |
| AUTH-029 | P1 | N | Attempt sign-in as a SUSPENDED user | Refused, with suspension stated rather than "wrong password" | [ ] |
| AUTH-030 | P1 | F | Sign out from the user menu, then press Back | Session gone; Back does not restore an authenticated page from cache | [ ] |
| AUTH-031 | P2 | S | Sign in on two browsers, sign out of one | The other session survives. Confirm this is the intended policy and record it | [ ] |
| AUTH-032 | P2 | F | Delete a user entirely, then try their old password | Refused; screens that listed them do not break on an orphaned reference | [ ] |
| AUTH-033 | P1 | F | *Student has a portal login created by `sendLoginCredentials`.* Use the emailed temporary password | Signs in and is asked to change it | [ ] |
| AUTH-034 | P1 | S | Read the WhatsApp message log for that credential send | The **password is redacted** from the stored message params | [ ] |

## 1.2 NAV - sections, roles, capabilities, the founder's overrides

The sidebar is **not** hardcoded. A section exists because a route exists; but its label, icon,
group, order, on/off state and role list are the founder's layer, saved as JSON. Access is enforced
**on the page**, so a hidden section is also an unreachable URL.

*Before the 0xx-2xx cases: screenshot the current Console -> Access -> Sections config so you can
restore it. Everything in 1.2 that writes is **[LOCAL ONLY]**.*

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| NAV-001 | P1 | P | As each of the 6 roles, list every sidebar item | Matches the matrix in 1.3. Record every difference | [ ] |
| NAV-002 | P1 | P | As USER, type `/finance` | Refused - **not** a rendered page with empty numbers | [ ] |
| NAV-003 | P1 | P | As HEAD, type `/finance`, `/cash`, `/payments`, `/funnel` | All four refused. The Phase 2/3 role tables override Phase 1: the head coach has no Finance, Cash, Payments or Funnel access, so this lock-out is correct, not a bug | [ ] |
| NAV-004 | P1 | P | As STUDENT, type `/students`, `/pipeline`, `/console`, `/activity` | All refused | [ ] |
| NAV-005 | P1 | P | As TUTOR, type `/german-note/manage`, `/programs` | Refused - admin-only twice over (section gate plus an admin check) | [ ] |
| NAV-006 | P1 | P | As COACH, type `/my-desk`, `/arena` | Refused - both belong to the sales floor | [ ] |
| NAV-007 | P1 | F | Console -> Sections: rename "Bookings" to "QA Calls", save, reload as USER | New label in the sidebar; the URL is unchanged | [ ] |
| NAV-008 | P1 | F | Switch a section OFF, reload as a role that had it | Gone from the sidebar **and** its URL now refuses | [ ] |
| NAV-009 | P1 | F | Remove HEAD from the `students` section's role list | HEAD loses the sidebar item and the URL | [ ] |
| NAV-010 | P1 | N | Try to hide `console`, or hand it to a non-admin | Refused - it is locked. If this succeeds, the only way back is a database edit: P1 | [ ] |
| NAV-011 | P1 | N | Try to hide or reassign `activity` | Also refused. A log its subjects can hide is not a log | [ ] |
| NAV-012 | P2 | F | Move a section to a different sidebar group | Appears under the new group for every role that has it | [ ] |
| NAV-013 | P2 | F | Reorder two sections within a group | Order persists across reload and across roles | [ ] |
| NAV-014 | P2 | B | Load a saved config that files a section under the retired group "Money" | Resolves and renders rather than orphaning the section | [ ] |
| NAV-015 | P2 | B | As each role, count items per sidebar group | No group exceeds five items for any one role (the stated design rule) | [ ] |
| NAV-016 | P2 | B | Set an icon name the catalogue does not know, via a saved config | Falls back to a default icon; the sidebar still renders | [ ] |
| NAV-017 | P1 | F | Console -> Per-person rules: grant one USER the `finance` section | That person gains it; other USERs do not | [ ] |
| NAV-018 | P1 | F | Deny one ADMIN a non-locked section | Denied for them only | [ ] |
| NAV-019 | P1 | P | Grant `attendance` to someone who teaches nothing | They get the screen and an **honest empty desk** - never somebody else's week | [ ] |
| NAV-020 | P1 | P | Grant `coaching` to a non-teacher | Same: the desk scopes itself to cohorts they lead | [ ] |
| NAV-021 | P1 | P | *A user holds `attendance` but teaches nothing.* Attempt to mark a register for a batch they do not teach | Refused inside the action. A section puts a door in the sidebar; it never decides whether a register may be written | [ ] |
| NAV-022 | P1 | P | Remove the `batches.manage` capability from an ADMIN | `/batches` disappears - it is capability-gated | [ ] |
| NAV-023 | P1 | P | Remove `agreements.issue`, open `/agreements/new` | Refused at the page, not after the form is filled | [ ] |
| NAV-024 | P1 | P | Remove `pipeline.configure`, open `/opportunities/pipelines` | Opens **read-only**. Knowing which pipelines exist is not permission to reshape them. Every mutation refuses | [ ] |
| NAV-025 | P1 | P | Remove `finance.write`, open `/finance` | Readable; every write refused | [ ] |
| NAV-026 | P1 | P | Remove `users.manage`, open `/people` | Readable; no user can be created, edited or suspended | [ ] |
| NAV-027 | P1 | P | Remove `germanNote.finance`, open `/german-note` | Financials tab withheld; Community still works | [ ] |
| NAV-028 | P1 | P | Remove `sites.manage`, POST to `/api/media/upload` | 403. An unauthenticated writer to a public bucket is free file hosting on the company domain | [ ] |
| NAV-029 | P1 | P | Remove `improvements.triage` from HEAD, open `/improvements` | They can read and **escalate**, not triage. Three separate rights - confirm all three behave independently | [ ] |
| NAV-030 | P1 | P | Remove `qualification.manage`, open Console -> Qualification | Read-only | [ ] |
| NAV-031 | P1 | P | Remove `rewards.approve`, open Console -> Rewards | Pending grants visible; approve and decline refused | [ ] |
| NAV-032 | P2 | P | Remove `commission.firstCall` from a USER | Their first-call share is no longer shown or accrued; the other two commission capabilities are unaffected | [ ] |
| NAV-033 | P1 | S | Call `/api/export/<entity>` as a role that cannot open the screen | Refused. An export that skipped the section gate would be a way to read a section you cannot open | [ ] |
| NAV-034 | P2 | U | Open the command palette, search for a section the role cannot access | Not offered | [ ] |
| NAV-035 | P2 | U | Open `/guide` as each role | Only entries for screens that role can open; walkthroughs filtered by role and listed **before** per-section entries | [ ] |
| NAV-036 | P2 | P | Open `/guide/rules` as HEAD | Refused - ADMIN only, since every destination on it is the Console | [ ] |
| NAV-037 | P2 | L | Open `/batches/<id>` as the COACH who leads it, with the `batches` section switched OFF | Opens - the page is deliberately not section-gated. Confirm that is still wanted | [ ] |
| NAV-038 | P1 | S | As USER, request `/batches/<id of a cohort you do not teach>` | Refused | [ ] |
| NAV-039 | P2 | U | Every page: read the browser tab title | Names the screen; no page shares the bare app title | [ ] |
| NAV-040 | P2 | U | Deep-link a tabbed page with `?tab=`, `?area=`, `?panel=` | Opens on that tab; a reload keeps it; the link is shareable | [ ] |
| NAV-041 | P2 | U | Switch tabs then press Back | Returns to the previous tab rather than leaving the page | [ ] |
| NAV-042 | P2 | U | Resize to 390px, open the sidebar | Drawer opens, closes on selection, does not trap focus | [ ] |
| NAV-043 | P1 | F | Add a new folder under `public/` and reference an image from a signed-out page | Renders only if the prefix is in middleware's public list - otherwise masks render empty. Confirm brand and media assets load on `/login`, `/portal`, `/book`, `/agreement/<token>`, `/i/<token>`, a funnel and the marketing site | [ ] |

## 1.3 Role x section matrix

Run as each role, **by URL** rather than by sidebar. `Y` should be reachable, `-` must be refused in
both the sidebar and by URL. These are the code defaults; a founder override changes the
expectation, so **record the Console config alongside the result**.

| Section (route) | ADMIN | HEAD | USER | COACH | TUTOR | STUDENT |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Founder Console `/console` | Y | - | - | - | - | - |
| Users `/people` | Y | - | - | - | - | - |
| Programs `/programs` | Y | - | - | - | - | - |
| Activity Log `/activity` | Y | - | - | - | - | - |
| Improvements `/improvements` | Y | Y | - | - | - | - |
| Finance `/finance` | Y | - | - | - | - | - |
| Cash Health `/cash` | Y | - | - | - | - | - |
| Payments `/payments` | Y | - | - | - | - | - |
| Bonus & Commission `/telecaller` | Y | Y | - | - | - | - |
| Funnel Report `/funnel` | Y | - | - | - | - | - |
| Reports `/reports` | Y | Y | Y | - | - | - |
| My Desk `/my-desk` | Y | Y | Y | - | - | - |
| Arena `/arena` | Y | Y | Y | - | - | - |
| My Daily Log `/daily-log` | - | Y | - | Y | Y | - |
| Pipeline `/pipeline` | Y | Y | Y | - | - | - |
| Contacts `/contacts` | Y | - | Y | - | - | - |
| Deals `/opportunities` | Y | Y | Y | - | - | - |
| Bookings `/bookings` | Y | Y | Y | - | - | - |
| Outreach `/outreach` | Y | - | Y | - | - | - |
| Website `/sites` | Y | - | - | - | - | - |
| Funnels `/funnels` | Y | - | Y | - | - | - |
| Forms `/forms` | Y | - | Y | - | - | - |
| WhatsApp `/whatsapp` | Y | - | - | - | - | - |
| Conversations `/conversations` | Y | - | - | - | - | - |
| Onboarding `/onboarding` | Y | Y | Y | - | - | - |
| Students `/students` | Y | Y | Y | - | - | - |
| Agreements `/agreements` | Y | Y | Y | - | - | - |
| German Note `/german-note` | Y | Y | - | - | Y | - |
| My Teaching `/coaching` | Y | Y | - | Y | Y | - |
| Attendance `/attendance` | Y | Y | - | Y | Y | - |
| Batches & Plans `/batches` | Y | Y | - | - | - | - |
| Leaderboard `/leaderboard` | Y | Y | - | Y | Y | Y |
| Weekly Reports `/weekly-reports` | Y | Y | - | Y | Y | - |
| My Classroom `/classroom` | - | - | - | - | - | Y |
| Dashboard `/dashboard` | - | - | - | - | - | Y |
| My Journey `/my-journey` | - | - | - | - | - | Y |
| App Guide `/guide` | Y | Y | Y | Y | Y | Y |

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| NAV-044 | P1 | P | Execute the whole matrix: 6 roles x 37 rows, by URL | Every cell matches. One `-` that renders is a data leak | [ ] |
| NAV-045 | P1 | P | For every `-` cell, also call that entity's CSV export | Also refused | [ ] |

## 1.4 XC - behaviour that must be identical everywhere

### Money, currency and number entry

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| XC-001 | P1 | V | In a euro amount field, type `125.000,50` | Reads as 125,000.50 euros, not 125. European grouping uses dots, and the form submits a hidden canonical value | [ ] |
| XC-002 | P1 | V | In a rupee field, type `1,25,000` | Parsed as 125000 | [ ] |
| XC-003 | P1 | B | Enter `0` as an amount | Accepted or refused consistently with the field's rule; never silently saved as null | [ ] |
| XC-004 | P1 | B | Enter a negative amount | Refused on income and expense; allowed only where a credit is meaningful, and labelled as one | [ ] |
| XC-005 | P1 | B | Enter `99999999999999` | Refused or clamped with a message. No overflow, no silent truncation | [ ] |
| XC-006 | P1 | V | Paste `12.5.3` into an amount | Refused; the field does not keep the first fragment | [ ] |
| XC-007 | P1 | L | Flip the rupee/euro toggle on Finance | Figures **switch between two stored aggregates**; nothing converts on the fly. A number that changes by an exchange rate is a bug | [ ] |
| XC-008 | P1 | L | Flip the toggle, then reload | The choice persists, and every tile and table on the page agrees | [ ] |
| XC-009 | P2 | L | Hunt for a server-rendered figure that ignores the toggle | A server component cannot read the toggle - it must be handed an `{inr, eur}` pair. A frozen tile is a real bug; record which | [ ] |
| XC-010 | P1 | I | Open a screen that needs an FX rate on a day with no rate | A clearly labelled stale rate with its date, or an explicit "no rate" - never a silent 0 or a 1:1 | [ ] |
| XC-011 | P1 | L | Record income in euros, then read the same money in a rupee total. Re-read tomorrow | The rate is stamped at entry, so the figure never moves afterwards. Same number both days | [ ] |
| XC-012 | P2 | V | Every money field: type letters, then a currency symbol | Ignored or rejected; no NaN reaches the database | [ ] |

### Dates, times and the timezone

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| XC-013 | P1 | L | Record something at 01:00 IST, then read the Activity Log | Filed under **today IST**, not yesterday. 20:00 UTC is already the next IST day - the 5.5 hour trap | [ ] |
| XC-014 | P1 | B | Submit a daily log at 23:58 IST | Lands on today, not tomorrow | [ ] |
| XC-015 | P1 | B | Open a dated form and read the default date immediately after navigating | It may briefly show the server's IST date before the browser corrects it (about 120ms). Read defaults after the page settles; a *persistent* mismatch is a bug | [ ] |
| XC-016 | P1 | B | Set the device to a non-IST timezone and repeat XC-013 | Still files under IST. The business runs on one clock | [ ] |
| XC-017 | P2 | B | Enter 29 February in a non-leap year | Refused | [ ] |
| XC-018 | P2 | B | Enter a future date where only the past makes sense (money received) | Refused or warned - never silently accepted into a month that has not happened | [ ] |
| XC-019 | P2 | B | Record on the 1st at 00:05 IST and on the last day at 23:55 IST | Each appears in the right month on every monthly total | [ ] |
| XC-020 | P2 | U | Every custom date picker: open it, pick with the keyboard only, close with Esc | Works, and the hidden native control carries the value | [ ] |
| XC-021 | P2 | U | `time`, `month`, `datetime` fields, and every field on a public form | Stay **native** by design - confirm they are not wrapped in a custom popover | [ ] |
| XC-022 | P2 | B | A record dated during a DST change in a European timezone | No off-by-one-hour drift in anything derived from it | [ ] |

### Deleting, archiving and the audit trail

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| XC-023 | P1 | L | Delete a lead, a contact, an opportunity and an expense | **Archived, not destroyed** - delete means archive across nine models. Gone from every list, still in the database | [ ] |
| XC-024 | P1 | L | Delete a **Student** | Student is the stated exception to soft-delete. Record exactly what happens and whether it is reversible; a hard delete here is a P1 LOGIC finding | [ ] |
| XC-025 | P1 | L | After archiving, re-check every count, total and board that listed the record | All exclude it. There is **no middleware** doing this - every query filters explicitly, so a missed filter is likely, and this case is the hunt for it | [ ] |
| XC-026 | P1 | L | Archive a payment, then read a student's "paid so far" | Excludes the archived payment | [ ] |
| XC-027 | P1 | F | Delete a kanban card that is a lead's only board presence | The lead is not stranded invisible - it stays reachable from the leads table | [ ] |
| XC-028 | P2 | F | Run the retention cron after the window has passed | Archived rows older than the window are purged; nothing inside the window is touched | [ ] |
| XC-029 | P1 | S | On `/activity` as ADMIN, after five writes by three different users | All five appear, with the right actor, screen, record and an IST timestamp to the second | [ ] |
| XC-030 | P1 | S | Try to edit or delete an activity entry | Impossible from the UI | [ ] |
| XC-031 | P2 | F | On `/activity`, filter by person, by date, by section, and switch Feed/Table | Filters and the view live in the URL - the link is shareable | [ ] |
| XC-032 | P2 | L | Hunt for a write the log does **not** record | Every write worth attributing should be logged. List the gaps; each one is a LOGIC finding | [ ] |

### Exports

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| XC-033 | P1 | F | Filter a table to a narrow slice, then export CSV | The file follows the **filter**, not the rendered page, and is not capped at the paginated slice | [ ] |
| XC-034 | P1 | B | Export a filter matching over 5,000 rows | Completes; the row count matches the on-screen count | [ ] |
| XC-035 | P2 | V | Export rows containing commas, quotes, newlines and a leading `=` | Correctly quoted, and the `=` cell cannot execute as a spreadsheet formula | [ ] |
| XC-036 | P2 | V | Export rows with Devanagari characters and umlauts | UTF-8 intact when opened in Excel | [ ] |
| XC-037 | P1 | S | Export an entity whose section you cannot open | Refused (see NAV-033) | [ ] |

### Appearance, layout and feel

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| XC-038 | P1 | U | Every screen in **dark** mode | No unreadable text; contrast meets AA. Programme colours are fills, not text | [ ] |
| XC-039 | P2 | U | Hunt for `text-white` on an accent fill | Should be the `--on-accent` token. Each instance is a design-system violation | [ ] |
| XC-040 | P1 | U | At 390px wide, try to scroll every screen sideways | No horizontal page scroll. A past cause was invisible screen-reader-only boxes; `main` is clipped, never `overflow: hidden`, which breaks sticky | [ ] |
| XC-041 | P1 | U | Open a date or select picker **inside a modal** | The picker renders above the modal, not behind it | [ ] |
| XC-042 | P2 | U | Open two popovers in sequence, press Esc, click outside | The first closes when the second opens; Esc and outside-click both close | [ ] |
| XC-043 | P2 | U | Switch tabs on a tabbed page twice | Entrance animations replay because each panel remounts. Known and minor - confirm it has not become a data re-fetch | [ ] |
| XC-044 | P1 | U | Every table and board with no data | A named empty state with the button or link that fills it - never a bare "0" or a blank panel | [ ] |
| XC-045 | P2 | U | Every chart | Drawn by the shared chart layer, with axis text legible at small sizes and no hand-rolled SVG | [ ] |
| XC-046 | P2 | U | Every chart in dark mode | Series colours and axis labels legible | [ ] |
| XC-047 | P2 | U | Every metric card with a link | Clicking navigates. Where the role cannot navigate there it falls back to a detail popup, so confirm no card is a dead click | [ ] |
| XC-048 | P2 | U | Every destructive button | Asks first, names the record, and says whether it can be undone | [ ] |
| XC-049 | P2 | U | Double-click Save on any form | One record, not two | [ ] |
| XC-050 | P2 | U | Submit a form, then press Back | No resubmission prompt and no duplicate | [ ] |
| XC-051 | P2 | U | Every multi-field form: submit with required fields empty | Field-level errors, focus on the first, nothing saved | [ ] |
| XC-052 | P2 | U | Fill a long form, then navigate away without saving | Either warns or loses the work silently - record which. Silent loss on a long form is a P2 | [ ] |
| XC-053 | P2 | U | Throttle to Slow 3G and open the heaviest screens | Skeletons or streamed content, not a frozen blank page | [ ] |
| XC-054 | P2 | U | Stop the database and open a page | A readable error, not a stack trace | [ ] |
| XC-055 | P1 | N | Open `/students/<nonexistent-id>` | Not-found UI. **Assert on the body**: `notFound()` renders the page but the HTTP status stays 200 under streaming | [ ] |
| XC-056 | P1 | N | Open a detail page with a malformed id: `../`, a 5,000-character string, SQL-ish text | Clean not-found; no error leaking a table or column name | [ ] |
| XC-057 | P2 | U | Leave a tab open ten minutes, reload, then press reset on the work-time tracker | Minutes accumulate for **your own** row only; reset clears only today, only yours | [ ] |
| XC-058 | P2 | S | POST to `/api/work-time` with another user's id in the body | The user comes from the session, never the body. A client can say how long it worked, never who it worked as | [ ] |
| XC-059 | P2 | U | The notification bell | Only your notifications; marking them read persists | [ ] |
| XC-060 | P2 | U | Every screen at 1280px, 768px and 390px | No clipped buttons, no overlapping text, no table that cannot be read or scrolled | [ ] |

---

# Part 2 - Section by section

## 2.1 HOME - the role home pages

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| HOME-001 | P1 | F | `/` as ADMIN | Founder home: KPI tiles, month hero, Arena tile. Every number has a source you can click through to | [ ] |
| HOME-002 | P1 | L | Compare each KPI tile on `/` against the same figure on its own screen (Finance, Cash, Pipeline) | Identical. A home tile that disagrees with its source screen is a P1 LOGIC finding | [ ] |
| HOME-003 | P1 | F | `/` as HEAD | No finance figures anywhere, including inside tiles and popups | [ ] |
| HOME-004 | P1 | F | `/` as USER | Their own desk summary; no company-wide money | [ ] |
| HOME-005 | P1 | F | `/` as COACH, TUTOR, STUDENT | Each lands somewhere meaningful for their role, never on an empty founder home | [ ] |
| HOME-006 | P2 | F | Month hero with the monthly target set, and again with it unset | States target versus actual; with no target it says so rather than dividing by zero | [ ] |
| HOME-007 | P2 | B | `/` on a brand-new database with no data at all | Every tile shows an honest empty state; nothing shows NaN, Infinity or a negative percentage | [ ] |
| HOME-008 | P2 | F | Arena tile on `/` | Names the weekly leader. ADMIN and HEAD are promoted out of ranking: they see the board but do not appear on it | [ ] |
| HOME-009 | P2 | U | Click every tile on `/` | Each navigates to the screen that explains it, or opens a detail popup when the role cannot navigate | [ ] |

## 2.2 DESK - My Desk, call logging, offline capture

My Desk branches on `TeamProfile.logVariant`, **not** on role. A telecaller invited but never added
to the team list arrives with nothing of their own.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| DESK-001 | P1 | F | `/my-desk` as a USER whose TeamProfile has `logVariant` = APPOINTMENT_SETTER | The L1 desk | [ ] |
| DESK-002 | P1 | F | `/my-desk` as a USER whose variant is DISCOVERY_SPECIALIST | The L2 desk, visibly different from L1 | [ ] |
| DESK-003 | P1 | L | `/my-desk` as a user with a login but **no TeamProfile** | A clear "you are not on the team list yet" state naming who fixes it - not a broken or empty desk | [ ] |
| DESK-004 | P1 | L | Change a person's `logVariant` and reload | The desk changes. Confirm this is a profile change and never a role change | [ ] |
| DESK-005 | P1 | F | *Leads assigned to this user exist.* Open the desk | Their queue lists only leads with their `assignedToId`. A desk that is empty while leads exist usually means the leads are **unassigned**, not that the desk is broken - check before filing | [ ] |
| DESK-006 | P1 | P | Confirm the desk never shows another telecaller's lead | Scoped by assignment | [ ] |
| DESK-007 | P1 | F | Log a call with outcome SPOKE and notes | Saved; appears in the lead's history with the caller, time and outcome | [ ] |
| DESK-008 | P1 | F | Log each other outcome: NO_ANSWER, BUSY, CALLBACK, WRONG_NUMBER, NOT_INTERESTED | Each saves and each routes the lead as its rule says (record the routing you observe for each) | [ ] |
| DESK-009 | P1 | L | Log CALLBACK with a callback time | A chase appears at that time, on this desk, not somebody else's | [ ] |
| DESK-010 | P1 | L | Log WRONG_NUMBER | The lead leaves the calling queue and does not reappear tomorrow | [ ] |
| DESK-011 | P1 | L | Log NOT_INTERESTED, then have the same person opt in again | They **return** to a desk. A dedupe that keeps the row but does nothing else is the bug this case exists for: re-opted-in lost leads must not vanish from every desk | [ ] |
| DESK-012 | P1 | F | Go offline (devtools), log two calls, come back online | Both sync, each carrying its **original** time. `calledAt` is the one clock the client is trusted on | [ ] |
| DESK-013 | P1 | B | Offline, log a call, close the tab, reopen it online | The queued call is still there and syncs - it is held in IndexedDB | [ ] |
| DESK-014 | P1 | B | Offline, log the same call twice | One row after sync, not two | [ ] |
| DESK-015 | P2 | B | Offline, log a call, then sign in as a different user before syncing | The queued call does not attach to the wrong caller | [ ] |
| DESK-016 | P2 | F | The "new lead just landed" popup: leave the desk open and create a lead assigned to you | Appears within about 30 seconds | [ ] |
| DESK-017 | P1 | P | Create a lead assigned to **somebody else** while your desk is open | No popup. This feed is scoped to leads assigned to the caller, so it cannot leak another telecaller's pipeline | [ ] |
| DESK-018 | P2 | F | First-call share and commission figures on the desk | Match Bonus & Commission for the same person and period | [ ] |
| DESK-019 | P2 | B | A desk with 200+ queued leads | Paginates or caps without timing out; the count is honest | [ ] |
| DESK-020 | P2 | L | Count the queries behind one desk load (dev tools or server log) | The shell used to rebuild the whole desk on every page - seven queries for a greeting pill. Count round trips, not local wall-clock. A regression here is a real P2 | [ ] |
| DESK-021 | P2 | F | Call-note extraction: log a call whose notes contain a date, a budget and a timeline | Extracted fields are offered, never silently written over what the human typed | [ ] |
| DESK-022 | P2 | F | Speed-to-lead: create a lead and leave it uncalled past the SLA | Flagged on the desk and in alerts | [ ] |

## 2.3 CONT - Contacts, companies, tasks, custom fields, duplicates

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| CONT-001 | P1 | F | Contacts tab: create a contact with name and phone only | Saved and listed | [ ] |
| CONT-002 | P1 | V | Create a contact with **no phone** | Record the behaviour. Every lead *webhook* 422s a phone-less lead silently - confirm whether the UI shares that rule, and that it tells the user if so | [ ] |
| CONT-003 | P1 | V | Create a contact with a phone in six formats: `+91...`, `0091...`, `91...`, with spaces, with dashes, with brackets | All normalise to one stored form, so dedupe can work | [ ] |
| CONT-004 | P1 | V | Create a contact with an invalid email | Refused with the field named | [ ] |
| CONT-005 | P1 | F | Create a second contact with an existing phone | Flagged as a duplicate rather than silently created | [ ] |
| CONT-006 | P1 | F | Merge two duplicates | One survivor; history follows the record you keep; **no undo** - confirm the UI says so before merging | [ ] |
| CONT-007 | P1 | L | After a merge, check the loser's calls, bookings, payments and agreements | All reachable from the survivor; nothing orphaned | [ ] |
| CONT-008 | P1 | F | A returning prospect gives a **new** email address | The new address wins (newest-wins email history). An old fill-blanks-only rule discarded it - that must not have returned | [ ] |
| CONT-009 | P2 | F | Companies tab: create a company, attach two contacts | Both listed under it; the company shows on each contact | [ ] |
| CONT-010 | P2 | F | Tasks tab: create a task with a due date, complete it | Moves from OPEN to COMPLETED; overdue tasks are visibly overdue | [ ] |
| CONT-011 | P2 | F | Custom fields: create one of each type (text, long text, number, date, dropdown, multi-select, checkbox, phone, email, URL, monetary) | All eleven render on the contact form and save | [ ] |
| CONT-012 | P1 | V | A monetary custom field with a euro amount using dot grouping | Same rule as XC-001 | [ ] |
| CONT-013 | P2 | B | Delete a custom field that holds data on 10 contacts | Warns what will be lost; after deletion no screen errors on the missing field | [ ] |
| CONT-014 | P2 | F | Custom fields scoped to CONTACT, OPPORTUNITY and COMPANY | Each appears only on its own object | [ ] |
| CONT-015 | P2 | F | Contact detail: notes, tasks, call history, bookings, payments, agreements | Each panel loads, and every row belongs to this contact | [ ] |
| CONT-016 | P1 | P | As USER, open a contact entered by another USER | Record the result. Confirm the intended rule and that it is applied the same way on the list, the detail page and the export | [ ] |
| CONT-017 | P2 | F | Search contacts by partial name, by phone fragment, by email domain | All three find the record | [ ] |
| CONT-018 | P2 | B | Search with a 200-character string and with regex characters | No error; no results, cleanly | [ ] |
| CONT-019 | P2 | F | Tag a contact, filter by that tag, export | Filter and export agree | [ ] |

## 2.4 PIPE - Pipeline (board, leads, discovery outcomes, aging)

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| PIPE-001 | P1 | F | Board tab as ADMIN | Columns match the lead stages; every card is on the column its stage names | [ ] |
| PIPE-002 | P1 | F | Drag a card one column right | The lead's stage changes, and the lead's own history records the move with who moved it | [ ] |
| PIPE-003 | P1 | L | Drag a card **backwards** two columns | Allowed or refused - record which, and whether the history shows a regression | [ ] |
| PIPE-004 | P1 | L | Drag a card to WON | Check what else fires: an opportunity, an agreement readiness change, a stage message. List every side effect | [ ] |
| PIPE-005 | P1 | L | Drag a card to LOST, then back out of LOST | The lead is recoverable and no stage message was sent on the way out | [ ] |
| PIPE-006 | P1 | F | Leads tab as ADMIN versus as USER | ADMIN sees every lead; a USER sees only the ones they entered. A **webhook** lead has no "entered by", so confirm who can see it at all - a lead nobody can see is a P1 | [ ] |
| PIPE-007 | P1 | F | Leave the Leads tab open, post a lead through a webhook | Appears within the poll interval | [ ] |
| PIPE-008 | P1 | F | Same, on the Board tab | Appears. The two tabs poll different scopes and never both at once, since switching tabs remounts the panel | [ ] |
| PIPE-009 | P1 | F | Discovery call outcomes tab: record each of QUALIFIED_FOR_SSS, NOT_QUALIFIED_FOR_SSS, FOLLOW_UP_NEEDED, NO_SHOW, SENT_TO_WORKSHOP | Each routes the lead as its rule says. Record the routing for each | [ ] |
| PIPE-010 | P1 | L | Record QUALIFIED_FOR_SSS | An SSS booking becomes possible and the lead's stage reflects it | [ ] |
| PIPE-011 | P1 | L | Record NO_SHOW | The slot is released with reason NO_SHOW, and the no-show chase becomes due | [ ] |
| PIPE-012 | P1 | L | Record an outcome for a call that has not happened yet | Refused or warned; an outcome recorded against a future call corrupts every funnel figure | [ ] |
| PIPE-013 | P1 | B | Record two different outcomes for the same call | The second either replaces the first with history, or is refused. Never two live outcomes | [ ] |
| PIPE-014 | P2 | F | Aging tab | Leads ordered by how long they have sat; the oldest first; the day count matches the lead's own last-activity date | [ ] |
| PIPE-015 | P2 | L | Aging after a call is logged | The age resets from the call, not from creation | [ ] |
| PIPE-016 | P2 | F | Bulk-assign 20 unassigned leads to a telecaller | All 20 land on that desk; the operation is capped and reports what it did | [ ] |
| PIPE-017 | P1 | L | Count unassigned leads | Any lead with no `assignedToId` is invisible on every desk. This is the exact cause of a past "My Desk is empty" report - the figure here is the one to watch | [ ] |
| PIPE-018 | P2 | F | Filter the leads table by source, stage, owner and date, then export | Export matches the filter | [ ] |
| PIPE-019 | P2 | B | Board with 300 cards in one column | Virtualised or capped; drag still works; the column header count is honest | [ ] |
| PIPE-020 | P2 | U | Drag a card and drop it outside any column | Returns to where it was; no silent stage change | [ ] |
| PIPE-021 | P2 | L | Compare the Pipeline board with the Deals board | Two separate pipelines exist by design. Confirm which is authoritative for a given lead, and that moving one does not silently move the other | [ ] |

## 2.5 DEAL - Deals and pipeline configuration

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| DEAL-001 | P1 | F | Create a deal against a contact, with a value and a stage | Saved; appears on the board | [ ] |
| DEAL-002 | P1 | F | Move a deal through every stage to WON | Each move recorded; the WON total updates | [ ] |
| DEAL-003 | P1 | L | Mark a deal WON | Check whether it creates an agreement readiness, an invoice, a student, or nothing. Record every side effect | [ ] |
| DEAL-004 | P1 | F | Mark a deal LOST, then ABANDONED | Both leave the open board but remain reportable | [ ] |
| DEAL-005 | P1 | L | *Auto-create-opportunity engine ON.* Create a lead | A deal is created once, not on every edit of the lead | [ ] |
| DEAL-006 | P1 | L | Same, with the engine OFF | No deal created, and the screen says why rather than looking broken | [ ] |
| DEAL-007 | P2 | F | `/opportunities/pipelines`: create a pipeline with five stages, reorder them | Saved; the board follows | [ ] |
| DEAL-008 | P1 | B | Delete a pipeline stage that holds 10 deals | Warns, and the deals are not stranded off-board. (A past fix had to rescue cards stranded by a board delete) | [ ] |
| DEAL-009 | P1 | B | Delete an entire pipeline that holds deals | Refused, or migrates them with a named destination | [ ] |
| DEAL-010 | P2 | P | As a user without `pipeline.configure` | The list is readable; create, rename, reorder and delete all refuse | [ ] |
| DEAL-011 | P2 | L | Rename a stage that a stage message is bound to | The message follows the stage rather than detaching silently | [ ] |
| DEAL-012 | P2 | F | Deal value in euros and in rupees on one board | Totals do not mix currencies into one meaningless sum | [ ] |

## 2.6 BOOK - Bookings, availability, slots, the SSS calendar

The booking screen once showed four zeroes for months because **no availability pattern was saved**.
Read the empty-state notice before concluding anything is broken.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| BOOK-001 | P1 | F | `/bookings` with no availability saved | An explicit notice that availability is not configured, with a link to set it - not four silent zeroes | [ ] |
| BOOK-002 | P1 | F | `/bookings/availability` -> Add availability: save a weekly pattern and generate two weeks of slots | Slots appear on the week view at the right times | [ ] |
| BOOK-003 | P1 | B | Generate slots over a range that already has slots | No duplicates; existing bookings are untouched | [ ] |
| BOOK-004 | P1 | B | Generate slots across a month boundary and across a Sunday | Correct days; the "works Saturdays" flag on a team profile is honoured | [ ] |
| BOOK-005 | P1 | F | Booking rules panel: set the public booking window (earliest and latest a visitor may book) | `/book` offers only slots inside it | [ ] |
| BOOK-006 | P1 | B | As a visitor, try to book a slot 10 minutes from now with a 2-hour minimum notice | Not offered, and refused if forced | [ ] |
| BOOK-007 | P1 | F | Book a slot from `/book` | Slot becomes BOOKED; a BookingRequest exists; the lead's stage moves; the slot disappears from `/book` | [ ] |
| BOOK-008 | P1 | B | Two visitors book the **same** slot simultaneously (two tabs, submit together) | One succeeds, one is told the slot has gone. Never two bookings on one slot | [ ] |
| BOOK-009 | P1 | F | Reschedule a booking to another slot | Old slot released with reason POSTPONED; new slot BOOKED; history shows both | [ ] |
| BOOK-010 | P1 | L | Reschedule a booking that has a Zoom link | The link is reconciled, and `zoomStartsAt` is **null** whenever the time changes until the reconciler runs again. A stale link on a moved call is a P1 | [ ] |
| BOOK-011 | P1 | F | Cancel a booking | Slot released with reason CANCELLED and offered again on `/book` | [ ] |
| BOOK-012 | P1 | F | Mark a booking NO_SHOW | Released with reason NO_SHOW; the chase ladder becomes due | [ ] |
| BOOK-013 | P1 | F | Mark a booking COMPLETED | Appears in completed counts and in the discovery-outcome queue | [ ] |
| BOOK-014 | P1 | L | Read the slot's release history | Every release is a SlotRelease row with its reason. Hold state is **derived**, not stored - a slot that looks held with no release row is the bug to look for | [ ] |
| BOOK-015 | P1 | F | Upcoming slots panel | Lists future slots with their status; BLOCKED slots are distinguishable from OPEN | [ ] |
| BOOK-016 | P1 | F | Block a slot, then try to book it publicly | Not offered; forced booking refused | [ ] |
| BOOK-017 | P1 | L | *Confirm-or-cancel engine OFF (its default).* Leave a booking unconfirmed past the window | Nothing happens, and the screen says the loop is off rather than looking broken | [ ] |
| BOOK-018 | P1 | L | Same with the engine ON | The confirm request is sent, and on no reply the slot is released with reason NO_CONFIRMATION and the next person is promoted | [ ] |
| BOOK-019 | P1 | I | Reply to a confirmation request with a confirming word, and separately with something unrelated | The confirming reply holds the slot; the unrelated one does not silently confirm it | [ ] |
| BOOK-020 | P1 | L | The confirm-request WhatsApp template | This one is **positional**, not named. Binding readable variable names to it would break the send - confirm it has not been "tidied" | [ ] |
| BOOK-021 | P1 | F | Turning applicants away panel: set the disqualification rule and message, then book as a disqualified applicant | Turned away with that message; no slot consumed | [ ] |
| BOOK-022 | P1 | F | SSS Calendar tab: book an SSS slot for a qualified lead | Booked; visible to the owner of that calendar | [ ] |
| BOOK-023 | P1 | F | Auto-reschedule an SSS slot | Moves; both the old and new times appear in history; the student is notified once, not twice | [ ] |
| BOOK-024 | P1 | F | Drag an SSS booking to a new slot | Same outcome as BOOK-023 | [ ] |
| BOOK-025 | P1 | B | Book an SSS slot for a lead who is **not** qualified | Refused | [ ] |
| BOOK-026 | P1 | F | Zoom links panel: set the per-person link, then book a call | The booking carries that person's link | [ ] |
| BOOK-027 | P1 | L | Book a call for a person with **no** Zoom link | The booking is still made, and the missing link is visible as a gap. A `_zoom` WhatsApp template **skips the send entirely** when the link is empty - confirm the gap is reported somewhere a human sees it | [ ] |
| BOOK-028 | P2 | F | Confirmation and reminder messages for one booking | Each sent once. Re-running the reminder cron twice in a morning sends nothing twice | [ ] |
| BOOK-029 | P2 | B | A slot at 00:00 IST and one at 23:30 IST | Correct day on the week view, on `/book`, and in the message text | [ ] |
| BOOK-030 | P2 | B | A booking for 29 February, and one in the week a European DST change happens | No day or hour drift | [ ] |
| BOOK-031 | P2 | F | Download the calendar invite for a booking | Opens in a calendar app with the right time, duration and link | [ ] |
| BOOK-032 | P2 | B | 50 slots in one week | Week view stays usable; counts are right | [ ] |
| BOOK-033 | P2 | P | As USER, open `/bookings/availability` | The three admin-only panels (booking rules, confirm-or-cancel, turning applicants away) are withheld; add-availability and upcoming slots remain | [ ] |

## 2.7 OUT - Outreach SOP (the 23-step ladder)

The ladder is a pure sequence plus a database shell. The engine is **OFF by default** and needs a
one-minute cron, because the tightest rule is a five-minute reaction window.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| OUT-001 | P1 | F | `/outreach` with the engine off | Queue renders, and the screen says the engine is off rather than showing an empty queue as if nothing is due | [ ] |
| OUT-002 | P1 | F | Opt a lead in, then open the Queue tab | The intro WhatsApp step is DUE with the message already written | [ ] |
| OUT-003 | P1 | L | Leave the intro step for six minutes with the cron ticking every minute | The reaction window reads **breached** - truthfully, and at most a minute late. The window is reported from the real clock, never enforced wrongly | [ ] |
| OUT-004 | P1 | B | Same, with the cron ticking every 15 minutes | Still truthful, just reported later. A 15-minute cron cannot police a 5-minute SLA - this is a configuration finding, not a code bug | [ ] |
| OUT-005 | P1 | F | Execute each step in the booking-chase phase: intro WhatsApp, intro email, first call, check 1, follow-up WhatsApp, follow-up email, check 2, follow-up WhatsApp 2, check 3, follow-up call, final check | Each marks SENT and materialises the next; nothing skips ahead | [ ] |
| OUT-006 | P1 | F | Skip a step deliberately | Marked SKIPPED, not SENT, and the ladder continues | [ ] |
| OUT-007 | P1 | L | Have the prospect book a call mid-ladder | Pending chase steps go SUPERSEDED, not SENT. A reminder that goes out after the person already booked is the failure this case hunts | [ ] |
| OUT-008 | P1 | F | Reach the final check with no reply | The lead moves to the IGNORED bucket and appears on the Closed tab, dormant, never deleted | [ ] |
| OUT-009 | P1 | F | Run BANT qualification, then key-metrics transfer | Both recorded; the verdict is stored against the lead | [ ] |
| OUT-010 | P1 | L | Score BANT at opt-in, then again at booking | The score is written to the **Lead**, not only to the booking request, and "not scored" is never shown as zero | [ ] |
| OUT-011 | P1 | L | A lead qualified YES via BANT, who then books directly through `/book` | The journey links the outreach record to the booking. A direct `/book` submission that never linked the two left BANT stuck below Qualified - confirm the link is made | [ ] |
| OUT-012 | P1 | F | Discovery confirmation phase: confirm 1, confirm 2, confirm call 1, confirm call 2 | Each sends once; a confirmation reply stops the rest | [ ] |
| OUT-013 | P1 | F | Cancel a discovery call mid-confirmation | Cancel message and email fire; the slot releases; the journey moves to CANCELLED | [ ] |
| OUT-014 | P1 | F | No-show path: no-show call 1, call 2, message | Each fires in order after the recorded no-show | [ ] |
| OUT-015 | P1 | F | SSS confirmation: confirm 1, 2, 3 and the confirm call | Same once-only behaviour | [ ] |
| OUT-016 | P1 | F | Mark a lead not-highly-qualified at handoff | Journey moves to CLOSED_NOT_HQ; no further steps materialise | [ ] |
| OUT-017 | P1 | B | Opt the same lead in twice in one hour | One journey, not two, and no duplicate intro message | [ ] |
| OUT-018 | P1 | B | Run the outreach cron twice within a minute | Nothing sends twice | [ ] |
| OUT-019 | P2 | F | Key Metrics tab | Figures match the Pipeline and Funnel screens for the same period | [ ] |
| OUT-020 | P2 | F | Closed tab | Ignored and cancelled journeys, each with a reason and a date; nothing is deleted | [ ] |
| OUT-021 | P1 | L | A step whose WhatsApp template has an **empty declared variable** | The send is **skipped**, not sent with a blank. Confirm the skip is visible on the queue and in delivery health, not silent | [ ] |
| OUT-022 | P1 | L | A step whose channel is CALL | Waits for a human; the engine never marks it SENT by itself | [ ] |
| OUT-023 | P2 | L | Compare the queue against the written SOP step numbers | Record any step the screen cannot reach, and any screen step the SOP does not name | [ ] |
| OUT-024 | P2 | B | Quiet hours configured: a step falls due at 02:00 IST | Held until the window opens, and not sent at 02:00 | [ ] |
| OUT-025 | P2 | F | Opt-out: the prospect replies STOP, then a step falls due | Nothing is sent, and the step says why | [ ] |

## 2.8 QUAL - Qualification questions and BANT

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| QUAL-001 | P1 | F | Console -> Qualification: create questions of each kind (text, long text, select, multi-select, boolean, number) | All six render on the booking form and on the public opt-in | [ ] |
| QUAL-002 | P1 | F | Assign each question a BANT dimension: BUDGET, AUTHORITY, NEED, TIMELINE, NONE | Only the first four score; NONE is context and scores nothing | [ ] |
| QUAL-003 | P1 | L | Answer every question at maximum, then read the verdict | CONFIRM. The scale runs **0 to 4**, and the cutoff is an average **above 2.4** | [ ] |
| QUAL-004 | P1 | L | Answer to produce an average of exactly 2.4, and exactly 1.6 | 2.4 is **DOUBT** (confirm is strictly above it); 1.6 is **DOUBT** (cancel is strictly below it). Check both boundaries explicitly | [ ] |
| QUAL-004a | P1 | L | Compare those cutoffs against the `BantVerdict` comment in the database schema | **They disagree, and the schema is wrong.** The scale was rescaled 0-5 to 0-4 on 22 Sep 2026 and every threshold multiplied by 0.8 (3 became 2.4, 2 became 1.6), but the enum comment still reads "avg > 3 / 2-3 / < 2". File as `Class: DOC`. Anyone testing from that comment will report two false bugs | [ ] |
| QUAL-004b | P1 | L | Confirm a prospect's verdict did not move across the rescale | Each score was migrated by the same 0.8, so no verdict changed. Spot-check a lead scored before 22 Sep 2026 | [ ] |
| QUAL-005 | P1 | L | Answer no questions at all | **Not scored**, never zero, and never silently CANCEL | [ ] |
| QUAL-006 | P1 | L | Re-weight a dimension in Console, then re-read an **existing** lead's verdict | Decide and record whether an old verdict is restated or frozen. A verdict that silently changes under a config edit is a LOGIC finding | [ ] |
| QUAL-007 | P1 | I | Post a lead through the direct intake endpoint with answers to all questions | Every answer reaches the scorer verbatim, and anything unrecognised is **recorded as evidence**, not dropped | [ ] |
| QUAL-008 | P1 | I | Post the same lead through the Pabbly relay instead | Fewer fields may arrive, because a relay forwards only what it was configured to. Record exactly which answers are lost - the known failure is 111 leads, 13 questions and **zero** scored leads | [ ] |
| QUAL-009 | P2 | F | Console -> Qualification: read the unmapped-field evidence | Unrecognised inbound fields are listed, so a mapping problem is visible rather than silent | [ ] |
| QUAL-010 | P2 | B | Delete a question that has answers | Existing answers survive for reporting, or the deletion is refused - never a broken report | [ ] |
| QUAL-011 | P2 | F | Reorder questions | The public form follows | [ ] |
| QUAL-012 | P2 | V | Submit a number question with text, and a select with a value not in the list | Rejected; nothing unscoreable is stored | [ ] |

## 2.9 AGR - Agreements

Eight states, all **derived** from the records by one pure function - there is no status column. The
signing page is public and the token is the only credential.

### Templates

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| AGR-001 | P1 | F | `/agreements/templates`: upload a Word document, mark the signature fields, save | Template created at version 1 | [ ] |
| AGR-002 | P1 | F | Edit the current version, then promote an older version | Only the current version is editable; older ones are listed, downloadable and promotable | [ ] |
| AGR-003 | P1 | L | Draw an agreement from version 1, then promote version 2 | The existing agreement still points at version 1 and its own copy is unchanged. Editing a template must not be able to reach a contract that exists | [ ] |
| AGR-004 | P1 | F | Preview a template version | Renders the document with field markers | [ ] |
| AGR-005 | P1 | B | Upload a 30MB file, a PDF, an image renamed to `.docx`, and an empty file | Each refused with a readable reason | [ ] |
| AGR-006 | P1 | S | Request a template file by URL as a role without `agreements.issue` | Refused | [ ] |

### Issuing

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| AGR-007 | P1 | F | `/agreements/new?leadId=<id>` | Opens prefilled from what the CRM already knows | [ ] |
| AGR-008 | P1 | F | Section 2.1 Batch: the batch chooser | Offers **real cohorts**. A guessed value lands in "suggested" and blocks one-click and bulk send exactly as a missing value does | [ ] |
| AGR-009 | P1 | L | Issue with a suggested-but-unconfirmed batch | Blocked until confirmed; the reason is named | [ ] |
| AGR-010 | P1 | F | Issue an agreement with an instalment plan | The plan, its surcharge and the schedule are snapshotted onto the agreement, not read live | [ ] |
| AGR-011 | P1 | L | Change the Console instalment surcharge after issuing | The issued agreement's figures do not move | [ ] |
| AGR-012 | P1 | F | Add a co-signer (a parent or guardian) | Co-signer receives their own token and must sign **before** the student | [ ] |
| AGR-013 | P1 | N | As the student, open the signing link before the co-signer has signed | Told it is waiting on the co-signer; cannot sign ahead | [ ] |
| AGR-014 | P1 | F | Attach each of the three document kinds (guided, Word, PDF) | All three issue and render | [ ] |
| AGR-015 | P1 | F | `/agreements/bulk` with a saved countersignature | Issues to a group of students | [ ] |
| AGR-016 | P1 | N | `/agreements/bulk` with **no** saved countersignature | Refused **at the page**, before picking fifty students | [ ] |
| AGR-017 | P1 | B | Bulk-issue to 50 students where 3 have missing or suggested data | Those 3 are excluded by name; the other 47 issue | [ ] |

### The derived lifecycle

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| AGR-018 | P1 | L | A lead with no deal | State NOT_REQUIRED | [ ] |
| AGR-019 | P1 | L | *Readiness set to DEPOSIT.* A lead at DEPOSIT_FOLLOWUP | AWAITING_PAYMENT. At DEPOSIT_PAID or WON: READY_TO_SEND | [ ] |
| AGR-020 | P1 | L | *Readiness set to WON.* A lead at DEPOSIT_PAID | AWAITING_PAYMENT - only WON is ready | [ ] |
| AGR-021 | P1 | L | *Readiness EITHER.* A lead at DEPOSIT_PAID | READY_TO_SEND | [ ] |
| AGR-022 | P1 | L | Issue it | SENT. Open the link once: VIEWED. Sign: SIGNED | [ ] |
| AGR-023 | P1 | L | Let a token expire unsigned | EXPIRED, and the person appears with the gap "signing link expired unsigned" | [ ] |
| AGR-024 | P1 | L | After signing, with the sealed copy present | COMPLETED. **COMPLETED requires a real agreement copy** - a SIGNED agreement with no sealed document must not read COMPLETED | [ ] |
| AGR-025 | P1 | L | Change the readiness setting with agreements already in flight | Confirm nothing in flight silently changes state. Record what happens | [ ] |

### Signing (public)

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| AGR-026 | P1 | F | Open `/agreement/<student token>` | The student's part of the ceremony | [ ] |
| AGR-027 | P1 | S | Open `/agreement/<co-signer token>` | The co-signer's part. Which one you get comes from **which table the token resolves in**, never from the URL or a query parameter | [ ] |
| AGR-028 | P1 | S | Try to reach the other party's part by editing the link | Impossible | [ ] |
| AGR-029 | P1 | S | Open `/agreement/<random token>` | Plain "not valid". The page must not become an oracle telling the holder which kind of signer they nearly were | [ ] |
| AGR-030 | P1 | F | Request a signing OTP and enter it | Verified; signing proceeds. Each OTP attempt is on the trail (sent, verified, failed) | [ ] |
| AGR-031 | P1 | N | Enter a wrong OTP three times, then the right one | Rate limited or locked as specified; record the behaviour | [ ] |
| AGR-032 | P1 | I | Read the OTP WhatsApp that arrives | It arrives at all, with the code in it. Signing codes were once dead twice over - an unbound OTP variable **and** an authentication template with one placeholder. End-to-end send is the thing to prove here | [ ] |
| AGR-033 | P1 | F | Draw the signature, submit | Sealed; the success screen offers **"view / download your signed copy"** and the links open the sealed PDF, not a re-render | [ ] |
| AGR-034 | P1 | F | Re-open the same signing URL after signing | The already-signed screen **offers the copy** rather than dead-ending | [ ] |
| AGR-035 | P1 | F | Decline instead of signing | DECLINED on the trail; the founder sees it; no sealed copy is produced | [ ] |
| AGR-036 | P1 | B | Sign on a phone (iOS and Android) | Signature pad works with touch; the PDF link opens outside an iframe, since mobile browsers do not render PDFs in one | [ ] |
| AGR-037 | P1 | F | Upload an attachment during signing (an ID document) | Stored and listed on the agreement | [ ] |
| AGR-038 | P1 | B | Upload a 25MB attachment, and a file type that is not allowed | Refused with a reason | [ ] |

### After signing

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| AGR-039 | P1 | F | `/agreements/<id>`: the preview iframe and the "open PDF in a new tab" link | Both work; check the link on a phone too | [ ] |
| AGR-040 | P1 | L | Compare the integrity footer (data hash and PDF hash) on the founder's copy and the student's copy | Identical. A mismatch is invisible until disputed, which is why it is checked here | [ ] |
| AGR-041 | P1 | F | Request an RFC-3161 timestamp | Applied and recorded; the trail shows TIMESTAMPED | [ ] |
| AGR-042 | P1 | F | Read the append-only trail for one agreement | Every event in order: created, document attached, issued, delivery sent or skipped, viewed, OTP sent and verified, signed, timestamped, copy downloaded | [ ] |
| AGR-043 | P1 | L | After signing, check whether a Student exists | Signing creates **no** Student by itself - an enrol prompt appears instead. Confirm the prompt is there and that following it creates the student with a programme | [ ] |
| AGR-044 | P1 | F | Follow the enrol prompt | Student and Enrollment created with the programme level from the agreement | [ ] |
| AGR-045 | P1 | L | Skip the enrol prompt | The person appears in Onboarding -> Needs completing with the gap "no programme bought yet" | [ ] |
| AGR-046 | P1 | F | Void an agreement | VOIDED; it no longer counts as the live agreement; the trail says who and when | [ ] |
| AGR-047 | P1 | L | Supersede an agreement with a new one | The old one is voided, and the new one is the live agreement for that person | [ ] |
| AGR-048 | P2 | L | *Agreement-reminder engine on, with a reminder day configured.* Leave an agreement unsigned | One nudge per configured day, recorded with the day it was for. Running the cron twice in one morning sends nothing twice | [ ] |
| AGR-049 | P2 | L | The agreements cron's staleness thresholds | A known drift: the agreements job reads a 21h/24h threshold that is missing from the shared stale-after list. Confirm the heartbeat reports it correctly | [ ] |
| AGR-050 | P1 | S | Request another person's agreement PDF, document file, or attachment by id | Refused for every one of the three endpoints | [ ] |

## 2.10 ONB - Onboarding

Four lists over one derived journey. Nothing here is a stored status: where somebody has got to is
worked out from their records every time the page renders, which is what makes the guided flow
resumable for free.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ONB-001 | P1 | F | `/onboarding`: the four lists | In flight (grouped by step), Needs completing, Stuck, Reached class | [ ] |
| ONB-002 | P1 | L | Walk one person through all ten steps (new lead, contacted, call booked, call done, said yes, agreement sent, agreement signed, enrolled, in a cohort, in class) | The rail advances by itself as records are created. There is no second place to tick | [ ] |
| ONB-003 | P1 | L | Mark the person not-going-ahead | They leave the rail into "not going ahead" and are not counted as stuck | [ ] |
| ONB-004 | P1 | L | Create a student from the income form (recording a bank transfer in Finance) | They appear in **Needs completing** with the gap "no programme bought yet" - this is one of the three creation paths that leaves a bare record | [ ] |
| ONB-005 | P1 | L | Create a student by converting a lead, and by enrolling off a signed agreement | Both also land in Needs completing with their gaps named | [ ] |
| ONB-006 | P1 | L | Produce each gap deliberately and confirm it is named: no enrolment, no programme level, no payment, not seated, no portal login, cohort not ready, agreement expired | All seven appear with a plain-language label and a "go there" link that opens the right screen | [ ] |
| ONB-007 | P1 | F | Click "go there" on each gap | Opens the screen that fixes it; fixing it removes the row | [ ] |
| ONB-008 | P1 | L | Leave a person with nothing recorded for 10 days | They appear in **Stuck**. On day 9 they do not | [ ] |
| ONB-009 | P1 | L | Record anything against a stuck person | They leave Stuck immediately | [ ] |
| ONB-010 | P1 | F | Reached class, for the current month | Lists only people who got all the way through this month | [ ] |
| ONB-011 | P1 | F | `/onboarding/new`: type a name and a phone, stop at the agreement step, close the tab, come back the next day | Resumes exactly where you were, because the place is derived rather than saved | [ ] |
| ONB-012 | P1 | F | Complete the whole guided flow in one sitting | Student, enrolment, cohort seat and portal login all exist at the end | [ ] |
| ONB-013 | P1 | V | `/onboarding/new` with a phone that already exists | Offers the existing person rather than creating a duplicate | [ ] |
| ONB-014 | P1 | V | `/onboarding/new` with no phone | Record the behaviour; a person with no phone cannot be messaged by any engine | [ ] |
| ONB-015 | P2 | L | A person whose cohort is Draft | Gap "their cohort is not ready to teach", with the cohort's own checklist reachable | [ ] |
| ONB-016 | P2 | B | 200 people in flight | Lists paginate or group without timing out; the counts are honest | [ ] |
| ONB-017 | P2 | P | `/onboarding` as HEAD and as USER | Both can work the lists; neither sees money they should not | [ ] |

## 2.11 STU - Students

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| STU-001 | P1 | F | 90/120-day tracker tab | One row per active sprint student, with signal colour, days since last session and programme end date | [ ] |
| STU-002 | P1 | L | Produce a RED, an AMBER and a GREEN signal deliberately | Each colour follows the configured thresholds. The thresholds are **config**, not hardcoded - change one in Console and confirm the colour moves | [ ] |
| STU-003 | P1 | F | Sort by red-first, by longest-since-session, by programme-ends-soonest; filter by signal and by level | Each ordering and filter is correct | [ ] |
| STU-004 | P1 | U | The tab label when any student is RED | Carries a warning marker | [ ] |
| STU-005 | P1 | F | Weekly update panel: record an update for a student | Saved; the signal recalculates; the days-since count resets | [ ] |
| STU-006 | P1 | F | All students & totals tab: create a student with level, coach, start date | Saved and listed. Confirm the enrolment form offers **every** configured level - a form listing only Solo/Guided/Elite while levels are founder-editable is a known gap | [ ] |
| STU-007 | P1 | L | Add a level in Console, then reopen the enrolment form | The new level is offered. If not, that is the gap in STU-006 | [ ] |
| STU-008 | P1 | F | Change a student's status through ACTIVE, PAUSED, COMPLETED, DROPPED | Each moves them between the Active, Completed and Dropped counts | [ ] |
| STU-009 | P1 | L | Drop a student who has an open receivable | The money does not disappear from Cash Health; record where it goes | [ ] |
| STU-010 | P1 | F | Record a testimonial, a job offer and a satisfaction score | Each lands in the summary tiles (promoters, passives, detractors, sample size) | [ ] |
| STU-011 | P1 | L | Record satisfaction scores of 10, 8 and 6 | Counted as promoter, passive and detractor respectively; the boundaries (9, 7) are the ones to check | [ ] |
| STU-012 | P1 | F | Upgrade a student from one level to a higher one | Counted in the upgrade rate; the money and the enrolment both follow | [ ] |
| STU-013 | P1 | F | Book orders panel: request a quote, quote it, order, pay, courier | Each status moves; "ready to release" marks the right rows | [ ] |
| STU-014 | P1 | L | A book order that is deferred, then cancelled | Neither counts as a cost until it is actually ordered | [ ] |
| STU-015 | P1 | F | Import tab: import a valid CSV of 10 students | All 10 created, with a report naming each | [ ] |
| STU-016 | P1 | N | Import a CSV with a missing required column, a duplicate phone, a bad date and a bad level | Each bad row reported with its line number, and the good rows either all import or none do - say which, and whether that is intended | [ ] |
| STU-017 | P1 | B | Import the same file twice | No duplicates | [ ] |
| STU-018 | P1 | B | Import 500 rows | Completes or reports a cap; never a half-finished silent partial | [ ] |
| STU-019 | P1 | F | Student detail page: enrolment, cohort, payments, agreements, attendance, sprint log, milestones | Every panel loads and every row belongs to this student | [ ] |
| STU-020 | P1 | L | A student with two enrolments (an upgrade) | Both visible; money attributed to the right one; no double count in revenue | [ ] |
| STU-021 | P1 | F | Record milestone progress through onboarding, resume build, LinkedIn optimisation, applications, interviews, offer received, completed | Each saves and shows on the student's journey and on the student's own portal | [ ] |
| STU-022 | P1 | L | Record a derived metric (one the app computes) as if by hand | Refused - derived metrics are not re-loggable | [ ] |
| STU-023 | P2 | F | Student code generation for a new student | Unique, sequential, and matching the configured format | [ ] |
| STU-024 | P2 | B | Create two students at the same instant | Two different codes | [ ] |
| STU-025 | P2 | P | `/students` as USER and as HEAD | HEAD is view-only on the Students board per the role table; a USER sees what the role table allows. Record both | [ ] |
| STU-026 | P2 | F | Send login credentials to a student | Email **and** WhatsApp go out; the temporary password is redacted from the stored message params | [ ] |
| STU-027 | P2 | L | Send credentials twice | The second send issues a new temporary password, or refuses - never silently sends a password that no longer works | [ ] |

## 2.12 BATCH - Batches, plans, timetables, rosters

A cohort's state is derived: Draft means something it needs is missing. Fill the missing thing and
the cohort changes by itself.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| BATCH-001 | P1 | F | `/batches`: create a B2 cohort | Created as **Draft**, with a checklist naming exactly what is missing and a link to each fix | [ ] |
| BATCH-002 | P1 | L | Add, in turn, a plan, a teacher, a start date, classes on the calendar and one learner | The cohort becomes Ready on its own once it has a plan, a teacher and a learner | [ ] |
| BATCH-003 | P1 | L | With a plan, a teacher and a learner but **no dates and no timetable** | Start cohort is **enabled**: dates and the full timetable are on the checklist but do not block starting | [ ] |
| BATCH-004 | P1 | L | With a plan and a teacher but **no learner** | Start cohort is disabled, and the button says which of the three is missing | [ ] |
| BATCH-005 | P1 | L | Create a **German Note** cohort | Not asked for a plan or a built timetable; its classes are scheduled one at a time | [ ] |
| BATCH-006 | P1 | F | Start a Ready cohort | Running; the register and the student classroom come alive | [ ] |
| BATCH-007 | P1 | L | Teach every class in a Running cohort | Completed, by itself, with no status to set | [ ] |
| BATCH-008 | P1 | F | Archive a cohort from each of Draft, Ready, Running and Completed | All four allowed; archived cohorts leave the working lists | [ ] |
| BATCH-009 | P1 | F | Curriculum: write a week-by-week plan, reuse it on a second cohort | One plan, two cohorts, no copy | [ ] |
| BATCH-010 | P1 | L | Edit the plan after a cohort has taught two weeks from it | Record what happens to the taught weeks. A plan edit that rewrites history is a P1 LOGIC finding | [ ] |
| BATCH-011 | P1 | F | Generate a timetable from the plan | Dated sessions appear; times and durations match the pattern | [ ] |
| BATCH-012 | P1 | L | Re-generate the timetable after the cohort has taught sessions and taken registers | Careful merge, **not** delete-and-rewrite: taught sessions and their registers survive | [ ] |
| BATCH-013 | P1 | B | Generate a timetable across a month boundary and over a public holiday | Correct dates; no session on a day the pattern excludes | [ ] |
| BATCH-014 | P1 | F | Move one session to a new date and time | Only that session moves; its register and tasks follow it | [ ] |
| BATCH-015 | P1 | F | Cancel and postpone a session | Each status is distinct on the student's classroom, and neither counts as taught | [ ] |
| BATCH-016 | P1 | F | Roster: add five learners at once | All five seated in one action - not one trip per learner | [ ] |
| BATCH-017 | P1 | B | Add learners past the cohort's target strength | **A warning, not a refusal** - re-submitting proceeds. Confirm the warning names the capacity | [ ] |
| BATCH-018 | P1 | F | Remove a learner who has attendance recorded | Their past attendance is not destroyed; they leave the roster | [ ] |
| BATCH-019 | P1 | B | Add the same learner twice | One seat, not two | [ ] |
| BATCH-020 | P1 | L | Add a learner with no enrolment | Record whether it is allowed. A seated person who bought nothing should surface in Onboarding -> Needs completing | [ ] |
| BATCH-021 | P1 | F | Assign a coach, then change the coach | The new coach's teaching desk gains the cohort; the old one loses it, in both directions | [ ] |
| BATCH-022 | P1 | P | As COACH, open `/batches/<id>` for your own cohort and for another's | Own: opens. Other: refused | [ ] |
| BATCH-023 | P2 | F | Session tasks: add a watch-video, an apply-job, a homework and an other task | Each appears on the student's classroom with its completion state (yes, no, pending) | [ ] |
| BATCH-024 | P2 | F | Mark a task complete as the student, then as the coach | Both routes recorded, distinguishably | [ ] |
| BATCH-025 | P2 | L | Read every B2 batch count on a screen that shows both lines | Every GN batch read needs a line filter. A count that mixes B2 and German Note cohorts is the bug this case hunts | [ ] |
| BATCH-026 | P2 | B | 40 sessions in one cohort | Timetable renders and scrolls; the register desk is still usable | [ ] |

## 2.13 CLS - Classroom, teaching desk, attendance, resources, leaderboard, weekly reports

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| CLS-001 | P1 | F | `/coaching` as COACH | Only the cohorts they lead and the students they coach | [ ] |
| CLS-002 | P1 | P | `/coaching` as TUTOR | Only their German Note batches | [ ] |
| CLS-003 | P1 | P | `/coaching` as a person granted the section who teaches nothing | Honest empty desk | [ ] |
| CLS-004 | P1 | F | `/coaching` as ADMIN and HEAD | Supervisor view across cohorts | [ ] |
| CLS-005 | P1 | F | `/attendance`: mark a register (present, late, absent, excused) | Saved as marked, source TUTOR; **not yet visible to students** | [ ] |
| CLS-006 | P1 | L | Publish the register | Only now may students see the marks. Marking and publishing are two separate decisions, and publishing may come later | [ ] |
| CLS-007 | P1 | L | Correct a mis-tapped row **after** publishing | Allowed, and the correction is visible to the student | [ ] |
| CLS-008 | P1 | F | Open the self check-in window for a cohort | Only that cohort's students see a live "I'm here" button with a countdown | [ ] |
| CLS-009 | P1 | B | As a student in a different cohort during that window | No button | [ ] |
| CLS-010 | P1 | B | Check in one second before the window closes, and one second after | First succeeds, second refused. The server and the four screens that show the button must agree about the instant - a button the server then refuses is worse than no button | [ ] |
| CLS-011 | P1 | F | Check in as a student, then have the tutor correct that row | Student's self mark (source SELF) is overridden by the tutor's, and both are distinguishable | [ ] |
| CLS-012 | P1 | P | As HEAD, mark a register | Allowed - HEAD gained marking rights, which only widens access | [ ] |
| CLS-013 | P1 | P | As a user with the `attendance` section but not this batch | Marking refused inside the action (see NAV-021) | [ ] |
| CLS-014 | P1 | L | Publish a register where a student is ABSENT, with absence notices armed | The notice fires **on publish**, not on marking, and exactly once | [ ] |
| CLS-015 | P1 | L | Mark absent, then unmark before publishing | No notice is sent | [ ] |
| CLS-016 | P1 | F | `/classroom` as STUDENT | Their timetable, join links, recordings and coursework - and nothing from another cohort | [ ] |
| CLS-017 | P1 | L | A recording outside the configured viewing window | Withheld, with the window stated. One delivery fence governs this, replacing three earlier copies | [ ] |
| CLS-018 | P1 | L | The same recording inside the window | Plays; the watch is recorded | [ ] |
| CLS-019 | P1 | L | Check the delivery fence from each read side: student dashboard, classroom, coaching desk, attendance | All four agree. Three read-side copies once omitted HEAD - never re-derive this rule, and report any screen that disagrees | [ ] |
| CLS-020 | P1 | F | Resources: add a link-based resource at each of the three scopes | Exactly one scope per row; each appears only where its scope says | [ ] |
| CLS-021 | P1 | P | A resource with "visible to students" off | Filtered out in the **query**, not hidden in the markup - confirm it is absent from the page source too | [ ] |
| CLS-022 | P1 | F | `/leaderboard` as STUDENT | Their own cohort and their own breakdown, plus a box to log what the app cannot see | [ ] |
| CLS-023 | P1 | S | `/leaderboard` as STUDENT with classmate names **not** permitted | Names are replaced **on the server** before the view is serialised - check the page source, not just the screen. This is the first screen where a student sees another student | [ ] |
| CLS-024 | P1 | F | `/leaderboard` as staff | Named board for any cohort they run, plus the review feed | [ ] |
| CLS-025 | P1 | F | Log a sprint entry as a student, then correct it as a coach | Correction recorded; the original is visible in the review feed | [ ] |
| CLS-026 | P1 | L | Try to log a derived metric by hand | Refused | [ ] |
| CLS-027 | P1 | F | `/weekly-reports`: open the week, ask the cohort, chase non-responders, close the week | Each step happens once at the configured time; the engine is idempotent | [ ] |
| CLS-028 | P1 | F | Submitted / Still missing / Came in late | Each student in exactly one bucket; "late" is relative to the configured close time | [ ] |
| CLS-029 | P1 | L | Answers that should produce GREEN, YELLOW and RED | Each flag follows the configured rule; change a threshold and confirm the flag moves | [ ] |
| CLS-030 | P1 | F | Record each action: none, message sent, call scheduled, escalated | Saved against the response; visible in history | [ ] |
| CLS-031 | P2 | F | Weekly report templates and questions, all seven kinds | Each renders on the public form and saves | [ ] |
| CLS-032 | P2 | B | Submit the same weekly report twice | One response, or a replacement with history - never two live answers | [ ] |
| CLS-033 | P2 | F | History tab | Past cycles with their flags; closed cycles are read-only | [ ] |

## 2.14 GN - German Note

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| GN-001 | P1 | F | `/german-note`: Financials and Community tabs | Both load | [ ] |
| GN-002 | P1 | P | Financials as a user without `germanNote.finance` | Withheld; Community still works | [ ] |
| GN-003 | P1 | L | Financials figures versus `/finance` filtered to German Note | Agree. The two books are reported separately by design | [ ] |
| GN-004 | P1 | F | `/german-note/manage`: create a German level, set its price | Offered by every level picker and used by GL postings | [ ] |
| GN-005 | P1 | P | `/german-note/manage` as TUTOR | Refused - admin-only twice over | [ ] |
| GN-006 | P1 | F | `/german-note/members`: list members, add one, remove one | Roster correct; a removed member keeps their history | [ ] |
| GN-007 | P1 | F | Pending joiners | Listed; approving one seats them; rejecting one does not | [ ] |
| GN-008 | P1 | F | `/german-note/<batchId>`: schedule a class, record attendance, attach a recording | All three save and reach the student | [ ] |
| GN-009 | P1 | F | Community: post, comment, like, like a comment | Each saves and is attributed | [ ] |
| GN-010 | P1 | P | Community as a student in a different batch | Record the scoping rule and confirm it is applied consistently | [ ] |
| GN-011 | P1 | F | Post categories: general, announcement, question, win | Each renders distinguishably | [ ] |
| GN-012 | P1 | F | Mention a member in a post | They are notified; the mention links to them | [ ] |
| GN-013 | P1 | F | `/german-note/workshops/<id>`: create a workshop, register attendees, record conversions by level | Conversions recorded per level; status CONFIRMED and ON_HOLD both available | [ ] |
| GN-014 | P1 | L | Workshop profit and loss | Books and tutor costs are the cost of goods sold. Confirm nothing else is counted there | [ ] |
| GN-015 | P1 | F | Workshop with ad spend recorded, source AD versus ORGANIC | Cost per conversion computed per source | [ ] |
| GN-016 | P1 | B | Each workshop product (A1, A2, B1, A1_A2, A2_B1, A1_A2_B1) and each day type (weekday, weekend) | Pricing correct for all twelve combinations | [ ] |
| GN-017 | P1 | B | A workshop registration with a slot preference of weekday, weekend and either | Honoured when seating | [ ] |
| GN-018 | P2 | F | Recording with each provider (Fathom, YouTube, Vimeo, Google Drive) | All four embed or link correctly | [ ] |
| GN-019 | P2 | L | A pre-recorded session versus a live one | Different delivery; the student's classroom labels which | [ ] |
| GN-020 | P2 | F | Tutor fee: draft, approve, pay | A headcount change updates a DRAFT in place; an APPROVED fee does not move | [ ] |
| GN-021 | P2 | L | Change a batch's headcount after a tutor fee is APPROVED | The approved fee is unchanged, and the difference is visible somewhere | [ ] |

## 2.15 FIN - Finance, Cash, Payments, Commission

The highest-risk area in the app: it writes to the books, and the ledger is append-only.
**Every write case here is [LOCAL ONLY]** unless you void it immediately.

### Income

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FIN-001 | P1 | F | Income tab: record a rupee payment against a student | Saved; appears in revenue, in the student's paid-so-far, and on the ledger | [ ] |
| FIN-002 | P1 | F | Record a euro payment | Same, with the rate stamped at entry | [ ] |
| FIN-003 | P1 | L | Record income with the page filtered to German Note | The form opens on German Note with German levels. With the filter on ALL it must **not** pre-answer the business - that is how German Note money once filed into the B2 book | [ ] |
| FIN-004 | P1 | L | Record income under the ALL filter without choosing a business | Refused or explicitly asked. A silent default to B2 is a P1 LOGIC finding | [ ] |
| FIN-005 | P1 | F | Record a payment that names the instalment plan it pays off | Allocated to that plan; the plan's balance drops by exactly that amount | [ ] |
| FIN-006 | P1 | L | Record two payments for one student across two different plans | Paid-so-far is **per plan**, not summed per student. Four separate reported issues were one bug here - this is the regression case | [ ] |
| FIN-007 | P1 | L | Record a payment larger than the plan's balance | Refused, or the overpayment is visibly parked - never silently absorbed | [ ] |
| FIN-008 | P1 | F | Record income that creates a new student | Student exists afterwards and appears in Onboarding -> Needs completing with no programme | [ ] |
| FIN-009 | P1 | F | Each payment method: bank transfer INR, bank transfer EUR, PayPal, Razorpay, cash, UPI, credit card, other | All eight save, and each credits the account the configuration names | [ ] |
| FIN-010 | P1 | L | Record income and read which ledger account it credits | Follows the configured account for its category, not a hardcoded Bank-INR | [ ] |
| FIN-011 | P1 | F | Void an income row | Reversed on the ledger by a new entry, not by deleting the old one | [ ] |
| FIN-012 | P1 | B | Income dated in a **locked** period | Refused, naming the lock | [ ] |
| FIN-013 | P1 | V | Income with no student, no amount, no date | Each refused with the field named | [ ] |

### Expenses

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FIN-014 | P1 | F | Expense tab: record an expense in each founder-configured category | Each posts to **its own** profit-and-loss account | [ ] |
| FIN-015 | P1 | L | Record an expense and read `paidFromAccount` | Honoured. Without it everything credits Bank-INR, which is the bug this case guards | [ ] |
| FIN-016 | P1 | F | Record each business line: B2, German Note, Shared | Shared is apportioned as configured, not dumped on one book | [ ] |
| FIN-017 | P1 | F | Team payments panel inside Expenses: pay a team member | Appears as an expense and on that person's pay record | [ ] |
| FIN-018 | P1 | L | Team pay versus Owner's equity | Owner drawings go to equity, not to expenses. Confirm a founder's own money does not land in the profit and loss | [ ] |
| FIN-019 | P1 | F | Record a recurring payable at each frequency: monthly, quarterly, annual, one-time | Each schedules correctly; pausing one stops it; cancelling one ends it | [ ] |
| FIN-020 | P1 | F | Add a new expense category in Console with its own account | Offered by the picker; its rows post to that account | [ ] |
| FIN-021 | P1 | B | Delete an expense category that has rows | Refused, or migrated with a named destination - never orphaned rows | [ ] |

### Receivables, instalments, dunning

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FIN-022 | P1 | F | Pending payments tab: create a receivable with a 3-instalment plan | Three instalments with dates and amounts; the surcharge is snapshotted from the Console configuration for that plan length | [ ] |
| FIN-023 | P1 | L | Change the Console surcharge, then re-read the existing receivable | Unchanged - it carries its own snapshot | [ ] |
| FIN-024 | P1 | B | A plan whose total does not divide evenly into three | The rounding difference lands on one named instalment; the parts sum exactly to the total | [ ] |
| FIN-025 | P1 | F | Pay instalment 2 before instalment 1 | Allowed or refused - record which, and that the plan's balance is right either way | [ ] |
| FIN-026 | P1 | L | Let an instalment pass its date | Status becomes OVERDUE on the sweep, and it appears in Cash Health under Past due | [ ] |
| FIN-027 | P1 | L | *Dunning engine OFF.* Leave an instalment overdue | Nothing is chased, and Payments **says so** with a link to switch it on - not a silent nothing | [ ] |
| FIN-028 | P1 | L | *Dunning ON.* Walk one receivable through UPCOMING, MISSED and FINAL | One message per stage, recorded; running the cron twice sends nothing twice | [ ] |
| FIN-029 | P1 | F | Pay a plan in full | Status PAID_IN_FULL; it leaves the open-balance tiles; dunning stops | [ ] |
| FIN-030 | P1 | F | Write off a receivable, and separately mark one DROPPED | Each leaves the open balance and is reported differently | [ ] |
| FIN-031 | P1 | L | Restate a plan (change the total after payments exist) | Existing payments stay attributed; the new schedule accounts for what is already paid | [ ] |
| FIN-032 | P1 | L | Archive a payment, then read paid-so-far and the plan balance | Both exclude it | [ ] |

### Cash Health

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FIN-033 | P1 | F | `/cash`: cash position, past due, due within 30 days, due later, payables | Each bucket's total equals the sum of its rows | [ ] |
| FIN-034 | P1 | L | Runway with a non-zero burn | Balance divided by the three-month average burn | [ ] |
| FIN-035 | P1 | B | Runway with **zero** burn | No divide-by-zero: an explicit "no burn recorded" rather than Infinity | [ ] |
| FIN-036 | P1 | B | A due date exactly 30 days away, and exactly 31 | Lands in the right bucket at both boundaries | [ ] |
| FIN-037 | P1 | F | Cash targets configured in Console | The screen measures against them; with none set it says so | [ ] |
| FIN-038 | P1 | F | Equity: record a contribution and a drawing | Both on the equity account, neither in the profit and loss | [ ] |

### Payments, invoices, products

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FIN-039 | P1 | F | `/payments/new`: raise an invoice | The product picker offers the **programme products**. Live has had **0 products**, which empties the picker - if it is empty, create F6 before filing a bug | [ ] |
| FIN-040 | P1 | L | An invoice while in DRAFT | Reference reads as a draft placeholder, never a real number | [ ] |
| FIN-041 | P1 | L | Issue the invoice | The number is drawn **at issue** in the configured format; the invoice is then locked | [ ] |
| FIN-042 | P1 | B | Issue three invoices in a row | Sequential numbers, no gaps, no reuse | [ ] |
| FIN-043 | P1 | B | Issue two invoices simultaneously from two tabs | Two different numbers | [ ] |
| FIN-044 | P1 | N | Edit an issued invoice | Refused - issued means locked. A credit note or a void is the route | [ ] |
| FIN-045 | P1 | F | Void an issued invoice | VOID; the number is **not** reused; the ledger is reversed by a new entry | [ ] |
| FIN-046 | P1 | F | Record a partial payment, then the balance | Status PARTIAL then PAID; the balance is right at each step | [ ] |
| FIN-047 | P1 | L | An invoice past its due date, unpaid | OVERDUE | [ ] |
| FIN-048 | P1 | F | Raise an estimate, then accept it, and separately decline one | ACCEPTED and DECLINED; an accepted estimate can become an invoice | [ ] |
| FIN-049 | P1 | L | Tax: an invoice in rupees and one in euros | Tax is **per currency** and ships at 0%. Confirm the rate applied is the one configured for that currency | [ ] |
| FIN-050 | P1 | L | The German VAT paragraph-14 gate | Needs the Tax ID blank on live to behave as specified. Confirm the rendered invoice states the right thing for the configuration in force | [ ] |
| FIN-051 | P1 | F | `/i/<token>` as the customer, beside the PDF | The page and the PDF state the **same** figures, tax line and issuer - both read one builder | [ ] |
| FIN-052 | P1 | F | Download the receipt for a payment | Correct amount, date, method and student | [ ] |
| FIN-053 | P1 | F | Products tab: create a product per level with a price | `levelCode` is unique; price lives only here, not on the enrolment | [ ] |
| FIN-054 | P1 | N | Create a second product for a level that already has one | Refused | [ ] |
| FIN-055 | P1 | F | Each product interval: one-time, monthly, quarterly, yearly | All four save and bill as named | [ ] |
| FIN-056 | P1 | L | *Invoice-posting engine OFF.* Issue an invoice | No ledger entry, and the screen says why | [ ] |
| FIN-057 | P1 | L | Same with the engine ON | One ledger entry per invoice; issuing twice does not post twice | [ ] |

### Commission, bonuses, tutor fees, the ledger

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FIN-058 | P1 | F | `/telecaller`: bonuses and commission for one person and one month | Each figure traces to a named sale or a named rule | [ ] |
| FIN-059 | P1 | L | Change a commission rate in Console, then re-read a **past** month | Record whether history restates or is frozen. A paid month that silently restates is a P1 LOGIC finding | [ ] |
| FIN-060 | P1 | L | A sale with a first-caller, a discovery specialist and a closer, all different people | Each share goes to the right person, and the three shares sum to the configured total - no more | [ ] |
| FIN-061 | P1 | L | A sale where one person held two of the three roles | Paid once per role, not double for the same role | [ ] |
| FIN-062 | P1 | L | *Commission-accrual engine OFF.* Close a sale | Nothing accrues, and the screen says so | [ ] |
| FIN-063 | P1 | F | Run a commission payout: PENDING then PAID | Each status recorded with who approved it | [ ] |
| FIN-064 | P1 | L | *Tutor-fee accrual OFF, then ON.* Teach a session | Off: nothing. On: one accrual per session, not per read | [ ] |
| FIN-065 | P1 | F | Ledger: read the journal for one income row | Debits equal credits; the source type names the row it came from | [ ] |
| FIN-066 | P1 | N | Try to edit or delete a posted journal entry | Impossible. Void posts a reversing entry | [ ] |
| FIN-067 | P1 | F | Lock a period, then attempt an entry inside it | Refused. Unlock, repeat: allowed | [ ] |
| FIN-068 | P1 | L | Opening balances and an FX revaluation entry | Each visible as its own source type, not mixed into trading income | [ ] |
| FIN-069 | P1 | L | Net profit on the Finance tiles | Computed on **cash collected**, not on quoted or invoiced value | [ ] |
| FIN-070 | P1 | L | Gross profit, cost of goods sold, margin | Each tile's arithmetic checks out against its own components; margin is not computed from a different revenue figure than the one displayed | [ ] |
| FIN-071 | P1 | L | Compare every Finance tile against the tables below it | Tile and table agree. A tile that disagrees with the rows it summarises is the single most valuable finding in this section | [ ] |
| FIN-072 | P2 | F | Yearly revenue to date, with and without data | Correct, and an honest empty state rather than a zero that looks like a loss | [ ] |
| FIN-073 | P2 | F | CSV export from each Finance tab under a filter | Matches the filter and the on-screen totals | [ ] |

## 2.16 MKT - Website, funnels, forms, WhatsApp, conversations

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| MKT-001 | P1 | F | `/sites`: create a site, add a page, publish it | Live at `/s/<slug>/<path>` immediately - publishing revalidates rather than waiting for a cache window | [ ] |
| MKT-002 | P1 | F | Edit a published page and save | The change is live immediately | [ ] |
| MKT-003 | P1 | F | Header, footer and reusable sections | Each renders on every page that uses it; editing it updates all of them | [ ] |
| MKT-004 | P1 | F | Page revisions: make three edits, then restore the first | Restores exactly, and the restore is itself a revision | [ ] |
| MKT-005 | P1 | B | A site page with a query string on the public URL | The page is cached and must not vary on query parameters; confirm no stale or personalised content leaks | [ ] |
| MKT-006 | P1 | F | Media library: upload an image, use it on a page | Renders on the public page while signed out | [ ] |
| MKT-007 | P1 | B | Upload a 15MB image, and a file that is not an image | Refused with a reason - the cap is 12MB | [ ] |
| MKT-008 | P1 | S | Upload a `.svg` containing a script, and a `.php` renamed to `.png` | Refused, or stored in a way that cannot execute. This endpoint writes to a public bucket | [ ] |
| MKT-009 | P1 | F | `/funnels`: build a funnel with three steps, publish | Live at `/p/<slug>` and `/p/<slug>/<step>` | [ ] |
| MKT-010 | P1 | F | Visit a funnel step as a cold visitor | A visitor cookie is stamped, and the view count increments | [ ] |
| MKT-011 | P1 | B | Visit with cookies refused | The page still renders | [ ] |
| MKT-012 | P1 | F | Funnel A/B split: two variants | Visitors are split, and a returning visitor sees the same variant | [ ] |
| MKT-013 | P1 | F | Funnel auto-pull into the pipeline | A submission creates a lead with the right source and reaches a desk | [ ] |
| MKT-014 | P1 | U | Share a funnel link into WhatsApp | The preview card is the funnel's, not the app's private-dashboard title | [ ] |
| MKT-015 | P1 | S | Search for a funnel step's URL in a search engine, and read its robots meta | Not indexable. A thank-you or booking-confirmation step ranking for the brand is the failure | [ ] |
| MKT-016 | P1 | F | `/forms`: build a form with every field type, publish it | Live at `/f/<slug>`; every field renders | [ ] |
| MKT-017 | P1 | F | Submit the public form | Submission stored; the configured redirect happens; a lead is created if the form is wired to the pipeline | [ ] |
| MKT-018 | P1 | F | A form with a file-upload field: submit a CV | Stored and attached to the submission | [ ] |
| MKT-019 | P1 | S | POST to the form-upload endpoint for a form that has **no** file field, and for an unpublished form | Both refused. It is bound to a published form with such a field, rate limited, magic-byte sniffed and size capped - it is not a general uploader | [ ] |
| MKT-020 | P1 | S | POST 30 uploads in a minute | Rate limited | [ ] |
| MKT-021 | P1 | S | Upload a file whose extension and contents disagree | Refused on the magic bytes | [ ] |
| MKT-022 | P1 | V | Submit the form with required fields empty, and with a 50,000-character answer | Refused cleanly in both cases | [ ] |
| MKT-023 | P1 | U | Share a form link | Preview card is the form's, and the page is not indexable | [ ] |
| MKT-024 | P1 | F | `/whatsapp`: the template catalogue | Lists all templates with their state. As of this writing the pack holds **51 templates, 3 never submitted and 30 needing some action**. An unsubmitted template cannot send, and that is a configuration finding, not a bug - but confirm the screen's own counts match the pack | [ ] |
| MKT-025 | P1 | L | A template with a declared-but-empty variable | The send is **skipped**, which is why `_zoom` and `_portal` are separate template names rather than optional variables | [ ] |
| MKT-026 | P1 | L | Bind readable variable names to the confirm-request template | Must **not** be done - that template is positional. Confirm it is still positional | [ ] |
| MKT-027 | P1 | F | Delivered and Read tallies | Match the per-message statuses; a failed send is visible, not swallowed | [ ] |
| MKT-028 | P1 | L | Force a send failure (a bad number) | Surfaces in the tally and in the cron heartbeat. A Meta cap once classified as a recipient problem could **never** alert - confirm a cap-type failure does alert | [ ] |
| MKT-029 | P1 | F | Settings tab: the test recipient and the enabled flag | With the flag on and no test recipient, outbound goes to **real numbers**. Confirm the screen says so unmistakably | [ ] |
| MKT-030 | P1 | F | Opt-out list: add a number, then trigger a send to it | Skipped, with the reason recorded | [ ] |
| MKT-031 | P1 | F | `/whatsapp/stage-messages`: edit a stage's WhatsApp and email wording, save | The outreach cron sends the new wording. This page is the only editor for live messages - a deleted page would leave a cron messaging real prospects with no way to read the text | [ ] |
| MKT-032 | P1 | V | Save a stage message with one field blank | Refused, because every field must be non-empty: a blank variable **skips** the send | [ ] |
| MKT-033 | P1 | L | The email half of a stage message | Reads the same values as the WhatsApp half; confirm both go out, not just one | [ ] |
| MKT-034 | P1 | F | `/conversations`: inbox with inbound WhatsApp, email and SMS | All three channels appear, attributed to the right lead | [ ] |
| MKT-035 | P1 | L | An inbound reply from a number that matches no lead | Still visible somewhere, not silently dropped | [ ] |
| MKT-036 | P1 | F | Reply from the inbox | Sent and logged as outbound, with the status advancing on the delivery callback | [ ] |
| MKT-037 | P2 | F | Leave the inbox open; send an inbound message | Appears within the poll interval | [ ] |
| MKT-038 | P2 | F | Conversations Settings tab | Changes take effect on the next poll | [ ] |

## 2.17 INS - Reports, Funnel Report, Daily Log, Arena, Activity

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| INS-001 | P1 | F | `/reports` as ADMIN, HEAD and USER | Each sees a report set appropriate to their role; no finance figures for HEAD or USER | [ ] |
| INS-002 | P1 | L | Every report's period selector: this month, last month, a custom range | Figures change, and the same range on two reports agrees | [ ] |
| INS-003 | P1 | L | Compare each report against its source screen | Agreement everywhere. Record each disagreement with both numbers | [ ] |
| INS-004 | P1 | F | `/funnel`: downloads, completed discovery calls, enrolled, enrolled in Guided, paying students, average revenue per student | Each count traces to the records behind it | [ ] |
| INS-005 | P1 | B | A conversion rate with a zero denominator | Explicit "no data", never 0% presented as a fact and never NaN | [ ] |
| INS-006 | P1 | L | Same-month conversion | Counts only conversions in the month the lead arrived; a lead converting next month does not appear in this month's figure | [ ] |
| INS-007 | P1 | L | The Ghosted Blueprint attribution tag | Only leads carrying it are in the Ghosted Blueprint figures | [ ] |
| INS-008 | P1 | F | Weekly funnel snapshot | Written once per week; re-running does not overwrite with a partial. **Never run the snapshot specs against production** | [ ] |
| INS-009 | P1 | F | `/daily-log` as HEAD, COACH and TUTOR | Each can submit their own log and sees only their own | [ ] |
| INS-010 | P1 | L | Submit a daily log after the configured cutoff | Refused by the real clock, whether or not any cron ticks | [ ] |
| INS-011 | P1 | L | Leave a log unsubmitted past the cutoff with the cron running | Auto-saved once, source EOD_AUTO, distinguishable from a HUMAN entry | [ ] |
| INS-012 | P1 | B | The cron ticks four times after the cutoff | One auto-save, not four | [ ] |
| INS-013 | P1 | L | A laptop asleep at the cutoff, waking an hour later | The day is auto-saved on the next tick, not missed | [ ] |
| INS-014 | P1 | L | Daily targets configured in Console | The log measures against them; everything on the timeline is derived purely from the log | [ ] |
| INS-015 | P1 | F | `/arena`: leaderboard, quests, badges, XP feed | Every number derives from work recorded elsewhere; nothing can be entered directly | [ ] |
| INS-016 | P1 | L | ADMIN and HEAD with team profiles | Both see the Arena but neither appears in the ranking. Telecallers rank normally | [ ] |
| INS-017 | P1 | L | Record a pipeline move, a daily log and a student milestone | XP appears for each, once | [ ] |
| INS-018 | P1 | L | Reverse one of those (undo the stage move) | XP is withdrawn, or the rule is explicitly "earned is kept" - record which | [ ] |
| INS-019 | P1 | F | Goals: create a company-scoped and a user-scoped goal, each over month, quarter and year | All six combinations judged on the right total | [ ] |
| INS-020 | P1 | F | Reward rules: produce a grant, then approve, decline and pay one | Each status recorded; declining does not pay | [ ] |
| INS-021 | P1 | P | Approve a grant without `rewards.approve` | Refused | [ ] |
| INS-022 | P1 | F | `/activity`: the full matrix of filters and the two views | See XC-029 to XC-032 | [ ] |

## 2.18 ADM - Console, Users, Programs, Improvements, Maintenance

### Console: Access

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-001 | P1 | F | Sections panel | Covered by NAV-007 to NAV-016 | [ ] |
| ADM-002 | P1 | F | Access Matrix panel | Reads the same truth as the sidebar; a change here is visible there, and vice versa | [ ] |
| ADM-003 | P1 | F | Per-person rules panel | Covered by NAV-017 and NAV-018 | [ ] |
| ADM-004 | P1 | B | Save a sections config with an unknown key, and with a known key missing | Unknown keys ignored (a route was removed); missing keys fall back to the catalogue (a route was added). Neither breaks the sidebar | [ ] |

### Console: Money

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-005 | P1 | F | Commission panel: edit each rate | Saved; Bonus & Commission and Finance both follow - one rule, not two | [ ] |
| ADM-006 | P1 | F | Instalment Plans panel: set a surcharge per plan length | New receivables snapshot it; existing ones do not move | [ ] |
| ADM-007 | P1 | F | Payment Types panel: add a type | Offered by the income form, and branching is on its **kind**, not its code | [ ] |
| ADM-008 | P1 | L | Add a payment type whose kind matches an existing one | Both behave the same way, because the code is a label and the kind is the rule | [ ] |
| ADM-009 | P1 | F | Expense categories panel: add one with its own account number | Offered by the picker and posting to that account | [ ] |
| ADM-010 | P1 | F | Invoicing panel: number format, tax per currency, issuer details, tax ID | Each reflected on a newly issued invoice and on `/i/<token>` | [ ] |
| ADM-011 | P1 | F | Cash targets panel | Reflected on `/cash` | [ ] |
| ADM-012 | P1 | F | Tutor Fee panel and the Tutor Fees queue | Rates configurable; DRAFT fees recompute, APPROVED ones do not; the queue count matches the drafts | [ ] |

### Console: Sales ops

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-013 | P1 | F | Qualification panel | Covered by QUAL-001 to QUAL-012 | [ ] |
| ADM-014 | P1 | F | Call Distribution panel: set the share and the Saturday flag | New leads distribute accordingly; the Saturday flag is honoured | [ ] |
| ADM-015 | P1 | B | Shares that do not sum to 100% | Refused, or normalised with the result stated | [ ] |
| ADM-016 | P1 | F | Availability panel | Covered by BOOK-002 onward | [ ] |
| ADM-017 | P1 | F | Zoom links panel: set a per-person link | Carried onto that person's bookings | [ ] |
| ADM-018 | P1 | F | Confirm-or-cancel panel | Covered by BOOK-017 to BOOK-020 | [ ] |
| ADM-019 | P1 | F | Operations panel | Each setting takes effect on the screen it governs; note any that need a deploy | [ ] |
| ADM-020 | P1 | F | Lead Webhook panel: generate a key, switch the webhook on, post a lead | Accepted. Switch it off and post again: refused | [ ] |
| ADM-021 | P1 | S | Rotate the key, then post with the old key | Refused | [ ] |
| ADM-022 | P1 | L | Read the public links the templates use | They are config-backed variables now, not constants. Change one and confirm the message text follows - a constant URL in a message is the bug this guards | [ ] |

### Console: Delivery and team

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-023 | P1 | F | Agreements panel: set readiness to DEPOSIT, WON and EITHER | Covered by AGR-019 to AGR-021 | [ ] |
| ADM-024 | P1 | F | Delivery defaults panel | New cohorts inherit them; existing ones do not change | [ ] |
| ADM-025 | P1 | F | Daily Targets panel | Reflected on `/daily-log` | [ ] |
| ADM-026 | P1 | F | Gamification panel: change XP per action | Arena follows; past XP is not silently restated (or is - record which) | [ ] |
| ADM-027 | P1 | F | Goals and Rewards panels | Covered by INS-019 to INS-021 | [ ] |
| ADM-028 | P1 | F | Weekly reports panel: open and close times, question set | Covered by CLS-027 onward | [ ] |
| ADM-029 | P1 | F | Levels configuration | Levels are founder-editable. Add one and confirm it reaches every picker, including the Students enrolment form | [ ] |

### Console: System

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-030 | P1 | F | Not armed panel | Lists all seventeen engines, what is **not** happening while each is off, and where to switch it on. The count in the tab label matches the list | [ ] |
| ADM-031 | P1 | L | Switch one engine on and re-read the panel | It leaves the list. Four engines compute a sharper answer at runtime (email, WhatsApp, class reminders, cron) - confirm those four report their real state, not the fallback text | [ ] |
| ADM-032 | P1 | L | For each of the seventeen, open the feature screen with the engine off | The screen itself says what is not happening - not an empty panel that reads as broken | [ ] |
| ADM-033 | P1 | F | Alerts & Chasing panel: set recipients and arm the alert | Alerts fire on the configured cadence, with the engine's own cooldown preventing noise | [ ] |
| ADM-034 | P1 | L | Arm an alert with **no** recipients | No-op, stated plainly, rather than a silent failure | [ ] |
| ADM-035 | P1 | F | Leaderboard panel: visibility of classmate names | Covered by CLS-023 | [ ] |
| ADM-036 | P1 | F | Why students stop panel | Reasons configurable and used by the termination report | [ ] |
| ADM-037 | P1 | F | Improvements panel | Covered by ADM-040 onward | [ ] |
| ADM-038 | P1 | F | Maintenance panel: run each maintenance action | Each reports what it did; none is destructive without asking | [ ] |
| ADM-039 | P1 | L | Cron heartbeat on the System panel | Reports the last tick per job. Stop the scheduler and confirm it goes stale - a dead-man's switch that never fires is worthless | [ ] |

### Improvements

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-040 | P1 | F | File a report as each of the six roles | Filing is **ungated** for all six | [ ] |
| ADM-041 | P1 | F | File one of each kind: not working, wrong result, logic change, missing state, new feature, confusing, access | Each kind asks its own questions | [ ] |
| ADM-042 | P1 | F | File at each severity: blocking, annoying, minor | Reflected in the queue's ordering | [ ] |
| ADM-043 | P1 | F | Attach a voice recording, and separately a screen capture of this tab | The form **hides** while recording so the reporter can roam; a recording makes the typed fields optional | [ ] |
| ADM-044 | P1 | F | Attach files to a report | Stored and listed | [ ] |
| ADM-045 | P1 | P | Open a report's recording and attachments as ADMIN, HEAD, the reporter, and an unrelated user | One read rule governs all of them. The head coach was once missing from it and saw a 403 player - confirm HEAD can play it | [ ] |
| ADM-046 | P1 | P | As HEAD: read, escalate, and attempt to triage | Read and escalate work; triage refuses. HEAD escalates **without** gaining triage | [ ] |
| ADM-047 | P1 | F | Walk a report through NEW, TRIAGED, ACCEPTED, IN_PROGRESS, FIXED, CLOSED | Each transition recorded with who and when | [ ] |
| ADM-048 | P1 | F | Mark one DECLINED and one DUPLICATE | Both leave the working queue and stay readable | [ ] |
| ADM-049 | P1 | F | Comment, re-kind, assign | Each is its own event on the report's history | [ ] |
| ADM-050 | P1 | F | Captured context on a report | Names the screen, the role and the engines in force at the time | [ ] |

### Users and Programs

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| ADM-051 | P1 | F | `/people` -> Users & access: create a user at each of the six roles | All six offered. A picker that offers only some roles **silently rewrites** the ones it cannot represent - a form listing only Admin/Head/User once turned a coach into an admin on save | [ ] |
| ADM-052 | P1 | L | Open and save a COACH's profile without changing anything | Still a COACH afterwards. This is the regression case for ADM-051 | [ ] |
| ADM-053 | P1 | F | Suspend, unsuspend and delete a user | Covered by AUTH-028 to AUTH-032 | [ ] |
| ADM-054 | P1 | F | Set a user's password as admin | They are forced to change it on next sign-in | [ ] |
| ADM-055 | P1 | F | Team & org chart tab: create a TeamProfile, set `logVariant`, role title, first-call share, Saturday flag | Each drives the desk, the commission split and the slot generation respectively | [ ] |
| ADM-056 | P1 | L | A User with no TeamProfile, and a TeamProfile with no User | Both states are visible as incomplete rather than invisible - a person is two records | [ ] |
| ADM-057 | P1 | F | OKRs tab: create, update and close an OKR | Reflected on the Arena and on the person's own screens | [ ] |
| ADM-058 | P1 | F | Invite a user, then revoke the invite before redemption | The link stops working | [ ] |
| ADM-059 | P1 | F | Access requests: raise one, approve it, decline another | Approval grants exactly what was asked; decline grants nothing | [ ] |
| ADM-060 | P1 | F | Offboard a user: suspend, revoke sections, delete | At each step, confirm what they can still open. After the last, nothing | [ ] |
| ADM-061 | P1 | F | Termination report for a person | Downloads, naming the right reason from the configured list | [ ] |
| ADM-062 | P1 | F | `/programs`: create a coaching tier, set its price via its product | The catalogue moves every level picker and GL posting. Price lives only on the product | [ ] |
| ADM-063 | P1 | P | `/programs` as HEAD and USER | Refused | [ ] |
| ADM-064 | P1 | B | Rename a level that students are enrolled on | Existing enrolments follow or are refused - never orphaned | [ ] |
| ADM-065 | P1 | B | Deactivate a level with active students | Warns; it leaves new pickers but existing students are unaffected | [ ] |

## 2.19 PORT - The student and tutor portals

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| PORT-001 | P1 | F | `/my-journey` as STUDENT | Only their own data: sessions, applications, interviews, milestones, scoreboard | [ ] |
| PORT-002 | P1 | S | Try to read another student's journey by changing an id in any URL or request | Refused everywhere | [ ] |
| PORT-003 | P1 | F | `/dashboard` as STUDENT | Timetable, next class, check-in button when the window is open, outstanding coursework | [ ] |
| PORT-004 | P1 | L | `/dashboard` for a student whose cohort is Draft | An honest "your cohort has not started" rather than an empty page | [ ] |
| PORT-005 | P1 | F | `/classroom` as STUDENT | Covered by CLS-016 to CLS-021 | [ ] |
| PORT-006 | P1 | F | `/leaderboard` as STUDENT | Covered by CLS-022 and CLS-023 | [ ] |
| PORT-007 | P1 | F | `/profile`: change the theme to system, light and dark | Persists across sessions and devices | [ ] |
| PORT-008 | P1 | F | `/profile`: change your own password | Works; the old one stops working | [ ] |
| PORT-009 | P1 | S | `/profile`: attempt to change your own role or sections | Not offered, and refused if forced | [ ] |
| PORT-010 | P1 | F | Record a job application and move it through APPLIED, INTERVIEW, SELECTED, REJECTED | Each reflected in the student's own counts and in the staff-side tracker | [ ] |
| PORT-011 | P1 | L | A student with no enrolment signing in | A clear next step, not a wall of empty panels | [ ] |
| PORT-012 | P2 | F | The portal at 390px | Every action reachable; no horizontal scroll | [ ] |

---

# Part 3 - Public surfaces, API and cron

## 3.1 PUB - Pages a stranger can open

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| PUB-001 | P1 | S | List every route reachable without a session, and compare against the middleware public list | Exactly: `/book`, `/invite`, `/agreement`, `/f`, `/p`, `/i`, `/s`, `/media`, brand assets, and the webhook, intake, form-upload, cron and health API prefixes. Anything else reachable is a P1 | [ ] |
| PUB-002 | P1 | S | Confirm `/api/export` is **not** public | A public export of the contact database would be the worst hole this list could open | [ ] |
| PUB-003 | P1 | S | Request `/whatsapp` and `/weekly-reports` signed out | Both refused. There is no public weekly-report route at all any more - the form is answered only in the portal | [ ] |
| PUB-004 | P1 | F | `/book` as a stranger: pick a slot, answer the qualification questions, submit | Booking made; a lead created with the booking source; confirmation shown | [ ] |
| PUB-005 | P1 | B | `/book` with no slots available | Says so, with what to do instead - not a blank calendar | [ ] |
| PUB-006 | P1 | V | `/book` submitting a name with no phone | Record the behaviour. A phone-less booking cannot be messaged by anything | [ ] |
| PUB-007 | P1 | S | `/book`: submit 20 times in a minute | Rate limited | [ ] |
| PUB-008 | P1 | S | `/book`: submit a script tag in every text field, then read the lead in the back office | Rendered as text, never executed | [ ] |
| PUB-009 | P1 | F | `/f/<slug>` for a published form, and for an unpublished one | Published renders; unpublished is not found | [ ] |
| PUB-010 | P1 | F | `/p/<slug>` and `/p/<slug>/<step>` | Render; a visitor cookie is set; views count | [ ] |
| PUB-011 | P1 | F | `/s/<slug>` and a nested path | Render from cache; a publish makes an edit live at once | [ ] |
| PUB-012 | P1 | F | `/i/<token>` for an issued invoice | Matches the PDF exactly | [ ] |
| PUB-013 | P1 | S | `/i/<token>` with a token for a **draft** invoice, and with a random token | Refused in both cases | [ ] |
| PUB-014 | P1 | S | Request `/w`, `/w/<anything>` and an old cohort-link URL | Redirected to `/login` like any other private route - the public weekly form is gone, and the report is answered only on the student's dashboard | [ ] |
| PUB-015 | P1 | F | Sign in as a student and submit the week from My Journey, then try the same cycle as a student on another cohort | Own week accepted; the other cohort's refused. The session is the whole identity check | [ ] |
| PUB-016 | P1 | S | Read the WhatsApp message a student receives when their week opens | It points at the portal, carries no token, and lets nobody who is not signed in answer as anybody | [ ] |
| PUB-017 | P1 | S | `/agreement/<token>` | Covered by AGR-026 to AGR-038 | [ ] |
| PUB-018 | P1 | S | Every public page: read the HTML source for data beyond what the page shows | No other person's name, phone, email or figures in the payload | [ ] |
| PUB-019 | P2 | U | Every public page while signed out, in dark mode, at 390px | Brand assets render (no empty masks), layout holds, no horizontal scroll | [ ] |
| PUB-020 | P2 | U | Share each public link into WhatsApp | Each preview card is the page's own, never the app's private-dashboard title | [ ] |

## 3.2 API - Webhooks and endpoints

*Use curl or a REST client. Record the exact status code and body for each.*

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| API-001 | P1 | S | POST `/api/leads/b2consultants` with **no** secret | Refused, fail-closed | [ ] |
| API-002 | P1 | S | Same with the secret in the `x-webhook-secret` header, and in the `?key=` query | Both accepted - a form webhook that only takes a URL needs the query form | [ ] |
| API-003 | P1 | S | Same with the secret unset in the environment | 503, fail-closed - never "accept everything" | [ ] |
| API-004 | P1 | F | POST the same payload twice | De-duped on source plus external reference, then phone, then email. One lead | [ ] |
| API-005 | P1 | L | POST a lead with **no phone** | 422 - and the only trace is the reverse-proxy log. Confirm whether the 422 is now visible anywhere in the app; if not, that is a P1 observability finding | [ ] |
| API-006 | P1 | F | POST a lead whose email already exists against a different phone | Record which rule wins, and that no data is lost | [ ] |
| API-007 | P1 | S | GET `/api/leads/meta` with a matching verify token, and with a wrong one | Challenge echoed; wrong token refused | [ ] |
| API-008 | P1 | S | POST `/api/leads/meta` with a valid signature, a tampered body, and no signature | Accepted, refused, refused | [ ] |
| API-009 | P1 | S | POST `/api/leads/meta` with the app secret unset | 503 - it refuses rather than accepting unverifiable payloads | [ ] |
| API-010 | P1 | F | POST `/api/leads/pabbly` with each origin in `lead_source` | Mapped onto the right source; the pipe is always recorded as Pabbly | [ ] |
| API-011 | P1 | L | POST the same lead to Pabbly **and** the direct intake endpoint | Dual-write by design - do not cut the relay off. Confirm one lead results, not two | [ ] |
| API-012 | P1 | F | POST `/api/intake/lead` with every qualification answer | All reach the scorer verbatim; unrecognised fields are recorded as evidence | [ ] |
| API-013 | P1 | S | POST `/api/intake/lead` with no secret | Refused, same contract as the other lead endpoints | [ ] |
| API-014 | P1 | F | POST `/api/wati/webhook` with a delivery status for a known message id | That message advances to sent, delivered, read or failed | [ ] |
| API-015 | P1 | F | POST `/api/wati/webhook` with an inbound reply | The last outbound to that number is marked replied, an inbound row is logged, and STOP opts the number out | [ ] |
| API-016 | P1 | S | POST `/api/wati/webhook` with a payload shape nobody recognises, after passing auth | 200, so WATI does not enter a retry storm | [ ] |
| API-017 | P1 | S | POST `/api/wati/webhook` with no secret | 503 | [ ] |
| API-018 | P1 | S | POST `/api/resend/webhook` with a valid Svix signature, and with an invalid one | Accepted, refused | [ ] |
| API-019 | P1 | L | POST `/api/resend/webhook` with the webhook secret empty | 503. An email marked SENT means only that Resend accepted it - **not** that it was delivered. Confirm the screen wording reflects that | [ ] |
| API-020 | P1 | F | POST a `email.received` event | The body is fetched from the receiving API and logged as an inbound message, matched to a lead by sender | [ ] |
| API-021 | P1 | F | POST `/api/twilio/webhook` with an inbound SMS, and with a status callback | Inbound logged; the status half is implemented but dormant unless outbound sets a status callback - record what you observe | [ ] |
| API-022 | P1 | S | GET `/api/export/leads` signed out, as a role without the section, and as ADMIN | Refused, refused, succeeds | [ ] |
| API-023 | P1 | F | GET `/api/export/<entity>` for every exportable entity | Each returns a CSV matching the screen's filter | [ ] |
| API-024 | P1 | S | GET `/api/export/<unknown-entity>` | Clean 404, no stack trace | [ ] |
| API-025 | P1 | F | GET `/api/health` | `ok` with a latency number, and the channel summary as booleans only. It touches the database deliberately | [ ] |
| API-026 | P1 | S | Read `/api/health` for anything sensitive | No schema, no counts, no configuration values | [ ] |
| API-027 | P1 | F | Stop the database and GET `/api/health` | `degraded`, not `ok` - a process that is up but cannot reach the database is not ready to serve | [ ] |
| API-028 | P1 | S | POST `/api/media/upload` signed out, and without `sites.manage` | Refused in both cases | [ ] |
| API-029 | P1 | B | POST a 15MB file to `/api/media/upload` | Refused - the cap is 12MB | [ ] |
| API-030 | P1 | S | POST `/api/form-upload` for a form with no file field | Refused (see MKT-019) | [ ] |
| API-031 | P1 | S | GET `/api/agreements/<id>/pdf`, `/document`, `/document/file` and an attachment, for an agreement that is not yours | Refused on all four | [ ] |
| API-032 | P1 | S | GET `/api/improvements/<id>/recording` and an attachment, as ADMIN, HEAD, the reporter and a stranger | One read rule; HEAD included; the stranger refused | [ ] |
| API-033 | P1 | S | GET `/api/payments/invoice/<id>/pdf` and `/api/payments/receipt/<id>` for another customer's record | Refused | [ ] |
| API-034 | P1 | S | GET `/api/people/<id>/termination-report` as a non-admin | Refused | [ ] |
| API-035 | P1 | F | GET `/api/leads/poll?since=...` as a USER | Only leads assigned to the caller, created after `since` | [ ] |
| API-036 | P1 | S | Same, trying to read another user's feed by changing a parameter | Impossible - the scope comes from the session | [ ] |
| API-037 | P1 | F | GET `/api/leads/poll-recent?scope=table` and `scope=kanban` as ADMIN and as USER | ADMIN sees every lead; a USER sees only leads they entered. A webhook lead has no "entered by" - record who sees it | [ ] |
| API-038 | P1 | F | GET `/api/conversations/poll` | Only conversations the caller may read | [ ] |
| API-039 | P1 | F | GET `/api/notifications` | Only the caller's | [ ] |
| API-040 | P1 | F | POST, GET and DELETE `/api/work-time` | Own row only (see XC-058) | [ ] |
| API-041 | P1 | F | GET `/api/command-palette` as each role | Only sections that role can open | [ ] |
| API-042 | P1 | F | GET `/api/classroom/timetable/<batchId>` as a student in that batch, and in another | Allowed, refused | [ ] |
| API-043 | P1 | F | POST `/api/observability/client-error` | Accepted and recorded; it cannot be used to write arbitrary content into a human-facing screen | [ ] |
| API-044 | P1 | S | Every API route: send a malformed JSON body, a 5MB body, and an unexpected content type | Clean 4xx each time, never a 500 and never a stack trace | [ ] |
| API-045 | P1 | S | Every API route: check for an unauthenticated route that writes | Only the documented public ones, each with its own defence | [ ] |

## 3.3 CRON - Scheduled work

*All cron cases need `CRON_SECRET`. Every route is fail-closed (503) when it is unset.*

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| CRON-001 | P1 | S | Call each of the nine cron routes with no secret, with a wrong secret, and with the secret in each accepted presentation | Refused, refused, accepted. The comparison is constant-time | [ ] |
| CRON-002 | P1 | S | Call each with `CRON_SECRET` unset in the environment | 503 for all nine | [ ] |
| CRON-003 | P1 | B | Call each route twice in quick succession | Rate limited where the shared hourly rule applies; the outreach route has its own frequent rule that makes a one-minute tick legal | [ ] |
| CRON-004 | P1 | F | `/api/cron/daily` once | FX prewarm, overdue sweep, invoice issuance backfill, retention sweep, dunning ladder and the founder digest all run or no-op; the response summarises each | [ ] |
| CRON-005 | P1 | B | `/api/cron/daily` four times in an hour | The once-a-day guards keep the destructive work to one run; the digest does not send four times | [ ] |
| CRON-006 | P1 | F | `/api/cron/alerts` every five minutes with a 15-minute unanswered-lead rule | Alerts fire within five minutes of breach, and the cooldown prevents repeats | [ ] |
| CRON-007 | P1 | L | `/api/cron/alerts` with no recipients configured | No-op, reported | [ ] |
| CRON-008 | P1 | F | `/api/cron/outreach` every minute through a full SOP ladder | Covered by OUT-003 to OUT-018 | [ ] |
| CRON-009 | P1 | F | `/api/cron/whatsapp` | Due reminders **and** the bookings confirmation loop both run; the response summarises both | [ ] |
| CRON-010 | P1 | B | `/api/cron/whatsapp` twice in fifteen minutes | No message sent twice | [ ] |
| CRON-011 | P1 | F | `/api/cron/agreements` twice in one morning | Each nudge is recorded with the day it was for, so nothing sends twice | [ ] |
| CRON-012 | P1 | F | `/api/cron/daily-log` | Auto-saves after the cutoff, idempotently (see INS-011 to INS-013) | [ ] |
| CRON-013 | P1 | F | `/api/cron/weekly-reports` every fifteen minutes | Opens, sends, chases and closes within a quarter hour of the configured minute; a tick with nothing to do is cheap | [ ] |
| CRON-014 | P1 | F | `/api/cron/retention` twice in a day | Purges once; the second run finds nothing | [ ] |
| CRON-015 | P1 | F | `/api/cron/workflows` | Resumes enrollments whose wait has elapsed, and picks up freshly created ones | [ ] |
| CRON-016 | P1 | L | Stop every cron for a day, then read Console -> System | The heartbeat reports each job stale. **A heartbeat that still reads healthy is a P1** | [ ] |
| CRON-017 | P1 | L | Compare each job's staleness threshold against its real cadence | A job whose threshold is missing from the shared list reads wrong. The agreements job is the known case (AGR-049) | [ ] |
| CRON-018 | P1 | B | Make one sub-job inside `/api/cron/daily` throw | The others still run; the failure is captured and visible | [ ] |
| CRON-019 | P1 | B | Run two instances of the same cron route at the same instant | No double-send and no duplicated rows | [ ] |
| CRON-020 | P2 | B | Install the cron entries on the server and read the first run | A CRLF shebang once crash-looped the cron. Confirm line endings and that the first run actually ticked | [ ] |

---

# Part 4 - FLEX: can the logic be changed without a developer?

This part exists because "the app does the wrong thing" and "the app cannot be told to do the right
thing" are different defects with different fixes, and only the second one needs a developer. Every
case here asks one of three questions:

1. **Is this rule editable today?** If so, prove an edit actually reaches the screens it governs.
2. **Is it editable but dangerous?** A knob with no audit trail, no effective date, or a second copy
   of itself somewhere else.
3. **Is it hardcoded, and should it not be?** These become the feature list, filed as
   `Class: LOGIC` with the proposed knob written out.

### The governing rule, restated

**The config system makes *values and membership* flexible and keeps *structure* as code.** A
number, a rate, a threshold, a label, a list member, a who-can-do-what - all editable at runtime.
A new *kind of thing* - a new lead stage, a new role, a new commission leg, a new SOP step, a third
currency - is a code change and usually a database migration.

- **Flexible** = a value inside a fixed shape (the XP for a won deal, the booking buffer, a level's
  price, who holds `finance.write`).
- **Not flexible** = the shape itself (the *set* of lead stages, the *structure* of the commission
  split, the *list* of roles, the *steps* of the SOP).

### Two mechanisms, and a third thing that is neither

| Mechanism | What it looks like | Who edits it |
|---|---|---|
| **Config document** | One JSON row in `AppSetting`, validated by a zod schema in `lib/config-schema.ts`, read through a `coerce*` function that fills every gap with a default and never throws | a Console panel, or the owning feature's own settings screen |
| **Configurable rows** | A real table the founder adds to: `Level`, `Product`, `QualificationQuestion`, `Pipeline` + `PipelineStage`, `WeeklyReportTemplate` + `WeeklyReportQuestion`, `CurriculumTemplate` + `CurriculumItem`, `MessageTemplate`, `RewardRule`, `Goal`, `MarketingSource`, `JobDescription`, `ProgramMilestone`, `Vendor`, `AgreementTemplate` | the feature's own screen |
| **Not a setting at all** | `cronHeartbeat`, `watiTemplateCatalog`, `integrationDeliveries`, `stageMessagesCursor`, the `IMP` sequence, `pipelineAvgFeeInr` - these are **state and caches** that happen to live in the same table | nothing; they are written by the app |

> **The third row is a trap for this part.** All of them are `AppSetting` rows, so a sweep that
> treats every `AppSetting` key as a knob will report six missing Console panels that should not
> exist. Editing a heartbeat or a cursor by hand is a way to corrupt a run, not a way to configure
> anything.

## 4.1 The config register - prove each knob reaches its screens

One case per config document. For each: open the editor, change the value to something visibly
different, save, then open **every screen the change should reach** and confirm it moved. Then set
it back.

**The failure you are hunting is not a panel that refuses to save.** It is a panel that saves
happily while nothing reads the value - which looks exactly like a working setting. There is already
a regression test for three rules that fell into this (`worry-thresholds-are-config.test.ts`), and
its header names the mechanism: *"a later edit re-introducing the literal at the point of use, so
the Console panel still shows a number, still saves it, and nothing reads it."*

| ID | P | Config document | Governs | Edited at | Screens that must move | Status |
|---|---|---|---|---|---|---|
| FLEX-001 | P1 | `sectionsConfig` | Section labels, icons, groups, order, on/off, role lists | Console -> Access -> Sections | The sidebar and every section URL, for all 6 roles | [ ] |
| FLEX-002 | P1 | `gamificationRulesets` | XP per action, **versioned by date** | Console -> Delivery & team -> Gamification | Arena, the XP feed, the home Arena tile | [ ] |
| FLEX-003 | P1 | `commissionRules` | `bothCallsPct`, `splitPct`, `closerPct`, `substitutePct` | Console -> Money -> Commission | Bonus & Commission, Finance commission tab, each telecaller's desk | [ ] |
| FLEX-004 | P1 | `instalmentPlans` | Surcharge per plan length, 2 to 24 instalments | Console -> Money -> Instalment Plans | New receivables, the agreement's snapshotted schedule | [ ] |
| FLEX-005 | P1 | `paymentTypes` | The payment-type list. Each has a **kind** (FULL, INSTALMENT, SUBSCRIPTION); 3 are locked | Console -> Money -> Payment Types | The income form, the receivable form, the agreement | [ ] |
| FLEX-006 | P1 | `expenseCategories` | Categories, each with **its own P&L account**; 3 are locked | Console -> Money -> Expense categories | The expense form picker, the P&L, the ledger | [ ] |
| FLEX-007 | P1 | `invoiceSettings` | Number format, tax rate **per currency**, issuer details, tax ID | Console -> Money -> Invoicing | A newly issued invoice, its PDF, `/i/<token>` | [ ] |
| FLEX-008 | P1 | `cashTargets` | Monthly revenue target and the cash targets | Console -> Money -> Cash targets | Cash Health, the month hero on `/` | [ ] |
| FLEX-009 | P1 | `tutorFee` | Per-level tutor rates | Console -> Money -> Tutor Fee | DRAFT tutor fees (they recompute), German Note financials | [ ] |
| FLEX-010 | P1 | `financePosting` | Which postings are armed | Console (Money) | The ledger entries income and invoices produce | [ ] |
| FLEX-011 | P1 | `qualificationConfig` | Which scorer runs (`shipped` or otherwise) | Console -> Sales ops -> Qualification | The verdict on a new lead | [ ] |
| FLEX-012 | P1 | `callDistribution` | Distribution shares, the Saturday flag, per-person caps | Console -> Sales ops -> Call Distribution | Who a new lead is assigned to; each desk's queue | [ ] |
| FLEX-013 | P1 | `bookingRulesConfig` | Public booking window, minimum notice, disqualification rule and its message | Bookings -> Availability -> Booking rules | `/book` (which slots are offered, and what a turned-away visitor reads) | [ ] |
| FLEX-014 | P1 | `slotPatternConfig` | The weekly availability pattern | Bookings -> Availability -> Add availability | Generated slots, the week view, `/book` | [ ] |
| FLEX-015 | P1 | `bookingCalendars` | Per-person booking calendars | Console -> Sales ops -> Availability | Each person's slots | [ ] |
| FLEX-016 | P1 | `zoomConfig` | Default host plus a per-person host email | Console -> Sales ops -> Zoom links | The link on a new booking, and the `_zoom` template variable | [ ] |
| FLEX-017 | P1 | `sssConfig` / `sssPatternConfig` | SSS owner and the SSS slot pattern | Console -> Sales ops | The SSS calendar, SSS bookings | [ ] |
| FLEX-018 | P1 | `leadWebhook` | The webhook key and its on/off switch | Console -> Sales ops -> Lead Webhook | `/api/leads/b2consultants` accepting or refusing | [ ] |
| FLEX-019 | P1 | `pipelineConfig` | Pipeline mode, and `autoCreateOpportunity` | Console -> System -> Operations | Whether a new lead lands on the Deals board | [ ] |
| FLEX-020 | P1 | `bookOrders` | The order threshold in rupees collected | Console -> System -> Operations | The "ready to release" marker on Students -> Book orders | [ ] |
| FLEX-021 | P1 | `outreachConfig` | Master switch, **per-step auto-send**, the SLA windows, `maxPerRun`, `maxAgeDays`, `firstCallMode` (immediate or after-check), instant intro and its hourly cap | Outreach -> Settings | The outreach queue, what the cron sends, the reaction-window readout | [ ] |
| FLEX-022 | P1 | `stageMessages` | The WhatsApp **and** email wording for each pipeline stage | WhatsApp -> Stage messages | What the outreach cron actually sends | [ ] |
| FLEX-023 | P1 | `publicLinks` | The public URLs that templates interpolate | WhatsApp page | Every message body carrying a link | [ ] |
| FLEX-024 | P1 | `watiConfig` | Template bindings per touchpoint, the test recipient, the enabled flag | WhatsApp -> Settings | Every outbound WhatsApp | [ ] |
| FLEX-025 | P1 | `agreementWorkflow` | Readiness (DEPOSIT / WON / EITHER), delivery channel (WhatsApp / email / both), reminder days | Console -> Delivery & team -> Agreements | The derived agreement state, how a link is delivered, the chase cron | [ ] |
| FLEX-026 | P1 | `deliveryDefaults` | Defaults a new cohort inherits | Console -> Delivery & team -> Delivery defaults | Newly created cohorts only - existing ones must not move | [ ] |
| FLEX-027 | P1 | `dailyLogTargets` | The daily targets a log is measured against | Console -> Delivery & team -> Daily Targets | `/daily-log`, the Arena, the desk | [ ] |
| FLEX-028 | P1 | `dailyLogEod` | The submission cutoff and the auto-save grace | Console -> Delivery & team | Whether a late log is refused; what the cron auto-saves | [ ] |
| FLEX-029 | P1 | `attendance` | Check-in window length, late-after minutes, the publish gate, the absence notice, the recording viewing window and its chase | Console -> System -> Alerts & Chasing | The register desk, the student dashboard, the classroom, the check-in action | [ ] |
| FLEX-030 | P1 | `dunning` | Stage days, channel (email / WhatsApp / both), the per-run cap, who is copied on a final notice | Console -> System -> Alerts & Chasing | Payments, Cash Health, what the daily cron chases | [ ] |
| FLEX-031 | P1 | `speedToLeadAlert` | Unanswered-lead threshold, lookback window, cooldown, recipients | Console -> System -> Alerts & Chasing | The alert cron, the desk flag | [ ] |
| FLEX-032 | P1 | `studentLifecycle` | The early-warning radar thresholds **and** the "why students stop" reason list | Console -> System -> Why students stop | The 90/120-day tracker's signal colours, the Stuck tab's day limit, the termination report | [ ] |
| FLEX-033 | P1 | `leaderboardConfig` | Per-metric rules, and whether classmates' names are shown | Console -> System -> Leaderboard | `/leaderboard` for a student (names stripped **server-side**) and for staff | [ ] |
| FLEX-034 | P1 | `weeklyReport` | Open and close times, the question set, the flag rules | Console -> Delivery & team -> Weekly reports | `/weekly-reports`, `/my-journey`, the weekly cron | [ ] |
| FLEX-035 | P1 | `improvements` | Triage configuration | Console -> System -> Improvements | `/improvements` queue behaviour | [ ] |
| FLEX-036 | P1 | `maintenanceConfig` | The maintenance actions | Console -> System -> Maintenance | What each action does when run | [ ] |
| FLEX-037 | P1 | `scheduledReport` | The founder digest: time, recipients, contents | Console -> System | What the daily cron emails and when | [ ] |
| FLEX-038 | P1 | `workflowSettings` | The automation runner's behaviour | **Find the screen.** If there is none, this is a FLEX-040 finding | Workflow enrollments resumed by the cron | [ ] |
| FLEX-039 | P1 | ~~`retentionDays`~~ → `maintenanceConfig.retention.archiveDays` | How long an archived row survives before the purge **deletes it permanently** | **✅ BUILT 1 Nov 2026** — moved into the document that already holds the switch governing it, at Console -> System -> Maintenance -> "Keep archived records (days)". The retired bare key is still read but **never obeyed**; a hand-set value is reported as `legacyIgnored` on the cron result rather than silently applied | The retention cron | [ ] |

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FLEX-040 | P1 | F | Enumerate every `AppSetting` key the code reads, subtract the six state keys named above, and find the screen that edits each remainder | A key with no screen is **config with no UI**: live in production, editable only by hand-editing a JSON row in the database. Candidates found on 1 Nov 2026: `workflowSettings`, `retentionDays`, `runwayGrowthRatePct`, and the `aiConfig` / `emailConfig` / `smsConfig` channel settings. Confirm each, and confirm whether it is env-driven instead | [ ] |
| FLEX-041 | P1 | L | The archive window specifically | **✅ BUILT** (see FLEX-039). Three things to verify: the floor is **1, not 0** (0 would mean a cutoff of *now* and purge the whole archive, while 0 means "keep forever" on the two fields beside it); the panel warns under 30 days that the Archive is the only undo the app has; and the default is still 90, so nothing moved on the day it shipped. Guard: `retention-window-is-config.test.ts` | [ ] |
| FLEX-042 | P1 | F | For each of FLEX-001 to FLEX-039: save a deliberately invalid value (a negative percentage, a 30-hour time, an empty required string, a letter in a number) | Refused by the zod schema with the field named. Nothing partially saved | [ ] |
| FLEX-043 | P1 | B | For each: delete the stored JSON row entirely, then open the screens it feeds | Every gap is filled by the `coerce*` default and **nothing throws**. A missing config must read as the shipped default, never as zero, empty or an error | [ ] |
| FLEX-044 | P1 | B | For each: store JSON of the wrong shape (an array where an object is expected, an unknown key, a null) | Coerced to defaults, never a crashed screen. Unknown keys ignored | [ ] |
| FLEX-045 | P1 | L | For each: a value of **zero**, where zero is meaningful | Zero means zero, and "unset" is a different state. A cap of 0 must not read as unlimited, and a target of 0 must not read as no target | [ ] |

## 4.2 The five ways a knob goes wrong

These are the failure modes. Each is worth running across the whole register rather than per knob.

| ID | P | T | Case | Expected / what a finding looks like | Status |
|---|---|---|---|---|---|
| FLEX-046 | P1 | L | **Saves but nothing reads it.** For every knob, change it to an extreme value and look for a screen that does not move | A literal re-introduced at the point of use. Everything looks configured and behaves as though it is not. This has happened three times already - the early-warning radar, the Stuck tab's 10-day limit, and the German Note book and tutor costs | [ ] |
| FLEX-047 | P1 | L | **The second copy.** For each rule, search for the same number or concept implemented somewhere else | "Change our monthly target" or "retune the health colours" should be **one** action. The July audit found three separate monthly-target figures and three separate threshold sets for the same signal bands. Re-run that search - any surviving duplicate means a founder's edit is silently half-applied | [ ] |
| FLEX-048 | P1 | L | **No effective dating.** Change a money rule, then re-read a month that has already been reported and possibly paid | Only `gamificationRulesets` versions by date. Every other edit is latest-wins and **retroactive**, so history re-prices on the next recompute. For each money knob - commission, instalment surcharge, tutor fee, tax, cash target - record whether history moved. A paid commission month that restates is a P1 | [ ] |
| FLEX-049 | P1 | L | **No audit trail.** Change a knob, then open `/activity` | Record whether the change appears, **who** made it, and whether the **prior value** is recoverable. `AppSetting` itself carries only a timestamp; some writers now log to the activity log explicitly (the public-links writer does). Every knob that does not is a blind overwrite of a business rule | [ ] |
| FLEX-050 | P1 | L | **No snapshot where one is needed.** Change a knob that a past record should have frozen | An issued invoice, a signed agreement and an existing receivable each carry their own snapshot and must not move (FLEX-004, FLEX-007, FLEX-025). A knob that reaches backwards into a signed document is a P1 | [ ] |
| FLEX-051 | P1 | L | Two admins edit the same config document at once | Last write wins and silently discards the other, or it is refused. Record which. A config document is one JSON blob, so a concurrent edit loses the whole document, not one field | [ ] |
| FLEX-052 | P1 | S | A non-admin reaches a config write action directly | Refused. Every knob here changes company-wide behaviour | [ ] |
| FLEX-053 | P1 | L | A knob that governs **sending** (dunning channel, auto-send, instant intro, delivery channel) set to its most aggressive value on the local stack | Arming by configuration must still respect the test-recipient fence. A config change that can message real people without a deploy is correct by design and therefore needs the fence to hold | [ ] |
| FLEX-054 | P2 | U | Every Console panel: save with no change | No spurious activity entry, no version bump, no cron re-trigger | [ ] |
| FLEX-055 | P2 | U | Every Console panel: the saved state after a reload | Shows what was saved, not the default. A panel that re-renders defaults after saving is how a founder concludes the Console does not work | [ ] |
| FLEX-056 | P2 | U | Every Console panel: does it say what the setting **does** and what breaks if it is wrong | A knob whose label a founder cannot act on is not usable flexibility | [ ] |
| FLEX-057 | P2 | L | Compare every knob against the App Guide and `/guide/rules` | The guide once told founders three rules could not be changed when two already could, and the third was editable in the catalogue all along. Any guide claim of "fixed in the app" must now be checked against the register above | [ ] |

## 4.3 The hardcoded register - what should become flexible

Each row is a rule that works and cannot currently be changed without a developer. Run the case,
confirm it is still hardcoded, then file it as `Class: LOGIC` with the proposed knob. **The
"Proposed knob" column is the feature request** - it is written in the shape the codebase already
uses, so each one is a small, self-similar piece of work rather than a design question.

Priority here is business risk, not effort: P1 means a founder has already asked to change it, or
getting it wrong misreports money or messages the wrong person.

> **Verify before you build.** Working this register on 1 Nov 2026 turned up four items that were
> already configurable in whole or in part - BANT question weights and option scores (via the
> `QualificationQuestion` catalogue), the runway signal bands (via `cashTargets`), and most of the
> lead-priority weights (via `callDistribution.priority`). Those rows are now marked down from P1
> and say what is genuinely left. The lesson generalises: this app has been made more configurable
> faster than its own documentation has kept up, so **read the code before writing the knob** or
> you will ship a second settings system for a rule that already had one.

| ID | P | Hardcoded rule | Where it lives | Why it matters | Proposed knob | Status |
|---|---|---|---|---|---|---|
| FLEX-058 | P1 | ~~**BANT verdict cutoffs** - confirm above 2.4, doubt from 1.6~~ | `lib/booking-intake.ts` | The whole qualification engine, and the `< 1.6` cutoff is what fires auto-disqualify on `/book`. Rescaled once already (0-5 to 0-4) by code change plus a data migration | **✅ BUILT 1 Nov 2026** as `qualificationConfig.thresholds`, editable at Console -> Sales ops -> Qualification -> Verdict cutoffs. `max` deliberately **excluded**: changing the scale reinterprets every stored score against a scale it was never measured on, so a rescale stays a migration plus a restate. Verify with FLEX-090 to FLEX-097 | [ ] |
| FLEX-059 | P2 | **BANT dimension weighting** - in the *legacy column scorer*, Budget carries two votes because it has two questions | `lib/booking-intake.ts` | **Smaller than it first looked.** `QualificationQuestion` already carries a founder-editable `weight` AND `dimension` per question, and `lib/qualification.ts` applies both - so weighting *is* configurable on the catalogue scorer. The fixed weighting only applies while `scorer` is `"shipped"`, which is the live default | Do **not** add a second weighting system. The real unlock is flipping to the catalogue scorer, which is already gated on the replay agreeing. Until then, record that editing a question's weight has no live effect | [ ] |
| FLEX-060 | P2 | **Intake question options** (`INTAKE_OPTIONS`) and their per-answer scores | `lib/booking-intake.ts` | Same correction: the catalogue's `options` JSON holds `{value, label, score}` per answer and is founder-editable in the Console, so options and scores are already config **on that scorer**. The hardcoded list is the booking form's own, used while `scorer` is `"shipped"` | Again, not a new knob. The gap is that the app has two question systems and the screen does not say which one is live for which door - the panel's banner covers the booking form; add the same for `/book`'s own question list | [ ] |
| FLEX-061 | P2 | **Signal bands** - attainment 80/50%, speed-to-lead 5/60 minutes | `lib/signals.ts` | **Smaller than it looked.** The RUNWAY bands already read `cashTargets` (`signalForRunway` takes them as an argument, defaulting to 6/3) - so the precedent and the pattern are both in this file already. Only `signalForPercent` and `signalForSpeedToLead` still hold literals | A `signalBands` config document holding the attainment and speed-to-lead bands, with both functions taking them as an argument exactly as `signalForRunway` does. Note all 7 call sites are **client** components, so the bands must be threaded from their server pages | [ ] |
| FLEX-062 | P2 | **FX last-resort fallback of 90 rupees per euro** | `lib/fx.ts` | Used when the rate API is down **and** the cache is empty. The real rate has run near 110, so on that one morning every euro figure reads about a fifth light | **✅ PART BUILT 1 Nov 2026** as `cashTargets.fxFallbackInrPerEur`, Console -> Money -> Cash targets -> "Euro rate of last resort"; default stays 90, read lazily so the happy path pays nothing. **Half remains:** `AmountPair` labels the invented rate "ECB *today* · cached, may be stale", which attributes a made-up number to a real publication date. Fixing that needs a `source: live \| cached \| fallback` on `FxResult` threaded to the display — 63 call sites, so it was left rather than half-done | [ ] |
| FLEX-063 | P1 | **Chart-of-accounts posting maps** - level to income account, method to asset account | `lib/chart-of-accounts.ts` | Expense categories now carry their own account, which proves the pattern works. The income and asset sides are still switch statements, so a new payment method or level posts wherever the code says | Per-level and per-method account fields, following the `expenseCategories` precedent exactly | [ ] |
| FLEX-064 | P2 | **Lead priority: the stage-weight table and the deal-risk day rules** (7/7/5/5/10) | `server/pipeline-metrics.ts` | **Half of this is already config.** `callDistribution.priority` holds `bantPerPoint`, `highlyQualifiedBonus`, `freshWithinDays`, `freshBonus`, `idleAfterDays`, `idlePenaltyPerDay` and `idlePenaltyMax`, and the ranking reads them. What remains hardcoded is the per-stage `STAGE_WEIGHT` table and the five day thresholds behind the risk flags | Add `stageWeights` and `riskIdleDays` to `callDistribution.priority`, beside the weights already there. Do **not** start a second priority config | [ ] |
| FLEX-065 | P1 | **Which stages count as pipeline value** (`INTERESTED_STAGES`, `OPEN_STAGES`) | `server/pipeline-metrics.ts` | Decides the reported value of the pipeline. Two founders can disagree about whether a stage counts, and neither can change it | Stage membership lists on `pipelineConfig` | [ ] |
| FLEX-066 | P2 | **Average-fee learning** - fee levels, a 24-month window, a 60-second cache | `server/pipeline-metrics.ts` | Feeds forecast figures. German Note levels are excluded by design, which is itself a rule nobody can see or change | Window and included levels on `pipelineConfig` | [ ] |
| FLEX-067 | P2 | ~~**Kanban card limit of 300**~~ | `server/pipeline-metrics.ts` | A silent cap on a board. Past it the board was not showing the pipeline and did not say so - a business with 412 open leads saw 300 cards and no indication 112 were missing | **✅ BUILT 1 Nov 2026.** `pipelineConfig.kanbanCardLimit` (50-2000), editable at Console -> System -> Operations -> "Cards on the board". More importantly `getKanbanLeads` now returns `total` beside the page and the board prints "Showing the newest 300 of 412 open leads" with where to raise it. The honesty was the real fix; the knob makes it actionable | [ ] |
| FLEX-068 | P1 | **Outreach SOP step list and bodies** | `lib/outreach-sop.ts` | The *behaviour* is richly configurable (per-step auto-send, SLAs, caps, first-call mode) but the 23 steps and their copy are code. The SOP is a business document that will be revised | The bodies are the urgent half: a step whose wording a founder cannot change gets worked around by sending manually. Consider moving bodies to `MessageTemplate` rows, keyed by step | [ ] |
| FLEX-069 | P1 | **Appointment durations - 30 or 60 minutes only**, slot buffer clamped 15-240, a 180-day booking cap | `server/booking-actions.ts` | Appointment "types" are two hardcoded numbers rather than a list. A 45-minute discovery call is a code change | A duration list on `bookingRulesConfig`, which already holds the window and notice rules | [ ] |
| FLEX-070 | P2 | **Booking rate limit (5 per 10 minutes) and the honeypot field** | `server/booking-actions.ts` | Legitimate traffic spikes (an ad launch) are turned away with no way to raise the limit | The limit on `bookingRulesConfig`; leave the honeypot as code | [ ] |
| FLEX-071 | P1 | **The notification centre** - every rule and threshold | `server/notifications.ts` | Named by the July audit as entirely hardcoded, and it re-implements at least one threshold (`runway`) that exists elsewhere. Nobody can turn off a notification they find noisy, so they stop reading all of them | A `notifications` config: per-rule on/off plus the threshold. Resolve the duplicates in the same pass (FLEX-047) | [ ] |
| FLEX-072 | P2 | **Native form field-type palette** | `lib/sites-types.ts` | Form *content* is database-driven; the *types* are a fixed list. A founder adding a field type cannot | Low priority - a new field type needs a renderer and a validator anyway, so this is honestly structural | [ ] |
| FLEX-073 | P2 | **`runwayGrowthRatePct` and `pipelineAvgFeeInr`** | `AppSetting`, no UI | Already config documents with no screen. One is a projection assumption a founder should own; the other is a learned cache that should probably not be editable at all | Decide per key: give the assumption a panel, and move the cache out of the settings table so a sweep stops reporting it | [ ] |
| FLEX-074 | P1 | ~~**Tutor fee levels fixed at A1, A2, B1**~~ | `lib/config-schema.ts` | Worse than "no rate": a GN_B2 batch was **dropped from the tutor-cost table silently**, so the German Note margin read as though the trainer were free, and no screen said a level was being skipped | **BUILT 1 Nov 2026.** `ratesByLevel` is now a record keyed by level code, with add/remove in Console -> Money -> Tutor Fee. **The omission invariant is preserved**: an unpriced level is still skipped, never charged at a guess, so adding B2 cannot restate a month already reported. Also removed the **third** copy of "which levels cost a trainer" (`LEVEL_TO_FEE_LEVEL` in `batch-costs-metrics.ts`) - all three copies had forgotten B2. Guard: `tutor-fee-levels-are-config.test.ts` | [ ] |
| FLEX-075 | P3 | ~~**Instalment count bounds, 2 to 24**~~ | `lib/config-schema.ts` | A 36-month plan was impossible to configure | **✅ RESOLVED 1 Nov 2026, and NOT with a knob.** The ceiling is now 60 (five years of monthly instalments). A bound on a config field is a guard rail against a typo, not business policy — a setting whose only job is to permit another setting is one no founder would look for, and it could only ever be lowered into invalidating saved tiers. The floor stays 2 in code: a one-part plan is a full payment, which is a fact about the word, not a preference | [ ] |
| FLEX-076 | P1 | **Locked lists** - 3 payment types, 3 expense categories, the `console` and `activity` sections | `lib/config-schema.ts`, `lib/sections.ts` | These locks are **correct** and must stay. The test is that the lock is enforced and *explained*, not that it is removed | No change. Confirm each refusal names the reason, so a founder does not read a lock as a bug | [ ] |

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FLEX-077 | P1 | L | Re-run the July 2026 flexibility audit's method - sweep for business rules, rates, thresholds and magic numbers - and diff against `docs/FLEXIBILITY_AUDIT.md` | That audit is from 17 Jul 2026 and is **substantially out of date**: commission rates, the cash target, levels and their prices, payment types, expense categories, invoice numbering, instalment pricing, call distribution, the student radar and the German Note cost model have all become config since. Produce the current list, and either update that document or mark it superseded. **Testing against it as written will produce false findings** | [ ] |
| FLEX-078 | P1 | L | For every number a founder has ever asked to change (check the Improvements queue and `Required_Document/error-fixing-list.md`) | Each is either config today or on the register above. A request that is neither is a gap in this document | [ ] |
| FLEX-079 | P2 | L | Count the rules the App Guide describes as fixed, against the register | Any that are now configurable are doc bugs; any that are genuinely fixed should say **where the decision lives**, not merely that it cannot be changed | [ ] |

## 4.4 Structural flexibility - adding a new kind of thing

Prisma enums are the hardest floor in the app. These cases do not ask for the enum to be removed;
they establish **what it costs today**, so the founders can decide which ones are worth converting
to data. Record the file count and whether a migration is needed for each.

| ID | P | T | Case | Expected / finding | Status |
|---|---|---|---|---|---|
| FLEX-080 | P1 | L | Add a new **lead stage** | A Postgres enum plus every zod schema and literal list that mirrors it. Note that the editable `Pipeline`/`PipelineStage` board is a **mirror** bridged to the enum, so the app already has a configurable pipeline and a fixed one. Record which is authoritative - that ambiguity is itself a finding (see PIPE-021) | [ ] |
| FLEX-081 | P1 | L | Add a new **role** | Enum, plus `APP_ROLES`, `APP_ROLE_LABELS`, the catalogue's role lists, the capability defaults, and every role picker. The picker is the dangerous part: one that cannot represent a role **silently rewrites it on save** (see ADM-051) | [ ] |
| FLEX-082 | P1 | L | Add a new **commission leg** (a fourth party to a sale) | The rates are config but the split is control flow, so this is a rewrite of the ladder. Decide whether the shape should become data | [ ] |
| FLEX-083 | P1 | L | Add a new **outreach SOP step** | Enum plus the step array plus the phase mapping. Compare against FLEX-068 | [ ] |
| FLEX-084 | P1 | L | Add a new **programme level** and a new **German level** | Should be entirely config today: a `Level` row plus a `Product` for its price. Confirm it reaches **every** picker - the Students enrolment form has lagged behind before - and that the tutor rate card can price it (FLEX-074) | [ ] |
| FLEX-085 | P1 | L | Add a new **expense category**, **payment type** and **payment method** | The first two are config. `PaymentMethod` is still an enum, so the three sit at different flexibility levels while looking alike on screen | [ ] |
| FLEX-086 | P1 | L | Add a **third currency** | A migration and a broad refactor: the base currency and the dual INR/EUR assumption run through the ledger, the money inputs, the toggle and the tax table. This is a project, not a knob - the finding is that it should be written down as one | [ ] |
| FLEX-087 | P2 | L | Add a new **WhatsApp touchpoint** | Enum, available-variables map, a template, a Meta submission and a binding. The binding half is already config with no deploy, which is the part that matters most | [ ] |
| FLEX-088 | P2 | L | Add a new **section** (a new screen) | A route plus a catalogue entry; everything else is the founder's. This is the one structural addition that is genuinely cheap - confirm it stays that way | [ ] |
| FLEX-089 | P2 | L | For each enum above, count how many files mirror it as a literal list | The July audit found several duplicated across three or four files, `LeadSource` in four. Each duplicate is a place a new member can be forgotten, which shows up as a value that renders as blank | [ ] |

## 4.5 Making new flexibility safe - the pattern, and the test it needs

When a register item in 4.3 is implemented, it must follow the shape the codebase already uses, or
it becomes a knob that does not work (FLEX-046). Use this as the acceptance checklist for each one.

**Two knobs have been through this already** - `qualificationConfig.thresholds` (FLEX-058) and
`pipelineConfig.kanbanCardLimit` (FLEX-067). Their guard tests,
`src/lib/__tests__/qualification-thresholds.test.ts` and `pipeline-config.test.ts`, are the
worked examples to copy; between them they cover every step below.

**The six steps:**

1. A zod schema plus a `DEFAULT_*` and a `coerce*` in `lib/config-schema.ts`. The coercer fills
   every gap and **never throws**.
2. A key in `server/founder-config.ts` and a reader that goes through the coercer.
3. The rule's point of use reads the config. **The literal is deleted, not left beside it.**
4. A Console panel (or the owning feature's settings screen) that writes it, with copy saying what
   it does and what goes wrong if it is wrong.
5. A unit test that the default matches today's shipped behaviour, so turning a literal into a knob
   changes nothing on the day it ships.
6. A unit test in the shape of `worry-thresholds-are-config.test.ts`: assert the **literal is gone
   from the point of use**, so a later edit cannot quietly re-introduce it.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FLEX-090 | P1 | F | For each newly configurable rule: set the knob to today's shipped value | Every screen reads exactly as it did before the change. Converting a literal to a knob is a no-op on day one | [ ] |
| FLEX-091 | P1 | F | Then set it to something clearly different | Every screen named in the register row moves | [ ] |
| FLEX-092 | P1 | B | Delete the config row | Falls back to the shipped default; nothing throws | [ ] |
| FLEX-093 | P1 | S | Confirm the literal no longer exists at the point of use | A grep for the old number in that file returns nothing. This is step 6, and it is the step that gets skipped | [ ] |
| FLEX-094 | P1 | F | Confirm the new knob appears in Console and in `/guide/rules` | A rule that is configurable and undocumented is a rule nobody will change | [ ] |
| FLEX-095 | P1 | L | Decide, per knob, whether it needs **effective dating** or a **snapshot** | Anything that prices money or governs a signed document needs one of the two. Write the decision down in the panel's copy | [ ] |
| FLEX-096 | P1 | S | Confirm the write is admin-gated and logged to `/activity` with the actor | See FLEX-049 and FLEX-052 | [ ] |
| FLEX-097 | P2 | F | Confirm the knob's default is right for a **brand-new install** | A default tuned to this one business is fine, but it must be a deliberate default, not an accident of what the literal happened to be | [ ] |

## 4.6 Per-section flexibility matrix

One case per section. For each: sit with the section open and the Console open, and answer three
questions - **what can a founder change here today, what would they most likely want to change that
they cannot, and does the screen tell them where the decision lives?** The third question is the
one that turns a hardcoded rule from a mystery into a request.

| ID | P | Section | Flexible today | Likely to be asked for and not possible | Status |
|---|---|---|---|---|---|
| FLEX-098 | P1 | Home / dashboards | Targets, signal thresholds via `cashTargets` and `studentLifecycle`, which tiles a role sees via sections | Which tiles appear and in what order; the attainment bands (FLEX-061) | [ ] |
| FLEX-099 | P1 | My Desk | Distribution shares and caps, the desk variant per person, daily targets | The queue's ordering algorithm (FLEX-064) | [ ] |
| FLEX-100 | P1 | Contacts | Custom fields of 11 types, tags, companies | Which fields are required; the dedupe rule and which record wins a merge | [ ] |
| FLEX-101 | P1 | Pipeline | Board stages and order (the mirror), lead webhook, auto-create deals | The underlying stage **set** (FLEX-080), what counts as pipeline value (FLEX-065) | [ ] |
| FLEX-102 | P1 | Deals | Pipelines, stages, custom fields | What a WON deal triggers | [ ] |
| FLEX-103 | P1 | Bookings | Availability patterns, per-person calendars, booking window, notice, disqualification rule and message, Zoom hosts, confirm-or-cancel | Call durations (FLEX-069), the rate limit (FLEX-070) | [ ] |
| FLEX-104 | P1 | Outreach | Master switch, per-step auto-send, every SLA window, caps, first-call mode, instant intro, the specialist name | The step list and the message bodies (FLEX-068) | [ ] |
| FLEX-105 | P1 | Qualification | The question rows, which scorer runs | Cutoffs, weights, per-answer scores, the booking form's own question list (FLEX-058 to FLEX-060) | [ ] |
| FLEX-106 | P1 | Agreements | Templates and versions, readiness, delivery channel, reminder days, the countersignature, instalment snapshot | Token lifetime; what signing triggers; the OTP policy | [ ] |
| FLEX-107 | P1 | Onboarding | The Stuck day limit, the gap set follows the data | Which gaps are shown and their order; the journey step set | [ ] |
| FLEX-108 | P1 | Students | Levels and prices, radar thresholds, stop reasons, coaches, book-order threshold | The signal formula itself; the tracker's 90/120-day shape | [ ] |
| FLEX-109 | P1 | Batches & plans | Curriculum templates, delivery defaults, capacity, timetable patterns, tutors | The cohort readiness checklist (which of the five items block starting) | [ ] |
| FLEX-110 | P1 | Classroom & attendance | Check-in window, late minutes, publish gate, absence notice, recording window and chase | Attendance statuses; who may mark (role rules are code, section access is not) | [ ] |
| FLEX-111 | P1 | Leaderboard & weekly reports | Metric rules, name visibility, question sets, open and close times, flag rules | The sprint week shape; which metrics exist | [ ] |
| FLEX-112 | P1 | German Note | Levels, prices, book and tutor costs, workshop pricing, tutor rate card | Workshop products and day types (enums); the rate card's fixed three levels (FLEX-074) | [ ] |
| FLEX-113 | P1 | Finance | Commission rates, instalment surcharges, payment types, expense categories and their accounts, cash targets, invoice numbering and tax, tutor fees, posting switches | Income and asset posting maps (FLEX-063), the FX floor (FLEX-062), effective dating on all of it (FLEX-048) | [ ] |
| FLEX-114 | P1 | Marketing & WhatsApp | Sites, funnels, forms, template bindings, test recipient, public links, stage message wording | Form field types (FLEX-072); the touchpoint set | [ ] |
| FLEX-115 | P1 | Insights | Goals, reward rules, XP rules (date-versioned), the scheduled digest | Report contents; the funnel's stage definitions | [ ] |
| FLEX-116 | P1 | Admin & access | Everything in 4.1, plus sections, capabilities, per-person rules, roles per section | The role **set** (FLEX-081); the capability list | [ ] |

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| FLEX-117 | P1 | L | Across all 19 sections, count how many have **no** founder-editable rule at all | Each is a section whose behaviour can only be changed by a developer. Name them; that list is the real answer to "how flexible is this app" | [ ] |
| FLEX-118 | P1 | U | For each hardcoded rule a tester hits during Parts 1 to 3, check whether the screen says where the decision lives | A screen that names the Console panel turns a bug report into a settings change. A screen that says nothing produces a support request | [ ] |

# Part 5 - Logical-fix probes

These are not feature tests. Every one of them is a question about whether a rule that **works** is
the **right** rule. Expect to file `Class: LOGIC` findings here, and expect some to come back "yes,
that is intended" - record those too, because an intended oddity that nobody has written down is the
next bug report.

## 5.1 Derived versus stored - where the two can disagree

Almost nothing in this app is a status somebody sets. That is a strength and it has one failure mode:
a derivation that reads a record the writer forgot to update.

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-001 | P1 | Advance a person through all ten journey steps, and after each one re-read: Onboarding, the lead's stage, the deal's stage, the agreement state, the student record, the cohort roster | Any two screens that disagree about where the same person is | [ ] |
| LOGIC-002 | P1 | Create the same journey state by two different routes (lead conversion versus agreement enrol versus income-form student) | The derived step differs by route | [ ] |
| LOGIC-003 | P1 | Produce an agreement that is SIGNED but has no sealed copy | It reads COMPLETED when it must not | [ ] |
| LOGIC-004 | P1 | Produce a cohort with a plan, a teacher and a learner but no sessions, and read every screen that reports its state | One screen calls it Ready and another Draft | [ ] |
| LOGIC-005 | P1 | Delete the last learner from a Running cohort | It silently reverts to Draft while classes are on the calendar | [ ] |
| LOGIC-006 | P1 | Record a discovery outcome, then change the booking's status by hand | The outcome and the booking status contradict each other and both feed the funnel | [ ] |
| LOGIC-007 | P1 | Take a lead to WON, then move it back to a mid-stage | Commission, the deal, the agreement readiness or the funnel keeps the WON | [ ] |
| LOGIC-008 | P1 | Mark a student DROPPED while they hold a cohort seat, an open receivable and a signed agreement | One of the three keeps treating them as active | [ ] |
| LOGIC-009 | P1 | Archive a record, then run every report, tile and export that counted it | A count that still includes it. There is no middleware filtering archives - every query does it by hand | [ ] |
| LOGIC-010 | P1 | Un-archive (restore) a record if the app allows it | It returns to some lists but not others | [ ] |

## 5.2 Money - double counting, attribution and the two books

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-011 | P1 | One student, two enrolments (an upgrade), payments against both | Revenue counts the money twice, or attributes both to one enrolment | [ ] |
| LOGIC-012 | P1 | One payment that pays off two instalments across two plans | Paid-so-far double counts, or one plan's balance never moves | [ ] |
| LOGIC-013 | P1 | A payment recorded, then the invoice for the same money issued and posted | The ledger holds the money twice | [ ] |
| LOGIC-014 | P1 | A Shared expense | Apportioned twice, or counted in full in both books | [ ] |
| LOGIC-015 | P1 | A German Note workshop that converts a student into a B2 programme | The revenue lands in the wrong book, or in both | [ ] |
| LOGIC-016 | P1 | Record income under the ALL currency and business filters | A silent default decides the business or the currency for you | [ ] |
| LOGIC-017 | P1 | A euro payment, then read every rupee total it feeds | A conversion happening at read time rather than a stamped rate | [ ] |
| LOGIC-018 | P1 | Commission on a sale that is later voided | The commission stays accrued | [ ] |
| LOGIC-019 | P1 | A tutor fee approved, then the batch headcount changes | The approved fee moves, or the difference is invisible | [ ] |
| LOGIC-020 | P1 | An owner's drawing | It reaches the profit and loss as an expense | [ ] |
| LOGIC-021 | P1 | Net profit versus gross profit versus margin, all on one screen, computed by hand from the rows | Any tile whose arithmetic does not reproduce from its own components | [ ] |
| LOGIC-022 | P1 | A receivable written off, then the same student pays anyway | The payment has nowhere to go, or revives a written-off plan without saying so | [ ] |
| LOGIC-023 | P1 | An instalment plan restated downward below what is already paid | A negative balance presented as a credit nobody granted | [ ] |
| LOGIC-024 | P1 | A refund, if the app supports one | It is recorded as negative income rather than as a reversal, breaking the append-only ledger's story | [ ] |

## 5.3 Messaging - the silent skip

A declared-but-empty template variable **skips the send entirely**. That is the single most
dangerous behaviour in the app, because nothing visibly fails.

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-025 | P1 | For every one of the 51 templates in the pack, trigger it with the thinnest valid data (no Zoom link, no portal login, no batch name) | A skip that appears nowhere a human looks. An approved template asking for a variable its touchpoint does not offer is skipped **forever, silently, for every prospect** - this is how agreement OTPs were undeliverable for weeks while the app looked healthy | [ ] |
| LOGIC-026 | P1 | Trigger each of the 3 never-submitted templates, and each of the 30 flagged as needing action | A feature that reads as working while nothing is sent | [ ] |
| LOGIC-027 | P1 | Trigger a message to a number on the opt-out list, and to a number with no WhatsApp | Both must record a reason; neither may read as sent | [ ] |
| LOGIC-028 | P1 | Trigger a send with WATI enabled and no test recipient, on the local stack | It reaches a real number. This must be impossible to do by accident | [ ] |
| LOGIC-029 | P1 | Compare the WhatsApp and email halves of every stage message | One fires and the other does not | [ ] |
| LOGIC-030 | P1 | An email marked SENT, then check actual delivery | SENT means Resend accepted it. Any screen that presents SENT as delivered is a LOGIC finding | [ ] |
| LOGIC-031 | P1 | Force a Meta messaging cap | It is classified as a recipient problem and therefore can never raise an alert | [ ] |
| LOGIC-032 | P1 | Send the same notification through two engines that both cover the same event (for example a class reminder and an absence notice) | The student receives two messages about one thing | [ ] |
| LOGIC-033 | P1 | A booking whose time changes twice in an hour, with confirmations armed | Two confirmation requests for the same call, or one naming a time that no longer exists | [ ] |

## 5.4 Access - the gaps between a door, a desk and an action

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-034 | P1 | For every section, compare three answers: can the role see the sidebar item, can it open the URL, can it perform the writes on that screen | A screen that opens but refuses everything with no explanation, or worse, one that refuses the screen but allows the action | [ ] |
| LOGIC-035 | P1 | For every server action that takes an id, call it with an id belonging to another person or cohort | Any action that trusts the id instead of re-checking ownership | [ ] |
| LOGIC-036 | P1 | The delivery fence: read it from all four screens that show recordings | Any screen that re-derives the rule instead of reading the one place it lives. Three copies once omitted HEAD | [ ] |
| LOGIC-037 | P1 | Grant a section to a role the catalogue never intended (students to a TUTOR, finance to a USER) | A screen that assumes founder-shaped data and errors, or shows another person's rows | [ ] |
| LOGIC-038 | P1 | The head coach: confirm every finance surface is closed, including tiles, popups, exports and PDFs | Money reaching HEAD through a side door | [ ] |
| LOGIC-039 | P1 | A student who is also a team member (same person, two records) | One identity seeing the other's data | [ ] |
| LOGIC-040 | P1 | A user whose role changes from USER to COACH while signed in | Stale permissions until they sign out | [ ] |
| LOGIC-041 | P1 | Suspend a user mid-action (submit a form as they are suspended) | The write lands anyway | [ ] |

## 5.5 Time, idempotency and concurrency

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-042 | P1 | Every cron route, twice in a row, then compare row counts | Any job that is not idempotent | [ ] |
| LOGIC-043 | P1 | Every "run now" button in the Console, pressed twice | Same | [ ] |
| LOGIC-044 | P1 | Two users editing the same record simultaneously | Last-write-wins with no warning, on a record where that loses somebody's work | [ ] |
| LOGIC-045 | P1 | Two bookings on one slot, two invoices from two tabs, two student codes at one instant | Any uniqueness enforced only in application code and not in the database | [ ] |
| LOGIC-046 | P1 | Anything dated between 18:30 and 00:00 UTC (the IST next-day window) | A record filed on the wrong day | [ ] |
| LOGIC-047 | P1 | A monthly total read on the 1st at 00:05 IST | The previous month's last day missing or duplicated | [ ] |
| LOGIC-048 | P1 | A window-based rule (check-in, recording access, booking notice) tested one second either side of its boundary | The server and the screen disagreeing about the instant | [ ] |
| LOGIC-049 | P1 | A long-running action (bulk issue, import, bulk assign) interrupted halfway | A half-finished state with no record of where it stopped | [ ] |

## 5.6 Where empty, zero and unknown get confused

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-050 | P1 | Every screen on an empty database | A zero presented as a measurement rather than "nothing recorded" | [ ] |
| LOGIC-051 | P1 | Every rate and percentage with a zero denominator | 0%, NaN, Infinity or a divide-by-zero | [ ] |
| LOGIC-052 | P1 | A BANT verdict with no answers, a signal colour with no sessions, a satisfaction score with no responses | Unknown rendered as the worst value, or as the best | [ ] |
| LOGIC-053 | P1 | An average over one data point, and over zero | Presented without the sample size | [ ] |
| LOGIC-054 | P1 | A target that is unset versus a target of zero | Treated identically | [ ] |
| LOGIC-055 | P1 | A student with no cohort, a cohort with no coach, a coach with no cohort | Any one of the three rendering as an error rather than a named waiting state | [ ] |

## 5.7 The engine-off experience

Seventeen engines ship off. Each one has a screen that must explain itself.

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-056 | P1 | For each of the seventeen, open the screens it feeds with it OFF | A screen that looks broken, or worse, looks fine and is doing nothing | [ ] |
| LOGIC-057 | P1 | For each, switch it on and confirm the notice disappears | A notice that persists after arming, which trains people to ignore notices | [ ] |
| LOGIC-058 | P1 | The four engines that compute their state at runtime (email, WhatsApp, class reminders, cron) | A fallback string shown where the real state was available | [ ] |
| LOGIC-059 | P1 | An engine that is on but unconfigured (armed with no recipients, no template, no availability) | "On" presented as "working" | [ ] |
| LOGIC-060 | P1 | A feature that is code-hidden **and** has no configuration row, so it is off twice over | The Console reporting it as available | [ ] |

## 5.8 Rules that live in more than one place

| ID | P | Probe | What a finding looks like | Status |
|---|---|---|---|---|
| LOGIC-061 | P1 | Open `/guide/rules` and, for each rule listed, change it and check **every** screen the page says answers to it | A screen that does not follow, or a screen that follows a rule the page does not list | [ ] |
| LOGIC-062 | P1 | A commission rate, which drives both Finance and Bonus & Commission | Two numbers from one rule | [ ] |
| LOGIC-063 | P1 | A level's price, which lives only on its product | A second price anywhere - on the enrolment, the agreement or the invoice line | [ ] |
| LOGIC-064 | P1 | The attendance window, read by four callers | Any caller computing it independently | [ ] |
| LOGIC-065 | P1 | Soft-delete filtering, applied by hand in every query | Any query missing it | [ ] |
| LOGIC-066 | P1 | The journey derivation, used by Onboarding, the guided flow and the student's own screens | Three answers to one question | [ ] |
| LOGIC-067 | P1 | Expense category to ledger account mapping | A category posting somewhere other than its own account | [ ] |
| LOGIC-068 | P1 | Public link variables in message templates | A hardcoded URL surviving a configuration change | [ ] |
| LOGIC-069 | P1 | The agreement state function, used by the list, the detail page, Onboarding and the bulk screen | Four answers to one question | [ ] |
| LOGIC-070 | P1 | Business-line attribution, used by Finance, German Note and the reports | Three different splits of the same money | [ ] |

---

# Part 6 - Non-functional

## 6.1 PERF - Performance

**Check the database and the server mode before measuring anything.** A slow screen is usually
`DATABASE_URL` pointing at a far-away database plus a dev-mode compile, not a slow query. Two
measured baselines exist in the repository: about **205ms per query** against hosted Supabase in
Singapore, and **0.58ms median** (from about 60ms) after the move to a self-hosted database on the
app's own box. A page that issues 65 round trips is fine at 0.58ms and unusable at 205ms, which is
why you count **round trips**, not local wall-clock.

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| PERF-001 | P1 | B | Record which database and which server mode (`next dev` or `next start`) every measurement below was taken against | Stated on every result, or the numbers are meaningless | [ ] |
| PERF-002 | P1 | B | Count queries per page load for the ten heaviest screens | No screen issues a query for a cosmetic element. The desk shell once ran seven queries to render a greeting pill | [ ] |
| PERF-003 | P2 | B | Time to first byte on `/`, `/finance`, `/pipeline`, `/students`, `/my-desk`, `/console` | Record a baseline and compare after any change | [ ] |
| PERF-004 | P2 | B | A list of 1,000 rows (contacts, leads, students) | Paginated or virtualised; no 30-second render | [ ] |
| PERF-005 | P2 | B | The kanban board with 300 cards | Drag stays responsive | [ ] |
| PERF-006 | P2 | B | A CSV export of 20,000 rows | Completes without a timeout | [ ] |
| PERF-007 | P2 | B | The 30-second polls (leads, conversations, notifications) with five tabs open | Each poll is one indexed query; they do not multiply into a page-worth of work | [ ] |
| PERF-008 | P2 | B | A public marketing page as a cold visitor | Served from cache, not a cross-region round trip plus a write | [ ] |
| PERF-009 | P2 | B | The funnel page, which does render dynamically and write a view | Record the cost, and confirm the trade-off is still acceptable for paid traffic | [ ] |
| PERF-010 | P2 | B | A PDF render (agreement, invoice, receipt) | Completes inside the request timeout for the largest real document | [ ] |
| PERF-011 | P2 | B | Memory during a large import and a large export | No unbounded growth | [ ] |

## 6.2 A11Y - Accessibility

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| A11Y-001 | P1 | U | Navigate every primary flow with the keyboard only | Every action reachable; focus always visible; no trap | [ ] |
| A11Y-002 | P1 | U | Every modal and popover: open, Tab through, Esc | Focus is contained while open and restored on close | [ ] |
| A11Y-003 | P1 | U | Contrast on every screen, light and dark | Meets AA. Programme colours are fills, never text | [ ] |
| A11Y-004 | P2 | U | Every form field | Has a real label, not a placeholder standing in for one | [ ] |
| A11Y-005 | P2 | U | Every error message | Announced to a screen reader and associated with its field | [ ] |
| A11Y-006 | P2 | U | Every icon-only button | Has an accessible name | [ ] |
| A11Y-007 | P2 | U | Every chart | Has a text alternative or an accompanying table - a chart alone is not data | [ ] |
| A11Y-008 | P2 | U | Every table | Real headers, and a caption or heading that says what it lists | [ ] |
| A11Y-009 | P2 | U | Screen-reader-only content | Does not create layout. Invisible boxes once caused a phantom sideways scroll | [ ] |
| A11Y-010 | P2 | U | At 200% browser zoom | Nothing is clipped or overlapped | [ ] |
| A11Y-011 | P3 | U | With reduced-motion requested | Entrance animations are suppressed | [ ] |

## 6.3 SEC - Security

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| SEC-001 | P1 | S | For every one of the 79 pages, request it signed out | Only the documented public routes render | [ ] |
| SEC-002 | P1 | S | For every one of the 43 API routes, call it signed out | Only the documented public ones answer; each has its own defence | [ ] |
| SEC-003 | P1 | S | For every detail page and every file endpoint, substitute another person's id | Refused everywhere. This is the single highest-value sweep in the document | [ ] |
| SEC-004 | P1 | S | Every text field that reaches a back-office screen: submit script tags, an event handler, and a `javascript:` URL | Rendered as text everywhere it is displayed | [ ] |
| SEC-005 | P1 | S | Every search and filter field: submit SQL fragments and Prisma-ish operator objects | No error, no leaked query | [ ] |
| SEC-006 | P1 | S | Every upload endpoint: a file whose extension and contents disagree, an oversized file, a zero-byte file, a file with a path in its name | Refused on all four | [ ] |
| SEC-007 | P1 | S | Every token (agreement, invoice, invite, weekly report, reset): guess a neighbouring value, reuse a spent one, and tamper with one character | Refused; no oracle about what the token nearly was | [ ] |
| SEC-008 | P1 | S | Every webhook: replay a captured valid request | De-duped, or the replay window is bounded. Record which | [ ] |
| SEC-009 | P1 | S | Check for secrets in client-side output: view source and the JavaScript bundles on a public page and an app page | No API keys, no webhook secrets, no database URL | [ ] |
| SEC-010 | P1 | S | Confirm no `.env` file, `data.sql`, backup or migration dump is reachable over HTTP | All refused | [ ] |
| SEC-011 | P1 | S | Error pages and API errors | No stack traces, no table or column names, no file paths | [ ] |
| SEC-012 | P1 | S | Rate limits: sign-in, `/book`, form upload, the weekly-report identify step, every webhook | Each limited; record the limit observed | [ ] |
| SEC-013 | P1 | S | Any field a model writes into | No model may write a permissioned field. Every AI feature goes through one seam and must degrade to a deterministic fallback | [ ] |
| SEC-014 | P1 | S | Trigger the AI seam with the provider unreachable | Falls back deterministically; the screen still works | [ ] |
| SEC-015 | P2 | S | Session cookie attributes | HttpOnly, Secure and a sane SameSite | [ ] |
| SEC-016 | P2 | S | Response headers on an app page and a public page | Content type, frame and referrer policies as intended | [ ] |

## 6.4 DATA - Data integrity

| ID | P | T | Case | Expected | Status |
|---|---|---|---|---|---|
| DATA-001 | P1 | I | Run every migration against a copy of production | All apply cleanly, in order, with no data loss | [ ] |
| DATA-002 | P1 | I | Count applied migrations against the repository | Equal. A missing migration is a silent schema drift - and the compose `migrate` service is a **separate build**, so the migration may not have run at all | [ ] |
| DATA-003 | P1 | I | Before any deploy: run the migration **first**, as its own step | There is no migrate gate in the deploy. `npm run db:deploy` goes before the image | [ ] |
| DATA-004 | P1 | B | Any migration generated by `migrate dev` for an enum or a configurable list | Read it before applying: these have generated a destructive drop-and-re-add. Prefer a hand-written ALTER | [ ] |
| DATA-005 | P1 | I | Take a backup, restore it to an empty database, and sign in | Restores completely; retention is 30 days; confirm whether an off-box copy exists | [ ] |
| DATA-006 | P1 | I | Check every foreign key for orphans after a round of deletions | None | [ ] |
| DATA-007 | P1 | I | Check every unique constraint the application relies on | Enforced in the database, not only in code | [ ] |
| DATA-008 | P1 | I | For each of the 9 soft-deleted models, count archived rows and confirm every read path filters them | Covered by LOGIC-009 and LOGIC-065 | [ ] |
| DATA-009 | P1 | I | Reconcile the ledger: total debits against total credits | Equal | [ ] |
| DATA-010 | P1 | I | Reconcile income rows against ledger income entries, and payments against invoice payments | Equal, or every difference explained | [ ] |
| DATA-011 | P1 | I | Reconcile each student's paid-so-far against their plan balances | Consistent (see LOGIC-012) | [ ] |
| DATA-012 | P1 | I | Count leads with no `assignedToId`, students with no enrolment, enrolments with no level, cohorts with no coach, agreements signed with no student | Each count is a work list, and each should be visible somewhere in the app rather than only in a query | [ ] |
| DATA-013 | P2 | I | Check the production `lead` table row count against expectation | A near-empty table that is not a soft-delete and was not done through the app is a data incident, not a bug | [ ] |

---

# Part 7 - What is already automated, and what this document adds

There is a real automated suite. **Run it before manual testing** - a failure there saves a day of
manual work.

```sh
npm test                                  # unit and pure-logic tests (src/**/__tests__)
cd e2e && E2E_AREA=finance npx playwright test tests/finance --workers=1
```

Run one e2e area at a time: five at once overloads a single local server and turns about half the
failures into timeouts.

| Automated area | Roughly what it already proves |
|---|---|
| `src/lib/__tests__` (about 170 files) | Pure rules: money parsing, instalments, attendance windows, agreement state, journey state, BANT, leaderboard, dunning, FX, permissions matrix, template catalogues, delivery health |
| `e2e/tests/access` | Provisioning, offboarding, the role matrix, action and API guards, login and password flows, UI rules, public surfaces |
| `e2e/tests/finance` | Income, expenses, dates, dashboard metrics, CSV export, partial payments, cash health, validation, plan attribution |
| `e2e/tests/outreach` | Opt-in intake, the SOP chase branches, funnel and pipeline behaviour, auto-pull |
| `e2e/tests/discovery` | Desk schedule, outcome routing, no-show chase, reschedule and cancel, the SSS ladder, edge cases |
| `e2e/tests/people` | Team profiles, OKRs, daily logs, students, the tracker, funnel links, lifetime value |

**What this document adds that the suite does not cover.** Prioritise these in a manual run:

1. **Every Console panel** (ADM-001 to ADM-039). Roughly 30 panels; the suite touches a handful.
2. **The classroom half** - batches, curriculum, timetable, attendance windows, resources,
   recordings, the leaderboard, weekly reports (BATCH, CLS). Newest code, least automated.
3. **Agreements end to end**, especially co-signers, OTP delivery, the sealed copy, timestamps and
   the integrity hashes (AGR).
4. **German Note**, including workshops, pricing combinations and the community (GN).
5. **Improvements** (ADM-040 to ADM-050) and the media-access rule.
6. **Invoices and products**, numbering, locking and tax per currency (FIN-039 to FIN-057).
7. **Marketing surfaces** - sites, funnels, forms, media uploads and their public pages (MKT, PUB).
8. **Every Part 4 and Part 5 case.** The automated suite asks whether the code does what it says.
   Part 4 asks whether a founder can change what it says; Part 5 asks whether what it says is right.
   Nothing automated can ask the second question. For the first, the suite has exactly one guard -
   `worry-thresholds-are-config.test.ts` - and it is the template FLEX-093 asks you to copy.

A test that proves a known bug is expected to fail with that bug's id in its message. The ids, the
steps and the root causes live in `e2e/findings/`.

---

# Part 8 - Running it: a suggested order

Eleven sessions. Each is a half day or less, and each ends with something worth reporting.

| # | Session | Cases | Why this order |
|---|---|---|---|
| 1 | Setup and Part 1 | AUTH, NAV, the role matrix | Everything else depends on these being sound |
| 2 | Cross-cutting | XC | Money, dates, deletion and exports break the same way everywhere - find it once |
| 3 | Sales floor | HOME, DESK, CONT, PIPE, DEAL | The busiest daily path |
| 4 | Booking and outreach | BOOK, OUT, QUAL | The most engine-dependent area; arm engines deliberately and record what you armed |
| 5 | Contracts and onboarding | AGR, ONB | The hand-off from sales to delivery, where records are created six different ways |
| 6 | Delivery | STU, BATCH, CLS, GN | The newest code and the least automated |
| 7 | Money | FIN | Highest risk. Local only, or voided immediately |
| 8 | Admin, marketing, public, API | MKT, INS, ADM, PORT, PUB, API, CRON | Breadth sweep |
| 9 | **The config register** | FLEX-001 to FLEX-057 | Needs sessions 1 to 8 done, because you have to know which screens each knob should move before you can tell whether it moved them |
| 10 | **The hardcoded register** | FLEX-058 to FLEX-118 | Produces the feature list. Run it with a founder in the room: half of these cases are really the question "would you ever want to change this?" |
| 11 | Logic and non-functional | LOGIC, PERF, A11Y, SEC, DATA | Last, because it needs everything else in your head |

**Session 10 is the one that produces work for a developer**, and its output has a shape: for each
register row, a decision (make it config, or write down where the decision lives), and for the ones
that become config, the six-step pattern in 4.5 as the acceptance criteria. Done that way, each knob
is a few hours rather than a design discussion.

**Sign-off.** Record, per session: cases run, passed, failed, blocked, drifted; which engines were
armed; which database; and the `Class` breakdown of the findings. A session with no LOGIC or DOC
findings should be re-read before it is signed off - either the area is genuinely settled, or the
probes were skipped. Sessions 9 and 10 should produce almost nothing but LOGIC and DOC findings; if
they return BUGs, those belong in an earlier session's report.
