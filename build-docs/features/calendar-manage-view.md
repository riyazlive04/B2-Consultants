# Feature 3: Manage view panel

## Purpose
Synamate's right-hand filter panel: choose whose calendars and which kinds of entries are on the grid.

## Architecture
- Right panel 320px, closable (X), toggled by "Manage view". Sections:
  - **View by type** radio card: All · Appointments · Blocked slots.
  - **Filters** + "✕ Clear all"; search box "Search users or calendars".
  - **Users (n)** collapsible checklist, 5 shown + "See more (+k)".
  - **Calendars** collapsible checklist (derived `CalendarRef`s).
  - Synamate "Groups" → B2 has two natural groups, DISCO and SSS: shown as 2 checkboxes.
- State in URL (`users`, `cal`, `type`); default = the signed-in user if they own a calendar,
  else all owners (matches Synamate defaulting to "me").
- USER role sees only their own calendars + any they're the booked caller on (same scoping the
  current bookings page applies); HEAD/ADMIN see all.

## Impact map
- `getCalendarEvents` filter args; `getBookableTeamMembers` for the user list.
- No schema change.

## Edge cases
- Filter excludes everything → grid empty + inline "No calendars selected · Clear all".
- A user removed/archived since the URL was shared → ignored silently.
- Search with no match → "No matches".

## Acceptance criteria
- AC1 Unticking a user removes their events and (in Day view) their column.
- AC2 "Blocked slots" shows only BLOCKED entries.
- AC3 Clear all restores the default selection.
- AC4 USER role cannot see another rep's appointments via URL params (server-enforced).
