# Student, coach and tutor flows

Built 21 Oct 2026. Covers the curriculum engine, the per-batch timetable, the student classroom
and the teaching desk.

---

## 1. What the founders' sheet is, in the model

The timetable spreadsheet has one row per session and **one column per batch**:

| Week Nr | Topic | Duration | Day | **Batch 14** |
|---|---|---|---|---|
| Week 01 | Kick Off | 1.5 hrs | Saturday | 5/9/2026 · 10:30 am |
| Week 02 | Resume Building | 3 hrs | Saturday | 12/9/2026 · 10:30 am |
| Week 02 | Social Profile Building | 3 hrs | Sunday | 13/9/2026 · 7:00 pm |
| Week 03 | Special Q&A | 1.0 hr | Saturday | 19/9/2026 · 8:00 pm |
| Week 03 | Hidden Job Market *(H.I.D.E.)* | 2.0 hrs | Sunday | 20/9/2026 · 10:30 am |
| Week 03 | Open Job Market *(O.P.E.N.)* | 3.0 hrs | Sunday | 27/9/2026 · 10:30 am |
| Week 04 | German Interview Structure | 2.0 hrs | Video (pre-rec) | — |
| Week 04 | Special Q&A & Sprint Start | 1.5 hrs | Sunday | 4/10/2026 · 8:00 pm |
| | **90 Day Sprint** | | | **2/1/2027** |

The rows are the **curriculum** (`CurriculumTemplate` + `CurriculumItem`). A column is a
**batch** (`Batch` + its `ClassSession` rows). The "D / T" labels on the sheet are just the Day
and Time rows of each batch cell — they carry no extra data.

### The dating rule

Week 03 has three sessions but a weekend has two days, so its third session **spills** into the
next weekend and everything after it shifts. Dating each week as `start + 7 × (week − 1)` would
put Open Job Market on top of Hidden Job Market and pull the final Q&A a week forward.

So dating is **sequential**: each session takes the next occurrence of its weekday *strictly
after the previous session*. `src/lib/curriculum.ts` implements it;
`src/lib/__tests__/curriculum.test.ts` pins it to Batch 14's real dates.

`weekNumber` is a label for grouping, never an input to the arithmetic.

A **pre-recorded** module has no weekday and no clock. It is released on the day of the session
before it and does not move the cursor, so adding a video never shifts the live classes.

The sprint starts on the date of the **last live session** (agreement Annexure A: "commences
immediately after the Final Special Q&A"), and `sprintDays` later is the sheet's own date —
4 Oct + 90 = 2 Jan 2027.

---

## 2. Screens

| Who | Where | What they do there |
|---|---|---|
| Founder | **Programs → Curriculum** | Author a curriculum; preview it against any start date. |
| Founder / coach | **Students → Batches → *batch name*** (`/batches/[id]`) | Build the cohort's timetable, re-time a class, take a register, set the sprint date. |
| Coach, tutor | **My Teaching** (`/coaching`) | This week's classes, registers owed, recordings to post, coursework, their caseload. |
| Student | **Dashboard** (`/dashboard`) | Their home. Next class, everything outstanding, progress, resources, links out. Owns no data — summarises the two below. |
| Student | **My Classroom** (`/classroom`) | Next class + join link, the week-by-week timetable, recordings, coursework to tick off, their own attendance, per-class resources. |

German Note keeps its own batch screen (`/german-note/[id]`) — a classroom and a community
feed, not a timetable. Both lines share one teaching desk and one student classroom.

---

## 3. Order of operations

1. **Programs → Curriculum** → *Start from the Guided programme* (seeds the eight sessions from
   the agreement), or write one. Set each row's week, topic, framework, duration, day, time and
   whether it is live or a video.
2. **Students → Batches** → create the cohort, assign the coach, set the target size.
3. Open the batch → **Build from curriculum** → pick the curriculum and the start date. The
   dialog shows the real dates before anything is written.
4. Seat students into the batch from the Students board.
5. Give each live class its **join link** (on the row, or in bulk by editing the curriculum and
   rebuilding).
6. Students now see the whole thing in **My Classroom**.

### Re-building after a slip

Re-running *Build from curriculum* with a new start date:

- **re-dates** every class that has not been marked,
- **leaves alone** every class with a register against it — that is a record of a class that
  happened,
- **removes** only generated sessions that are no longer in the curriculum *and* have no
  register and no coursework.

Editing a curriculum never reaches back into a cohort already running on it.

---

## 4. The COACH role

`Role.COACH` is new and is **not** `HEAD`. HEAD is the head coach's wider role — team oversight,
the Students board, commission. COACH sees only what they teach.

- `Enrollment.coachId → User` is the link the desk filters on.
- `Enrollment.assignedCoach` (the name) is kept: it holds years of rows for coaches who never
  had a login, and an outside coach may still have none.
- The picker still submits a **name**; the server resolves it to an account
  (`resolveCoachId`). A name matching two active accounts resolves to `null` rather than
  guessing.
- The migration backfills `coachId` for existing rows on the same rule, so the desk is not empty
  on day one.
- Sign-in door: **`/coach`** (like `/portal` for students and `/tutor` for tutors — same
  `LoginForm`, different copy).

---

## 5. The student's three pages

They answer different questions and are deliberately not merged:

- **Dashboard** (`/dashboard`) — *what do I need to do now.* The landing page. Signing in sends a
  student here (it used to be My Journey). It owns no data: every panel summarises one of the
  two pages below and links to it, so nothing here can disagree with them.
- **My Classroom** (`/classroom`) — *what is on, and what do I owe.* The timetable.
- **My Journey** (`/my-journey`) — *how far have I come.* The scoreboard, agreement and payments.

The portal previously had the last two and no front door, so a student arriving on a gamified
progress ring had to work out for themselves which page held the answer to the question they
actually signed in with.

---

## 6. Bugs found and fixed during the build

Five real defects, four of which would have shipped silently:

1. **Retiring a curriculum did nothing.** `z.coerce.boolean()` is `Boolean(value)`, and the
   string `"false"` a `<select>` posts is truthy — so "Retired" always parsed as Active. Now
   `z.enum(["true","false"]).transform(...)`.
2. **A no-sprint curriculum grew a 90-day sprint on any edit.** The dialog rendered `null` as
   the new-template default of 90, so opening and saving gave it a sprint it never had.
3. **A coach's worklist was sorted best-first.** Prisma orders an enum by *declaration* order
   (`GREEN, AMBER, RED`), so `signalColour: "asc"` put the healthy students at the top of a list
   whose whole purpose is to be worked from the top. Ranked explicitly in JS now, with an overdue
   check-in breaking ties.
4. **A student's attendance % disagreed with their coach's.** `student-classroom.ts` counted
   EXCUSED in the denominator; `lib/attendance.ts` excludes it. Both use the shared helpers now.
5. **A supervisor saw "Take the register" buttons that the server would refuse.** Permission is
   decided per session, server-side (`DeskSessionView.canMark`), and the three guards that must
   agree now do.

Plus two smaller ones: today's classes did not appear as "register outstanding" until the next
day (the query compared against IST midnight instead of now), and the edit dialogs kept the
previous row's delivery mode when you clicked straight from one row to another.

### Found by running it locally

Three more that only showed up with real data on screen:

6. **The coach's student list was still sorted best-first.** Fix 3 ranked on the manual signal
   colour alone — and on a real cohort that column is almost always null, because nobody hand-sets
   a flag until something has already gone wrong. The student on 20% attendance sat at the
   *bottom*, under five on 100%, with the tie broken alphabetically. Attendance is now part of the
   ranking, so the thing the app can measure for itself counts.
7. **"Join" appeared on classes that ran weeks ago** in the staff timetable, opening a dead room.
   The student view already hid it; the staff side now applies the same rule.
8. **A cohort's classes appeared in two different orders on two tabs of the same page.** A
   pre-recorded module is stored at midnight of its release day, so ordering by `startsAt` alone
   put "Week 04 German Interview Structure" above "Week 03 Open Job Market". The timetable panel
   re-sorted for itself and looked right; the Resources tab consumed the list directly and did
   not. The server now returns sheet order.

---

## 7. Guards that changed

`session-tasks.ts` and `attendance-actions.ts` used to open with
`requireSection("german-note")`. That was wrong in both directions:

- it was never a guard (the section was granted to STUDENT by default, so the POST endpoints
  were reachable by any student — the per-batch check was always the real fence), and
- once STUDENT lost the section on 14 Oct 2026 it became an active **block**: a student ticking
  their own coursework was redirected to `/?denied=german-note`.

Both now require only a session and ask the question that matters — *is this your batch* —
which is also what lets a COACH mark a register on a cohort that has no German Note section.

---

## 8. Resources

Course material, attached to whichever thing it actually belongs to. **Links, not files** — all
of it already lives in Drive, Skool or Fathom, and the app has no object storage configured
(`supabase-storage.ts` is unset and the one upload route is images-only, for the website's media
library). `kind` carries what it is; file upload can be added later behind the same model.

### Three scopes

| Scope | Attached to | Who may post | Why it exists |
|---|---|---|---|
| **Every cohort** | a curriculum row | Admin only | "The Resume Building worksheet." Attached once; every batch built from that curriculum shows it on that class, including batches opened next year. Without it the founders re-attach the same eight files to every cohort — which is how a batch ends up with last year's template. |
| **This cohort** | a batch | Coach/tutor who runs it, `batches.manage`, Admin | The WhatsApp group, the shared drive. |
| **This class** | one session | Coach/tutor who runs it, `batches.manage`, Admin | The deck actually used on Saturday. |

Exactly one scope per row, enforced by a DB `CHECK` **and** the service layer — a row in two
scopes would render twice with no non-arbitrary way to pick one at read time.

Curriculum material is Admin-only because its blast radius is every cohort that will ever run the
programme. That is a decision about the product, not about this Saturday's class.

### Staging

`visibleToStudents` lets staff write an exercise before the class and release it after. The flag
is applied **in the query**, not in the component: a staged resource is not merely un-rendered,
its title and URL never reach the browser at all (verified — neither appears in the page payload).

### Where they show up

- **Student**: the cohort shelf once at the top of My Classroom, and per-class material on each
  class card (curriculum's first, then this class's). The newest few also appear on the Dashboard.
- **Coach**: batch → **Resources** tab. Inherited curriculum rows are shown read-only in a tinted
  box, so a coach can see material they did not post rather than wondering where it came from.
- **Admin**: Programs → Curriculum → the paperclip on any row.

Links are validated, never sanitised: http(s) only. These are typed by staff and rendered as
anchors in a **student's** browser, so `javascript:` here would be stored XSS against the people
the app exists to serve. Every link opens with `rel="noopener noreferrer"`.

---

## 9. Class reminders

Two channels, one definition of "starting soon" (`src/lib/class-reminder.ts`).

### In-app (the bell)

Derived on every page load, never stored — there is no delivery to prove and no duplicate to
avoid, so a stored "we showed it" row would be a second source of truth free to disagree with
the screen. Opens 2 hours before a live class and **stays open through the class**, because an
alert that vanishes the moment a class starts disappears exactly when someone is hunting for the
link. Students see the classes they are seated in; coaches and tutors see the ones they are about
to teach.

### WhatsApp

| | |
|---|---|
| Engine | `src/server/class-reminders.ts`, on the existing `/api/cron/whatsapp` tick |
| Touchpoints | `CLASS_REMINDER` (students) · `CLASS_REMINDER_COACH` (whoever runs the batch) |
| Default ladder | 24h and 1h before, each rung once per recipient per class |
| Idempotence | counted off `WhatsAppMessage.classSessionId` — the same rows the WhatsApp screen shows, not a parallel table |
| Pre-recorded modules | never reminded about — they have no start time |
| Coach's number | their **team profile** phone, not their login; no profile number = skipped with that reason |

**Both ship OFF, and rehearsing when switched on.** This is the only touchpoint whose blast
radius is a whole cohort per class, and the live WATI account sends to real numbers (no test
recipient is set). A dry run writes the full SKIPPED row — recipient, template, resolved text —
so the exact blast is reviewable before one real message leaves.

Arm it in **WhatsApp → Settings → Cadence**: switch on *Class reminder (students)*, check the dry
run in WhatsApp history, then tick *Send for real*. Console → System → Not armed counts a
rehearsing engine as **not armed**, because it is doing its job perfectly while nobody is being
reminded of anything.

### Templates needing Meta approval

Three new entries in `WhatsApp_Templates_UTILITY_Submission_Pack.docx`
(`npm run docs:whatsapp:utility`), area **I · Class reminders** — the pack is now 35 templates:

| Template | Bind to | Note |
|---|---|---|
| `b2_class_reminder` | `CLASS_REMINDER` | **Bind this first.** Every variable is guaranteed non-empty, so it can never be skipped for want of a value. Points students at their classroom for the link. |
| `b2_class_reminder_link` | `CLASS_REMINDER` | Carries `{{join_url}}`. **Skips any class whose link has not been pasted** — an unresolved variable stops the whole send. Bind only once pasting the link is routine. Bind one of these two, not both. |
| `b2_class_reminder_coach` | `CLASS_REMINDER_COACH` | Batch name + headcount, so it reads as the coach's message rather than a copy of the student's. |

---

## 10. Running the local preview

The preview runs against a **project-local Postgres**, never Supabase. `.env` still points at
production and is untouched; `.env.local` (gitignored, created 21 Oct) overrides the database for
local runs only, because Next loads `.env.local` first.

```bash
node scripts/local-db.mjs start     # Postgres on :5435 (.pgdata). Does not return - that is fine.
npx next dev -p 3000                # reads .env.local → local DB
```

Delete `.env.local` to put local runs back on production.

### Rebuilding the demo data

```powershell
# load .env for BETTER_AUTH_SECRET etc., then force the DB local
Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+\s*=' } | ForEach-Object {
  $k,$v = $_ -split '=',2; Set-Item -Path "env:$($k.Trim())" -Value $v.Trim().Trim('"') }
$env:DATABASE_URL = 'postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public'
$env:DIRECT_URL   = $env:DATABASE_URL
npx tsx prisma/demo-coaching.ts     # curriculum + Batch 14 + 6 students + timetable
npx tsx prisma/demo-passwords.ts    # known passwords on the demo logins
```

Both scripts **refuse to run** unless `DATABASE_URL` is `localhost:5435` — they create users and
reset passwords, and production is one environment variable away.

`demo-coaching.ts` deliberately leaves the cohort mid-flight: five registers taken and one still
to take, six recordings outstanding, half the coursework done, one student on 20% attendance, and
one class 75 minutes out so the join button and the in-app alert are both live.

### Applying migrations locally

`prisma migrate deploy` auto-loads `.env`, and on this project a shell `DATABASE_URL` does **not**
win — that is how live Supabase has been hit twice before. Move `.env` out of the way first so
Prisma physically cannot reach it:

```powershell
try { Move-Item .env .env.bak -Force
      $env:DATABASE_URL='postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public'
      $env:DIRECT_URL=$env:DATABASE_URL
      npx prisma migrate deploy }
finally { Move-Item .env.bak .env -Force }
```

---

## 11. Migration

Two migrations, applied in order:

- `20261021100000_coaching_curriculum_and_timetable/`
- `20261021140000_class_reminders/` — the two new `WhatsAppKind` values and
  `whatsapp_message.classSessionId`
- `20261021170000_class_resources/` — `ResourceKind` + the `resource` table
- `20261021200000_attendance_window/` — `AttendanceSource`, the window and publish columns on
  `class_session`, and the backfill described in §12.8

Additive only: two tables, one enum, one new `Role` value, nullable columns on `batch`,
`class_session` and `enrollment`, plus the `coachId` backfill. Nothing is dropped. Hand-written,
because `migrate dev` has produced destructive drop-and-re-add diffs for enum changes on this
schema — on `Role` that would mean dropping the column every user's access hangs off.

**Not yet applied to any database.** Apply with `npm run db:deploy` from the app directory
(`.env` wins over a shell `DATABASE_URL`, so check which database `.env` points at first).

Exception: `20261021200000_attendance_window` has been applied to the local preview database on
`localhost:5435` only. Nothing has reached production.

---

## 12. Attendance: the window and the publish gate

### 12.1 What was already there, and what was missing

A register existed: `SessionAttendance`, one row per student per class, four statuses, with the
GREEN/AMBER/RED drop-risk signals computed from it in `lib/attendance.ts`. It was reachable from
two places — a tab on `/batches/[id]` and a row on the German Note schedule.

That is the right home for a correction a week later and the wrong one for what taking a
register actually is: a thing that happens in the first two minutes of a class, while the tutor
is also sharing a screen and greeting eight people. Nobody navigates a cohort page to find a tab
at that moment, which is most of why registers went untaken.

Two things were added, and they are deliberately separate decisions:

1. **Open the register.** For a bounded number of minutes the students in that cohort — and only
   that cohort — see a live "I'm here" button with a countdown. The register fills itself from
   the room.
2. **Show it to the students.** Afterwards, the tutor decides whether the cohort may read the
   finished marks.

They are separate because at the instant a window closes, the register is a list of everyone who
did not press a button — and the tutor has not yet excused the student who emailed in sick. The
gap between those two states is the whole reason publishing is its own switch.

### 12.2 The screens

| Who | Where | What they do |
| --- | --- | --- |
| Coach, tutor, head coach, admin | `/attendance` (new section, My Work) | Open now · Today · Never marked · Not shown to students · cohort summary |
| Same | the register sheet, from any of those rows | Live arrivals, provenance per row, "mark all present", "rest absent" |
| Student | `/dashboard` and `/classroom` | The check-in card while a window is open; their own marks once published |
| Student | the notification bell | "Attendance is open for …" while the window runs |
| Founder | Console → Alerts & chasing → Attendance | The two switches and the two durations |

The desk polls every 10 seconds **only while a window is open** — a tutor watches eight people
arrive over four minutes, and without a refresh the page would read "0 of 8" for the whole
window. An open sheet polls too, and merges: the server wins on rows nobody has touched, the
tutor wins on rows they have.

### 12.3 The two rules worth arguing about

Both live in `lib/attendance-window.ts`, pure and unit-tested (`attendance-window.test.ts`, 17
cases), because four callers have to agree about the same instant — the tutor's board, the
student's dashboard, the student's classroom, and the action that writes the row. A button the
server then refuses is worse than no button.

**Lateness is measured from `max(classStart, windowOpen)`.** Both halves are load-bearing:

- Not from the window alone. A tutor who opens ten minutes early, so arrivals can tick
  themselves off as they join, would otherwise have everyone who checks in on the hour marked
  LATE for a class that had not begun.
- Not from the class start alone. A tutor who forgets until twenty minutes in would otherwise
  mark the entire room LATE for the tutor's own delay.

The grace is **snapshotted onto the session** when the window opens (`attendanceGraceMins`), so a
cohort judged against a ten-minute grace in October is not silently re-judged when somebody
widens the setting in December. Same reasoning as `framework`.

**A student always sees their own check-in; the publish gate governs the tutor's verdict.** A
button that produces no visible change is one people press four times and then stop trusting.
What the gate withholds is the corrected register, with its absences and its excuses.

### 12.4 The consequence of the gate, stated plainly

While a register is unpublished it is invisible on the student's row **and absent from their
percentage**. Hiding the mark while still counting it would leak the verdict anyway: a student
whose rate drops from 100% to 83% has learned exactly what the hidden mark says, in the one form
they cannot question.

So a student's percentage is *lower-bounded* — the truth over the classes they have been told
about. Their coach's copy counts everything. The two can differ for as long as a tutor sits on a
register. That is the cost of the gate, and it is smaller than a number that silently reveals
what the gate exists to withhold.

### 12.5 Provenance

`SessionAttendance.source` is `TUTOR` or `SELF`, and `checkedInAt` records when the student
pressed the button. Three things need it:

- A student may see their own `SELF` row before publication.
- A `SELF` check-in must never overwrite a tutor's considered verdict — the action refuses.
- A tutor correcting a register needs to know which marks the students made themselves. That is
  the difference between confirming a row and overruling a person.

`markedById` is not a substitute: on a self check-in that id *is* the student's, it is nulled
when a login is deleted, and reading provenance off it would mis-answer for a tutor who is also
enrolled somewhere.

`checkedInAt` is separate from `markedAt` because `markedAt` is overwritten by every later
correction — a tutor amending one note at midnight would otherwise destroy the record of what
time the student actually arrived.

A tutor's save flips `source` to `TUTOR` **only on rows whose status actually changed**. Setting
it unconditionally would relabel every check-in as the tutor's own work merely for opening the
sheet, and the student's "you checked in at 10:31" confirmation would vanish until publication.

### 12.6 Guards

Opening, closing, publishing, marking and "rest absent" all run through one fence in
`server/attendance-actions.ts`: **ADMIN, HEAD, anyone holding `batches.manage`, or
`Batch.tutorId`**. `getAttendanceBoard` holds the mirror of that rule for the UI; if the two
drift, the board grows buttons the actions refuse.

**HEAD is the one permission this feature widens.** Everywhere else a head coach is a reader on a
cohort they do not lead — `canViewBatch` still returns `manage: false`, so they cannot re-date a
timetable. The register is the exception because the founders asked for it in those words ("the
tutor or the head coach enables attendance"), and because an attendance screen that cannot take
attendance is not one.

A student's check-in is fenced separately and more tightly: their login must resolve to a
`Student`, that student must be on *that* cohort's roster through either seating route, the
window must still be open when the server re-derives it, and no `TUTOR` row may already exist.
Without the roster check, any student login could check in to any class in the business by
passing its id — and the id is in the page source.

Opening a window is bounded to **within a day either side** of the class. Wider than the one-hour
guard on marking, because opening an hour early is a tutor being organised; bounded at all,
because a window on next month's class would sit on every student's dashboard inviting check-ins
indistinguishable from real ones.

### 12.7 Config (Console → Alerts & chasing → Attendance)

| Setting | Default | Why |
| --- | --- | --- |
| `selfCheckInEnabled` | `true` | Off hides the student button everywhere; tutors keep the sheet |
| `checkInWindowMins` | `15` | Long enough for a frozen video call, short enough that nobody ticks into a class they joined at the end |
| `checkInLateAfterMins` | `10` | Refused if longer than the window — LATE would be unreachable |
| `publishRequired` | `true` | What the founders asked for. Off restores the pre-window behaviour: a mark is visible as soon as it is written |
| `autoPublishOnClose` | `false` | Auto-publishing on close hands the cohort a list of everyone who did not press a button, before any excuse has been recorded |

Every new key carries a Zod `.default()`. `coerceAttendanceConfig` falls back to the *whole*
default object on a parse failure, so a required key would have silently thrown away the
founder's saved thresholds on the next deploy.

### 12.8 The backfill, and why it is in the migration

`20261021200000_attendance_window` ends with one non-structural statement: every session that
already has marks gets `attendancePublishedAt` set to the last `markedAt` on it.

Students could already see their own mark per class on `/classroom`. Once the publish gate goes
in, an unpublished session hides it — so shipping without the backfill would blank out attendance
history a cohort was reading yesterday, with no action by anyone and nothing on screen to explain
it. `markedAt` is used rather than `now()` because those registers were effectively visible from
the moment they were taken; stamping them with the deploy time would claim a publishing event
that never happened.

Sessions with no marks are left alone — there is nothing to publish, and the null is what makes a
tutor's first real "Show to students" press mean something.

### 12.9 Verified in the running app

Against the local preview, 21 Oct:

- **Coach board** — one window open with a live countdown, 2 of 6 marked, 2 self check-ins,
  "rest absent (4)" offered, "not shown to students (1)".
- **Student** — the card shows the countdown and the button; pressing it wrote `source: SELF`,
  `markedById` = the student's own login, and `status: LATE`, which was 13 minutes into a class
  with a 10-minute grace. That is the grace rule doing its job, not a bug.
- **Student classroom** — four published registers read "You attended", the
  marked-but-unpublished one reads "Attendance pending", and the student's own live check-in was
  visible immediately.
- **Publishing** from the coach's board moved "not shown to students" to 0 and the student's row
  from pending to its mark.
- **Opening** a window on a class 75 minutes out, then closing it by hand, both took effect.
- Zero console errors, zero server errors.

---

## 13. Missing a class: the notice, the catch-up list, and the viewing window

Three founder asks that turn out to be one loop: *tell the student they were absent*, *show us
who has not watched the recording within 24 hours*, and *let the head coach or tutor decide how
long a recording can be watched*. A catch-up deadline is meaningless if the recording has gone,
and a viewing window is meaningless if nobody watches whether it gets used.

### 13.1 The absence notice fires on PUBLISH, not on marking

This is the one design decision worth arguing with, so it is stated first.

A student may not see their mark until the coach presses "Show to students" (§12.3). If the
notice fired when the tutor ticked ABSENT, the student would get a message about a verdict their
own classroom was simultaneously hiding from them — one they could not look up, check or
dispute. So publication is the trigger: it is the moment the register becomes the student's
business.

Both channels respect it. `getMyCatchUp` filters on `attendancePublishedAt`, and so does the
WhatsApp sweep.

**Only ABSENT is ever messaged.** Not LATE — they were in the room. Not EXCUSED — the student
told somebody, which is the system working, and chasing them punishes exactly the behaviour we
want. Same line `isCounted` draws in `lib/attendance.ts`.

### 13.2 Two channels

| Channel | State | Gate |
| --- | --- | --- |
| In-app bell + dashboard | **Derived, never stored** — recomputed each load, disappears when they watch it | Console → Attendance (two switches, both default ON) |
| WhatsApp `CLASS_ABSENCE` / `CLASS_CATCH_UP` | `WhatsAppMessage` rows **are** the record of what was sent | WhatsApp → Settings → Cadence, both default **OFF**, dry-run default **ON** |

The in-app half is derived for the same reason the class alert is: a stored "we showed this" row
would be a second source of truth free to disagree with the screen, and a nudge *should* vanish
when the thing it nudges about is done. Only the WhatsApp half needs a memory, because a message
cannot be un-sent — dedupe is one message per `(class, student, kind)`, forever.

The outbound sweep looks back **14 days** only. A register published three weeks late should not
message a cohort about a class they have all forgotten, and it is also the blast-radius guard:
arming this for the first time gets a fortnight, not every absence ever recorded.

### 13.3 The catch-up list (`/attendance` → "Not caught up")

Derived from three tables that already existed and had never been joined up:
`SessionAttendance` (who was absent), `GnRecording` (whether the video is up, and for how long),
`GnRecordingWatch` (how much they actually watched). No new table — a `catch_up` table would be a
fourth record of facts the other three already hold.

**Watched means the TRACKED percentage**, via `resolveWatchTruth`. A student who ticked "watched"
at 40% is still behind, and the list says `40% (disputed)` — which is what lets a coach have that
conversation without it becoming an argument. That rule predates this work (spec §10.3).

Five states, because each needs a different action — or none:

| State | Means | Whose problem |
| --- | --- | --- |
| `NO_RECORDING` | Nobody posted the video | **Ours.** Agreement §3.3 promises it |
| `WINDOW_CLOSED` | Never watched, and the window has now expired | **Ours.** We let it close |
| `OVERDUE` | Absent, recording available, grace gone | Theirs — the founders' ask |
| `IN_GRACE` | Not late yet | Nobody. Chasing four hours after a class is noise |
| `CAUGHT_UP` | Watched it | Nobody |

The coach's list shows the first three (`needsFollowUp`). **The student is only ever messaged
about `OVERDUE`** — messaging them about the other two would blame them for our omission, which
is why those two appear on a desk and reach nobody's phone.

Grouped by **class**, not by student, which is the opposite of the teaching desk. A missing
recording or a closed window puts everyone who missed that session on the list from a single
cause; grouping by student would scatter one fixable cause across six rows and invite six
conversations instead of one action. The fix — "Watchable for 7d / 14d / … / No limit", or "Post
the recording" — is on the row, because sending a coach elsewhere to find it is how a follow-up
list stops being used.

A student with no portal login is flagged `No login` rather than silently read as "has not
watched". They cannot watch anything, and that is a coach's chore too.

### 13.4 The viewing window

`GnRecording.availableUntil`. **Null = no time limit**, which is both the old behaviour
(recordings were lifetime) and the right default for a cohort nobody has decided about.

- **An absolute instant, not a number of days.** A student promised a recording until 5 November
  must still have it on 4 November after somebody shortens the house default. Storing the days
  and computing expiry at read time would silently re-date every recording ever posted.
- **Editing a recording re-dates from its original posting time**, not from now — otherwise
  fixing a typo on day six of a seven-day window would hand the cohort another week without
  anyone deciding to.
- **Staff are never gated.** This governs the student portal only.
- **Withheld at the server boundary.** Prisma cannot filter a to-one relation by date, so the row
  is read and the URLs are simply not placed on the view — they never reach the browser's
  payload. Same rule as `visibleToStudents` on resources.
- The student's card **says** the window has closed rather than silently dropping the button: a
  card with no recording is indistinguishable from one the coach never posted, and a student
  would read our deadline as our failure.

Set from three places, all by ADMIN / HEAD / `batches.manage` / the batch lead:
`/coaching` when posting or **replacing** a recording, the German Note recording form, and
"Watchable for Nd" on the catch-up list.

### 13.5 Re-posting a recording now REPLACES it

`ClassSession.recordingId` is unique-to-one, so pointing it at a new row used to leave the old
recording orphaned — invisible to every screen and counted by nothing. The founders described
exactly this case ("the head coach will also be updating the link"), so the old row is now
deleted, taking its watch rows with it by cascade. **The watch history of a wrong video is not
evidence of anything.** If the old recording is also referenced by a `WATCH_VIDEO` task or a
classroom module the delete is refused and the row is left — strictly better than failing the
replacement the coach asked for.

The "Post the recording" button also no longer disappears once one exists. A head coach
correcting a bad paste was previously stuck: the only route was the German Note classroom, a
screen a coach has no section for.

### 13.6 One delivery fence, instead of three

`server/batch-access.ts` → `canManageDelivery`: **ADMIN, HEAD, `batches.manage`, or
`Batch.tutorId`**.

The same question had three implementations — in `attendance-actions.ts`,
`batch-timetable-actions.ts` and `german-note-actions.ts` — which had already drifted (the German
Note copy refuses anyone who is not a TUTOR; the other two honour `batches.manage`), and each
carried a comment warning that it must agree with the others. A rule needing three copies and
three warnings wants to be a function.

**German Note community moderation deliberately still uses its own, stricter check.** That one
also decides who may delete a student's post, and a head coach being able to run a class does not
imply they should be able to remove somebody's writing. Only the delivery question widened.

### 13.7 Config

Console → Alerts & chasing → Attendance:

| Setting | Default | Note |
| --- | --- | --- |
| `absenceAlertEnabled` | `true` | In-app notice when a published register marks them absent |
| `catchUpAlertEnabled` | `true` | In-app nudge once the grace runs out |
| `catchUpHours` | `24` | The founders' number. Measured from when the **recording** went up, not the class — a coach who posts three days late has not made the room three days overdue |
| `recordingAccessDays` | `0` (no limit) | What a tutor's picker pre-selects. Ships at 0 so nothing a cohort was already promised changes on deploy |

WhatsApp → Settings → Cadence: `classAbsenceEnabled`, `classCatchUpEnabled` (both off),
`classFollowUpDryRun` (on). One shared rehearse switch for both — they fire off the same facts
hours apart, and "am I rehearsing?" should not have two answers.

### 13.8 Templates needing Meta approval

Three new, in the regenerated pack (now **38** templates):

- `b2_class_absence` — bind this one first; every variable is guaranteed non-empty
- `b2_class_absence_link` — carries the recording link, and therefore **skips** any class whose
  video is not up *or* whose window has closed
- `b2_class_catch_up`

`watch_deadline` is a *sentence* ("7 days left to watch", "No time limit"), not a date, because
the window is per recording and a bare date leaves the reader to work out whether it has passed.

The absence templates close with "if you think this is wrong, reply here" — not politeness. A
register is taken by a human in a hurry, and a message asserting an absence with no way to
dispute it is how a wrong tick becomes an argument.

### 13.9 Migration

`20261021230000_recording_access_and_absence_notice` — one nullable column, one index, two enum
values. **No backfill, and none needed:** leaving `availableUntil` null preserves the lifetime
access every existing recording already had. The window only starts applying to recordings posted
or edited after somebody makes a decision about it.

---

## 14. The sprint leaderboard

Four taught weeks, then a 90-day (Guided) or 120-day (Elite) sprint. The taught weeks are
measured by attendance and coursework; the sprint is measured by what a student does with them.
One board spans both, because a student who attended everything and applied to nothing and one
who attended nothing and applied to forty roles are both in trouble, and only a number including
both can say so.

### 14.1 Two layers, like Sections

`lib/leaderboard.ts` holds the **catalogue** — code truth. A metric exists only because
something computes it, so the admin cannot invent one. `AppSetting("leaderboardConfig")` holds
**the admin's layer**: which metrics count, what each is worth, the weekly ceiling on the
self-reported ones, the period, the scope, the visibility and `topN`. That is what "configured by
the admin" means here — the arithmetic is theirs, the plumbing is not.

### 14.2 The ten metrics

| Metric | Source | Default | Read from |
| --- | --- | --- | --- |
| Class attended | measured | 10 | The register. LATE counts — they were in the room |
| Recording watched | measured | 5 | Tracked watch ≥90%. A 40% tick scores **nothing** |
| Coursework completed | measured | 10 | `SessionTaskCompletion` = YES |
| Sprint week hit | measured | 25 | `SprintWeek` = ACHIEVED |
| Application sent | measured | 5 | The tracker, on `appliedAt` |
| Offer received | measured | 200 | Tracker status SELECTED |
| **Application reviewed** | self-reported | 15 (cap 20/wk) | No `REVIEWED` status exists — applying is in our gift, being read is not |
| **HR connection accepted** | self-reported | 10 (cap 25/wk) | A German HR contact accepted |
| **HR interview secured** | self-reported | 50 (cap 10/wk) | Plus any tracker row at INTERVIEW |
| **Win shared** | self-reported | 5 (cap 5/wk) | Anything else worth telling the cohort |

**Only the self-reported four carry a cap**, and a test asserts that. A cap is meaningful only
where the quantity is typed in by the person being ranked — you cannot attend a class twice, so
capping attendance could only ever lose somebody real points.

**The derived six are not re-loggable.** Re-typing attendance into the leaderboard would be a
second copy of a fact the register owns, free to disagree with it; a board whose attendance
column contradicts the attendance page is worse than no board.

### 14.3 Scoring immediately, and what makes that safe

The founders chose "score at once, coach can correct". An entry counts the moment a student
writes it, and `/leaderboard` shows coaches a **review feed** where any entry can be edited down
or removed. Three things make that defensible:

- **The weekly cap**, applied per *elapsed* week — not per period length. 300 connections logged
  in week one score 25, not 300. Without that scaling the cap would let a week-one student bank
  thirteen weeks' worth in an afternoon.
- **The date is fenced at both ends.** Not in the future (the only reason to log tomorrow's
  interview is to bank points against a week that has not happened, and the cap is computed per
  elapsed week), and not before enrolment.
- **Removal is soft and logged.** `deletedAt`, following the house pattern. This row can decide
  a ranking, so a coach taking points off a named person has to be visible and reversible.

A student may withdraw their **own** entries but never a coach's correction.

### 14.4 Named peers — a deliberate reversal

This is the first section where a student sees another student. Everywhere else the privacy line
holds absolutely: on `/classroom` a classmate is a *count*, never a name. The founders asked for
a leaderboard, and a leaderboard of strangers motivates nobody.

It is also why `visibility` exists — NAMED / ANONYMISED / STAFF_ONLY. **`viewFor` strips the
names on the server**, before the view is serialised, so an anonymised board does not ship real
names to the browser merely hidden behind a label. Same rule as `visibleToStudents` on resources.

Two further limits, in the same function:

- **A classmate's breakdown is never sent.** The total is the board; the working behind it is
  theirs, and on a named board publishing it would amount to publishing their application count.
- **Anonymous labels are positional**, not derived from the person — "Student C" is the third
  row. A stable pseudonym on a six-person cohort stops being anonymous by about week three.

### 14.5 Ties, and the empty board

Equal totals **share a rank**: 1, 2, 2, 4. Breaking a real tie on something arbitrary invents a
difference the students can see is not real, on a board that names them. A cohort whose sprint
has not begun is therefore all joint first — which is right. Ranking six students 1–6 on nothing
at all would tell five of them they are behind before anything has happened.

### 14.6 The period, and why SPRINT falls back

`period: SPRINT` counts from the batch's sprint start. A cohort still inside its taught weeks has
no sprint yet, and scoring from a date that has not arrived would show every student zero — a
board of noughts on the screen meant to motivate them. So the window opens at enrolment instead
and **the page says which it used** (`basis: SPRINT_NOT_STARTED`). Nothing is hidden.

The window is one date for the whole cohort, taken from the batch — not per student. A board
whose students were each scored over a different number of days is not a ranking of anything.

`scope` defaults to BATCH for the same reason: a student in sprint week 12 and one in their first
taught week are not comparable, and a single global board would put every new cohort permanently
at the bottom of a race decided before they joined.

### 14.7 Cost

Eight counts, **four grouped queries plus one row read**. The one that cannot be grouped is
*recordings watched*: "watched" is `resolveWatchTruth`, not a column, and grouping in SQL would
have to pick either the tracked percentage or the tick — and picking the tick is exactly the
behaviour the founders complained about.

---

## 15. The absence reason — asked, never assumed

> "capture the absence reason only when nudged by the headcoach or their tutor"

**There is no standing reason box anywhere in the student portal.** That restraint *is* the
feature: an always-on "why were you away?" field on every missed class is a form nobody fills
in, and the silence it produces is indistinguishable from not caring — which is precisely the
distinction a coach needs. Asking rarely is what makes an unanswered question mean something.

The flow:

1. A coach opens the register, sees an ABSENT row, presses **Ask why**. `reasonAskedAt` is set.
2. The student gets a card on their dashboard: *"Karthick Raman asked why you missed Resume
   Building"*, one input, one Send.
3. The answer appears on the register beside the mark it explains, with **Excuse** next to it —
   because that is the decision the answer exists to inform, and making the coach reopen the
   register to act on what they just read is how a reason box becomes something nobody asks for.
   EXCUSED drops the class out of the attendance denominator (`isCounted`).

Guards worth noting:

- **Only ABSENT rows can be asked about.** Not LATE (they were there), not EXCUSED — somebody
  already knows why, and asking again would be the app failing to read its own record.
- **Asking is idempotent**, so a coach clicking twice cannot wipe an answer already given.
- **Answerable once.** A reason a student can rewrite after their coach has read it, and
  possibly excused them on the strength of it, is not evidence of anything.
- **Answerable only when asked** — enforced in the action, not just the UI. Without that server
  rule the field would quietly become the always-on form, reachable by anyone who could post.
- `submitAbsenceReason` lives in **its own file**, because every export in
  `attendance-actions.ts` is fenced on `canManageDelivery` and this one is fenced on *being the
  student in question*. Mixing them is how one ends up with the other's guard.
- **The reason is not in the activity-log summary**, only in `meta`. A student's explanation may
  be medical or personal, and an activity feed line is the wrong place for it to appear in
  passing.

### 15.1 Migration

`20261022120000_leaderboard_and_absence_reason` — four nullable columns on `session_attendance`
plus an index, two enums, and the `sprint_log_entry` table with a `CHECK` keeping quantity
between 1 and 500. Additive; no backfill.
