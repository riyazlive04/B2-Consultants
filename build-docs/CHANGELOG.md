# Changelog

## Unreleased
- 2026-11-12 build-docs created; Calendars redesign plan drafted.
- 2026-11-13 Plan approved. `fix(app-guide)` 43d1e77: en dashes broke the house-style test.
- 2026-11-13 `feat(calendar-settings)`: a "Calendar settings" tab listing every calendar B2 has -
  one card per discovery pattern, one per pile of hand-made slots, one for strategy sessions -
  each saying whether it is actually offering anybody a time, and why not when it is not. A door
  onto Console → Availability and the SSS tab; no second place to configure anything. Bookings
  tabs gained stable ids, so a link to a tab survives a reorder.
- 2026-11-13 `feat(appointment-list-view)`: an "Appointments" tab - both call types as one table
  with Synamate's saved views (Upcoming / Cancelled / All / Upcoming discovery / Upcoming
  strategy), inline status, search, sort and Admin CSV export. Booking requests and Cancelled
  slots are UNCHANGED beside it, so BANT, WhatsApp state and the existing export are not lost.
  Status writing moved into one shared module so the drawer and the list cannot disagree.
  `fix(calendar-view)`: EventCard mixed the `borderLeft` shorthand with `borderStyle`, which
  React warns about on re-render.
- 2026-11-13 `feat(book-appointment-modal)`: "+ New" on the toolbar and clicking an empty half-hour
  open a two-tab dialog - book an existing contact into an OPEN slot, or block a time range off.
  New actions `searchBookableLeads`, `listOpenSlotsForDay`, `bookDiscoveryForLead`, `blockTimeRange`;
  the lead/board/journey step and the post-commit step are now shared with `submitBooking`.
  Deferred: a title/description/notes to type (no field behind them), SSS booking (needs a journey),
  multi-day block ranges, and Synamate's free "custom" time.
- 2026-11-13 `feat(appointment-drawer)`: clicking an entry opens Synamate's "View details" drawer -
  time, owner, phone, email, Zoom join link - with the status select (Discovery), Unblock (blocked
  time) and a read-only note on a released call. Writes through the existing booking/sss actions;
  Modal gained a `side` (drawer) variant. Deferred: Edit/Reschedule from the drawer, attendees,
  booked-by, source and description rows.
- 2026-11-13 `feat(calendar-manage-view)`: Manage view panel - view by type (All/Calls/Blocked),
  per-person and per-calendar ticks, search, Clear all; filters in the URL and applied server-side.
- 2026-11-13 `feat(brand-icons)`: real brand marks (official simple-icons paths, inlined) for the
  services the app integrates with - Zoom links, WhatsApp sends - and for brand lead sources on
  the funnel Source column. No Google surface exists to mark (Sheets has no screen; Calendar/Meet
  are not integrated). LinkedIn has no simple-icons entry, so it keeps its lucide glyph.
- 2026-11-13 `feat(calendar-view)`: Week/Day/Month grid + toolbar on /bookings, page renamed
  "Calendars"; KPI strip + Next-call panel replaced by one Discovery calls tile on the dashboard;
  App Guide copy updated. Old hand-rolled week grid retired; tables unchanged.
- 2026-11-13 `feat(calendar-core)`: CalEvent model, Synamate colours (AA-safe text), overlap layout,
  `getCalendarEvents` read. No UI yet, no schema change.
- 2026-11-14 `feat(calendar-drag-reschedule)`: drag a discovery call to another time in Week/Day -
  or arm the move from the drawer and click a time, which is the keyboard and touch path. Lands on
  the grid's own half-hour lanes (not OPEN slots, which the grid does not draw) and writes through
  the existing `rescheduleBookingToTime`, so the old slot is freed, confirmation reset and the
  prospect notified exactly as from the Bookings table. Day view: a drop in another person's
  column reassigns too. SSS stays on the SSS Calendar tab, which already does this properly.
- 2026-11-14 `fix(app-guide)`: the Calendars manual caught up with the rebuild. Two new entries
  (Appointments list, Calendar settings) with their own screenshots; the calendar entry now covers
  opening a call, booking or blocking an empty half-hour, and moving a call by drag or by keyboard.
  Stale deep links fixed: Cancelled slots and SSS Calendar were still `?tab=1`/`?tab=2`, which after
  the two new tabs opened Booking requests and Cancelled slots instead - they use the stable ids
  now. Dropped the line saying a call cannot be booked from this screen (it can, since feature 5).
  All 9 bookings screenshots re-captured from the local preview; manifest still holds 200 entries.
- 2026-11-14 **DEPLOYED to production** as `b2-app:0edfa7d` (was `dd4203d`): the whole Calendars
  rebuild, features 1-8, plus the App Guide catch-up. Pure image swap - no migration (119 in the
  repo, 119 applied live, same latest) and no cron rebuild (`docker/` untouched, cron stays on
  `b2-cron:d4d24dc`). Built locally from `git archive HEAD`, shipped over an ssh pipe, loaded on
  the box. Health after the swap: ok, db up, 4 ms. Rollback image tagged `b2-app:rollback-20261114`.
