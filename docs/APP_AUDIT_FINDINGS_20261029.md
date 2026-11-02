# What the manual audit turned up - 29 Oct 2026

Writing a manual for every screen meant reading the code behind every screen, and that surfaced
problems the guide could not honestly paper over. This is the list.

**ALL OF IT HAS NOW BEEN FIXED - 30 Oct 2026.** Every item below was re-confirmed against the
code and then closed. The list is kept as written, because what each screen used to do is the
reason the fix looks the way it does; `**FIXED:**` lines record what changed and, where the
original reading turned out to be incomplete or wrong, say so.

Four of them were worse than reported, two were right about the symptom and wrong about the
cause, and one was not a defect at all:

- **§5.1** did not merely ignore the period bar - the rows behind those popups arrive already
  bounded to the selected window, so on any period but the current month the popups came up
  **empty** under cards showing real figures.
- **§6.9** was recording the failed attempt all along; the query that reads it back asked for
  `DELIVERY_SENT` only, so it never saw the `DELIVERY_SKIPPED` row that was meant to stop the
  retry.
- **§6.10** was four more places than the two named, all discarding a refusal the same way.
- **§1.5's** workshop item was right about the symptom but not the screen: the Workshops panel was
  already gated; the ungated Add/Edit/Delete buttons are on the workshop DETAIL page.
- **§1.5's** Batches item describes the intended design, not a bug - `batch-membership.test.ts`
  deliberately holds `batches.manage` at Admin-only, because granting it to every head coach is a
  product call nobody has made. The real defect was that the sidebar offered the section to a head
  coach the page then bounced; the section is now hidden unless the grant exists.
- **§4's** two unread settings could not be implemented: one described behaviour the data model
  makes unconditional, the other had no moment to fire on and its own comment argued against it.
  Both are removed rather than wired to nothing.
- **§2's** three "duplicate doors" are not duplicates in the harmful sense - two of the three are
  one implementation with live reads. Only first-call shares had a genuine second editor.

**Confidence.** Items marked **[verified]** were confirmed by reading the code directly. Items
marked **[reported]** came from the per-section audits; every one has since been checked against
the code as part of fixing it, and the `**FIXED:**` note says what was actually found.

---

## 1. Access and permissions

### 1.1 A coach or tutor can be silently promoted to Admin **[verified]** - most serious
Editing a team profile writes the form's Dashboard role onto the linked login. The role picker
offers only Admin, Head and User, but a profile may legitimately hold Coach, Tutor or Student. When
the stored value is not one of the three options the browser falls back to the **first** option -
Admin - so simply opening a coach's profile and saving it hands them the founder's access:
Finance, Cash, the Console, everything.

No outsider can reach this (the Users section is Admin-only), so it is an accident waiting to
happen rather than an attack. It is still the one item here worth fixing before anything else.
The fix is small: include every role in the picker, or refuse to write a role the picker cannot
represent.

**FIXED.** Both. The picker is built from `APP_ROLE_OPTIONS` (all six roles, one shared list) and
`profileSchema` validates against `APP_ROLES`, so a stale form cannot write a role either. The
form also gained the two rails Users & access has, because it edits a login's role: nobody can
demote themselves out of Admin, and the last Admin cannot be demoted.

### 1.2 Booking rules are writable by non-admins **[reported]**
`saveConfirmLoopRules`, `updateBookingRules` and `runBookingAutomationNow` guard on the Bookings
*section* rather than on Admin, so a Head coach or telecaller can arm the confirm-or-cancel loop
and change the buffer, notice period, advance window and auto-disqualify rule from the availability
screen. Every comparable money or messaging rule is Admin-only.

**FIXED.** All three are `requireAdmin()` now, and the availability page no longer draws the three
rule sections for anyone else - a form that refuses on save reads as a broken page. Slot work on
the same screen stays open to the whole section.

### 1.3 Two sales actions skip their permission **[reported]**
- The Level 2 desk's "route to Level 3" marks a lead Highly Qualified without holding the
  qualify permission.
- "Add opportunity" with a brand-new contact skips the duplicate check and leaves the contact
  with no owner.

**FIXED.** The route-to-Level-3 verdict now checks `outreach.qualify`, the same key the other two
doors onto it check, and the Level 2 desk stops offering what it would refuse. The inline new
contact dedupes on the normalised phone and takes an owner from the first-call rotation, like
every other door onto `Lead`.

### 1.4 Reports is not row-scoped **[reported]**
The code comment says rows are scoped to the viewer; they are not. A telecaller with Reports sees
every invoice total.

**FIXED.** The record objects are narrowed in the QUERY to the viewer's own leads and deals
(`assignedToId` OR `enteredById`, the predicate the pipeline uses), and the money - invoice totals
and campaign economics - is offered only to someone who could open Finance. A hand-edited
`?object=invoices` is not a way round it.

### 1.5 Controls drawn for people the server then refuses **[reported]**
Each of these shows a button and fails on save, which reads as a broken app rather than a
permission boundary:

- Workshop add and edit buttons appear for non-admins; saving is refused.
- "Enrol as a student" opens for anyone with the Agreements permission, but creating a *new*
  student inside it is Admin-only.
- A Head can open Onboarding but cannot use "Add someone" without Contacts access.
- A Coach sees "your verdict" sprint check-ins on My Teaching but cannot record one.
- Batches & Plans lists Head in its role defaults, yet a Head is bounced unless separately granted
  the seating permission - which is Admin-only by default.

**FIXED, four of five as described.** Workshop add/edit/delete, the enrol prompt, Onboarding's two
writes and the sprint verdict are now either drawn only for people the server will accept, or
worded for the person reading them. Two notes:

- The workshop buttons were not on the Workshops panel (already gated) but on the workshop detail
  page, which opens to anyone granted `germanNote.finance` while every writer behind it is Admin.
- "Enrol as a student" was subtler than drawn-and-refused: `enrolFromAgreement` was deliberately
  widened to `agreements.issue`, then called `convertLeadToStudent`, which re-guards at
  `requireAdmin()` - and `requireAdmin` REDIRECTS, so a head coach was thrown to the dashboard
  with no message at all. The student-creation core is now shared and takes the session its caller
  already authorised.
- Batches & Plans is **not** a bug: `batch-membership.test.ts` holds `batches.manage` at
  Admin-only on purpose, because handing seating to every head coach is a product call nobody has
  made. What was wrong is that the nav offered the section to a head coach the page then bounced,
  naming a tickbox nothing on screen mentioned. Sections can now declare a capability they also
  require (`needsCapability`), so the item appears exactly when the grant does.

---

## 2. Two doors to one setting

The user's own example. Each of these is one stored rule with several editors, so a founder can
change it in one place and be surprised by what the others show.

| The rule | Where it can be changed |
| --- | --- |
| Confirm-or-cancel loop **[reported]** | WhatsApp settings · Bookings → availability · Console → Sales ops |
| First-call lead shares **[reported]** | Console → Call Distribution · the team profile form on the org chart |
| Capabilities (per person) **[reported]** | Console → Per-person rules · the Access dialog on Users |
| A programme's price **[verified]** | Programs → Programmes · Payments → Products (same row, by design) |

Only the last is deliberate and documented. The other three are duplicates.

**FIXED, and two of the three were not duplicates.** The confirm-or-cancel loop and the per-person
capabilities each have ONE implementation that every door merges through, and every door reads
live - so neither can hold a stale copy. What was missing is that no door said the others existed,
which is what made opening a second one a surprise. The doors are now listed once in
`lib/shared-settings.ts` and each screen renders the list minus itself, so adding a fourth door
updates the other three.

First-call shares were a real second editor, and the Console wins: it edits the whole roster
together and previews the split the engine will actually produce, which is the only way the number
means anything (the engine normalises them, so 5 and 2 is 71/29, not "5%"). The org chart shows the
share read-only, and `saveTeamProfile` no longer accepts the field at all.

---

## 3. Pointers that lead nowhere

- **Tutor-fee posting has no switch at all [verified].** Console → Maintenance offers exactly two
  posting toggles: invoice issuance, and commission payout runs as money owed. There is no control
  for tutor-fee posting anywhere in the app - yet "Not armed" lists it and points at Maintenance,
  the Tutor Fees panel points at a non-existent "Operations → Finance posting", and the Finance
  screen counts it among the engines that are off. So the app reports a switch that does not exist.
- The Edit-access dialog says to link a login "on Team & org chart", where there is no link
  control **[reported]**.
- WhatsApp settings point at "Console → Attendance"; the real location is System → Alerts &
  Chasing **[reported]**.
- The read-only panel calls the permission "Triage improvement reports"; it is "Triage
  improvements" **[reported]**.

**FIXED.** The tutor-fee switch now exists, on the Maintenance card beside the other two posting
toggles - the engine behind it was already written, idempotent per fee and wired to the config;
only the control was missing. The Tutor Fees panel points at where it actually is. "Console →
Attendance" was wrong in **nine** places, not one, and all nine now say System → Alerts & Chasing.
The permission name is read from the capability catalogue so it cannot drift again. The Edit-access
dialog no longer sends anyone hunting for a link control: the EMAIL is the link, and
`saveTeamProfile` now makes it one on edit as well as on create - previously, correcting an
existing profile's email to match a login did nothing at all.

## 4. Settings that are stored and never read **[reported]**

- `requireFreshQuotePerLevel` - no reader.
- `autoPublishOnClose` - no screen, no reader.
- `releaseDeferredBookOrders` - never called; there is no automatic release of a held book order.
- The attendance setting that publishes a register when its window closes is defined and unused.
- `/opportunities/pipelines` exists and nothing in the app links to it.

**FIXED - two wired, two removed, and the removals are the point.**

- `releaseDeferredBookOrders` is wired into the daily tick, so DEFERRED is self-clearing as its own
  comment always claimed. It also moved out of a `"use server"` file on the way: every export of
  one is a callable action, and that function took no arguments and checked no permission.
- `/opportunities/pipelines` is linked from the Deals board, which is its parent screen.
- `requireFreshQuotePerLevel` could not be implemented. The rule it describes is structural - a
  book order is for one level and always opens at QUOTE_REQUESTED - so each level is already
  re-quoted unconditionally, and the Console's own preview proved the toggle changed nothing by
  producing an identical table either way. Removed, and the fact stated instead.
- `autoPublishOnClose` had no moment to fire on: a window does not close through code, closed is
  derived from `now > closesAt`. Implementing it would have meant a new cron job to do the thing
  its own comment argued against ("a register that is, at that instant, a list of everyone who did
  not press a button"). Removed; `publishRequired` is the real switch.

---

## 5. Numbers that may mislead

- **Finance metric-card popups ignore the period bar [reported].** The Expenses and COGS popups,
  Top 5 payments and Expenses by category all count the current calendar month, while the cards
  above them follow the period bar.
- **Cash Health and Finance count different receivables [reported].** Cash Health counts only
  Active plans; Finance counts Active and Overdue.
- **Finance cards do not read the ledger [reported].** Arming the posting engines changes no
  figure on screen, so "the numbers will change once I arm this" is not true.
- **A later instalment can never be ticked off automatically [reported].** Only an
  instalment-type payment settles one, and a new entry of that type always demands a new schedule,
  which is refused when a plan already exists.
- **Commission is re-derived from today's rates every time [verified].** Changing a rate therefore
  changes what *past* months report. Only an already-recorded payout run keeps its old totals.
  The old guide said the opposite.
- **A re-recorded payout run leaves the ledger behind [reported].** The saved snapshot updates;
  the ledger keeps the first amount.
- **Leaderboard attendance counts unpublished registers [reported]**, and a student with an
  enrolment but no cohort is ranked against every active enrolment.
- **Attendance colour bands disagree across three screens [reported]:** 80/60 on the Attendance
  cohort cards, 75/50 on My Teaching and the student pages, and the Console thresholds only on the
  roster.
- **Cancelled classes still appear** in "To mark", "Registers to take" and "Never marked"
  **[reported]**.
- **Arena pays XP for backward pipeline moves [reported]**, though its own "How XP works" says
  backward moves earn nothing.
- **Campaign attribution is always empty [verified].** Nothing in the app tags a lead with a
  campaign.
- **Two sales screens quote the wrong thresholds to their own users [reported].** The Level 1 desk
  says bookings inside 8 hours are blocked, when the minimum notice is 2 hours by default; the
  average BANT card's popup says above 3 / 2 to 3 / below 2, when the real cut-offs are 2.4 and
  1.6.
- **Pipeline's "Calls booked" undercounts [reported].** It counts two older stages, but the public
  booking page now sets "Discovery Call Booked", so a booking made the normal way is not counted.
- **The Outreach call step writes no call log [reported]**, so answering YES or NO there leaves no
  record anywhere else in the app.

**ALL FIXED.** Three of these were worse, or narrower, than the reading above, and those three are
the ones worth carrying forward.

- **The Finance popups did not come up stale - they came up EMPTY.** Each popup re-filtered rows
  that had already been fetched for the chosen period against the current calendar month, so for
  any period but this one the intersection was nothing at all. The re-filters are gone, and all
  four cards and their popups now carry the period's own label, so the figure and the heading can
  no longer disagree about which month is on screen.
- **Receivables are one rule now.** Both screens count a pending plan only when it is owing and
  its balance is above zero. `owing` is returned on the row, so neither screen re-derives it.
- **Finance's engine note no longer promises the figures will move.** The cards read the
  operational records, by design; arming a posting engine changes the ledger, not them. The note
  on the screen now says that, instead of implying the opposite.
- **A later instalment can be ticked off.** Naming an existing pending payment is what settles
  one, so the action no longer builds a plan in that case, and the form no longer demands a
  schedule that the action would then refuse.
- **Commission reports both numbers.** The report returns the live re-derivation and the recorded
  payout snapshot side by side, flagged when they have drifted - so "what the rates say today" and
  "what was actually paid" can no longer be mistaken for each other.
- **A re-recorded payout run takes the ledger with it.** The re-run voids the original entry and
  clears its id before posting, because the posting helper is idempotent on the source and would
  otherwise have treated the correction as a no-op.
- **Leaderboard attendance follows the publishing switch**, like every other reader. A student
  with an enrolment but no cohort is no longer ranked against the whole school: that case had been
  collapsed into the founder's deliberate "rank everyone" setting, and is now separate from it.
- **One band function.** `attendanceBandForPct` reads the Console thresholds and is used by all
  four screens, so there is nothing left for them to disagree about.
- **A called-off class owes nobody anything.** Cancelled sessions are out of "To mark", "Registers
  to take" and "Never marked".
- **Backward stage moves earn no XP**, decided against the declared stage ladder rather than by
  comparing labels.
- **Campaign attribution had no writer at all.** Nothing anywhere in the app ever set
  `Lead.marketingSourceId`, which is why the report was empty rather than wrong. Intake now
  resolves a source from the channel and the campaign, upserting on that pair and leaving a
  renamed source untouched; with no campaign it writes nothing, rather than inventing a
  placeholder that would read as real attribution.
- **Both screens quote the setting, not a number typed into a sentence.** The Level 1 desk reads
  `minNoticeHours`; the average BANT popup reads the real cut-offs.
- **"Calls booked" counts both stages that mean a call is on the books**, distinct by lead, from
  one shared constant - which fixed the appointment setter's auto-captured daily log at the same
  time, because it had the same question wrong in the same way. The Pipeline guide text that
  described the old behaviour has been corrected with it.
- **The Outreach call step writes a call log**, in the same transaction as the step, with the
  step's name in the note so the contact history says which call it was.

---

## 6. Things that silently do nothing

- **A resolution typed on an improvement report never reaches the reporter [reported].** It is
  stored, and replies marked visible to them are neither shown nor sent.
- **A free-text WhatsApp sent from the Conversations reply box has no contact attached
  [reported]**, so it never appears in that thread.
- **Dunning never chases an invoice [verified].** It works on Finance instalment plans only, so an
  overdue invoice ages in silence whether the engine is on or off.
- **The daily purge deletes archived issued invoices [reported]**, though a manual delete refuses
  them as tax records - and the purge runs regardless of the Maintenance pruning toggle.
- **A subscription's bin says "can be restored" and deletes permanently [reported].**
- **Staff PDF and Receipt buttons route through the public link [reported]**, so they stop working
  after a revoke or expiry.
- **Invoice emails show the total in rupees even on a euro invoice [reported].**
- **Weekly update wipes values [reported].** Once a row is touched, leaving Last session, Task set,
  Task done or Next check-in blank clears what was there.
- **A failed reminder retries every day [reported]**, contradicting the code's own comment.
- **A status pill and Delete on Bonus & Commission report success even when refused [reported].**
- **Publishing a form requires a field keyed `name` [reported]**, so a First/Last-name-only form
  cannot be published.
- **Any Sections save puts Outreach back on the sidebar [reported].**
- **Two Operations toggles cannot be saved on their own [reported]** - the dirty check compares
  only the pipeline mode, so flipping auto-create, or "put every new lead on the Deals board",
  leaves Save inert.
- **Onboarding never shows an expired signing link [reported].** It reads a saved status that
  never becomes expired, so the gap the journey promises to surface is invisible.

**ALL FIXED.** Two of these turned out to be a different defect than the one described, and one of
them was in six places rather than two.

- **A resolution reaches the reporter.** Typing one marks it visible to them, and the reporter's
  own view reads the visible events.
- **A free-text WhatsApp carries its target**, so a message sent from the Conversations reply box
  lands in the thread it was sent from.
- **Dunning's scope is stated rather than implied.** It chases Finance instalment plans. The
  engine note says "overdue instalments", and the Payments guide says plainly that an unpaid
  invoice is only marked OVERDUE and that following it up is a person's job. Widening the engine
  to invoices is a decision about who gets chased by machine, not a bug fix, so it was not made
  here.
- **The purge keeps issued invoices** - the same tax-record rule a manual delete applies - and it
  does not run at all unless retention is switched on. The toggle is now read before anything is
  deleted, rather than after.
- **The subscription bin says what it does.** `Subscription` has no archive column, so that button
  was always a permanent delete sitting behind the most reassuring dialog in the section. It now
  warns, and points at Cancel, which stops billing and keeps the record.
- **Staff PDF and Receipt are their own session-gated routes**, so they no longer depend on a
  public link that can be revoked or expire. The receipt is keyed by payment id, not by the
  guessable receipt number.
- **Invoice emails quote the invoice's own currency.** The send selects the currency and both
  totals, instead of selecting the rupee total and printing it whatever the document says.
- **Weekly update opens on what is stored.** The four boxes render their saved values, so a blank
  is now a deliberate clear rather than a side effect of the row having been touched for some
  other reason.
- **A failed reminder does not retry daily - and the failure was never missing.** It was recorded
  as `DELIVERY_SKIPPED`; the reader asked only for `DELIVERY_SENT`, so it looked for the wrong
  event and found nothing. It reads both now.
- **Six places, not two, acted on a result they had thrown away.** A sweep for an awaited action
  followed by an unconditional success toast found all of them; each now reads the result through
  `safeAction` and reports what actually happened.
- **A form that captures First and Last name can be published.** The check asks whether the form
  captures a name at all, from a declared list of name field keys, instead of insisting on a field
  keyed exactly `name`.
- **A Sections save keeps Outreach where you put it.** The rail flag travels with every row out to
  the panel and back again, so a save can no longer silently reset it.
- **The two Operations toggles save on their own.** The dirty check compares the whole draft with
  what was loaded, not the pipeline mode alone.
- **An expired signing link is visible.** Onboarding no longer reads a stored status that never
  becomes expired: expiry is derived from the link's own expiry against the current time, the same
  way the agreement state engine does it.

---

## 7. Guide text that was wrong, and is now corrected

Twenty claims in `lib/guide-content.ts` no longer matched the app. All are fixed; they are recorded
here because each one is evidence of a screen that changed without its documentation.

Finance and money: Skool listed as COGS (it is Tools & Software); metric cards called
"always this-month" (they follow the period bar); the 5%/3% commission split presented as fixed
(four rates, all editable, plus a closer's share and a 20% stand-in share); the whole Bonus &
Commission entry, which described bonuses as derived from targets when they are assigned by hand,
and claimed a rate change does not touch past months.

Invoicing: "a level with no price cannot be invoiced" (unpriced programmes are offered, marked
"No price set"); the rupee and euro prices called "two stored figures, never a conversion" (they
mirror at today's rate unless unlocked); an "Invoices & estimates" tab that does not exist;
"an overdue balance ages here in silence" implying dunning would otherwise chase it.

Programmes: adding C1 or C2 described as needing code - levels became a founder-editable config
table, so they do not.

**The real gap named here is now closed, and it was wider than the enrolment form.** The form and
its validation were fixed first; the METRICS were not, and they failed in three different ways.
Pipeline's wins headline added three named buckets over a tally that had a fourth, so a deal won
at a tier the founders added was not merely unnamed - it was not counted. Students' popups listed
three rows under cards that counted every active enrolment, so the rows stopped summing to the
figure above them. The at-risk list printed `level === "GUIDED" ? "Guided" : "Elite"`, which
labels a C1 student "Elite" on the one screen where a coach reads a name and a tier together. And
the 90/120-day tracker selected `programLevel: { in: ["GUIDED", "ELITE"] }`, so a new tier given a
90-day duration never reached the tracker that exists to count its days - its length, too, was
re-derived from the level name rather than read from the enrolment's own stored `duration`.

There is one rule now, in `lib/level-tally.ts`: every active tier gets a row, any other code the
data carries gets one as well, and the rows therefore sum to the card. Eleven read sites use it -
Students, Pipeline, the dashboard, Finance's revenue-by-programme bars, the head coach's card -
and a source-scanning test fails if a screen names a tier in source again.

Agreements: "nobody is chased until you switch it on" - chasing ships **on**, days 3, 7 and 12.
Also the list described as grouped by state when it is one flat table, and the signing code
described as going out with the link by default when it only goes on request.

Reports and Funnel: "click a number to see the records behind it" (only the Contacts groupings
drill through); campaign attribution described as showing which form an enquiry came through (it
reports spend, cost per lead, cost to acquire and return on spend); "the red box always names your
biggest drop-off" - it names the stage losing the most *people* against expectation, measured
against an agreed target first and only then against recent history.

Ledger posting: two journey steps said tutor fees post once armed in Maintenance. There is no such
switch (§3).

Classroom and portal: the next-class card described as appearing an hour before the class; a
recording "nudge on your dashboard" that is a bell notification; OKR progress said to be below the
form when it is above; Arena quests and streaks described as coming from daily-log numbers, which
telecallers no longer have by default; My Teaching said to show only your own cohorts; Batches
described as three tabs regardless of role.

Classroom and students: the next-class card said to appear an hour before the class (it always
shows the next class, and Join appears once a link exists); a recording "nudge on your dashboard"
that is a bell notification; recordings said to be released by a visible-to-students tick when a
viewing window decides it; OKR progress said to sit below the form when it is above; Arena quests
described as tracking daily-log numbers, which telecallers no longer keep; My Teaching said to show
only your own cohorts (the founder and head coach see all); Batches described as three tabs for
everyone when Plans is founder-only; the agreements list described as grouped by state when it is
one flat table; the signing code said to go out with the link when it only goes on request; "mark
each class Watched" where tracked viewing marks it at 90%; a journey step promising Onboarding
would flag an expired signing link and offer to re-issue, which it does not; and the week's sprint
actual described as something a coach records, when it is founder and head-coach only.

Sales: Contacts said to offer a call form on the contact record (it has none) and to leave
nobody unassigned (the rotation does, when it cannot place someone); Deals said to be dragged,
when the default rules-driven mode blocks dragging, and its auto-create described as needing an
engine armed when the switch ships on; Outreach's Key Metrics described as counts by day when it
is one row per booked prospect, and its breach figures described as lists when they are two
counts in one card; first-call shares said to be set in People, when they moved to the Console;
and a journey step telling staff to "pick a free slot", when there is no staff booking form at
all - bookings go through the public page.

Marketing: "a submission with no phone number is refused" (only when the field is required);
funnels "each with its own booking page" (only with a booking block); "every message the app has
sent is listed" (the latest 300); "there is no test mode" - there is one, blank on live;
Conversations threads said to start only when you write from a contact record.

---

## Suggested order

1. **1.1** - the Admin promotion. Small fix, worst consequence.
2. **§3's tutor-fee switch** and **1.2** - the app is actively misdescribing its own controls.
3. **§6's silent failures** that touch customers or money: the invoice currency in emails, the
   subscription bin, the purge of issued invoices, PDF links breaking after revoke.
4. **§2's duplicate doors** and **§5's disagreeing numbers** - worth a decision on which screen
   owns each rule before more screens read them.
