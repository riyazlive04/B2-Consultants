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
- State in URL (`users` / `off`, `cal`, `type`, `panel`). **Default = everyone**, not "me" as in
  Synamate: /bookings is deliberately the whole-team calendar (see `sections.ts`), and opening it
  pre-filtered to yourself would hide what the page is for.
- Who is shown is stored whichever way round is SHORTER - `users` (show these) or `off` (hide
  these) - because on a 22-person team "everyone except Anna" is 21 ids in the address bar.
- Synamate's three lists (Users / Calendars / Groups) collapse to two: a B2 calendar IS
  (person x call type), so its groups and its calendars are the same two things.
- **AC4 dropped, 13 Nov:** it assumed /bookings already scopes a USER to their own calendar. It
  does not - every role sees the whole team's calls, by design. Adding scoping here would be a
  silent access change, so it needs a decision of its own, not a filter panel.

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
- ~~AC4 USER role cannot see another rep's appointments via URL params~~ - dropped, see above.
