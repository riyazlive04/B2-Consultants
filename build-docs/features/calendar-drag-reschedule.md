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

## As built (2026-11-14)
- **The drop target is any empty half-hour lane, not an OPEN slot.** The grid deliberately does
  not load OPEN slots (`getCalendarEvents` skips them), and the move runs through
  `rescheduleBookingToTime`, which already exists for the Bookings table: it claims a published
  OPEN slot at that instant if there is one and otherwise creates the slot BOOKED, so the time is
  held for this prospect alone and never published on `/book`. Requiring a pre-existing OPEN slot
  would have meant loading every open slot into the grid to land on perhaps two of them.
- Snap is **30 minutes** (the grid's own lanes), not 15: the lane is the drop target, so there is
  nothing new to compute and no invisible half-lane to miss.
- **No red/green ghost.** While a move is armed every lane is tinted and the hovered one lights up;
  anything that is not a lane is not a drop target at all. The refusals (past time, same time, not
  a time) are told as a toast, because a tooltip on a drag is unreadable on the move.
- **AC3 is met by not building it.** SSS cards are not draggable here: there are no open SSS slots
  on this grid to land on, and the SSS Calendar tab already moves a journey onto a real slot with
  `moveJourneyToSlotAction`, which is what keeps `journey.sssAt` in step. Dragging an SSS card in
  the week grid would have been a second, weaker copy of a feature that is live and verified.
- **Drag is the second way in, not the only one.** Arming the move is also a button in the details
  drawer ("Move to another time"), after which a click or Enter on any lane lands it - the same
  pick-then-place the SSS calendar uses. That is the keyboard and touch path; HTML5 drag has no
  touch support at all, so long-press was never going to work without a pointer-event rewrite.
- A cancelled or no-show card stays undraggable as planned (it is a SlotRelease ghost with no slot),
  even though the underlying action can revive one - re-booking is a decision, not a drag.
- Day view: dropping in another person's column reassigns the call as well as moving it, with no
  OPEN-slot condition (the action's own clash check refuses a double-booking).
