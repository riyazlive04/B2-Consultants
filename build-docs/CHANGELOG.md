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
