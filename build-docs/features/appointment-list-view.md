# Feature 6: Appointment list view

## Purpose
Synamate's "Appointment list view" tab: every appointment as a table with inline status.

## Architecture
- Heading "Appointments" + **+ New appointment** (opens feature 5).
- Saved-view tabs: **Upcoming · Cancelled · All · Upcoming SSS · Upcoming Disco** (Synamate's
  own saved lists for this account) + B2 extra **Released slots** (the current
  `CancelledSlotsTable`, kept: it is slot history, not appointment status).
- Row tools: Advanced filters drawer (Appointment time is/after/before date, Calendar, Owner,
  Status), Sort by (time asc default), Search by title.
- Columns: # · Title (calendar icon + 2-line clamp) · Contact (initial avatar chip) · **Status
  select inline** · Appointment time ("November 12, 2026, 09:30 AM (IST)", "Rescheduled to" chip)
  · Calendar · Appointment owner · ⋮ (View details · Edit · Reschedule · Cancel).
- Built on the house `DataTable` (selection/paging already exist). Server-paged, 25/page.
- Existing BookingsTable extras that Synamate lacks (BANT chip, WhatsApp status, CSV export) stay
  as optional columns via "Manage columns", **so nothing the team uses today is lost**.

## Impact map
- Replaces `BookingsTable.tsx` usage on the page; `CancelledSlotsTable.tsx` kept as a tab.
- CSV export route (if bound to BookingsTable) must keep working.
- Status select → same actions as drawer (feature 4).

## Edge cases
- Status select change on a past booking → allowed (marking Showed/No show is after the fact).
- Empty tab → "No appointments" row.
- Huge "All" list → paging; search is server-side.

## Acceptance criteria
- AC1 Upcoming lists future non-cancelled appointments of both types, time ascending.
- AC2 Upcoming SSS / Upcoming Disco filter by type correctly.
- AC3 Inline status change persists and matches the drawer.
- AC4 BANT + WhatsApp columns available via Manage columns; CSV export still downloads.

## As built (2026-11-13)
- **BookingsTable was NOT replaced.** The doc's plan rebuilt it with "Manage columns" so nothing
  was lost; keeping it is the cheaper way to lose nothing. The list is a tab beside it, reading
  the same `CalEvent` the grid draws - so both call types appear, which is what Synamate's list
  gave the team and the booking table never could.
- Saved views as built: Upcoming, Cancelled, All, Upcoming discovery, Upcoming strategy. Synamate's
  advanced-filter drawer is not rebuilt: the Manage view panel already filters by person, calendar
  and type, and the table searches and sorts itself.
- Columns: Appointment, Contact, Appointment time, Status (inline), Calendar, Owner, Details.
  No row number column - the table pages, so a row's number is a lie by page two.
- Blocked time is never listed. It is not an appointment; it stays on the grid.
- Export is the house DataTable's CSV, Admin-only, named for the view it was taken from.
