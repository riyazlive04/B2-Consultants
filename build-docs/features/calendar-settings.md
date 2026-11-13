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
