# Changelog

## Unreleased
- 2026-11-12 build-docs created; Calendars redesign plan drafted.
- 2026-11-13 Plan approved. `fix(app-guide)` 43d1e77: en dashes broke the house-style test.
- 2026-11-13 `feat(brand-icons)`: real brand marks (official simple-icons paths, inlined) for the
  services the app integrates with - Zoom links, WhatsApp sends - and for brand lead sources on
  the funnel Source column. No Google surface exists to mark (Sheets has no screen; Calendar/Meet
  are not integrated). LinkedIn has no simple-icons entry, so it keeps its lucide glyph.
- 2026-11-13 `feat(calendar-view)`: Week/Day/Month grid + toolbar on /bookings, page renamed
  "Calendars"; KPI strip + Next-call panel replaced by one Discovery calls tile on the dashboard;
  App Guide copy updated. Old hand-rolled week grid retired; tables unchanged.
- 2026-11-13 `feat(calendar-core)`: CalEvent model, Synamate colours (AA-safe text), overlap layout,
  `getCalendarEvents` read. No UI yet, no schema change.
