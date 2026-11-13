# Feature 7: Calendar settings tab

## Purpose
Synamate's Calendar settings list, as the door to B2's existing slot setup. Not a new config system.

## Architecture
- Left: "All calendars (n)" + Groups list **DISCO (n) · SSS (n)**.
- Table: Calendar name (+ copyable id) · Group · Duration · Type ("Personal") · Status (Active =
  has OPEN future slots, else "No availability") · Date updated · Actions.
- Actions → existing screens: ✎ = `/bookings/availability?owner=` (Discovery) or SSS config
  (owner, duration, reschedule window); 🔗 = copy public booking link (funnel/`/book`).
- "+ New calendar" = generate slots for a team member who has none (existing `generateSlots` /
  `generateSssSlotsAction`). ADMIN only; HEAD/USER see the list read-only.
- Rows derived from data (owners with slots) + SSS config owner. **No Calendar table.**

## Impact map
- `/bookings/availability`, Founder Console availability + SSS panels: linked, unchanged.
- `getSssConfig`, `getBookingRulesConfig`: read-only.

## Edge cases
- Owner with slots only in the past → status "No availability".
- No SSS owner configured → SSS row shows "Owner not set" with link to set it.

## Acceptance criteria
- AC1 Lists one Discovery row per owner with slots and one SSS row per SSS owner.
- AC2 ✎ opens the existing availability screen scoped to that owner.
- AC3 HEAD/USER cannot see "+ New calendar".

## As built (2026-11-13)
- Cards, not a table: five facts per calendar (owner, length, when, how many open slots ahead,
  and one sentence on what to do) read better as a card than as a row with six columns.
- Three row kinds: a configured discovery pattern, a pile of open slots NO pattern explains
  (hand-made, or left behind by a deleted pattern), and the strategy calendar.
- Status is the point of the screen: Active / No availability / Switched off / No days chosen /
  Owner not set. "Switched on with no weekdays" is called out separately because that exact state
  emptied the production calendar once and read as "the booking system is broken".
- **AC2 as built:** ✎ opens Console → Availability rather than an owner-scoped version of it.
  That panel IS the list of calendars, so there is nothing to scope; scoping it would have meant
  adding a parameter to a console panel for one link.
- "+ New calendar" links to the same console panel and is ADMIN-only. Nothing is configured here.
