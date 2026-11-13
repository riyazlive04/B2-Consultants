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

- 2026-11-13 Month view's "+N more" is a native `<details>`, not a popover component - it opens
  on click and Enter with no JS of ours.
- 2026-11-13 KPI move (decision 3) landed as ONE dashboard tile fed by a new light
  `getDiscoveryCallSummary` (4 counts), NOT `getBookingsOverview` (5 queries, 300 bookings).

- 2026-11-13 Calendar filters: `users` (show) and `off` (hide) are two ways of saying the same
  thing; the panel writes the shorter one. `none` is the unassigned pile - `?users=` empty means
  NOTHING is ticked. Both are honoured server-side (`getCalendarEvents`), and `notIn` needs the
  NULL owner allowed back in explicitly.
- 2026-11-13 **Open question for the owner:** /bookings shows every role the whole team's calls
  (deliberate per `sections.ts`), so feature 3's AC4 (a USER must not see another rep's calls)
  was dropped rather than implemented. Changing that is an access decision.

- 2026-11-13 The drawer opens from ONE delegated click listener over the grids, not a callback
  threaded through Week/Day/Month: every card is already a `<button data-event-id>`, so keyboard
  activation and focus-return come free (Modal hands focus back to the trigger).
- 2026-11-13 SSS confirmation from the drawer calls the existing `setSalesCallConfirmed`, which
  sits behind the **outreach** section - a HEAD has Calendars but not Outreach, so the page asks
  `canOpenSection("outreach")` and the drawer says so instead of the click redirecting to
  `/?denied=outreach`. Unconfirmed also red-flags the journey; that is the existing action's
  behaviour and the hint says so.
- 2026-11-13 "Delete" (feature doc) is the status select's Cancelled, not a bin icon: B2 never
  hard-deletes a booking, and a second control doing the same write would be a second way to be
  wrong.

- 2026-11-13 `submitBooking` was NOT made to serve staff bookings. Everything that makes it what
  it is - rate limits, the consent record, BANT scoring, auto-disqualify - belongs to a stranger
  filling in a form. What the two paths genuinely share is now two functions in booking-actions:
  `linkLeadToBooking` (stage + board card + journey link) and `afterBookingCommitted` (automation
  trigger, Zoom, WhatsApp confirmation, in that order).
- 2026-11-13 A staff booking stores `source: MANUAL`, blank email/phone when the lead has none
  (the schema requires both) and `confirmedAt` set when the modal says Confirmed. The founder's
  booking window (min notice / max advance) is deliberately NOT applied to it.
- 2026-11-13 Blocking is one IST day and a time range, not Synamate's multi-day datetime pair;
  OPEN slots only, booked calls keep their time and are reported back.

- 2026-11-13 The appointment list does NOT replace BookingsTable (the feature doc's plan). That
  table carries BANT, WhatsApp state, the intake answers and the export - things Synamate never
  had and the team uses daily - so rebuilding them behind a "Manage columns" control would have
  been a large change whose best outcome was parity. The list is a second tab beside it.
- 2026-11-13 Status writing lives in ONE client module (`_components/calendar/event-status.ts`):
  the drawer and the list both call `applyStatusChange`, so "No show" cannot mean two things.
- 2026-11-13 The list reads a 90-days-either-side window, its own `getCalendarEvents` call; the
  grid's query stays scoped to the view on screen.

- 2026-11-13 The Calendars tabs now carry stable `id`s (appointments / requests / cancelled /
  settings / sss). Without them `?tab=` held the INDEX, and inserting a tab silently re-pointed
  every saved link.
- 2026-11-13 Calendar settings is DERIVED: a discovery calendar is a named weekly pattern in
  Console → Availability, the strategy calendar is the one owner in the SSS config, and a third
  row type accounts for open slots no pattern explains (generated by hand). No Calendar table.

## Constraints
- Synamate capture at `../syn-cal/` (outer folder, not git) contains real prospect PII. Never commit.
- Local preview only (`.env.local`, :5435 Postgres, `scripts/local-demo-serve.ps1` on :3011).
  `.env` is LIVE.
- Synamate login (shared Playwright profile) was refreshed by the owner on 12 Nov; it expires.

## Known issues
- App Guide screenshots for /bookings are stale: the copy describes the new calendar, the images
  still show the old grid. Needs a capture run (watch the `--only` trap: count the manifest after).
- The local preview DB was 2 migrations behind; applied via a temporary `prisma/tmp-local.prisma`
  with the local URL hardcoded, because the Prisma CLI reads `.env` (LIVE) and would ignore a
  shell `DATABASE_URL`.
- SSS appointments have no outcome (showed/no-show) field in B2.
- No staff-side "book a discovery call for this lead" action exists yet (only public `submitBooking`).
