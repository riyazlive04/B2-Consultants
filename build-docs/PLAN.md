# PLAN: Calendars redesign, matching Synamate (Nov 2026)

Status: **APPROVED 13 Nov 2026** (all 5 decisions = the recommended option; see MEMORY.md)

## Goal and scope
- Rebuild `/bookings` as one **Calendars** page that looks and works like Synamate's Calendars
  module, because the team used Synamate daily and should not have to learn a new screen.
- Covers **both** call types in one grid: Discovery calls (`AppointmentSlot` + `BookingRequest`)
  and SSS calls (`SssSlot` + `OutreachJourney`).
- Reference capture (Synamate, live account, 12 Nov): `../syn-cal/*.png` + `styles-week.json`,
  `event-variants.json`. **Outside the git repo, never commit it:** the screenshots contain real
  prospect names, phones and emails.

**Out of scope**
- Google/Outlook calendar sync (Synamate's grey "Busy" Google blocks). B2 has no sync.
  Synamate's "Busy" look is reused for **B2 BLOCKED slots** instead.
- Synamate's Service menu, Rooms, Equipment, Groups editor, Smart lists, Export PDF/CSV,
  "Scheduling tips", "View consent", "Generate reschedule link".
- The public `/book` page and funnel booking widget (prospect side), which stay as they are.
- New calendar *types* (round-robin, class, collective). B2 has exactly 2 calendar types × owner.

## Project memory that shapes this
- RBAC: `bookings` section = ADMIN, HEAD, USER (`src/lib/sections.ts:492`). Unchanged.
- Discovery calendars are already **per owner** (`server/booking-calendars.ts`, "Personalized
  Discovery Call with X"). This maps 1:1 to Synamate's calendar list.
- Slot engines must stay the only writers: cancel/no-show go through `setBookingStatus` (it writes
  `SlotRelease` and runs promote-next); SSS moves go through `moveJourneyToSlot` (free-old-slot
  **before** claim, because `SssSlot.journeyId` is unique). **No new mutation path may bypass them.**
- Design system v1.1 is WCAG-AA tuned; text on accent uses `--on-accent`; charts/colours via tokens;
  selects and dates are the house custom pickers (`b2-custom-pickers`).
- Every new UI fact goes into the App Guide in the same change (`b2-sweep-similar-sections`).

## Decisions needed from you (I recommend the first option in each)
1. **Colours: exact Synamate vs accessible.** Synamate puts **white text on yellow #F6BF26
   (1.7:1) and on green #33B679 (2.6:1)**, which fails WCAG AA, the standard this app was tuned
   to in v1.1. *Recommend:* copy the scheme exactly (fill = calendar colour, 5px left edge = team
   member colour, cancelled = hollow + strikethrough, blocked = grey), keep the same hues, and
   switch the text to dark wherever white fails contrast. On screen it still reads as Synamate.
2. **Open slots on the grid.** Synamate shows only booked appointments and blocked time. B2's
   grid currently also shows every empty OPEN slot. *Recommend:* hide them like Synamate.
   Clicking an empty spot opens "Book appointment", whose **Slot** dropdown lists the OPEN slots,
   which is exactly how Synamate's modal works.
3. **KPI cards + "Next call" panel** sit above today's grid; Synamate has neither. *Recommend:*
   move them to the Dashboard (they already summarise sales). Alternative: keep them as a
   collapsible strip above the toolbar.
4. **Status on SSS appointments.** Synamate offers Confirmed / Showed / No show / Cancelled /
   Invalid on every appointment. B2 records that for Discovery (`BookingStatus`) but **SSS has no
   outcome field at all**. *Recommend:* phase 1 shows SSS status as Confirmed/Unconfirmed
   (`salesCallConfirmed`) + Cancel; add a real `sssStatus` column later as its own feature.
5. **Route and name.** *Recommend:* keep the URL `/bookings` (links, RBAC, App Guide, the
   `?tab=` deep links all keep working) and rename the nav label and page title to **Calendars**.

## Features (priority order = build order)
| # | Feature | Doc | Depends on |
|---|---------|-----|------------|
| 1 | Calendar event model + layout engine (pure) | `features/calendar-core.md` | - |
| 2 | Calendar view: Week / Day (per user) / Month grid + toolbar | `features/calendar-view.md` | 1 |
| 3 | Manage view panel (view-by-type, Users, Calendars filters) | `features/calendar-manage-view.md` | 2 |
| 4 | Appointment details drawer (View details + status + actions) | `features/appointment-drawer.md` | 2 |
| 5 | Book appointment / Blocked off time modal | `features/book-appointment-modal.md` | 2, 4 |
| 6 | Appointment list view | `features/appointment-list-view.md` | 1, 4 |
| 7 | Calendar settings tab | `features/calendar-settings.md` | 1 |
| 8 | Drag to reschedule (Week/Day) | `features/calendar-drag-reschedule.md` | 2, 4 |

Each feature: design doc → impact check → implement → tests mapped to acceptance criteria → run
→ regression (`npm test` + typecheck + lint) → browser check on local preview (`.env.local`,
:3011, never live) → update build-docs → commit `feat(<feature>): …` → push.

## Build approach (why no calendar library)
- Synamate runs on **FullCalendar**. Its free plugins cover Week/Month, but the **Day view with
  one column per team member is FullCalendar Premium (paid licence)**. It would also ship its own
  CSS that has to be overridden to match B2's tokens and pickers.
- *Recommend:* hand-build the grid. The only non-trivial logic is overlap packing (side-by-side
  columns for clashing events), which is a pure function in `src/lib/calendar-layout.ts` with unit
  tests. Everything else is CSS grid. No new dependency.

## Risks
- `/bookings/page.tsx` is 611 lines. The redesign replaces its body, so the KPI and tab
  content need careful moving, not deleting (see decision 3).
- Staff-side Discovery booking (feature 5) is a **new write path**: today only the public
  `submitBooking` creates a `BookingRequest`. It must reuse the same internals (lead link,
  OutreachJourney link, BANT, slot claim race guard) and not fork them.
- Real slot data is sparse locally; the demo seed needs bookings across 3 owners + SSS.
