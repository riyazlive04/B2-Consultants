# Feature 1: Calendar event model + layout engine

## Purpose
One shape for "a thing on the calendar", so Discovery and SSS render, filter and list through
the same code, the way Synamate treats every calendar's appointments alike.

## Architecture
- `src/lib/calendar-event.ts` (pure, client-safe):
  - `CalEvent = { id, kind: "APPOINTMENT"|"BLOCKED", calendar: CalendarRef, ownerId, ownerName,
    ownerColor, startsAt: string(ISO), endsAt, title, contact: {name, phone, email, leadId}|null,
    status: "CONFIRMED"|"UNCONFIRMED"|"SHOWED"|"NO_SHOW"|"CANCELLED",
    source: {table:"slot"|"release"|"sss", id, bookingId?, journeyId?} }`
  - `eventLook(ev)` → `{bg, border, edge, text, strike}`; blocked = #E1E1E1 with #475467 text
    (Synamate's #667085 is 3.7:1).
  - `CalendarRef = { key: "disco:<ownerId>"|"sss:<ownerId>", type: "DISCO"|"SSS", name, color }`
    Names copy Synamate: "Personalized Discovery Call with <first name>", "Solution Strategy
    Session - <first name>". Title copies Synamate: "<calendar label> between <contact> and <owner>".
  - Status map (Discovery): BOOKED/RESCHEDULED + confirmed → CONFIRMED, unconfirmed → UNCONFIRMED,
    COMPLETED → SHOWED, NO_SHOW → NO_SHOW, CANCELLED → CANCELLED. SSS: `salesCallConfirmed`.
  - Colours: calendar fill per type (Disco indigo, SSS green; Ameen's Disco yellow in Synamate is
    one calendar colour, so it's per calendar, not per type), owner edge from a fixed 8-hue palette
    by stable index of owner. `textOn(fill)` picks white/dark by WCAG contrast ≥ 4.5.
- `src/lib/calendar-layout.ts` (pure): `layoutDay(events, dayStartMin, dayEndMin)` →
  `{ top%, height%, col, cols }`. Greedy column packing per overlap cluster (same rule as
  FullCalendar: events in one cluster share width equally).
- `src/server/calendar-events.ts` (server-only): `getCalendarEvents({from, to, ownerIds?, types?})`
  → pure `buildCalendarEvents(rows, team)` (unit-tested). POSTPONED releases are skipped (the
  booking is drawn at its new slot).
  - 2 queries (AppointmentSlot + BookingRequest + assignedTo; SssSlot + journey.lead + owner),
  **cancelled discovery bookings come from `SlotRelease`** (the booking's `slotId` is nulled on
  release, so the slot no longer points at it).

## Impact map
- Reads `booking-metrics.getWeekSlots` logic: reuse its query shape; do not change it (page and
  CSV export still use it until feature 2 lands).
- `lib/booking-hold.ts`, `lib/slot-tint.ts`: hold state stays derived; `slot-tint` superseded only
  on the calendar page.
- `server/slot-release.ts`: read-only use.
- No schema change.

## Edge cases
- Slot with booking whose lead was archived (soft delete) → still shown, contact name from
  `BookingRequest.name` (snapshot), no link.
- Owner null (unassigned slot) → calendar "Discovery Call (unassigned)", grey edge.
- Event crossing midnight IST → clipped to the day in Day/Week; whole in Month.
- DST: IST has none; CET shown only as a secondary label. All maths in IST via `lib/dates`.
- Empty range → `[]`, never throws.

## Acceptance criteria
- AC1 Discovery booked+confirmed slot maps to CONFIRMED with calendar `disco:<owner>`.
- AC2 Cancelled discovery booking appears once, as CANCELLED, from `SlotRelease`.
- AC3 SSS slot with journey maps to APPOINTMENT; SSS BLOCKED slot maps to BLOCKED.
- AC4 OPEN slots are **not** events (decision 2).
- AC5 `layoutDay`: 3 events overlapping pairwise → 3 columns; A overlaps B, B ends before C → C
  reuses column 0; touching (end == start) is not an overlap.
- AC6 `textOn` returns dark text for #F6BF26 and #33B679, white for #3F51B5.
