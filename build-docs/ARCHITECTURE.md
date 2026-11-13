# Architecture (scoped to work tracked in build-docs)

App-wide architecture is documented in `docs/` and `README`. This covers the Calendars module.

## Calendars module (planned)
```
AppointmentSlot ─┬─ BookingRequest ── Lead / OutreachJourney      (Discovery)
                 └─ SlotRelease (cancelled / no-show / postponed history)
SssSlot ──────────── OutreachJourney.sssAt ── Lead                (SSS)
        │
server/calendar-events.ts  getCalendarEvents(range, filters)  → CalEvent[]
        │
lib/calendar-event.ts (types, status + colour map) · lib/calendar-layout.ts (overlap packing)
        │
bookings/_components/calendar/*  (Week/Day/Month grid, Manage view, drawer, book modal)
        │ writes ONLY via
booking-actions.ts (setBookingStatus, setBookingConfirmed, rescheduleBooking*, setSlotBlocked,
                    + new bookDiscoveryForLead sharing submitBooking's core)
sss-actions.ts     (move/book/block/unblock)
```
- Boundaries: lib/* pure + client-safe; server/* `server-only`; UI never touches Prisma.
- Time: stored UTC; displayed IST ("GMT +05:30"); all day maths through `lib/dates`.
