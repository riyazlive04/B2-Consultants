# Feature 4: Appointment details drawer

## Purpose
Synamate's "View details" side drawer: everything about one appointment, plus its status, without leaving the calendar.

## Architecture
- Right drawer ~450px over a dimmed page. Header: "View details" + ✎ Edit · ⋮ · 🗑 Delete · ✕.
- Body (icon rows, captured order): type pill "Appointment" · title · Appointment time
  (+ "Rescheduled" chip) · Contact name (link → `/contacts/<leadId>`) · Phone · Email ·
  Appointment owner · Meeting location ("Join Meeting" button + Zoom URL + copy) · Calendar ·
  Attendees · Booked by · Source ("Booking widget" / "Staff") · Description.
- Footer: **Status** select. Discovery → Confirmed/Showed/No show/Cancelled → `setBookingStatus` /
  `setBookingConfirmed`. SSS → Confirmed/Unconfirmed (decision 4).
- Synamate's right icon rail (contact, notes, payments, conversations) → B2: Contact, BANT answers
  (existing `BookingDetail` content), WhatsApp thread. Reuse `BookingDetail.tsx`, don't copy it.
- ✎ Edit / Reschedule → reuses `RescheduleDialog` (discovery) / slot picker + `moveJourneyToSlotAction` (SSS).
- 🗑 Delete = Cancel (B2 never hard-deletes bookings; confirm dialog says so).
- Blocked entry → drawer shows owner, time, "Unblock" (`setSlotBlocked` / `unblockSssSlotAction`).

## Impact map
- `booking-actions.ts` `setBookingStatus`, `setBookingConfirmed`, `rescheduleBooking*`;
  `sss-actions.ts` move/unblock. **Called, not changed.** Cancel still triggers SlotRelease +
  promote-next + WhatsApp exactly as today.
- `logActivity` already inside those actions.

## Edge cases
- Status change fails (stale slot, permissions) → toast with server message, select reverts.
- Booking changed by someone else while open → action returns error → drawer re-fetches.
- No Zoom link → location row shows "No meeting link yet".
- USER opening a booking they don't own → server rejects (existing check).

## Acceptance criteria
- AC1 Clicking a card opens the drawer with the fields above for that booking.
- AC2 Setting "No show" calls `setBookingStatus(id,"NO_SHOW")`; card turns hollow/struck after refresh;
  a SlotRelease row exists.
- AC3 Esc and ✕ close; focus returns to the card.
- AC4 Delete asks for confirmation and cancels, never hard-deletes.

## As built (2026-11-13)
- `Modal` gained a `side` variant (full-height right panel) rather than a second dialog
  component - scroll lock, Esc, focus trap and focus return are already correct there.
- Body rows as built: status pill + call type, title, date + IST range, owner, phone, email,
  Zoom join link ("No meeting link yet" when Zoom made none), and Open in pipeline.
  **Not built:** attendees, booked-by, source and description (no field or no screen behind them),
  the "Rescheduled" chip, and the right icon rail.
- **Edit / Reschedule from the drawer was deferred**, not cut: `RescheduleDialog` is driven by the
  Bookings table's own row shape, and a second caller for it belongs with feature 5 (Book /
  Blocked-off-time modal), which needs the same slot picker.
- A released call (`source.table === "release"`) has no booking left to set, so the drawer is
  read-only and points at the Booking requests tab.
- AC4 is met by the status select's Cancelled, which asks first and releases the slot - there is
  no delete control, because B2 never hard-deletes a booking.
