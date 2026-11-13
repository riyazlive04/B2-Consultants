# Feature 8: Drag to reschedule (Week / Day)

## Purpose
Synamate events are draggable. Dragging a card to another time moves the appointment.

## Architecture
- Pointer drag on APPOINTMENT cards (not cancelled, not blocked) in Week/Day; snaps to 15 min.
- Drop target must be an **OPEN slot of the same calendar starting at that time**; ghost shows
  green when valid, red otherwise. Keyboard alternative = drawer's Reschedule (feature 4).
- Confirm popover "Move <name> to Thu 10:00?" → Discovery `rescheduleBooking(bookingId, slotId)`;
  SSS `moveJourneyToSlotAction(journeyId, slotId)`. Both already reset confirmation + send WhatsApp.
- Day view drag across owner columns = change owner only if target owner has an OPEN slot there.
- No resize (B2 durations are fixed per slot).

## Impact map
- The two reschedule actions + their WhatsApp sends (called, unchanged).
- Same-instant slot pool rule (`lib/slot-pool.ts`): only one slot per instant is bookable.

## Edge cases
- Drop on past time → refused. Drop on own slot → no-op. Network fail → card snaps back + toast.
- Touch devices: long-press to start, else page scroll wins.

## Acceptance criteria
- AC1 Valid drop moves the booking; old slot OPEN, new slot BOOKED; confirmation reset.
- AC2 Invalid drop changes nothing in the DB.
- AC3 Moving an SSS keeps `journey.sssAt` equal to the new slot's `startsAt`.
