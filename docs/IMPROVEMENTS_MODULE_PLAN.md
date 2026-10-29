# Improvements — build plan

**Renamed 29 October 2026.** This was built as "Issue Reports" and renamed to **Improvements**
throughout - route, section, capability, Prisma models, tables, enums and copy. The body of this
plan has been rewritten to the new names so it reads as one thing; see §10 of
[`IMPROVEMENTS_P1_SHIPPED.md`](./IMPROVEMENTS_P1_SHIPPED.md) for what the rename touched and why
it was free to do when it was done.

**Status:** **P1 is built** (28 October 2026) - see [`IMPROVEMENTS_P1_SHIPPED.md`](./IMPROVEMENTS_P1_SHIPPED.md)
for what was built, what changed from this plan, and what is still open. The element tag (§5.2) was
pulled forward from P2 into P1; screenshots, breadcrumbs and the reporter-facing loop are not built.

This document stays as written below, as the plan it was. No existing behaviour is changed by
anything proposed here; the "Files touched" table at §9 is the complete list of existing files that
would gain a line, and every one of them is additive.

**Written:** 28 October 2026, against `master` at `45d528e` (+ an uncommitted working tree, see §10.1).

---

## 0. What is being asked for

Every signed-in person gets a **Report** control. Pressing it captures *where they are* and *what
the app was doing*, asks them *what kind of problem this is* and *what they think*, and lands the
result somewhere a developer is told about and can work from.

The founder's three named improvement kinds — "a logical improvement", "it needs a logical change", "an
entirely new feature for this section" — are the spine of the taxonomy in §3. They are not
cosmetic: each kind needs a *different set of questions*, because the thing that makes a report
actionable is different in each case (§3.2).

### 0.1 Naming, settled up front

`reports` is already a section (`/reports`, the founder's analytics). `feedback.tsx` is already the
toast/confirm host - and it is imported by 124 files, which is why "feedback" was rejected as the
name for this module even though it is the obvious positive word. So:

| Thing | Name |
|---|---|
| Section key / route | `improvements` → `/improvements` |
| Nav label | **Improvements** |
| Prisma models | `Improvement`, `ImprovementEvent`, `ImprovementAttachment` |
| Pure module | `lib/improvement.ts` |
| Server modules | `server/improvement-actions.ts`, `server/improvements.ts`, `server/improvement-context.ts` |
| Button component | `components/shell/SuggestImprovementButton.tsx` |
| Human reference | `IMP-0001` (see §4.3) |

Using "feedback" or "reports" anywhere in this module is a collision with two live things. Don't.

---

## 1. What the last two weeks say the module must do

This is not a generic bug tracker. The last 14 days of this repo tell us exactly which *classes* of
problem actually occur here, and the capture form should be built to make those classes
self-diagnosing. 50 commits, 14–26 Oct, 558 files, three audit rounds:

| Date | Shipped | Problem class it was fixing |
|---|---|---|
| 14 Oct | invoice numbering, receipts, login credentials, derived instalment plans | missing states in money |
| 22 Oct | student/coach/tutor flows, Batches section, dedicated VPS, agreement documents | new surface area |
| 24 Oct | flow refactor rounds 1–3: CV Studio + Automation + Ledger removed, onboarding board, journey rail, 23 browser titles, 5 walkthrough bugs | dead ends, screens that disagreed |
| 25 Oct | auth screens cleanup | — |
| 26 Oct | wireflow audit (A1–A8, B1–B7, C1–C6), then the observability audit | dead ends · access/secrets · missing states · silent failures |

### 1.1 The six recurring classes

1. **Dead ends.** A screen that tells you to do something and offers no way to do it; a flow that
   ends nowhere. 20 setup dead ends found in the inventory, 13 fixed; A1–A8 on 26 Oct were all of
   this shape. *The reporter's word for this is "I'm stuck", not "there's a bug".*
2. **Two places answering one question differently.** W1: archived income counted as money received
   in the decision site but not the display site — the panel read ₹0 while the decision released
   books. Bug #3: two capacity checks disagreeing over one column. *The reporter's word for this is
   "this number is wrong" — and the only thing that makes it diagnosable is **which number they saw,
   on which screen**.*
3. **Missing states in the data model.** C1–C6: a reversed settlement un-chaseable for ever; income
   with no failure state; a class that could not be cancelled; a past class with no register
   carrying no pill. *The reporter's word for this is "there's no way to record X" — which is the
   founder's "needs a logical change" kind, exactly.*
4. **Silent failure.** The observability audit's whole subject: `agreements` reading STALE for 21
   hours out of 24 while working; an armed WhatsApp channel sending nothing and reading as a quiet
   week; phone-less leads 422'd with no trace. *Nobody reports these, because nothing looks wrong.
   The module's job here is narrow: when someone **does** report "the message never arrived",
   attach the delivery verdict so the dev doesn't start from zero.*
5. **Armed vs. broken.** Most engines in this app ship OFF by default and live has them at their
   OFF default. The single most likely report in week one is *"this section does nothing"* about a
   section that is working exactly as configured. **This is the highest-value piece of automation in
   the whole module:** the server must answer "is the engine behind this screen armed?" at submit
   time, before a human reads the report (§5.3).
6. **Access and permission confusion.** B3/B7/A7, the HEAD role supersession, `AccessDeniedToast`
   showing nothing for a key the catalogue does not hold. *The reporter's word is "I can't see X" —
   needs role, section overrides and capability grants captured, or it is unanswerable.*

### 1.2 The lesson that sets the design

> "Round two's lesson was that the deep problems came out of *using* the app, not scanning it. This
> round did both: six more static audit classes, then the money flows driven by hand. The audits
> were nearly silent; walking the screens was not." — `docs/refactor/CHANGELOG.md` §12

Four of the five round-three bugs were found by *doing a thing twice* (W2 — the income form died on
the second save) or *pressing the button and reading what came back* (W4 — Send returned four
compliance gaps at once). Static analysis found almost nothing. Every person using this app every
day is doing the thing the audits cannot do, and today **there is no path from what they notice to
the developer.** That path is this module, and it is why it is worth building before any feature on
`docs/FUTURE_FEATURE_ROADMAP.md`.

It also sets the capture priority: **what the person was doing beats what the screen looked like.**
A screenshot of the income form after W2 shows the word "null" and tells you nothing; "I saved one
payment and then tried to save a second" is the entire bug. Hence the form in §3.2 asks for steps
and reproducibility before it asks for a picture.

---

## 2. Scope

### In scope (v1)

- A Report control reachable from **every authenticated screen**, for all six roles
  (ADMIN, HEAD, USER, STUDENT, TUTOR, COACH).
- A Report control on the **crash screen** (`app/(app)/error.tsx`) and the not-found screen —
  the screens most worth reporting are the broken ones, and the shell may not be there.
- Kind-aware questions (§3.2), auto-captured context (§5), optional screen tagging and screenshot.
- A triage queue at `/improvements` for whoever holds a new `improvements.triage` capability.
- The reporter can see the status of their own reports and is told when one is fixed (§6.4).
- Notification to the developer: in-app bell + email, severity-gated (§7).

### Out of scope (v1), deliberately

| Not doing | Why |
|---|---|
| Reporting from **public** surfaces (`/book`, `/agreement/<token>`, `/p`, `/f`) | An unauthenticated write with a file upload is the attack surface this app has been systematically closing (B2/B5, and `/api/form-upload`'s own warning note). A prospect who hits a problem on `/book` is a sales conversation, not a ticket. Revisit only with the same defences that route carries. |
| WhatsApp notification of the developer | Needs a new WATI template → Meta approval, and the pack already has 7 unsubmitted. Worse: `testRecipient` is null with `WATI_ENABLED="true"`, so outbound goes to real numbers. Email + in-app is enough for a queue one person reads. |
| GitHub / Jira / Linear sync | The developer is one party. A second system to keep in sync is a cost with no reader. The Markdown export in §6.3 covers "I want this in my own tracker". |
| Session replay (rrweb etc.) | A client-side DOM recorder is a PII firehose over student data and a bundle cost on every page. The breadcrumb ring in §5.4 buys most of the diagnostic value for ~2 KB. |
| Any change to existing logic | Explicitly ruled out by the brief. See §9 for the exact additive touches. |

---

## 3. The taxonomy and the questions

### 3.1 Improvement kind — `ImprovementKind`

The founder's three, plus the four that the last two weeks prove will arrive whatever the picker
offers. Seven is near the limit of what someone will read; each carries a one-line hint so the
picker is self-teaching.

| Kind | Label the reporter sees | Hint | Class (§1.1) |
|---|---|---|---|
| `NOT_WORKING` | Something is broken | "It errored, or nothing happened when I did it" | 1, 4 |
| `WRONG_RESULT` | A number or result looks wrong | "The figure, list or status here does not match what I expect" | 2 |
| `LOGIC_CHANGE` | The rule should work differently | "It does what it was built to do; the rule itself is wrong for us" | 3 |
| `MISSING_STATE` | There is no way to record this | "The thing that happened has no option on this screen" | 3 |
| `NEW_FEATURE` | This section needs something new | "A capability that does not exist yet" | — |
| `CONFUSING` | I cannot tell what to do here | "The screen is unclear, or tells me to do something I cannot find" | 1 |
| `ACCESS` | I cannot see or open something | "Permission, a blocked page, or a missing section" | 6 |

`MISSING_STATE` is split out from `LOGIC_CHANGE` on purpose: C1–C6 were all of that exact shape, and
the two need different follow-ups (one is a schema change, the other is a rule edit). The founder's
"logical improvement" splits into `NOT_WORKING` and `WRONG_RESULT` for the same reason — "it crashed" and
"it gave me ₹99,500 where the panel says ₹0" are different investigations.

**Kind is the reporter's opinion, not a classification.** The dev can re-kind it during triage, and
`ImprovementEvent` records that it was re-kinded — which makes the picker's accuracy measurable (§11.4).

### 3.2 Questions per kind

This is the part the brief asks for explicitly: *"the thought should be collected from the person
who is reporting the improvement."* One generic "describe your improvement" box produces "doesn't work". The
form asks different things per kind, and only 2–4 things at a time.

| Kind | Required | Optional | Why these |
|---|---|---|---|
| `NOT_WORKING` | What were you doing? · What happened? | What did you expect? · Does it happen every time? (always / sometimes / once) | W2 needed "I saved a second one". Reproducibility is the single field that decides whether a dev can chase it. |
| `WRONG_RESULT` | What does it show? · What should it show? | Where are you seeing the right number? | W1 was *two screens disagreeing*. "Where is the right one" names the second site and halves the hunt. |
| `LOGIC_CHANGE` | What is the rule now? · What should it be? · Why — what goes wrong with the current rule? | Who else does this affect? | A rule change without a "why" cannot be judged. The changelog's "Left alone, deliberately" table is full of rules nobody could judge. |
| `MISSING_STATE` | What happened in real life? · Where would you expect to record it? | What do you do instead today? | "What do you do instead" is how you find out the workaround is corrupting data. |
| `NEW_FEATURE` | What should it do? · Who is it for? · What do you do today instead? | How often would you use it? (daily / weekly / rarely) | Frequency × "today instead" is the whole prioritisation input. |
| `CONFUSING` | What did you expect this screen to do? | What would make it clear? | The dead-end class. The reporter's expectation *is* the finding. |
| `ACCESS` | What were you trying to open? · What did it say? | Who told you you should have it? | A7 was a denial toast that rendered nothing. |

Shared across every kind: **severity** (`BLOCKING` "I can't do my job" / `ANNOYING` "I have a
workaround" / `MINOR` "cosmetic") and a title (auto-suggested from the first answer, editable).

Severity is the reporter's, and it drives notification urgency only (§7.3) — never triage order,
which is the dev's call. Nobody's `MINOR` should be able to page anyone, and nobody's `BLOCKING`
should be silently ignored.

### 3.3 Status — `ImprovementStatus`

`NEW` → `TRIAGED` → `ACCEPTED` → `IN_PROGRESS` → `FIXED` → `CLOSED`, plus the terminal
`DECLINED` and `DUPLICATE`.

Deliberately a **stored column**, not derived — unlike `lib/agreement-state.ts`, which derives 8
states from evidence. There is no evidence to derive from here: "a human decided to work on this" is
not observable anywhere else in the system. The status machine itself (which transitions are legal)
*is* pure and lives in `lib/improvement.ts`, so the UI and the server agree on what buttons exist.
That is the half of the agreement-state pattern that does apply.

`FIXED` is distinct from `CLOSED`: `FIXED` means the dev shipped something, `CLOSED` means the
reporter (or the dev, after a timeout) agrees it is actually fixed. Collapsing the two is how a
tracker fills with things everyone believes are done.

---

## 4. Data model

### 4.1 Three tables

```prisma
model Improvement {
  id             String   @id @default(cuid())
  ref            String   @unique            // IMP-0001, drawn at create (§4.3)

  kind           ImprovementKind
  severity       ImprovementSeverity
  status         ImprovementStatus @default(NEW)

  title          String                       // <= 160, suggested from the answers
  answers        Json                          // the kind-specific Q&A, see §4.4
  reporterNote   String?                       // free text, <= 2000, always offered last

  // WHERE — the screen tag
  route          String                        // pattern, not raw path: /students/[id]
  routeParams    Json?                         // ids only
  sectionKey     String?                       // resolved from the catalogue, null if not a section
  elementTag     Json?                         // §5.2
  screenWidth    Int?
  screenHeight   Int?

  // WHAT THE APP WAS DOING — server-captured, never client-trusted (§5.3)
  context        Json
  breadcrumbs    Json?                         // §5.4, client-supplied, scrubbed on arrival
  clientDigest   String?                       // Next's error digest, when reported from error.tsx
  appVersion     String?                       // git sha of the running image

  reporterId     String
  reporter       User     @relation("ImprovementReporter", fields: [reporterId], references: [id])
  reporterRole   String                        // role AT REPORT TIME; roles change

  assigneeId     String?
  assignee       User?    @relation("ImprovementAssignee", fields: [assigneeId], references: [id])
  duplicateOfId  String?
  duplicateOf    Improvement?  @relation("ImprovementDuplicate", fields: [duplicateOfId], references: [id])
  duplicates     Improvement[] @relation("ImprovementDuplicate")

  devNote        String?                       // triage notes, dev-visible only
  resolution     String?                       // shown to the reporter on FIXED / DECLINED
  fixedInVersion String?

  notifiedAt     DateTime?                     // developer notification attempted (§7)
  firstTriagedAt DateTime?
  fixedAt        DateTime?
  closedAt       DateTime?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?                     // house soft-delete, §4.5
  deletedById    String?

  events         ImprovementEvent[]
  attachments    ImprovementAttachment[]

  @@index([status, createdAt])
  @@index([sectionKey, status])
  @@index([reporterId, createdAt])
  @@index([deletedAt])
}

model ImprovementEvent {
  id        String      @id @default(cuid())
  reportId  String
  report    Improvement @relation(fields: [reportId], references: [id], onDelete: Cascade)
  kind      ImprovementEventKind            // STATUS · COMMENT · REKIND · ASSIGN · ATTACH
  fromValue String?
  toValue   String?
  body      String?                   // <= 2000
  /** A comment the REPORTER may read. Dev notes default to internal. */
  visibleToReporter Boolean @default(false)
  actorId   String
  actor     User        @relation(fields: [actorId], references: [id])
  createdAt DateTime    @default(now())
  @@index([reportId, createdAt])
}

model ImprovementAttachment {
  id           String      @id @default(cuid())
  reportId     String
  report       Improvement @relation(fields: [reportId], references: [id], onDelete: Cascade)
  storageKey   String      @unique    // PRIVATE bucket key, never a public URL (§5.5)
  mimeType     String
  bytes        Int
  width        Int?
  height       Int?
  uploadedById String
  createdAt    DateTime    @default(now())
  @@index([reportId])
}
```

### 4.2 The migration is hand-written

Four new enums (`ImprovementKind`, `ImprovementSeverity`, `ImprovementStatus`, `ImprovementEventKind`) and three tables.

**`prisma migrate dev` must not be used.** It reaches for a destructive drop-and-re-add on this
schema — recorded twice in this repo's own history (the configurable-payment-types work, and the
26 Oct wireflow migration, whose commit message states that every enum change in it is written by
hand as `CREATE TYPE` / `ADD VALUE`). Author the migration as SQL at
`prisma/migrations/<ts>_improvements/migration.sql`: four `CREATE TYPE`, three `CREATE TABLE`, the
indexes, the FKs. It is **purely additive** — no existing table is altered. `User` gains three
back-relations, which is a Prisma-side change with no SQL.

### 4.3 `ref` — the human reference

`IMP-0001`, drawn at create. `server/document-numbers.ts` already owns at-improvement numbering for
invoices (`INV-yy9999`) with the locking that makes it collision-safe; reuse it rather than writing
a second counter. If its contract turns out to be invoice-shaped, the fallback is a serial-backed
default on `ref` — but a second numbering implementation in this codebase needs a reason, and "it
was easier" is not one.

### 4.4 Why `answers` is `Json` and not columns

Seven kinds × 2–4 questions ≈ 20 fields, of which any one report fills three. Columns would mean 20
nullable columns and a schema change every time a question is reworded. The shape is owned by
`lib/improvement.ts` as a discriminated union keyed on `kind`, validated with `zod` on the way in
*and* on the way out — the same contract `sectionsConfig` and the funnel builder blocks already use
(`lib/config-schema.ts`). The rule from that precedent carries over: **unknown keys are ignored,
missing keys fall back**, so a question reworded next month does not make old reports unreadable.

### 4.5 Soft delete

`Improvement` becomes the **10th** soft-deleted model. `lib/soft-delete.ts` names the nine
explicitly in its header comment; that comment is updated in the same change, and every list read
spreads `...ACTIVE`. Follow the house rule: no Prisma middleware, explicit filtering per query.
Archived reports are swept by the existing retention cron, which needs no change — it reads
`ARCHIVED` generically.

A report is **archived, never hard-deleted**, including on `DECLINED`. "We decided not to do this"
is the most valuable row in the table six months later.

---

## 5. Capture: what "tagging the screen" actually means

Four layers, in descending order of diagnostic value per unit of effort. Layers 1 and 3 are
automatic; 2 and 4 cost one click each.

### 5.1 Layer 1 — the route (automatic, free)

`usePathname()` + `useParams()`. Params are recorded as **ids only**, and the section key is
resolved from the catalogue rather than parsed out of the URL, so `/students/abc123` records
`route: "/students/[id]"`, `routeParams: { id: "abc123" }`, `sectionKey: "students"`. Recording the
raw path would put a student id into a `title` and into a notification email.

### 5.2 Layer 2 — the element tag (one click, no dependency)

"Point at the problem": the modal offers a crosshair, and the next click anywhere on the page is
captured instead of actioned (capture-phase `pointerdown`, `preventDefault`), recording:

```ts
{ selector: "main > div:nth-of-type(2) > table tbody tr:nth-child(3) td:nth-child(5)",
  testId: null, text: "₹0", role: "cell",
  heading: "Income · October", box: { x, y, w, h } }
```

`text` is capped at 120 characters. This is what makes class-2 reports answerable: W1's report would
have carried `text: "₹0"` against a heading naming the panel, and the dev would have known which of
the two disagreeing sites the person was looking at without a single follow-up question.

Cost: one `useEffect`, one listener, zero dependencies. The tag is **optional** and the flow never
blocks on it.

### 5.3 Layer 3 — server-side context (automatic; the most valuable field in the table)

Captured **on the server, inside the submit action** — never sent up from the client, because the
client cannot be trusted about its own permissions and does not know what is armed. New module
`server/improvement-context.ts`, reading only modules that already exist:

| Captured | Source | Answers |
|---|---|---|
| Is the engine behind this screen armed? | `lib/engines.ts` + `server/engine-status.ts`, keyed by `sectionKey` | *"This section does nothing"* — class 5, answered before a human reads it |
| Delivery verdict for the relevant channel | `server/delivery-health.ts` | *"The WhatsApp never arrived"* — class 4 |
| Role, section overrides, capability grants | the session (`requireSession`) | *"I can't see X"* — class 6 |
| Running build | git sha / `observabilityRuntime().release` | "fixed in" vs "still on the old image" |
| Recent server errors | `recentErrors()` from `lib/observability.ts` (an in-process ring kept whether or not Sentry is armed) | Links the report to a trace that already exists |
| IST server time | `lib/dates.ts` | Cron-adjacent reports |

**Nothing here is a new query against a new table.** Every one of these reads is a function this
codebase already calls on some screen. That keeps the submit path cheap and stops this module
becoming a second source of truth about arming.

Everything in `context` passes through `scrubContext()` from `lib/observability.ts` before it is
stored. That function already strips `postgres://` URLs, Bearer tokens, JWTs and 32+ character hex
runs — it exists because a Prisma connection error embeds the production password. Re-deriving
scrubbing for this module is how the next leak would happen.

### 5.4 Layer 4 — client breadcrumbs (automatic, ~2 KB)

New module `lib/report-breadcrumbs.ts`: a capped in-memory ring (20 entries, per tab, never
persisted) recording route changes, failed `fetch`/action responses and `window.onerror`. Read only
when the modal opens; scrubbed server-side on arrival.

This is the W2 catcher. "Saved · `/finance` → re-rendered → action returned an error" is the whole
bug. It is the cheapest approximation of session replay and carries no PII beyond paths and error
messages. It touches no existing logic: nothing else reads the ring, and an empty ring still makes
a valid report.

### 5.5 Screenshots — recommendation: paste/attach, into a private bucket

**Recommended: paste or drop an image.** The modal accepts `Ctrl+V` (clipboard image) and
drag-and-drop; max 2 files, 5 MB each. On Windows, `Win+Shift+S` then `Ctrl+V` is two keystrokes and
the person crops to the actual problem, which beats any automatic full-page capture.

Rejected, with reasons, so this is not relitigated later:

| Option | Why not |
|---|---|
| `html2canvas` / `html2canvas-pro` | A new client dependency on every page that re-implements layout, and it mis-renders exactly the modern CSS this app is built on (custom properties, CSS masks, `backdrop-filter`, the `BrandLogo` mask). It also fails hardest on a broken render — the case you most want a picture of. |
| `getDisplayMedia()` | Native and dependency-free, but raises an OS-level screen picker every time, can capture the wrong window, and is a worse experience than the snipping tool the person already has. **Worth adding later** as a progressive enhancement behind a `try/catch`; not v1. |
| Full DOM serialisation | A PII firehose (student names, balances) for a diff nobody reads. The element tag's `text` field carries the one value that matters. |

**The storage gap this plan exists to catch:** `lib/supabase-storage.ts` writes to a **public-read**
bucket and `publicUrl()` returns an uncredentialed URL — correct for marketing media, wrong for a
screenshot of a student's payment schedule. Improvement attachments therefore go to a **separate,
non-public bucket** (`SUPABASE_IMPROVEMENT_BUCKET`, default `improvement-attachments`, public-read off) and are
served through an authenticated route that checks `improvements.triage` or ownership and streams the
bytes. `supabase-storage.ts` needs one additive export (`downloadObject`, or a signed-URL helper);
`publicUrl()` must never be called with the improvement bucket, and a test should pin that.

The upload itself is a **route handler, not a server action** — a server action cannot stream a file
body; the whole payload would be serialised into the action argument. Mirror
`src/app/api/media/upload/route.ts` exactly: `sharp().metadata()` magic-byte sniffing (never the
filename, never the browser's `Content-Type`), a raster allow-list with SVG deliberately excluded as
a stored-XSS vector, a size cap, and a 503 carrying a clear sentence when storage is unconfigured.

### 5.6 What the reporter sees before sending

The modal's last step shows **exactly what will be sent**, collapsible: the route, the tag, the
context keys, the breadcrumbs, the attachment thumbnails. Two load-bearing reasons: a person who
cannot see what is being collected under-reports, and this is the only honest place to let someone
remove an attachment that caught a screen they should not share.

---

## 6. Screens

### 6.1 The Report control

Mounted **once**, in `AppShell`'s top bar, beside `ThemeToggle` / `NotificationBell`. One mount
covers all six roles: `/portal`, `/tutor` and `/coach` are **login screens only** — every
authenticated surface, students included, renders inside the `(app)` group under `AppShell`. Worth
stating plainly, because the brief says "all the users" and the natural assumption is four shells.

Shape: an icon button (`lucide` `MessageSquareWarning` or `Flag`), label from `sm:` up, matching
`RecordButton`'s classes. Plus a `CommandPalette` entry ("Report an improvement") so it is keyboard
reachable without claiming a new global shortcut — `mod+K` is taken and a second one is noise.

**Not a floating FAB.** The rail collapses at 1100px (§5.1 of the design system) and the top bar is
already the home of global actions; a floating button would sit over `DataTable` pagination on the
money screens.

### 6.2 The crash screen

`app/(app)/error.tsx` is already a client component that already posts to
`/api/observability/client-error`. It gains a **Report this** button opening the same modal
pre-filled with `kind: NOT_WORKING`, `severity: BLOCKING`, the Next `digest` and the route — so the
report and the Sentry event share a key. Same for the not-found screen.

This is the highest-signal entry point in the module and it is three lines of JSX. Today a React
render error shows a message and tells nobody by name.

### 6.3 `/improvements` — the triage queue

A new section, `ADMIN` by default, gated by a new capability `improvements.triage`.

- `DataTable` of open reports: ref, kind chip, severity, section, reporter, age, status.
- Filters: status, kind, severity, section, reporter, "mine".
- A grouped-by-section view, because "which part of the app generates reports" is the number that
  decides where the next week of work goes (§11.4).
- Detail: the answers, the context panel (**arming verdict first** — it answers a third of reports
  outright), the element tag with the screenshot, the breadcrumbs, the event thread.
- Actions: re-kind, set severity, assign, legal status transitions only, mark duplicate of `IMP-…`,
  write a dev note (internal), write a reply (visible to the reporter), export one or many as
  Markdown for pasting into whatever the developer actually works from.
- **Empty states must carry an action or a named explanation** — `lib/__tests__/empty-states.test.ts`
  is a source scan that enforces this, and "no open improvements" is a genuine good-news state that must
  be listed in that test's deliberate-exclusions table.

### 6.4 What the reporter sees — the loop that decides adoption

Reporters see **their own** reports only, scoped server-side. The pattern to copy is the sprint
leaderboard's `viewFor`, which strips other people's names **in the query**, not in the component.
That precedent exists for a reason: a client-side filter over a full list is a leak waiting for a
render bug.

Surfaces:
- A "My reports" panel on `/profile`, or a tab on `/improvements` for anyone lacking `improvements.triage`.
- A bell item when one of their reports reaches `FIXED`, carrying the `resolution` sentence and a
  "still happening?" action that re-opens it.

**This is not polish.** A reporting channel where nobody hears back goes quiet in two weeks, and
then this is another dead section like the ones removed on 24 Oct. The loop is the feature.

### 6.5 Guide entry — mandatory, not optional

`src/lib/__tests__/sections-structure.test.ts` asserts, as a hard gate (it was a ratchet and is now
a rule): **every section has a guide entry**, its `href` resolves to a real route, the entry and the
catalogue agree on that href, every screenshot it names exists in `public/guide/`, and the click
`path` starts "where the reader's eyes are". So `lib/guide-content.ts` gains an `improvements` entry with
a `path`, 3–5 steps, and either no `shots` or real captures from `npm run guide:shots`.

A section shipped without this **fails the test suite**. It is called out here because it is the
single easiest thing in this plan to forget.

---

## 7. Notifying the developer

### 7.1 In-app (v1)

`server/notifications.ts` gains one item: *N open improvement reports, M blocking*, for holders of
`improvements.triage`, linking to `/improvements`. Stateless — it appears while the condition holds and
disappears when the queue is clear, which is exactly that module's existing contract ("stateless
status alerts that appear while a condition holds"). `escalated: true` is right for a `BLOCKING`
report: that flag exists for "a person deliberately raised this", and this is its purest case.

### 7.2 Email (v1)

`sendResendEmail` from `lib/email.ts`, to a **config-backed** developer address held in `AppSetting`
via `server/founder-config.ts` — not an env var. The repo has already learned this (the WhatsApp
URLs became config-backed variables for the same reason): an env var means a redeploy to change who
gets the mail, which is how a notification channel ends up pointing at someone who left.

Be honest about what it proves: **`SENT` means Resend accepted it, not that it was delivered.**
`notifiedAt` records the attempt. The triage queue is the system of record; email is a nudge.

### 7.3 Severity gating, and no new cron

| Severity | Developer email |
|---|---|
| `BLOCKING` | Immediately, one email per report |
| `ANNOYING` / `MINOR` | Folded into a **daily digest** |

The digest rides the **existing** `/api/cron/daily` job, inside its `safe()` wrapper so a failing
sub-job cannot fail the tick. A *new* cron route would need a matching crontab entry in
`docker/cron/entrypoint.sh` **and** an explicit `STALE_AFTER_MINUTES` entry in `server/uptime.ts` —
`lib/__tests__/cron-stale-thresholds.test.ts` reads both files as text and fails the suite if any
job rides the default. That test exists because `agreements` shipped without a threshold and read
STALE for 21 hours out of every 24. Folding into `daily` avoids the whole class.

### 7.4 Sentry

On submit, one `captureException`-style breadcrumb with `where: "improvement"` and the ref, so a
report surfaces in whatever alerting the DSN points at and can be correlated with the error it is
about. Cheap, inherits the scrubbing, and degrades to nothing when the DSN is unset — like
everything else behind that seam.

### 7.5 This module ships ON

House convention is that engines ship OFF behind a switch. That convention is right for anything
that sends to a customer and should not be copy-pasted here: a report button is inert, writes one
row, and sends nothing outside the org. Shipping it disarmed would reproduce the exact failure mode
of the engines currently sitting at their OFF default on live.

What *is* gated: the **developer email** (no configured address → in-app only, no error) and
screenshot upload (no bucket configured → the rest of the form still works). Both fail soft with a
sentence, never a stack trace — the `storageConfig()` contract.

---

## 8. Build order

| Phase | Deliverable | Value on its own |
|---|---|---|
| **P1** | Migration · `lib/improvement.ts` · `server/improvement-actions.ts` + `improvements.ts` + `improvement-context.ts` · button in `AppShell` · modal with all 7 kinds and their questions · `/improvements` queue · in-app bell · guide entry · tests | **Complete and shippable.** Reports land, the dev is told, and the context answers the arming question automatically. |
| **P2** | Element tag (§5.2) · paste/drop screenshots + private bucket + authenticated read route · breadcrumb ring (§5.4) · Report button on `error.tsx` | Turns a good report into a diagnosable one. |
| **P3** | Reporter-visible status · reply thread · `FIXED` notification with "still happening?" · Markdown export · daily digest email | Keeps the channel alive past week two. |
| **P4** | Reports-by-section analytics · kind accuracy (how often triage re-kinds) · time-to-first-triage | Tells the founder where the app actually hurts. |

P1 is the honest MVP. P2 and P3 are not optional in the long run — P2 because without it reports are
guesses, P3 because without it reporting stops.

---

## 9. Every file touched

### New

```
prisma/migrations/<ts>_improvements/migration.sql
src/lib/improvement.ts                      pure: kinds, questions, status machine, zod shapes
src/lib/report-breadcrumbs.ts                client ring buffer (P2)
src/server/improvement-actions.ts                  "use server" - submit, triage, comment
src/server/improvements.ts                         reads for /improvements and "my reports"
src/server/improvement-context.ts                  server-side context capture
src/components/shell/SuggestImprovementButton.tsx   top-bar button
src/components/shell/SuggestImprovementModal.tsx    the form
src/components/improvements/...                    queue table, detail, context panel, tag picker
src/app/(app)/improvements/page.tsx                + loading.tsx, _components/
src/app/api/improvements/attachment/route.ts       upload (route handler, not an action)
src/app/api/improvements/attachment/[id]/route.ts  authenticated read
src/lib/__tests__/improvement.test.ts
src/server/__tests__/improvement-context.test.ts
src/server/__tests__/improvement-redaction.test.ts
```

### Existing — additive only

| File | Addition | Risk |
|---|---|---|
| `prisma/schema.prisma` | 3 models, 4 enums, 3 `User` back-relations | None; no column altered |
| `src/lib/sections.ts` | one `SECTION_CATALOGUE` entry (`improvements`, `/improvements`, group `Admin`, `roles: ["ADMIN"]`, icon `inbox`) | A missing key falls back to the catalogue, so no live `sectionsConfig` row is strictly needed — unlike `automation`, which was invisible on live for want of one. Verify on live regardless. |
| `src/lib/capabilities.ts` | one `improvements.triage` capability | None |
| `src/lib/guide-content.ts` | one `GUIDES` entry | **Required**, or `sections-structure.test.ts` fails |
| `src/lib/soft-delete.ts` | header comment: nine models → ten | None |
| `src/components/shell/AppShell.tsx` | import + render the button | Low; mirrors `RecordButton` |
| `src/app/(app)/error.tsx` | a Report button (P2) | Low; already a client component |
| `src/server/notifications.ts` | one notification item | Low; same shape as the others |
| `src/lib/supabase-storage.ts` | `downloadObject` / signed-URL helper | Additive export; **do not** change `publicUrl` |
| `src/app/api/cron/daily/route.ts` | digest step inside the existing `safe()` wrapper (P3) | Low |
| `src/lib/__tests__/empty-states.test.ts` | list the new empty states | Required by that test's own contract |
| `docs/DEV_MAP.md`, `docs/APP_MAP.md` | the new module and screen | Docs |

**No existing logic is modified.** No existing query, rule, total or state machine is touched.

---

## 10. Deployment, and the traps this repo has already paid for

### 10.1 Before anything

The working tree currently holds **~30 modified files** (WhatsApp submission, delivery health,
`sections.ts`, `AppShell.tsx`, the lead webhooks, `config-schema.ts`). Two consequences:

1. `docker build` ships the **working tree, not the commit** — build from `git archive HEAD`, or
   this unrelated in-flight work goes to production alongside the module.
2. `sections.ts` and `AppShell.tsx` are both already modified *and* both on this plan's touch list.
   Land or stash that work first, or expect a conflict in exactly the two files that decide whether
   the button renders at all.

### 10.2 Sequence

1. **Migrate first, separately:** `npm run db:deploy`. The compose `migrate` service is a separate
   build and silently does not run; the new VPS has no migrate gate at all. The migration is
   additive, so it can safely land ahead of the image.
2. Never run a migration with a shell-set `DATABASE_URL`: **`.env` wins, and `.env` is live
   Supabase.** Move it aside for a local migration. Use the pooler URL with the `%40`-encoded
   password.
3. Build locally and ship the image — never build on the box (1 vCPU, no swap). Cap the node heap
   via `NODE_OPTIONS`, or BuildKit dies at typecheck with "rpc error … EOF".
4. `scp` fails with "File too large" on Git Bash — use `ssh 'cat >'`.
5. The branch is `master`. Check `git symbolic-ref HEAD` before pushing: work on a branch once
   reported "up-to-date" while nothing shipped.
6. Verify on live: the section appears for ADMIN; the button appears for a STUDENT login; a report
   submits; the bell item appears; one email arrives.

### 10.3 Gates before shipping

`tsc --noEmit` clean · `next lint` clean (it is clean today — keep it so, and watch for the dead
`tsconfig` include paths the build re-appends) · the full suite green (2,011 today) · **every export
in a `"use server"` module is `async`** — `tsc` misses this and only `next build` catches it, at the
very end of a long build.

---

## 11. Suggestions from the two-week review

Everything here is additive or observational. None of it changes an existing rule, total or state
machine, per the brief.

### 11.1 Make the module answer "is it armed?" before a human does — highest value

Already in the plan at §5.3, called out separately because it is the single highest-leverage line in
it. Live has engines sitting at their OFF default, so week one's reports will be dominated by *"this
section does nothing"*. A context block reading **"the confirm-or-cancel engine behind this screen
is OFF (`autoCancelEnabled` = false)"** converts a support conversation into a one-line answer —
automatically, and for ever.

### 11.2 Three source-scan tests that would have caught the last fortnight's bugs

This repo's best regression guards are source scans, not unit tests: `paid-so-far-excludes-archived`
("no call site sums archived income"), `cron-stale-thresholds`, `empty-states`, `engines`. Three
more of the same kind, each closing a class that actually bit:

| Proposed test | Closes | Precedent |
|---|---|---|
| **Every page exports a `metadata.title`**, with the five deliberate exceptions listed | W5 fixed 23 of 28 missing titles by hand and nothing pins it; the 29th arrives with the next screen | `empty-states.test.ts` |
| **No `<select>` placeholder `value=""` whose server guard tests `=== null`** | W2 exactly: two spellings of "unanswered", `tsc` happy because of a lying cast, the income form dead after one save | `income-form.test.ts`, generalised |
| **No public-bucket write from a session-gated route** (and no `publicUrl()` on the improvement bucket) | The PII-in-a-public-bucket gap that §5.5 catches for this module — the same mistake is available to the next feature | `paid-so-far-excludes-archived` |

Tests only. No behaviour changes.

### 11.3 A dirty-tree gate in the deploy preflight

`scripts/deploy-preflight.ps1` already exists. Given that `docker build` ships the working tree, it
should refuse — or at minimum warn loudly and print the file list — when `git status --porcelain` is
non-empty. Today's ~30 modified files are one careless build away from production. Three lines, no
logic touched.

### 11.4 Measure the picker, not just the queue

Once P1 is live, *reports re-kinded during triage ÷ reports* measures whether §3.1's taxonomy
matches how people actually think. If `CONFUSING` reports keep being re-kinded to `NOT_WORKING`, the
hint text is wrong, not the reporter. Same for *reports per section*: it is the only evidence-based
answer to "where should the next week of work go", and this app has never had it.

### 11.5 Close the loop in public

When a report reaches `FIXED`, the reporter is told (§6.4). One cheap step further: a "Recently
fixed" list in the existing App Guide, which is already a section with a tested structure. People
report when they can see reports being acted on — and the 24–26 Oct work is a long list of fixes
nobody using the app ever saw.

### 11.6 What I would not do

| Tempting | Why not |
|---|---|
| Auto-create a report from every client error | That pipeline already exists and goes to Sentry. A table filling itself with 200 render errors from one loop is how a triage queue becomes unreadable. Link them via `clientDigest`; do not merge them. |
| Let the reporter set priority or assignee | Severity is the reporter's honest input; the order of work is the dev's. Handing out priority is how every `MINOR` becomes `BLOCKING`. |
| A public-facing reporter on `/book` or `/agreement` | §2. An unauthenticated write with a file upload, on the app whose last fortnight was spent closing exactly that shape. |
| Ship it behind an off-by-default switch | §7.5. That convention protects outbound sends; applying it here reproduces the disarmed-engine problem the module exists to surface. |

---

## 12. Decisions needed before P1 starts

| # | Question | Recommendation |
|---|---|---|
| 1 | Who may triage — ADMIN only, or ADMIN plus a developer account holding `improvements.triage`? | A real user account for the developer, holding `improvements.triage` and nothing else. No new credential surface, and the activity log attributes their actions. |
| 2 | Screenshot capture: paste/attach only, or add `getDisplayMedia` too? | Paste/attach in P2. Add `getDisplayMedia` later only if people ask for it. |
| 3 | Which developer address receives the notification? | One config-backed address, editable in Console. Needs confirming. |
| 4 | Can STUDENT / TUTOR / COACH report? | Yes — same button, same form. They are the users most likely to hit a dead end and the least likely to have another channel. Their reports carry no finance context, because context is role-filtered. |
| 5 | Is `/improvements` on the sidebar for ADMIN, or off-rail? | On the rail, in `Admin`. It is a queue someone must visit; off-rail is for sections reached from the screens that surface them. |
