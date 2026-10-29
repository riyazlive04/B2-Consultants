# What the manual audit turned up - 29 Oct 2026

Writing a manual for every screen meant reading the code behind every screen, and that surfaced
problems the guide could not honestly paper over. This is the list.

**Nothing here has been fixed.** The App Guide work changed guide content, navigation and tests
only - no feature behaviour was touched. Where the old guide text asserted something untrue, the
text was corrected to describe what the app actually does; the underlying issue is still open and
is listed below.

**Confidence.** Items marked **[verified]** were confirmed by reading the code directly. Items
marked **[reported]** come from the per-section audits and are credible but were not
independently re-checked - treat each as a lead, not a conclusion.

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

### 1.2 Booking rules are writable by non-admins **[reported]**
`saveConfirmLoopRules`, `updateBookingRules` and `runBookingAutomationNow` guard on the Bookings
*section* rather than on Admin, so a Head coach or telecaller can arm the confirm-or-cancel loop
and change the buffer, notice period, advance window and auto-disqualify rule from the availability
screen. Every comparable money or messaging rule is Admin-only.

### 1.3 Two sales actions skip their permission **[reported]**
- The Level 2 desk's "route to Level 3" marks a lead Highly Qualified without holding the
  qualify permission.
- "Add opportunity" with a brand-new contact skips the duplicate check and leaves the contact
  with no owner.

### 1.4 Reports is not row-scoped **[reported]**
The code comment says rows are scoped to the viewer; they are not. A telecaller with Reports sees
every invoice total.

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

## 4. Settings that are stored and never read **[reported]**

- `requireFreshQuotePerLevel` - no reader.
- `autoPublishOnClose` - no screen, no reader.
- `releaseDeferredBookOrders` - never called; there is no automatic release of a held book order.
- The attendance setting that publishes a register when its window closes is defined and unused.
- `/opportunities/pipelines` exists and nothing in the app links to it.

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
table, so they do not. (The real gap: the Students enrolment form still offers only Solo, Guided
and Elite.)

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
