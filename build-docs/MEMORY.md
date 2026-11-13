# Project memory (build-docs)

Older history lives in `docs/` (SYNAMATE_CLONE_SPEC.md, Required_Document/*) and git log.
This file starts 12 Nov 2026 with the Calendars redesign.

## Decisions
- 2026-11-12 Calendars redesign to match Synamate requested by owner. Scope chosen: Discovery +
  SSS + one unified Calendars page (`/bookings`). Classroom timetable NOT included.
- 2026-11-12 No calendar library (FullCalendar's per-user Day view is a paid plugin); no schema
  change; existing slot actions remain the only writers.
- 2026-11-13 Plan approved by owner ("start building"); the 5 decisions took the recommended option:
  1. ~~Synamate hues~~ **superseded 13 Nov:** owner asked for "the application current ui design"
     for colours. Synamate's structure stays; every colour is a design token (`eventLook`), so the
     dark theme and the v1.1 AA tuning carry over and no contrast maths is needed at runtime.
  2. OPEN slots hidden from the grid; the Book modal's Slot select lists them.
  3. KPI cards + Next-call panel move to the Dashboard.
  4. SSS status = Confirmed/Unconfirmed (`salesCallConfirmed`) + Cancel; no `sssStatus` yet.
  5. URL stays `/bookings`; label and title become "Calendars".
- 2026-11-13 A slot a release turned BLOCKED (late cancel / no-show) is drawn only as the
  cancelled card, not also as Busy (`buildCalendarEvents`), else every no-show showed twice.
- 2026-11-13 Owner colour = index in the name-sorted ACTIVE team, so a person keeps one colour.

## Constraints
- Synamate capture at `../syn-cal/` (outer folder, not git) contains real prospect PII. Never commit.
- Local preview only (`.env.local`, :5435 Postgres, `scripts/local-demo-serve.ps1` on :3011).
  `.env` is LIVE.
- Synamate login (shared Playwright profile) was refreshed by the owner on 12 Nov; it expires.

## Known issues
- SSS appointments have no outcome (showed/no-show) field in B2.
- No staff-side "book a discovery call for this lead" action exists yet (only public `submitBooking`).
