# Issue triage & fix plan — 4 Aug 2026

Twenty reported issues, root-caused against the **live Supabase database** and the code as it
stands today. Every claim below is backed by a file reference or a live query, both recorded
inline. Nothing here has been implemented yet — this is the plan.

## Live facts this triage is built on

Read from the production database on 4 Aug 2026 (read-only probe):

| Fact | Value | What it explains |
|---|---|---|
| Leads | 23,545 | — |
| **Opportunities** | **1** | Issue 13 |
| **AppointmentSlots** | **0** | Issues 9, 14, 16 |
| **BookingRequests** | **0** | Issues 9, 14, 16 |
| CallLogs | 1 | Issue 9 |
| **Leads ever BANT-scored** | **0** (of 111 Pabbly leads) | Issue 20 |
| Leads with `intakeAnswers` | 0 | Issue 20 |
| Qualification questions configured | 13 | Issue 20 |
| `AppSetting` rows present | 8 — no `slotPatternConfig`, no `sectionsConfig`, no `emailConfig`, no `qualificationInboundMapping` | Issues 10, 14 |
| Asma's `TeamProfile.logVariant` | `DISCOVERY_SPECIALIST` | Issue 9 |
| Nilofer's `logVariant` | `APPOINTMENT_SETTER` | Issue 9 |
| Default pipeline | "Sales" — includes two stages with `legacyStage: null` named `loser` and `Aakash` | Extra finding E5 |
| Duplicate lead groups | 1 by phone, 4 by email; **5,889 leads with no phone at all** | Issue 7 |
| `EMAIL_ENABLED` | `"false"`, `RESEND_API_KEY` empty (both `.env` and `.env.production`) | Issue 10 |

`npx tsc --noEmit` is **clean**. Every problem below is a logic, configuration or design
problem — not a type error. That is why none of them showed up in a build.

### The one sentence that explains half the list

**Booking availability was never switched on.** `DEFAULT_SLOT_PATTERN_CONFIG` ships
`enabled: false, weekdays: []` ([config-schema.ts:353](../src/lib/config-schema.ts#L353)) and no
`slotPatternConfig` row exists on live, so `ensureBookingSlots()` returns
`{ ran: false, reason: "slot pattern disabled" }` on every cron tick
([slot-topup.ts:32](../src/server/slot-topup.ts#L32)). Zero slots → `/book` offers an empty
calendar → zero bookings → the Bookings page is empty → Asma's desk has nothing to act on.
Issues 9, 14 and 16 are three symptoms of that one unset switch.

---

## Part A — the twenty reported issues

### 1. Arena is not neatly designed or organised; redesign the form section

**Scope confirmed: the Arena page layout.**

[ArenaClient.tsx](../src/app/(app)/arena/_components/ArenaClient.tsx) is five stacked blocks in
one long scroll (my card → leaderboard → quests → badge gallery → XP feed → a 70-line prose
"How XP works" panel) using **three different control idioms** for the same job: a pill group for
the leaderboard period (L134–147), a free-floating chip row for the badge-gallery person picker
(L215–228), and nothing at all for quests. The admin branch at L180–207 hand-rolls its own
progress bars rather than reusing `QuestCard`. The rules panel — the longest block on the page —
is reference material sitting below live data.

**Fix — restructure the page around one control idiom and one fold:**
1. **Above the fold, two columns:** "my card" (`LevelRing` + `XpBar` + streak/rank/badge pills)
   on the left, the leaderboard on the right. Today the leaderboard — the thing people open the
   page for — starts below a full-width hero.
2. **One period control, one place.** The leaderboard's pill group (L134–147) becomes the page's
   period control and drives the quest board and XP feed too, so "this week" means one thing on
   the whole screen.
3. **Badge gallery person picker → `Tabs`.** The free-floating chip row (L215–228) is a third
   idiom doing the same job as the pill group; use the shared `Tabs` component.
4. **Delete the bespoke admin quest bars** (L180–207) — hand-rolled progress bars duplicating
   `QuestCard`. Give `QuestCard` a `compact` variant and use it for both branches.
5. **Collapse "How XP works" behind a disclosure.** It is the longest block on the page and it is
   reference material sitting under live data. `<details>`, closed by default, with the pipeline-
   moves table inside it.
6. **Empty states per section**, not one page-level bail-out (L91–97): with 1 CallLog and 0
   bookings on live, most of this page is empty and currently says nothing about why.

~1 file, ~200 lines rewritten. No server change, no schema change.

*Related but out of scope for this issue:* the Founder Console has 20 flat top-level tabs
([console/page.tsx:228–330](../src/app/(app)/console/page.tsx#L228)) and would benefit from the
same grouping treatment — tracked separately in the sequencing section, since issue 6 adds a
21st tab.

---

### 2. 90–120 day tracker — Google Form integration?

**Root cause:** the 90/120-day tracker already exists in-app — Students → "90/120-day tracker"
tab ([students/page.tsx:252](../src/app/(app)/students/page.tsx#L252)) and the per-student
`SprintTracker` ([SprintTracker.tsx:147](../src/app/(app)/students/[id]/_components/SprintTracker.tsx#L147),
Guided 90d/13wk · Elite 120d/18wk). It is **only ever written by hand** through `updateTracker`.
There is no inbound path of any kind: `INGEST_ENABLED` exists as a documented seam but *nothing
reads it for tracker data* ([ingest.ts:17](../src/lib/ingest.ts#L17)), and the only bulk import in
the app is a CSV paste for the student roster
([student-import-actions.ts](../src/server/student-import-actions.ts)).

**Decision: replace the Google Form with an in-app form. No Google integration is built.**

This is the right call — the tracker writes to a student's `Enrollment`, and every write needs
the milestone log, the signal-change log and an audited author, none of which a Google Form can
supply. The existing `updateTracker` path already does all three; the form just has to reach it.

**Fix — a coach-facing tracker form that mirrors the Google Form's questions:**
1. **Inventory the Google Form first.** Its questions are the spec; anything it asks that the
   `Enrollment` model cannot hold needs a schema decision before UI work starts. *(This is the
   one input still needed — see the note at the end.)*
2. **Two entry points, one form component:**
   - Per-student, on the student record — replaces the current inline field grid at
     [StudentDetailClient.tsx:412–434](../src/app/(app)/students/[id]/_components/StudentDetailClient.tsx#L412),
     which today is a bare row of inputs with no framing.
   - **Batch mode** on Students → "90/120-day tracker" — the reason a Google Form was used at
     all: a coach updating twelve students should not open twelve pages. One screen, one row per
     student, week-by-week, inline save.
3. **Make the cadence explicit.** Guided is 13 weeks, Elite 18
   ([SprintTracker.tsx:147](../src/app/(app)/students/[id]/_components/SprintTracker.tsx#L147)) —
   the form should open on the *current* week for each student and mark which weeks are missing,
   so a gap is visible rather than inferred.
4. **Keep every write on `updateTracker`** so milestone + signal logs and `logActivity` continue
   to fire. No new write path.
5. **Nudge instead of a form link:** a weekly reminder to each coach listing students with no
   tracker update this week — this is what the Google Form's scheduled email was doing. Reuse the
   alerts machinery in `server/speed-to-lead-alert.ts` / the digest cron; it needs Resend armed
   (issue 10), which is already Week 0.
6. **Migrate the history**: a one-shot CSV import of past Google Form responses through the
   existing preview→commit contract (`previewStudentImport` / `commitStudentImport`), so the
   in-app tracker starts with the record already collected rather than from zero.
7. **Then retire the Google Form** — turn off accepting responses, keep the sheet read-only as an
   archive.

*Consequence to accept:* coaches must be logged in to update a tracker. That is a real change to
their workflow and worth confirming with them before the Google Form is switched off. If any
coach has no account, that is a prerequisite, not a detail.

---

### 3. Remove the Founder/Admin option from the signup section

**Root cause:** [LoginForm.tsx:22–26](../src/app/login/LoginForm.tsx#L22) —
`REQUEST_ROLES` lists `ADMIN → "Founder / Admin"` as a self-service request option. Anyone who
finds the login page can request founder access.

**Fix (both layers, not just the UI):**
- Drop the `ADMIN` entry from `REQUEST_ROLES`.
- **Also** tighten the server gate: [access-requests.ts:52](../src/server/access-requests.ts#L52)
  `role: z.enum(["ADMIN","HEAD","USER"])` accepts ADMIN from a crafted POST regardless of what
  the UI shows. Narrow it to `["HEAD","USER"]` (plus `TUTOR`/`STUDENT` if issue 4 lands).
- Change the default `reqRole` from `"USER"` — already correct — and re-check that
  `people/_components/UsersPanel` renders an unknown legacy role without crashing (old queued
  requests may still carry `ADMIN`).

Small, ~20 lines. Do the server half or the fix is cosmetic.

---

### 4. Tutor login in the login dashboard; separate login for the student dashboard

**Root cause:** the roles and the destinations *already exist and work* — `Role` enum has `TUTOR`
and `STUDENT` ([schema.prisma:27–33](../prisma/schema.prisma#L27)), live has one of each
(`tutor.demo@`, `student.demo@`), and the root page redirects them correctly:
`STUDENT → /my-journey`, `TUTOR → /german-note`
([(app)/page.tsx:69–71](../src/app/(app)/page.tsx#L69)).

What is missing is entirely on the **login screen**: the sign-up role picker offers only
Admin/Head/Telecaller, and there is no signal anywhere that a tutor or a student signs in at the
same URL. A tutor lands on a page whose copy says "Sign in to your B2 Consultants workspace" and
whose only branding is "Internal tool · access by invitation".

**Fix:**
- Add `TUTOR` ("German Note tutor — your batches and community") and `STUDENT` ("Student portal —
  your own journey") to `REQUEST_ROLES`, with the server enum widened to match.
- Add a third framing on the brand panel: "Team · Tutor · Student — one sign-in, three
  workspaces", so nobody thinks they are on the wrong page.
- **Separate student entry point:** add `/portal` as a thin route that renders the same
  `LoginForm` with `variant="student"` — student-facing copy, no Sign-up tab (students are
  provisioned from a Student record, see `portal-actions.ts` / `revokeStudentLogin`), and a
  post-login `?next=/my-journey`. One route file + one prop; it shares all the auth logic, so
  there is no second auth surface to keep secure.
- Same treatment for `/tutor` if you want the symmetry.

---

### 5. Remove whitespace in the login credential

**Root cause, and it is *not* the email field.** The email input already strips every whitespace
character on change — `filterEmail = raw.replace(/\s/g, "")`
([field-rules.ts:89](../src/lib/field-rules.ts#L89)) applied via `fieldKindProps("email")`
([LoginForm.tsx:58](../src/app/login/LoginForm.tsx#L58)).

Two real gaps:
1. **The password is never trimmed.** [LoginForm.tsx:257](../src/app/login/LoginForm.tsx#L257)
   binds the raw value, deliberately (the comment at L55–56 says a password must accept every
   character). But every password in this system is either admin-set or chosen at invite
   acceptance and then *pasted from WhatsApp or email*, which routinely carries a trailing space
   or a non-breaking space. The user then gets **"Invalid email or password."** with no hint.
2. **The email is never lower-cased before sign-in.** `submitAccessRequest` folds to lowercase
   ([access-requests.ts:73](../src/server/access-requests.ts#L73)) and `User.email` is `@unique`,
   but `authClient.signIn.email({ email, password })`
   ([LoginForm.tsx:84](../src/app/login/LoginForm.tsx#L84)) sends whatever was typed. Someone
   whose keyboard capitalises the first letter may be bounced.

**Fix:**
- `signIn.email({ email: email.trim().toLowerCase(), password: password.trim() })`.
- Strip ` `/zero-width characters too — a WhatsApp paste is the actual source.
- Add a visible note when trimming changed the value ("we removed a stray space"), so a user
  whose password genuinely ends in a space isn't silently locked out. *Flagging the trade-off:
  trimming a password is a behaviour change; it is safe here because no password in this system
  was ever chosen with a leading/trailing space, but say so in the release note.*
- Apply the same treatment to `/change-password`, `/reset-password` and `/invite/[token]`, or the
  problem simply moves.

---

### 6. Founder console: enable/disable discovery-call commission (or any feature) per telecaller

**Root cause:** commission rates are **global only**. `commissionRulesConfigSchema` has four
scalars — `bothCallsPct`, `splitPct`, `closerPct`, `substitutePct`
([config-schema.ts:433–446](../src/lib/config-schema.ts#L433)) — and
[CommissionPanel.tsx](../src/app/(app)/console/_components/CommissionPanel.tsx) edits exactly
those. There is no per-person dimension anywhere: "Nilofer is first-call-only" is expressed
nowhere in config, only in who happens to log which calls.

The mechanism you want **already exists** for other things: `User.sectionAccess` and
`User.capabilities` are per-user JSON override blobs
([schema.prisma:63–66](../prisma/schema.prisma#L63)) driven by a code catalogue
([capabilities.ts:36](../src/lib/capabilities.ts#L36)) and edited from People → Users & access.

**Fix — extend the existing per-user override system rather than inventing a parallel one:**
1. Add capability keys to `CAPABILITIES`:
   - `commission.discovery` — "Earns discovery-call commission"
   - `commission.firstCall` — "Earns first-call commission"
   - `commission.closer` — "Earns closer commission"
   Default roles `["ADMIN","USER"]` so today's behaviour is preserved exactly.
2. Enforce them where the money is computed — `getCommissionReport` in
   [commission-metrics.ts](../src/server/commission-metrics.ts) — by skipping a leg whose earner
   lacks the capability, and **showing the skipped leg with a "not eligible" note** rather than
   silently zeroing it (an invisible zero is how a payout dispute starts).
3. New Console tab **"Per-person rules"**: a matrix of team member × capability, so the founder
   sets Nilofer to first-call-only in one click instead of via three separate user dialogs.
4. The same matrix should surface `sectionAccess` per person, which answers the "or any feature"
   half of the request — it is already stored, just not editable from one screen.

---

### 7. Show the users who are duplicates

**Root cause:** duplicate detection exists but is **write-time only and one-directional**.
`findDuplicateLead` ([lead-intake.ts:138](../src/server/lead-intake.ts#L138)) blocks a *new*
manual entry; nothing ever reports the duplicates already sitting in the table. And the two
callers disagree:
- [contacts-actions.ts:59](../src/server/contacts-actions.ts#L59) passes `{ phone, email }`
- [pipeline-actions.ts:93](../src/server/pipeline-actions.ts#L93) passes `{ phone }` only

so a duplicate created from the Pipeline screen by email alone is never caught.

Live scale: 1 phone-duplicate group, 4 email-duplicate groups — small — but **5,889 leads have no
phone at all**, and `resolveIntakeLead` deliberately skips blank phones from dedupe
([lead-intake.ts:326](../src/server/lead-intake.ts#L326)), so that population is only ever matched
on email, and only when the incoming record also has no phone. Name-similarity is never checked.

**Fix:**
1. New `server/duplicates-metrics.ts` with one SQL pass per entity, grouping on
   `regexp_replace(phone,'[^0-9]','','g')`, `lower(email)`, and a normalised-name +
   city fallback for the phoneless population.
2. New screen **People → Duplicates** (and a tab on Contacts) listing each cluster with: rows,
   which key matched, created dates, owner, stage, call count, booking count.
3. A **Merge** action: keep the oldest row, re-point `CallLog`, `OutreachJourney`,
   `BookingRequest`, `LeadStageHistory`, `LeadAnswer`, `Opportunity`, then soft-delete the loser.
   Admin-only, `logActivity`-audited, previewed before commit (same two-step contract
   `previewStudentImport`/`commitStudentImport` already uses).
4. Cover **Users** and **Students** with the same report — the request said "users", and
   `Student.email` collisions are the more damaging case (they split a paying student's ledger).
5. While in there, make `pipeline-actions.ts:93` pass `email` too.

---

### 8. Remove the connection from sheet → API; redirect directly into the API

**Root cause:** there is **no Google Sheets code in this repo at all**. `sheets_scrape/` in the
parent folder is one-off Python (`sheets_extract.py`, `dump_tracker.py`) used to reconstruct
history — it is not a runtime path. The sheet hop you are describing lives *outside* the app, in
Pabbly/Apps Script.

What the app already offers as the direct path: signed webhook endpoints
`/api/leads/pabbly`, `/api/leads/meta`, `/api/leads/flexifunnels`, all funnelling into the single
`upsertIntakeLead` entry point ([lead-intake.ts:173](../src/server/lead-intake.ts#L173)).

**Fix — generalise that seam into one documented intake API, then cut the sheets over:**
1. Promote the shared parts of `webhook-payload.ts` into a reusable `intakeRoute()` factory
   (secret check → rate limit → unwrap → debug echo → handler), so a new inbound source is ~20
   lines instead of a copied 100-line route.
2. Add `POST /api/intake/lead` — a generic, source-tagged lead endpoint for any landing page
   that isn't behind Pabbly, so a page can post straight to us with its qualification answers
   intact (which is also issue 20's likely cure). *No tracker endpoint: issue 2 is being solved
   with an in-app form instead.*
3. Console → Operations gains an **Integrations** card: per-endpoint URL, secret status,
   last-delivery timestamp, last-24h count, and last error. Today there is no way to tell whether
   a webhook is even wired up.
4. **Then** delete the sheet: repoint the Apps Script / Pabbly step, watch the delivery counter
   for a week, retire the sheet.
5. Keep the CSV importer — it is the recovery path when a webhook is down.

**Do not remove the Pabbly leg until the direct leg has been verified live.** Memory of the last
cut-over ([b2-pabbly-lead-relay]) is explicit that this is a dual-write, not a replacement.

---

### 9. The "Log outcome" button is missing from Asma's My Desk

**Two independent causes, both confirmed.**

**Cause 1 — the desk she gets has no such button outside booked calls.** Asma's
`logVariant` is `DISCOVERY_SPECIALIST`, so `MyDeskPage` renders `L2Desk`
([my-desk/page.tsx:81](../src/app/(app)/my-desk/page.tsx#L81)). In `L2Desk`:
- `CallRow` has `Record outcome`, gated on `!call.recorded && call.leadId`
  ([L2Desk.tsx:260](../src/app/(app)/my-desk/_components/L2Desk.tsx#L260)) — only for **today's
  booked calls**.
- `LeadRow` — the "Your leads" section, which is where *all* her assigned leads live — has
  **only a dial link**, no outcome control at all
  ([L2Desk.tsx:284](../src/app/(app)/my-desk/_components/L2Desk.tsx#L284)).

Compare `L1Desk`, which has it on every lead row
([L1Desk.tsx:270](../src/app/(app)/my-desk/_components/L1Desk.tsx#L270)) — so Nilofer has the
button and Asma does not, purely because of which desk variant she was assigned.

**Cause 2 — `desk.today` is *always* empty.** Live has 0 `AppointmentSlot` and 0
`BookingRequest` rows, so `CallRow` never renders either. Asma's desk has **zero** outcome
controls under any circumstance. (Whole-app `CallLog` count: 1.)

**Fix:**
- Give `LeadRow` in `L2Desk` the same `Log outcome` action `L1Desk` has, wired to the same
  offline-capable `queueCall` path (`useOfflineCalls.ts`) so a call logged with no signal still
  survives — that machinery already exists and L2 simply doesn't use it.
- Use the L2 outcome vocabulary, not L1's: `L2Desk`'s `RouteModal` outcomes
  (`QUALIFIED_FOR_SSS` / `FOLLOW_UP_NEEDED` / `NO_SHOW`) apply to a *call that happened*; a lead
  with no booking needs L1's `SETTER_NEXT_STAGES` set. Share one modal with a variant prop rather
  than forking a third.
- Fix issue 14 (below) so `desk.today` stops being empty.
- **Regression guard:** add a test asserting every desk variant exposes an outcome-logging
  control on every row type it renders. This class of bug — "the affordance exists on the other
  variant" — will recur otherwise.

---

### 10. Email using Resend

**Root cause: fully built, entirely disarmed.** [lib/email.ts](../src/lib/email.ts) is a complete
raw-HTTP Resend client with a fail-closed runtime gate
([email.ts:51–65](../src/lib/email.ts#L51)). It requires three things and has **none** of them on
live:

| Requirement | State |
|---|---|
| `EMAIL_ENABLED="true"` | `"false"` in `.env` **and** `.env.production` |
| `RESEND_API_KEY` | empty in both |
| `emailConfig.fromEmail` saved in-app | **no `emailConfig` AppSetting row exists** |

Consequences, all silent: password reset ([auth.ts:62–74](../src/lib/auth.ts#L62)) never sends —
better-auth returns a generic "check your email" either way; the SOP Step-1 opt-in alert
`notifyNewOptIn` ([lead-intake.ts:388](../src/server/lead-intake.ts#L388)) is fire-and-forget and
swallows its own errors; invoices and the 3-stage dunning ladder
([dunning.ts](../src/server/dunning.ts)) do nothing.

**Fix — configuration, not code:**
1. Verify a sending domain in Resend (`b2consultants.in`) — an unverified sender fails at *send*
   time, not at save time.
2. Set `RESEND_API_KEY` and `EMAIL_ENABLED="true"` in `.env.production`; redeploy.
3. Save the From address in-app at Conversations → Settings (writes `emailConfig`).
4. Set `RESEND_WEBHOOK_SECRET` so `/api/resend/webhook` records bounces and delivery status.
5. **Then** add the missing observability: today a failed send returns
   `{ ok: false, error }` that most callers discard. Add a `Console → System Health` row for
   "emails sent / failed, last 24h", and route `sendResendEmail` failures through
   `lib/observability.ts` so a silent outage is visible.
6. Send a test to each template (reset · invite · invoice · dunning · opt-in alert) before
   announcing it.

---

### 11. Leads downloadable/viewable by month or week; week+month filter on all leads and money sections

**Root cause: three incompatible period mechanisms and, on the money screens, none at all.**

| Screen | Period control | Evidence |
|---|---|---|
| Finance | **none** — hardcoded to the current calendar month | `istMonthRange()` with no args, [finance/page.tsx:103](../src/app/(app)/finance/page.tsx#L103) |
| Pipeline | **none** — a `<Pill>This month</Pill>` that is *decoration, not a control* | [pipeline/page.tsx:161](../src/app/(app)/pipeline/page.tsx#L161) |
| Payments | none | no `searchParams` |
| Outreach | none | no `searchParams` |
| Cash | `?period=` | [cash/page.tsx:35](../src/app/(app)/cash/page.tsx#L35) |
| Reports | `?range=` (a different vocabulary) | [reports/page.tsx:62](../src/app/(app)/reports/page.tsx#L62) |
| Contacts | filters, but **no date filter at all** | [contacts/page.tsx:47](../src/app/(app)/contacts/page.tsx#L47) |

Export exists only where a `DataTable` was given a `csvName`
([DataTable.tsx:262](../src/components/ui/DataTable.tsx#L262)) — and it exports **the rows
currently on screen**, so with no period filter it can only ever export "this month".
`MonthPicker` exists in `components/ui` and **is imported by nothing**.

**Fix — one period primitive, adopted everywhere:**
1. New `lib/period.ts`: a single `PeriodSpec` (`week | month | quarter | year | custom` + anchor
   date), one `parsePeriod(searchParams)`, one `resolvePeriod() → { start, endExclusive, label,
   previous }`. IST-anchored, half-open, matching `istMonthRange`'s existing contract so nothing
   double-counts a boundary day.
2. New `<PeriodBar>` component: segmented week/month toggle + prev/next arrows + a custom range,
   writing `?period=` — collapsing Cash's `period` and Reports' `range` into one vocabulary
   (keep both old params parsing for one release so existing links survive).
3. Adopt it on **Finance, Cash, Payments, Ledger, Telecaller Pay, Pipeline, Contacts, Outreach,
   Bookings, Opportunities, Reports**. This is the single largest item on the list — budget it as
   its own work stream, roughly one page per hour once the primitive exists.
4. **Export must follow the filter, not the page.** Add a server-side `GET /api/export/[entity]?period=…`
   that streams CSV from the same query the page runs, so "download all leads for July" is not
   capped by whatever the table happened to paginate. Gate on the same `requireSection` +
   capability the page uses, cap at a documented row count, and `logActivity` every export —
   23,545 lead records leaving the building should leave a trace.

---

### 12. Make sure all the dashboards are standard

**Root cause:** two competing header components plus five pages that hand-roll their own.

- `PageHeader` — 16 pages
- `ListHeader` — 8 pages
- **Neither** — `agreements`, `bookings`, `german-note`, `outreach`, `whatsapp`

[bookings/page.tsx:93–112](../src/app/(app)/bookings/page.tsx#L93) is the clearest case: a
bespoke 20-line header strip with its own icon chip, its own type scale and its own action slot,
reproducing what `PageHeader` already does.

**Fix:**
1. Decide the rule and write it into `docs/DESIGN_SYSTEM.md`: `ListHeader` for
   record-list screens (count + filter bar), `PageHeader` for everything else. Both should share
   one base so they can never drift on type scale or spacing.
2. Convert the five hand-rolled pages.
3. Add an ESLint rule (or a test that walks `src/app/(app)/*/page.tsx`) asserting every page
   exports one of the two. This is what stops the sixth from appearing.
4. Standardise the layer *below* the header too: KPI row → primary content → tabs, using
   `MetricCard` everywhere. `bookings` currently puts a 4-card KPI row, then a bespoke
   calendar+rail grid, then tabs; `pipeline` puts a hero, then cards, then tabs. Same information
   architecture, different scaffolding.

---

### 13. New leads are not coming into the Opportunities section

**Root cause: confirmed and unambiguous — nothing creates an Opportunity from an inbound lead.**
Live: **23,545 leads, 1 opportunity.**

There are exactly two `opportunity.create` call sites in the codebase:
1. [forms-actions.ts:276](../src/server/forms-actions.ts#L276) — a **native Form** submission,
   and only when `settings.createOpportunity && settings.pipelineId && settings.stageId` are all
   set (L269).
2. [opportunities-actions.ts:198](../src/server/opportunities-actions.ts#L198) — the manual
   "Add card" button.

The webhook path never does. `upsertIntakeLead` creates `Lead` + `LeadStageHistory` +
`OutreachJourney` and stops ([lead-intake.ts:351–382](../src/server/lead-intake.ts#L351)).
`syncDefaultOpportunity` only *moves* an opportunity that already exists — its first line is
`if (!opps.length) return;` ([opportunity-sync.ts:28](../src/server/opportunity-sync.ts#L28)).

**Fix:**
1. New `ensureDefaultOpportunity(tx, leadId)` in `opportunity-sync.ts`: find the default
   pipeline's stage whose `legacyStage` matches the lead's stage, create the card at the tail of
   that column. Idempotent — no-op if a card already exists for that lead.
2. Call it from the create branch of `resolveIntakeLead`, inside the existing transaction, and
   from `acceptReturningOptIn` when `plan.reopenStage` fires.
3. Also call it from the two manual creation paths (`contacts-actions`, `pipeline-actions`) so
   "where a lead came from" stops deciding whether it appears on the board.
4. Make it **founder-switchable** — `AppSetting("pipelineConfig").autoCreateOpportunity`,
   defaulting **on** — because the board is bounded and 23,545 cards is not a board.
5. **Backfill:** a one-shot script creating cards for open-stage leads only
   (`NEW_LEAD`, `DISCO_BOOKED`, `WORKSHOP_FOLLOWUP`, `DEPOSIT_PAID` — 15,453 rows; deliberately
   **excluding** the 8,092 `LOST`). Run it after issue 15's search/filter ships, or the board is
   unusable the moment it fills.
6. Note the interaction with the 300-cards-per-stage display cap
   ([opportunities-metrics.ts:14](../src/server/opportunities-metrics.ts#L14)) — 13,017 `NEW_LEAD`
   leads will hit it instantly. Issue 15 is a **prerequisite**, not a follow-up.

---

### 14. The Booking section feels broken

**Root cause: it is empty by construction, and it looks broken in dark mode.**

**(a) No availability was ever generated.** `slotPatternConfig` has no row on live, so the
default applies: `enabled: false, weekdays: []`
([config-schema.ts:353](../src/lib/config-schema.ts#L353)). `ensureBookingSlots()` therefore
short-circuits every hour ([slot-topup.ts:32](../src/server/slot-topup.ts#L32)). Result: **0
slots, 0 bookings**, `/book` shows an empty calendar to every prospect, and every KPI on the page
reads 0 with no explanation of why.

**(b) Dark-mode breakage.** The page hardcodes `white` inside `color-mix`:
[bookings/page.tsx:33–34](../src/app/(app)/bookings/page.tsx#L33) and again at L187, plus
`bg-white/70` at L289. In dark mode those become light chips on a dark card — which reads exactly
like "broken".

**(c) An avoidable serial round-trip.** `getWhatsAppStatusMap` is awaited *after* the
`Promise.all` ([bookings/page.tsx:57](../src/app/(app)/bookings/page.tsx#L57)), adding a full
Supabase round-trip (~205ms from Singapore) to every load.

**(d) BANT shown as `/4` from the raw column** (L266, L290) instead of through `resolveBant`,
which is the app's single source of truth for which score to display
([bant-view.ts](../src/lib/bant-view.ts)). So the calendar can disagree with the table beside it.

**Fix:**
1. **Configure availability** — Console → Availability: set weekdays, hours, duration, owner,
   `enabled: true`. This is a founder action, not a code change, and it unblocks issues 9 and 16.
2. Add an **empty-state that names the cause**: when `slotPatternConfig.enabled === false`,
   the page must say "No availability pattern is configured — set one in Console → Availability"
   with a link, not render four zeroes. Same for `/book`, which should say "no times are
   currently available" rather than showing an empty grid.
3. Replace every hardcoded `white` with `var(--surface)` / the design-system tokens.
4. Move `getWhatsAppStatusMap` into the `Promise.all` (it depends on `bookings`, so restructure
   as a two-stage `Promise.all` or accept the dependency and fetch statuses by slot).
5. Route both BANT renders through `resolveBant`.
6. Add a `System Health` check: "newest bookable slot is N days out" — the exact
   silent-empty-calendar failure that already happened on 23 Jul is documented in
   `slot-topup.ts`'s own header comment and still has no alarm.

---

### 15. Search in Opportunities + an automatic move mode

**Root cause (search):** `Board.tsx` has **no filter state whatsoever** — nine `useState` calls
for drag, modals and stages, none for a query
([Board.tsx:59–71](../src/app/(app)/opportunities/_components/Board.tsx#L59)). Worse, the board
already *tells you to use a filter that doesn't exist*: at 300+ cards in a stage it renders
"More cards exist in this stage than are shown — **filter** or split this pipeline"
([Board.tsx:375](../src/app/(app)/opportunities/_components/Board.tsx#L375)).

**Root cause (automatic move):** the machinery exists but is split in two and not applied here.
- Lead → card: `syncDefaultOpportunity` ([opportunity-sync.ts:19](../src/server/opportunity-sync.ts#L19))
- Card → lead: `moveOpportunity` ([opportunities-actions.ts:59](../src/server/opportunities-actions.ts#L59))
- Outcome → stage: `stageAfterCall` in `lib/call-outcome.ts`
- A founder switch, **`pipelineConfig.mode: "rules" | "drag_drop"`**
  ([config-schema.ts:624–631](../src/lib/config-schema.ts#L624)) — which is read *only* by
  `/pipeline` ([pipeline/page.tsx:89](../src/app/(app)/pipeline/page.tsx#L89)) and **ignored
  entirely by the Opportunities board**, which is always drag-drop.

So the two boards disagree about who is allowed to move a card.

**Fix:**
1. **Search + filter bar** on the board: debounced text search across name/phone/email/owner,
   plus owner, source, value-range and last-activity filters, applied server-side in `getBoard`
   (not client-side over a 300-card slice, or the cap defeats it). Persist in `?q=`/`?owner=` so
   a filtered board is linkable.
2. Raise/replace the 300-card cap with per-column pagination ("load 100 more"), since issue 13
   will fill these columns.
3. **Honour `pipelineConfig.mode` on the Opportunities board too.** In `"rules"` mode, disable
   drag and show a "moved automatically by rules" badge on each card with the rule that will move
   it next; in `"drag_drop"` keep today's behaviour.
4. **Auto-move rules, made explicit and founder-editable.** The rules already implicit in the
   code — call outcome → stage, booking created → `DISCO_BOOKED`, payment received → `WON` — should
   become a visible table in Console → Pipeline showing trigger → resulting stage, with an on/off
   per rule. Reuse the Automation engine (`server/automation.ts`) rather than building a second
   rules evaluator; note it is currently code-hidden
   ([sections.ts:135](../src/lib/sections.ts#L135)) and has no `sectionsConfig` row on live, so
   it would need re-enabling.
5. Add a **dry-run** before arming anything that moves 23,545 leads — `automation-dryrun.ts`
   already exists for exactly this.

---

### 16. In the Booking tab, remove the Bookings section (check the real purpose)

**What is actually there.** `/bookings` renders, top to bottom: a header strip → 4 KPI cards →
a "Next call" + "This week" rail → a 7-day slot calendar → then a `Tabs` with three panels:
`Bookings` (`BookingsTable`), `Availability` (`SlotManager`), `SSS Calendar`
([bookings/page.tsx:314–333](../src/app/(app)/bookings/page.tsx#L314)).

**The real purpose of the "Bookings" tab, and why it feels redundant:** the calendar above shows
**slots** (including empty and blocked ones); the tab shows **booking requests** — the prospect's
submitted form with their BANT answers, WhatsApp confirmation state, assignee, and the
confirm/postpone/cancel actions. Those are genuinely different objects. It feels redundant
because with **0 bookings on live both are empty**, so all you see is two blank panels saying
similar things.

**Decision: restructure, do not delete.**

1. **Rename the tab "Booking requests"** so it stops reading as a duplicate of the page title.
   This alone removes most of the confusion — two things called "Bookings" on a page called
   "Bookings".
2. **Move confirm / postpone / cancel onto the calendar cards.** Clicking a booked slot in the
   week grid opens that request in a modal with its BANT answers and WhatsApp state. The actions
   move to where the eye already is; the tab becomes the list view rather than the only view.
3. **Fold Availability out of the tab strip.** `SlotManager` is a *setup* screen, not a daily
   one — surface it as a "Manage availability" action next to the week navigation, opening in a
   modal or a `/bookings/availability` sub-route.
4. That leaves **two tabs — Booking requests · SSS Calendar** — which is the genuine split
   (discovery calls vs strategy sessions), not three panels that look like variations of each
   other.
5. **Order matters: do issue 14 first.** With availability configured and real bookings flowing,
   re-look at the restructure before finalising step 2 — the calendar-card modal is only worth
   building if slots are actually populated.

---

### 17. Find breaks and logic errors

See **Part B** below — 11 further defects found while root-causing the above, each with
evidence.

---

### 18. Minimise the Sales tab section

**Root cause:** the Sales group holds five sections, two of which are the *same board twice*:

| Section | Route | Overlap |
|---|---|---|
| Pipeline | `/pipeline` | kanban of `Lead.stage` |
| Opportunities | `/opportunities` | kanban of `Opportunity.stageId`, mirrored to `Lead.stage` |
| Contacts | `/contacts` | the same Lead rows as a table |
| Bookings | `/bookings` | |
| Outreach | `/outreach` | |

([sections.ts:73–84](../src/lib/sections.ts#L73).) The two boards even disagree on who may move a
card (issue 15). This duplication is already on the backlog from the UX overhaul as "unify 2
pipelines".

**Fix (staged, because merging boards is not a rename):**
1. **Now:** collapse Sales to three nav entries — **Pipeline · Contacts · Bookings** — and move
   Outreach under Pipeline as a tab (it is the SOP queue *for* the pipeline), Opportunities as a
   second tab on Pipeline ("Board view"). Nav shrinks 5 → 3; nothing is deleted or unreachable.
2. **Next:** pick one board. `Opportunity` carries value/fx/pipeline configurability that `Lead`
   does not, so it should win; `Lead.stage` becomes the derived mirror it already half is.
   This needs its own plan — do not fold it into this pass.
3. The collapsible nav groups already exist
   ([AppShell.tsx:60–81](../src/components/shell/AppShell.tsx#L60)) — make Sales default to
   expanded and the rest collapsed for a `USER`, so a telecaller opens onto three items.

---

### 19. Move the clock from Profile to the top nav (IST + German time)

**Root cause:** the dual clock exists and is good — `TimeZoneCard`
([TimeZoneCard.tsx](../src/app/(app)/profile/_components/TimeZoneCard.tsx)) ticks both zones
every second, auto-detects from `Intl`, and persists to `localStorage["b2_tz_pref"]`. It is just
buried on `/profile`, where nobody looks mid-call. The top bar
([AppShell.tsx:386–438](../src/components/shell/AppShell.tsx#L386)) shows search · record ·
month · runway · theme · alerts · avatar · logout — no time.

**Fix:**
1. Extract the zone/tick logic into `lib/use-dual-clock.ts` so one hook serves both surfaces.
2. New `<NavClock>` for the top bar: `🇮🇳 14:32 · 🇩🇪 11:02`, tabular-nums, `hh:mm` only (no
   seconds — a per-second re-render in the app shell is not worth it; tick on the minute
   boundary).
3. **Respect the existing responsive contract.** That top bar comment (L377–385) is explicit that
   the strip sheds whole controls at breakpoints rather than shrinking them. `NavClock` is ~110px
   — show both zones from `lg`, the non-home zone only from `sm`, hidden below. Replace the
   `currentMonth` span (L411), which is the least-used item there.
4. Keep the Profile card — it stays the place to *change* the preference; the nav is read-only,
   with a tooltip pointing at it.

---

### 20. BANT from Pabbly / landing page still not visible in the client section

**Two separate causes. The second is the fatal one.**

**Cause A — Contacts never displays BANT.** `resolveBant` is consumed by Bookings, My Desk L2 and
Outreach only. `grep bant` across `contacts/[id]/ContactRecord.tsx`, `contacts/[id]/page.tsx` and
`server/contacts-metrics.ts` returns **nothing** — the contact record, which is "the client
section", has no BANT anywhere.

**Cause B — nothing has ever been scored, and there is no way to see why.** Live:
**0 leads with `bantScoredAt`, 0 leads with `intakeAnswers`** — including leads captured *today*
(4 Aug), so the scoring code is deployed and running. `scoreLeadAtOptIn` is wired correctly:
`/api/leads/pabbly` passes the whole payload as `intakePayload`
([pabbly/route.ts:103](../src/app/api/leads/pabbly/route.ts#L103)), and `upsertIntakeLead` awaits
the scorer ([lead-intake.ts:176](../src/server/lead-intake.ts#L176)).

So the failure is at the very first gate:

```ts
if (mapping.mapped.length === 0) return EMPTY;   // lead-qualification.ts:66
```

**Zero payload fields fold onto any of the 13 configured questions' `key`/`inboundKeys`**
([qualification-inbound.ts:118](../src/lib/qualification-inbound.ts#L118)). Either the landing
page's answers are not in the Pabbly payload at all, or their field names differ from every
configured alias. And no `qualificationInboundMapping` AppSetting exists — nobody has ever
configured the mapping.

**The design flaw that makes this undiagnosable:** on that early return the function **stores
nothing**. `intakeAnswers` stays null, so Console → Qualification's Inbound Report — which reads
`intakeAnswers` ([intake-inspection.ts:75](../src/server/intake-inspection.ts#L75)) — is
permanently empty. The one screen built to tell you what the sender is sending can never show
you anything, precisely in the case where you need it.

**Fix, in order:**
1. **Set `LEAD_WEBHOOK_DEBUG="true"` on production** (already implemented,
   [pabbly/route.ts:68](../src/app/api/leads/pabbly/route.ts#L68)), submit the landing-page form
   once, read the real field names off the log. **Turn it off afterwards — it prints lead PII.**
2. **Fix the blind spot:** always persist evidence, even when nothing maps. Change the early
   return to call `persistEvidence` first, so `unrecognisedKeys` is recorded and the Console
   report starts working. This is the single highest-value change on this list — it converts a
   silent failure into a visible one, permanently.
3. Add the discovered field names as `inboundKeys` at Console → Qualification, and the real
   answer labels as option aliases.
4. **If the answers are not in the payload at all**, the landing page or the Pabbly step is
   dropping them — that is issue 8's territory: post the form directly to
   `/api/intake/lead` and stop relying on a relay to preserve fields it does not know about.
5. **Then** surface it: add a BANT block to the contact record — the `BantChip`, the four
   dimensions, the origin (`booking` / `opt-in` / `manual`), the scored-at date, and the stored
   `LeadAnswer` rows. Reuse `L2Desk`'s `CallPrep` block
   ([L2Desk.tsx:190–212](../src/app/(app)/my-desk/_components/L2Desk.tsx#L190)) — it already
   renders exactly this and handles the "scored but answers not kept" case.
6. Render "not scored" as **"not scored"**, never as 0.0/5 — `bant-view.ts`'s header comment is
   explicit about why, and a new surface is exactly where that rule gets broken.
7. Add a Console → Qualification alert: "N leads captured in the last 7 days, M scored" — so a
   mapping that breaks after a landing-page rewrite is noticed in days, not months.

---

## Part B — further defects found during triage

Ranked by consequence. None of these were reported; all are the same *class* as what was.

### E1 — Webhook leads are invisible to non-admins on the Pipeline table
`/api/leads/poll-recent` scope `table` mirrors `getPipelineOverview`'s rule: non-admins see only
leads they entered themselves. A webhook lead has no `enteredById`, so **a telecaller never sees
a new inbound lead in the Pipeline leads table** — only Admin does
([poll-recent/route.ts:18–21](../src/app/api/leads/poll-recent/route.ts#L18)). The route's own
comment states this as intended, but combined with issue 9 it means Asma's two most likely
routes to a new lead are both dead ends. *Fix:* scope non-admins to leads **assigned to them**,
not entered by them.

### E2 — An email-matched dedupe is reported as a phone match
[lead-intake.ts:344](../src/server/lead-intake.ts#L344) returns `deduped: "phone"` from the
**email** branch. Every webhook response, log line and future dedupe metric mislabels the reason.
One-word fix; matters because issue 7's report will be built on this signal.

### E3 — `findDuplicateLead` is called asymmetrically
`contacts-actions.ts:59` passes `{ phone, email }`; `pipeline-actions.ts:93` passes `{ phone }`
only. The same duplicate is blocked on one screen and allowed on the other.

### E4 — Blank-phone leads are structurally undedupable
5,889 leads have no phone. `resolveIntakeLead` skips them from phone-dedupe by design
([lead-intake.ts:326](../src/server/lead-intake.ts#L326) — correct, absence is not sameness), and
the email fallback runs **only when there is no phone on the incoming record**. A person who
first arrived email-only and later arrives with a phone creates a second row. *Fix:* run the
email check unconditionally as a second pass, not as an `if (!phone)` fallback.

### E5 — The default pipeline has unmapped stages
Live "Sales" pipeline contains stages named **`loser`** and **`Aakash`** with `legacyStage: null`.
By design an unmapped stage never writes through to `Lead.stage`
([opportunities-actions.ts:25](../src/server/opportunities-actions.ts#L25)) — so a card dragged
into either **silently stops syncing**, and `syncDefaultOpportunity` can never move a card back
out. On the *default* pipeline this is a data trap. *Fix:* map or delete them, and refuse
unmapped stages on `isDefault` pipelines.

### E6 — Hardcoded `white` breaks dark mode on the Bookings calendar
[bookings/page.tsx:33, 34, 187, 289](../src/app/(app)/bookings/page.tsx#L33). Worth a repo-wide
sweep for `color-mix(... white)` and `bg-white/` — the design system bans this
(`--on-accent`, not `text-white`).

### E7 — The board tells you to use a filter that does not exist
[Board.tsx:375](../src/app/(app)/opportunities/_components/Board.tsx#L375). Covered by issue 15;
listed separately because it is a *copy* bug that will outlive the feature work if not tracked.

### E8 — Serial Supabase round-trip on `/bookings`
[bookings/page.tsx:57](../src/app/(app)/bookings/page.tsx#L57), outside the `Promise.all`.
~205ms per load. Worth a sweep for the same pattern on other pages — this is the exact class the
perf baseline work was about.

### E9 — Off-by-default switches with no operator visibility
`slotPatternConfig.enabled: false`, `sectionsConfig` absent, `emailConfig` absent, `EMAIL_ENABLED`
false, `retention.enabled: false`, `commissionAccrual/tutorFeeAccrual/invoiceIssuancePosting`
false, `speedToLeadAlert` false, `dunning` false, automation section code-hidden. Every one is a
built feature doing nothing, and **none of them says so anywhere in the UI**. *Fix:* one
**Console → System Health "Not armed"** panel listing every feature that is built, off, and what
turning it on requires. This is the structural fix for the whole issue class — issues 10, 14 and
20 are all instances of it.

### E10 — Email is never lower-cased before sign-in
Covered under issue 5; repeated here because it is a *security-adjacent* correctness issue rather
than a UX one — case-variant addresses interacting with a `@unique` column.

### E11 — Two "not scored vs zero" hazards
`bant-view.ts` documents that an unscored prospect must never render as 0.0/5. Issue 20's new
contact-record surface and issue 6's commission matrix are both places where a missing value
would naturally be formatted as `0`. Add a shared `formatOrNotSet()` helper and use it in both.

---

## Sequencing

Ordered by (unblocks-other-work × cost). Weeks are indicative.

**Week 0 — configuration only, no code (unblocks 6 issues)**
1. Console → Availability: configure and enable the slot pattern → *issues 9, 14, 16*
2. Resend: verify domain, set key, enable, save From address → *issue 10*
3. `LEAD_WEBHOOK_DEBUG=true`, capture one real Pabbly payload, turn it back off → *issue 20*

**Week 1 — small, high-value code**
4. Persist intake evidence even when nothing maps (issue 20 step 2) — *the highest-value single change here*
5. Login: trim/fold credentials, drop ADMIN from signup, tighten the server enum → *issues 3, 5*
6. `L2Desk` lead rows get "Log outcome" → *issue 9*
7. Bookings: dark-mode tokens, `resolveBant`, parallel fetch, named empty states → *issue 14*
8. E2, E3, E5, E7 — one-line correctness fixes
9. NavClock → *issue 19*

**Week 2 — structural**
10. `lib/period.ts` + `<PeriodBar>` + adopt on Finance/Cash/Payments → *issue 11a*
11. Server-side CSV export API → *issue 11b*
12. Opportunities search/filter + pagination → *issue 15a*
13. `ensureDefaultOpportunity` + backfill → *issue 13* (after 12)

**Week 3 — surfaces & consolidation**
14. BANT on the contact record → *issue 20 step 5*
15. Duplicates report + merge → *issue 7*
16. Header standardisation + lint guard → *issue 12*
17. Sales nav collapse (stage 1 only) → *issue 18*
18. Arena page layout → *issue 1*
19. Bookings tab restructure (after 7 lands and real bookings exist) → *issue 16*

**Week 4 — forms, integrations, permissions**
20. In-app 90/120-day tracker form — per-student + batch mode, weekly nudge, CSV history import → *issue 2*
21. `intakeRoute()` factory + `/api/intake/lead` + Integrations status card → *issue 8*
22. Per-person commission capabilities + matrix → *issue 6*
23. Console tab grouping (now 21 tabs with 22's addition)
24. Tutor/student login variants + `/portal` → *issue 4*
25. Console → "Not armed" panel → *E9*
26. Auto-move rules table + dry run → *issue 15b*

**Deferred, needs its own plan:** unifying Pipeline and Opportunities into one board (issue 18
stage 2).

---

## Decisions taken

| Issue | Decision |
|---|---|
| 1 | Scope is the **Arena page layout**. Console tab grouping tracked separately (week 4, item 23). |
| 2 | **Replace the Google Form with an in-app form** — no Google integration is built. |
| 16 | **Restructure, don't delete** the Bookings tab; sequenced after issue 14. |

## Still needed before week 4 starts

1. **The 90/120-day tracker Google Form's question list** — it is the spec for the in-app form,
   and any question the `Enrollment` model cannot hold is a schema decision that must be made
   before UI work begins.
2. **Confirmation that every coach who fills the tracker has a login.** The in-app form requires
   one; a coach without an account is a blocker, not a detail.
3. **One real Pabbly payload** from the landing page (week 0, item 3) — issue 20's fix cannot be
   finished without seeing the actual field names.
