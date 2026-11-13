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
