# What was built — in-app improvement reporting, P1 (28 October 2026)

Implementation record for [`IMPROVEMENTS_MODULE_PLAN.md`](./IMPROVEMENTS_MODULE_PLAN.md).
The plan's ordering is kept, and where the build departed from it that is recorded here rather
than quietly left for somebody to discover.

**Verification:** `tsc --noEmit` clean · `next lint` clean · **2,072/2,073 tests pass** (the one
skip is the pre-existing ledger integration suite, which needs `LEDGER_TEST_DATABASE_URL`) ·
`next build` clean, run out-of-band into a throwaway dist dir so the dev server's `.next` was
never touched · the engine-map drift guard verified to fail when the map is sabotaged.

**Run locally on 29 October** against the project-local Postgres on :5435, in a browser, as
both an ADMIN and a STUDENT. That run applied the migration for the first time and found two
blocking bugs, both fixed - see §3.6 and §3.7. It has still never run against live. §6 is the
remaining honest list and §9 records what the local run did and did not prove.

---

## 1. What a person can now do

Press **Report** in the top bar, on any screen, as any of the six roles. Pick what kind of problem
it is; answer the two to four questions that kind asks; optionally point at the exact thing that is
wrong; send. The report lands at `/improvements` carrying the screen, the reporter's role and grants, the
running build, and - the part that earns the module - **whether the engine behind that screen was
switched off at the time.**

An admin works the queue at `/improvements`: filter, read, re-file under a different kind, move through
`NEW → TRIAGED → ACCEPTED → IN_PROGRESS → FIXED → CLOSED` (plus `DECLINED` / `DUPLICATE`), write
internal notes, write a reply the reporter may read, archive. The bell carries two counts for
admins; a blocking report emails the developer; everything else rides the existing daily tick as a
digest.

---

## 2. Built, as planned

| Plan § | Delivered |
|---|---|
| §3.1-3.2 | Seven kinds, each with its own 2-4 questions, in `lib/improvement.ts` - read by both the form and the server, so they cannot drift |
| §3.3 | The status machine as a pure transition table. The triage UI renders its buttons from it and the server refuses anything else |
| §4.1 | `Improvement` + `ImprovementEvent`. **`ImprovementAttachment` was not created** - it belongs with screenshots, which are P2 |
| §4.2 | Hand-written migration: four `CREATE TYPE`, two `CREATE TABLE`, six FKs, six indexes. Purely additive |
| §4.3 | `IMP-0001`, drawn from the shared `document_sequence` counter inside the report's own transaction |
| §4.5 | 10th soft-deleted model; `lib/soft-delete.ts`'s header updated; a guard test asserts every read in the actions module filters archives |
| §5.1 | Route stored as a **pattern** (`/students/[id]`), ids carried separately |
| §5.2 | The element tag - **pulled forward from P2**, see §3 below |
| §5.3 | `server/improvement-context.ts`: arming verdict, delivery verdict, role, capabilities held, build, recent server errors, IST time. All through `scrubContext` |
| §6.1 | One mount in `AppShell`, every role |
| §6.3 | `/improvements`: four counts, filters, queue, detail, triage, and a "where the reports come from" tally |
| §6.5 | Guide entry (mandatory - the structure test fails without one) |
| §7.1-7.3 | Bell items, blocking email, daily digest on the existing cron, Console panel for the address |
| §7.5 | Ships ON. Only the email is gated, and a blank address degrades to in-app only |

---

## 3. Where this departed from the plan

### 3.1 The element tag was pulled forward from P2 into P1

The plan put "point at the problem" in P2 beside screenshots. It is in P1.

Reason: it is one capture-phase listener and no dependency, the brief that started this asked for
screen tagging specifically, and the column was already in the migration. Screenshots were the
expensive half of that phase (a private bucket, an upload route, an authenticated read route), and
they are still P2.

### 3.2 No command-palette entry

The plan offered one as the keyboard route. The palette is a **navigator** - every item in it is an
href - so adding an action would mean changing its item model for one entry. The button is in the
tab order on every screen; that was judged enough. The claim was removed from the code comment
rather than left as a lie.

### 3.3 The bell is keyed on role, not on `improvements.triage`

`computeNotifications` is memoised per `role:userId` and called from three places. Threading
capabilities through it for a badge was a poor trade, so the bell items are `ADMIN`-only. Somebody
holding `improvements.triage` without the admin role still gets the queue itself and the email; the badge
is the one surface they miss. Recorded in the code at the call site.

### 3.4 The element picker swallows the whole pointer sequence

Worth writing down because the first version was wrong in a way that would have been reported as a
bug by the first person to use it. `preventDefault()` on `pointerdown` stops focus and text
selection and nothing else - the browser still dispatches mousedown, mouseup and `click`. So
pointing at a link would have recorded the tag and then **navigated away from the screen being
reported on**, and pointing at a Delete button would have pressed it.

Every event in the sequence is now stopped in the capture phase, and tagging ends on `click` - the
last of them - so the listeners are still attached when it arrives. Caught by reading the code, not
by a test: there is no DOM in this suite, which is the same limitation `empty-states.test.ts`
records about itself.

### 3.5 No reporter-facing surface yet

P1 tells the reporter their reference in a toast and nothing more. `ImprovementEvent.visibleToReporter`
exists and is written correctly from day one, so the loop in §6.4 of the plan is a screen away -
but today a reporter cannot see what happened to their report. **This is the single most important
thing still missing**, for the reason the plan gives: a channel where nobody hears back goes quiet
in two weeks.

### 3.6 The question fields crashed the modal on the first keystroke

Found by typing into the form, which nothing before had done. The three question inputs read the
event inside the state updater:

```js
onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.currentTarget.value }))}
```

React nulls `currentTarget` as soon as the handler returns, but the updater runs later, at render.
So the first character typed into any question threw `Cannot read properties of null (reading
'value')` and React tore down the whole modal - **no report of any kind could be filed.**

The value is now read before the closure is handed to `setState`. Worth knowing that the eight
pre-existing call sites with this shape all use `e.target`, which React does *not* null, so the
house idiom was right and only this module was wrong.

### 3.7 The detail panel could not render at all

`ImprovementTriage` declared a data prop named `ref`. `ref` is reserved by React, so passing it from
`ImprovementDetail` (a server component) threw *"Refs cannot be used in Server Components, nor passed to
Client Components"* and **the entire detail panel failed** - the queue listed reports that could
not be opened. Renamed to `improvementRef`.

`tsc` is blind to both of these: the first is valid TypeScript, and `ref` is a legal prop name to
the type system. Only running it finds them. That is the argument for §9.

---

## 4. Files

### New (16)

```
prisma/migrations/20261028090000_improvements/migration.sql
src/lib/improvement.ts                                    the whole contract: kinds, questions, status machine
src/server/improvement-ref.ts                             IMP-0001, row-locked
src/server/improvement-context.ts                         what the app knew at the time
src/server/improvement-actions.ts                         submit + triage
src/server/improvements.ts                                reads
src/server/improvement-notify.ts                          developer email + digest body
src/server/improvement-digest.ts                          the once-a-day summary
src/components/shell/SuggestImprovementButton.tsx
src/components/shell/SuggestImprovementModal.tsx
src/app/(app)/improvements/page.tsx  + loading.tsx
src/app/(app)/improvements/_components/{ImprovementFilters,ImprovementTable,ImprovementDetail,ImprovementTriage,tone}.tsx
src/app/(app)/console/_components/ImprovementsPanel.tsx
src/lib/__tests__/improvement.test.ts                     35 tests
src/server/__tests__/improvement-context-engines.test.ts  the drift guard
src/server/__tests__/improvement-actions-guards.test.ts   the fences
```

### Existing, additive only (13)

`prisma/schema.prisma` · `lib/sections.ts` · `lib/capabilities.ts` · `lib/guide-content.ts` ·
`lib/config-schema.ts` · `lib/soft-delete.ts` (comment) · `components/shell/AppShell.tsx` ·
`server/founder-config.ts` · `server/maintenance-actions.ts` · `server/notifications.ts` ·
`server/daily-maintenance.ts` · `app/(app)/console/page.tsx` ·
`lib/__tests__/empty-states.test.ts` (the two new empty states, registered as the test's own
contract requires).

**No existing query, rule, total or state machine was modified.** `app/(app)/error.tsx` was left
alone - the plan has the crash-screen Report button in P2.

`docs/DEV_MAP.md` and `docs/APP_MAP.md` were **not** updated, although the plan's touch list names
them. `DEV_MAP.md` is one of the ~30 files already modified in the working tree by unrelated
in-flight work, and adding a line to a file somebody may have open in an editor is how an edit gets
lost. Both maps still need an entry for this module and the `/improvements` screen - a two-line job once
that work has landed.

---

## 5. Tests added (53)

| File | What it pins |
|---|---|
| `lib/__tests__/improvement.test.ts` (35) | Every kind has 2-4 questions and at least one required; the SERVER refuses a missing required answer; **keys a kind does not ask about are dropped**, so a crafted POST cannot write arbitrary keys into a rendered JSON column; a choice refuses a value not in its options; the route is stored as a pattern and **a long opaque token never survives into it**; every status is reachable from `NEW`; nothing reaches `CLOSED` except via `FIXED`; every terminal state can be re-opened; the reporter-facing words are never the internal ones |
| `server/__tests__/improvement` trust boundary (in the above) | **The client cannot supply `reporterRole`, `reporterId`, `context`, `ref`, `status` or `appVersion`.** If any is ever added to the submit schema this fails on sight - that is the whole fence |
| `server/__tests__/improvement-context-engines.test.ts` (6) | `SECTION_ENGINES` covers every engine the eight feature pages name, names no screen that asks about nothing, and uses only real engine keys; the context is returned through `scrubContext` and this module defines no redaction of its own. **Verified to fail when the map is sabotaged** |
| `server/__tests__/improvement-actions-guards.test.ts` (12) | Every export is `async` (the trap `tsc` misses); **filing establishes a caller but is not capability-gated**, and is rate limited; **every other action is behind `improvements.triage`**; every report read filters archives; nothing deletes a report; the ref is drawn inside the transaction with an `ON CONFLICT` upsert, never `max()+1`; **no new cron route was added** and the digest runs inside the daily job's `safe()` wrapper with its cursor advanced only on a real send |

---

## 6. Not verified

Stated plainly, because the plan's own §10 is about traps that come from assuming otherwise.

| | |
|---|---|
| **The migration has not been applied to live** | It applied cleanly to the local database on 29 Oct, which is the first time it had run anywhere. Live is still untouched |
| **No email has ever been sent** | `notifyDeveloper` and `sendImprovementDigest` have still never run. The local run had `EMAIL_ENABLED=false` and no developer address, so both took their deliberate non-send path and wrote `notifiedAt: null` - which is the configuration being exercised, not the sending one |
| **The digest has never fired** | `runImprovementDigest` rides the daily tick and that tick did not run during the local session. The once-per-IST-day guard and the cursor are proved only by the source-scan test |
| **Nothing is checked at phone width** | The local run was at 1119px. The detail panel's two-column layout and the element picker are the parts most likely to be wrong on a narrow screen |
| **`appVersion` is empty** | It reads `SENTRY_RELEASE` / `GIT_SHA` / `NEXT_PUBLIC_BUILD_SHA`, and no compose file sets any of them (`SENTRY_RELEASE` is passed through but defaults to blank). So "Build: unknown" will show in production too, unless it is set at deploy time. Not a code fault - a deploy-time variable that nobody has had a reason to set before now |

---

## 7. Before this ships

In this order. Items 1 and 2 are not optional.

1. **The working tree.** When this was written the repo had ~30 unrelated modified files, two of
   which - `lib/sections.ts` and `components/shell/AppShell.tsx` - are also touched here. `docker
   build` ships the working tree, not the commit, so build from `git archive HEAD` or that
   in-flight work ships too.
2. **Migrate first, separately:** `npm run db:deploy`. The compose `migrate` service is a separate
   build and silently does not run. The migration is additive, so it may land ahead of the image.
   Never run it with a shell-set `DATABASE_URL` - `.env` wins and `.env` is live Supabase.
3. Nothing to clean up: the verification build went to a throwaway directory, which was deleted
   afterwards. `.gitignore` already covers that convention as `.next-verify*` - use that name, not
   a new one, and never let a verify build write to `.next`, which the dev server owns.
4. Set the developer's address in **Console → System → Improvements**. Until then the queue and
   the bell work and nobody is emailed, which is a working configuration.
5. Walk it once on live: the section appears for ADMIN, the button appears for a STUDENT login, a
   report submits and gets a `IMP-` reference, the bell count appears, one email arrives.

---

## 8. What P2 and P3 are, now that P1 exists

Unchanged from the plan, minus the element tag which is done:

- **P2** - screenshots (private bucket + upload route + authenticated read; the plan's §5.5 note
  about `publicUrl` being wrong for this is the thing to read first), the client breadcrumb ring,
  and the Report button on `app/(app)/error.tsx`.
- **P3** - the reporter-facing loop: their own reports, the `FIXED` notification with a "still
  happening?" action, and the Markdown export. See §3.5 above for why this is the most valuable
  piece left.

---

## 9. The local run, 29 October 2026

Run on the project-local Postgres (:5435) via `scripts/local-demo-serve.ps1` on port 3011, with
every outbound channel forced off. The migration `20261028090000_improvements` was applied there
first - with `.env` physically moved aside, because `prisma migrate deploy` loads it and it points
at live Supabase.

**Proved, by doing it:**

| | |
|---|---|
| The migration | Applied clean. Two tables, four enums, 33 columns on `improvement` |
| Filing, as an ADMIN | `IMP-0001` on `/cash`, then `IMP-0003` on `/payments` |
| **Filing, as a STUDENT** | `IMP-0002` on `/dashboard`. The Report button is in a student's top bar and the report filed - the asymmetry in §1 is real, not just intended |
| **The queue is closed to them** | A student hitting `/improvements` directly is redirected to their own dashboard. Nothing leaked |
| `reporterRole` | Stored as `STUDENT` / `ADMIN` from the session, never the payload |
| The reference counter | `IMP-0001` → `0002` → `0003`, drawn inside each report's transaction |
| Per-kind questions | `WRONG_RESULT` asked three; `NOT_WORKING` asked four including a dropdown. `answers` held only the keys that kind asks about |
| The title suggestion | "Wrong result: Runway: 3.1 months" and "Broken: I opened My Journey from the dashboard", both overridable |
| **The element picker** | Armed, then clicked a sidebar **link**. The page did **not** navigate, and the tag recorded `"Payments" under Cash Health` with its selector and box. §3.4's fix holds in a real browser |
| **The arming verdict** | `IMP-0003` was filed on `/payments` saying "this whole section does nothing". It arrived carrying `dunning - Payment chasing - Console → System → Alerts & Chasing - "Overdue instalments are never chased. The receivable ages silently."` The console reports ten engines not armed, so this is the common case, and the report answered itself before anyone read it. **This is the module's whole claim, and it is now demonstrated rather than asserted.** |
| The status machine | `NEW → TRIAGED` moved, `firstTriagedAt` stamped, and an `ImprovementEvent` written `STATUS NEW→TRIAGED` with `visibleToReporter: false` |
| The queue screen | Four counts correct (waiting 2, open 3, blocking 1, engine-off 1), five filters, an "engine off" chip on the row |
| The bell | "1 report blocking somebody's work" and "2 improvement reports waiting to be read" |
| The Console panel | Renders, and says of its own accord that email is not armed and the queue works regardless |

**Cost of the run:** two real bugs, each of which made a whole surface unusable, and neither
reachable by `tsc`, by lint, or by a suite with no DOM. Both are in §3.6 and §3.7. After the fixes:
`tsc --noEmit` clean, **2,072/2,073 tests pass** (unchanged).

The three sample reports are left in the local database on purpose, so the queue has something in
it to look at.

---

## 10. Renamed to "Improvements", 29 October 2026

The feature shipped as "Issue Reports". It was renamed because the point of it is not to collect
complaints: five of the seven kinds are about something being wrong, but the other two are
"this section needs something new" and "the rule should work differently", and the whole queue is a
list of things that would make the app better.

**Why the full rename rather than a copy change.** The migration had been applied to the local
database and *nowhere else*. So the original migration could be edited in place and the local
module rebuilt from it - no rename migration exists, and no legacy name survives anywhere. The same
rename after it reached live would have cost a permanent second migration plus a codebase whose
identifiers disagreed with its screens. It was free exactly once, and this was the moment.

**Why not "Feedback".** It is the natural positive word and it was rejected: `components/ui/feedback.tsx`
is the toast and confirm host, imported by 124 files. A `lib/feedback.ts` beside it is a trap. The
plan's §0.1 already recorded that collision before any of this was built.

### What changed

| | |
|---|---|
| Route / section key | `/issues` → `/improvements`. The old route is a real 404 |
| Nav label | "Issue Reports" → **Improvements** |
| Capability | `issues.triage` → `improvements.triage` |
| Prisma models | `IssueReport` → `Improvement`, `IssueEvent` → `ImprovementEvent` |
| Tables | `issue_report` → `improvement`, `issue_event` → `improvement_event`, all 8 indexes renamed with them |
| Enums | `IssueKind` / `IssueSeverity` / `IssueStatus` / `IssueEventKind` → `Improvement*` |
| Human reference | `ISS-0001` → `IMP-0001`, and the `document_sequence` key `ISS` → `IMP` |
| Config | AppSetting key `issueReports` → `improvements` |
| Query parameter | `?issue=` → `?improvement=` |
| Files | 16 renamed, 34 rewritten, 2 docs renamed |
| Totals | 712 identifier replacements plus a deliberate copy pass |

### The copy, deliberately

The **frame** is positive and the **kinds stay blunt**. The button is "Suggest an improvement to
this screen" and the first question is "What would make this better?", but the first option is
still "Something is broken" and the severity still reads "I can't do my job". A positive frame that
softened a blocked person into filing a polite suggestion would have cost exactly the reports worth
having - which is the same argument §1 makes for leaving filing ungated.

### How it was done safely

A blind find-and-replace would have broken three unrelated things, all of which live in the same
files:

- **`ZodError.issues`** - zod's own API, read in five places in this module. `error.issues` *was*
  rewritten to `error.improvements` by the prose pass and `tsc` caught it; it is the one thing in
  this rename that a human would not have spotted by reading.
- **`addIssue` / `ZodIssueCode`** - also zod, 27 uses. Untouched, because word-boundary matching
  cannot reach inside a token.
- **The invoicing and agreement verb** - "void the agreement and issue a fresh one", "an issued
  invoice", `issuedAt`, `issueDate`, `invoiceIssuerSchema`. Untouched, because bare prose was only
  rewritten in the 20 files the module owns, never in shared ones.

One behavioural regression was introduced and caught by the suite: the queue's card subtitle was
reworded to "Nothing matches these filters", which shadowed the registered `EmptyState` title
"Nothing matches" - `empty-states.test.ts` locates a title by first occurrence, so it found the
subtitle and failed. The subtitle is now "No improvements match these filters".

### Verified after the rename

`prisma validate` valid · `prisma generate` ok · `tsc --noEmit` clean · `next lint` clean ·
**2,072/2,073 tests pass** · `next build` clean, 68/68 static pages, `/improvements` at 6.28 kB ·
migration re-applied to the local database from the edited file, with the demo data left intact ·
in a browser: `/issues` 404s, `/improvements` renders, `IMP-0001` filed by an admin on `/payments`
still carries the `dunning` arming verdict, `IMP-0002` filed by a **student** as a `NEW_FEATURE`,
`NEW → TRIAGED` writes an `improvement_event`, and the Console panel reads correctly.

---

## 11. The developer seat, 29 October 2026

`scripts/developer-seat.ts` (`npm run seat:dev`) creates one login that can read and work this
queue and nothing else. It is the answer to "where will the developers see this" that does not
require handing anybody the founder's account.

```
role           USER                                       the lowest staff role
sectionAccess  { improvements: true, my-desk: true, guide: true, …everything else false }
capabilities   { "improvements.triage": true, …everything else false }
```

**Why it works without ADMIN.** §1 made `improvements` the one Admin-group section that is not
`locked`, and `sectionAllowed` consults the per-person override *before* the role list. So the
section can be handed to one individual without widening it to the whole USER role. The seat is
not a new mechanism - it is the mechanism that entry was shaped for, used for the first time.

**Why the row is written with every key spelled out.** `parseSectionAccess` and
`parseCapabilities` in `server/users-actions.ts` store an explicit `true`/`false` for every
catalogue key, and the script does the same. A *missing* key falls back to the role default,
which for a USER would quietly hand over Pipeline, Contacts, Students, Agreements and Reports.
Writing the same shape the screen writes also means the seat is editable from
People → Users & access afterwards with no surprises.

**Why `my-desk` is on.** It is this account's home: `app/(app)/page.tsx` redirects every USER to
`/my-desk`, so revoking it makes the first screen after sign-in a refusal and a denial toast. The
desk resolves from `TeamProfile.logVariant` and this account has no TeamProfile, so it renders
`NoProfile` - an explanation and no business data. Giving this account a TeamProfile would turn it
into a real telecaller desk, so don't.

### What the seat cannot reach, deliberately

| | |
|---|---|
| Console → System health | `console` is `locked`: always on, always ADMIN, grantable to nobody. Widening it is a far bigger decision than creating a login |
| The bell counts | `computeNotifications` keys the improvement items on the ADMIN **role**, not the capability - departure §3.3. The queue and the emails are unaffected |
| Everything else | 40-odd sections stored as an explicit `false` |

So this seat reads server errors through the **Recent server errors** panel attached to a filed
improvement, never through the live console.

### Verified on the local database

Signed in as the seat: the rail is exactly My Desk / App Guide / Improvements / My Profile; both
`IMP-0001` and `IMP-0002` are listed with the `dunning` arming verdict intact; the full triage
panel renders (status transitions, re-file, reporter note, working notes, archive);
`/console`, `/finance`, `/students`, `/activity` and `/pipeline` each bounce to
`/?denied=<key>` and on to `/my-desk` with the toast; the bell reads 0, as predicted above.

The datasource is read from the environment and printed, and a non-local host is refused unless
`--remote` is passed - checked by running it with `.env` inherited, which correctly refused
`aws-0-ap-southeast-1.pooler.supabase.com` without opening a connection.

---

## 12. Voice notes, 29 October 2026

> **Superseded the same day by section 13.** Voice notes became one of *two* recording kinds. The
> table is now `improvement_recording`, the library is `src/lib/recording.ts` and the route is
> `/api/improvements/[id]/recording`. The reasoning below still holds; the names have moved.

A reporter can attach one spoken clip to a report. It is optional, capped at **two minutes and
2 MB**, and **nothing is transcribed** - triage listens to it.

### What was deliberately not built

Dictation was the first design and was dropped on the user's instruction, which turned out to be
the right call for two independent reasons:

- Chrome's `SpeechRecognition` **streams the audio to Google** to transcribe it. That is a
  third-party processor for a recording that may name a student and their money, on an app with a
  German entity behind it.
- Running `SpeechRecognition` and `MediaRecorder` off one microphone at the same time is flaky
  across browsers, so "dictate *and* keep the clip" would have had a failure mode that only
  appears on somebody else's machine.

The cost is real and is stated in `src/lib/voice-note.ts`: a clip cannot be searched, titled,
emailed or put in the digest, and cannot be skimmed. That is why it is optional, short, and never
required for a report to be filed.

### The three decisions worth keeping

**1. The bytes are in Postgres, not in a bucket.** `improvement_voice_note.bytes` is a `bytea`,
served by an authenticated route - the pattern `AgreementAttachment` already set. The P1 notes
assumed attachments were blocked on provisioning a private bucket. They were not:
`lib/supabase-storage.ts` is public-read **by design** (it is the marketing site's media origin)
and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not configured in any env file here, so
`storageConfig()` returns null and both existing upload routes answer 503. The bucket was never
the way in. **The same reasoning unblocks P2 screenshots.**

**2. Its own table, not four columns on `improvement`.** Prisma selects every scalar when a query
names no `select`, so a `Bytes` column on `improvement` would be dragged across the wire by any
future `findMany` written without one - the queue, a count, the digest - and whoever wrote that
query would never know. A separate table cannot be loaded by accident. Both reading call sites
select `voiceNote: { select: { seconds: true } }` and never the bytes.

**3. The clip does not travel in the server action.** Next 14 caps an action body at 1 MB and
nothing raises it, so a two-minute clip can beat it. `submitImprovement` now also returns the new
`id`, and the form posts the audio to `POST /api/improvements/[id]/voice` afterwards. **If that
upload fails the report is already filed**, and the toast says so rather than reading as a failed
send. Do not "simplify" this back into the action: it works for short clips in testing and fails
for real ones in the field.

### The security header that had to change

`next.config.mjs` denied the microphone to every origin including this one
(`Permissions-Policy: camera=(), microphone=(), geolocation=()`, commented "no powerful browser
APIs"). `baseline()` now takes `{ mic }` and **only the signed-in catch-all rule passes it**:

| route group | microphone |
| --- | --- |
| the app (catch-all, `frame-ancestors 'none'`) | `(self)` |
| `/f/*`, `/p/*` - embeddable on third-party sites | `()` |
| `/i/*`, `/agreement/*` - token-addressed, customer-facing | `()` |
| `/.../pdf` | `()` |

Granting it to the app is safe precisely because that rule also sets `X-Frame-Options: DENY` and
`frame-ancestors 'none'`: no third-party document can inherit the grant. `camera` and
`geolocation` stay denied everywhere.

### Traps found while building it

- **A `MediaRecorder` WebM blob carries no duration.** `audio.duration` reads `Infinity` until the
  stream is seeked to the end, so the length is measured from the clock (`Date.now()` at start)
  and stored. It is why the player's label carries the length rather than relying on the control -
  visible in the browser run, where the control read `0:00 / 0:00` and the label read `0:03`.
- **Stopping the recorder does not release the microphone.** The `MediaStreamTrack`s do. Without
  `getTracks().forEach(t => t.stop())` on every exit path - including unmount - the browser's
  recording indicator stays lit on the tab for the rest of the session, and a person would be
  right to conclude the app is listening. `releaseMic()` is called from `onstop` and from the
  unmount cleanup.
- **The disclosure panel would have started lying.** "What gets sent with this?" ended with *"Not
  attached: anything you have not typed or pointed at"*, which a recording makes false. It now
  reads "typed, pointed at or recorded" and lists the clip and its length. The whole value of that
  panel is that it is accurate.
- **The "blocking" email races the upload.** The notification fires in `afterResponse`, before the
  clip has been posted. So `submitImprovementSchema` carries a `voiceSeconds` the form *declares*;
  it buys one line of email copy pointing at the report and nothing else is derived from it. The
  authoritative length is the `seconds` column.

### ⚠ The bug the first browser run missed: the clip uploads, and the page never looks again

Found by the founder recording a note and not seeing it. **The audio was stored correctly the
whole time** - `IMP-0005`, 14s, 214 KB, in the database. It simply did not appear.

`submitImprovement` calls `revalidatePath("/improvements")` as it writes the row, which is
*necessarily* before the clip exists: the upload needs the `id` that action returns. So the queue
and the detail page were both re-rendered at a moment when the report genuinely had no audio, and
nothing ever asked again. The person who filed it watched their own recording not appear.

**My first verification hid this**, because every check navigated with `page.goto(...)` - a fresh
request that re-rendered anyway. The flow a human actually performs (file from the queue, modal
closes, look at the row) was never exercised. **A verification that navigates is not a
verification of a mutation.**

Fixed in both places, because they cover different viewers:
- `revalidatePath("/improvements")` in the **upload route**, after the row is written - for
  everyone else looking at the queue.
- `router.refresh()` in the **modal**, after a successful upload - for the person standing on the
  page right now, who otherwise waits on a cache window.

Re-verified without any reload: filed from `/improvements`, the new row appeared with its `0:03`
chip and the detail panel showed the player, on the same page instance.

### Verified in a browser, 29 October 2026

Against the local stack, signed in as the developer seat, with `getUserMedia` replaced by a
synthetic `AudioContext` oscillator stream - no microphone, no fake-device flag, and the **real**
`MediaRecorder` producing a real 52 KB WebM/Opus blob:

- recorded, counter read `Recording 0:03 of 2:00`, preview player appeared, panel read
  `Attached - 0:03`
- filed as `IMP-0003`; `POST .../voice?seconds=3` → **200**
- queue row shows a mic chip reading `0:03`; detail shows `VOICE NOTE · 0:03` and the player
- `GET .../voice` → 200, `audio/webm`, 52,460 bytes, magic `1a 45 df a3`,
  `private, no-store`, `nosniff`, `inline; filename="IMP-0003-voice.webm"`
- headers: app routes `microphone=(self)`; `/f/`, `/p/`, `/i/` all still `microphone=()`

Guards, all exercised against the live route:

| attempt | result |
| --- | --- |
| replace an existing clip | `409 This report already has a voice note` |
| attach to someone else's report | `404 Report not found` |
| HTML labelled `Content-Type: audio/webm` | `415` - the sniff refuses it |
| 2,000,001 bytes | `413` |
| empty body | `400` |
| `GET` on a report with no clip | `404` |
| a valid clip sent as `application/octet-stream` | `200` - the **bytes** decide, not the header |

2,081 tests pass (8 new, in `src/lib/__tests__/voice-note.test.ts`), `tsc --noEmit` clean,
`next lint --max-warnings=0` clean.

### Still open

- **Retention.** A clip is personal data and nothing expires it. `Improvement` is soft-deleted, so
  archiving a report deliberately *keeps* its audio, and `onDelete: Cascade` only fires on a hard
  delete that nothing performs. If a retention rule is wanted, `/api/cron/retention` is where it
  belongs - as a decision, not a default invented here.
- **Not tested on a phone**, which is where most spoken reports will come from. Safari records MP4
  and the sniff handles it, but no iOS device has run this.
- The reporter cannot attach a clip *after* filing; there is no UI for it and the route refuses a
  second one by design.

---

## 13. Screen recordings, free roam and escalation, 29 October 2026

Three asks, in one pass, all at the founder's direction.

### 13.1 Record the screen, not just the voice

> *"while doing a function, we'll get an error. That error must be captured with the screen. What
> they were doing and not just the section that they found the issue."*

A reporter can now record **this browser tab with their voice over it** - the clicks, the
navigation, the error appearing. `AUDIO` stays, because `getDisplayMedia` **does not exist on iOS
at all** and most students file from a phone.

Caps are per-kind: AUDIO 2 min / 2 MB, SCREEN 3 min / 25 MB at 800 kbit/s video and 12 fps. A UI
is mostly static pixels, so a low frame rate costs nothing in legibility - a measured 24-second
capture came out at **672 KB**, so three minutes lands near 5 MB and the 25 MB cap is headroom.

**The capture is pinned to the current tab** (`preferCurrentTab`, `monitorTypeSurfaces: "exclude"`,
`surfaceSwitching: "exclude"`). These files land in a table every triager can play back, and
somebody concentrating on reproducing a bug is not also auditing what else is on their screen. A
test asserts those three flags, so removing one has to be deliberate.

`Permissions-Policy` gained `display-capture=(self)` alongside `microphone=(self)`, **on the
signed-in catch-all rule only**. `/f/`, `/p/`, `/i/`, `/agreement/` and `/.../pdf` keep both
denied - the first two are designed to be iframed on third-party sites.

### 13.2 Free roam: the form gets out of the way

> *"they should be able to freely move around the screen instead of being blocked by the pop-up"*

While recording, the form **hides without unmounting** and a floating bar takes its place. The app
underneath stays fully interactive - no overlay, nothing swallowing clicks. The same
hide-don't-unmount trick "point at it" already used, for the same reason: unmounting loses every
typed answer.

It works **across navigation** because `AppShell` lives in `src/app/(app)/layout.tsx`, a Next
layout, which React preserves between routes. Verified by recording across `/improvements` ->
`/my-desk` -> `/guide` and returning to a form still holding its state.

**The route is pinned when the form opens**, not read at Send. Roaming is now expected and
`usePathname` follows them, so a report filed after walking to `/guide` would otherwise be filed
against `/guide`. The auto-title proved it: *"Broken: screen recording on Improvements"*.

### 13.3 A recording makes the questions optional

> *"while we record audio it should be optional for filling out the other fields"*

With a recording attached, every required question becomes optional: Send enables, the stars come
off the labels, and the subtitle changes to *"Your recording says it - everything below is
optional now."* Somebody who has just talked through the problem has already answered "what were
you doing" better than the boxes would have.

Two consequences handled:

- **The title.** `suggestTitle` takes a fallback, so a wordless report becomes *"Broken: screen
  recording on Improvements"* rather than twenty queue rows all titled "Broken".
- **The server.** `answersSchema(kind, { recorded })` relaxes the same rule the form relaxes - one
  definition, as this module insists. `recorded` is the form's *declared* intent, because the
  media uploads on a later request. A crafted POST could claim a recording and send nothing; that
  buys an empty report in a queue the caller may already file in, which is no worse than typing
  "x" in each box. Written down rather than defended with a round trip.

### 13.4 Escalation

> *"The head coach and then the admin should be able to escalate a problem."*

**One flag, chosen over a ladder.** `Improvement.urgent` sorts a report to the top of the queue
and shows an Urgent chip. A full escalation ladder (levels, reasons, notify-the-next-person-up)
was offered and the simple flag was chosen.

It deliberately **does not touch `severity`**. Severity is the reporter's own answer to "how much
is this holding you up" and is the only honest signal of impact this module collects; a manager
overwriting it would destroy that answer permanently. Who escalated and when goes to
`logActivity` - no second audit trail.

**Three tiers now, not two**, and the middle one is the easy one to lose:

| tier | who | what |
| --- | --- | --- |
| file | any session | ungated |
| `improvements.escalate` | ADMIN + HEAD | one flag, one ordering |
| `improvements.triage` | ADMIN | status machine, re-kind, dev notes, archive |

`improvement-actions-guards.test.ts` pins all three and **was proven to fail when sabotaged**:
pointing `setImprovementStatus` at the weaker capability produced *"these use the head coach's
weaker permission for work that is triage: setImprovementStatus"*.

> **The leak, raised before the change and accepted.** `improvements` went from ADMIN to
> ADMIN + HEAD, and the Head Coach sees the **whole** queue. A report about a money screen quotes
> its figures ("shows 0, should be 99,500") and a screen recording shows the page outright - so
> HEAD can see, through a report, numbers that `finance`, `cash` and `pipeline` deliberately
> withhold from them. The narrower option (own team's reports only) was offered and not taken.
> Do not "fix" this by quietly narrowing the section.

### Verified in a browser, 29 October 2026

Synthetic devices only - an animated canvas as the screen and an oscillator as the microphone - so
the real `MediaRecorder`, track merge, bitrates, blob, sniff and upload all ran unmodified. Only
the permission grant was stubbed.

- recorded across **two navigations**, bar visible throughout, form returned with state intact
- filed with **no typed answers at all**; Send was correctly disabled until the recording existed
- `POST .../recording?kind=SCREEN&seconds=24` -> **200**; queue chip `0:24`
- `GET` -> 200, `video/webm`, **672 KB**, magic `1a 45 df a3`,
  `inline; filename="IMP-0007-screen.webm"`, `private, no-store`, `nosniff`, `preload="none"`
- headers: app `microphone=(self), display-capture=(self)`; `/f/` both `()`

Guards: no `kind` **400** - bogus kind **400** - replace **409** - someone else's report **404** -
HTML labelled `video/webm` **415** - 2.5 MB as `AUDIO` **413** (the cap is per-kind) - empty
**400**.

Escalation, as the real HEAD demo login: Escalate button present, **every** triage control absent
(status buttons, working notes and reporter message all 0), escalated -> sorted to the top ahead
of four newer reports. The developer seat is the exact inverse: triage yes, Escalate absent.

2,086 tests pass, `tsc --noEmit` clean, `next lint --max-warnings=0` clean.

### Still open

- **Retention.** Unchanged and now bigger: a 25 MB screen recording of somebody's workday is
  personal data and nothing expires it. `/api/cron/retention` is where a rule belongs.
- **Range requests.** `Accept-Ranges: none`, so a viewer cannot seek until the file has
  downloaded. Fine at 5 MB, worth revisiting if the cap ever rises.
- **Not tested on a phone.** Safari records MP4 and the sniff handles it, but no iOS device has
  run this - and iOS gets no screen option at all.
- **The bell.** `computeNotifications` keys improvement counts on the ADMIN *role*, so the Head
  Coach gets the queue but no badge.
