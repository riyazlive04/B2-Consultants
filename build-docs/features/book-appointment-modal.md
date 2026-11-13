# Feature 5: Book appointment / Blocked off time modal

## Purpose
Synamate's "+ New" / click-empty-slot modal: staff book a call for a contact, or block time off.

## Architecture
- Modal ~960px, 2 tabs. **Appointment** (two columns):
  - Left: Calendar select · Appointment title (prefilled "<calendar> between {{contact}} and
    <owner>") · Add description · Team member (Calendar default) · Date & time box: tz
    "GMT+05:30 Asia/Kolkata (IST)", Date picker + **Slot select = OPEN slots of that calendar on
    that date** · Meeting location (Calendar default / Custom).
  - Right: **Select contact\*** (search name/email/phone over Leads) · Internal notes.
  - Footer: Status (Confirmed / Unconfirmed) · Cancel · **Book appointment**.
  - Synamate's "Custom" time (outside slots) is **not** offered: B2 bookings must sit in a slot.
- **Blocked off time**: intro copy · User/Calendar · Title · Start/End datetime → blocks every
  OPEN slot of that owner in the range (`setSlotBlocked` / `blockSssSlotAction` per slot).
  Booked slots in the range are listed and **left booked** (Synamate: "Existing appointments will
  still remain"). Whole-day SSS block keeps using `blockSssDayAction` (it auto-reschedules).
- **New server action** `bookDiscoveryForLead(leadId, slotId, opts)` in `booking-actions.ts`:
  extracts the shared core of `submitBooking` (slot claim with race guard, BookingRequest create,
  OutreachJourney link, lead link) into one internal function both call. SSS uses existing
  `bookJourneyIntoSlotAction` (creates journey link if missing? → check before building).

## Impact map
- `submitBooking` refactor: **public /book path must behave identically**. Its tests + a manual
  /book submission are part of this feature's regression.
- Automation `BOOKING_CREATED` trigger, WhatsApp booking confirmation, Zoom reconciler: fire from
  the shared core so staff bookings behave like widget bookings (confirm in impact check).
- BANT: staff booking has no form answers → `bantSource` unchanged (never scored as zero).

## Edge cases
- Slot taken between open and submit → "That time was just booked" + slot list refresh.
- Lead already has an active booking → warn and offer Reschedule instead of a second booking.
- Lead with no phone → allowed (staff), but WhatsApp confirmation skipped and said so.
- Block range with end ≤ start → inline validation. Range > 31 days → refused.
- Double-click submit → button disabled while pending.

## Acceptance criteria
- AC1 Booking a lead into an OPEN discovery slot creates one BookingRequest linked to lead,
  slot BOOKED, journey linked; appears on grid.
- AC2 Concurrent second booking of that slot fails cleanly.
- AC3 /book public submission still passes its existing tests unchanged.
- AC4 Blocking 2–4 PM blocks only OPEN slots in range and reports the booked ones left alone.
- AC5 Clicking an empty 10:00 lane on Thu prefills date Thu and selects the 10:00 slot if open.

## As built (2026-11-13)
- **The refactor the plan asked for was narrowed, deliberately.** `bookDiscoveryForLead` does NOT
  share `submitBooking`'s core: the rate limits, consent record, BANT scoring and auto-disqualify
  branch all exist because a stranger is filling in a form, and none of them is true of a member
  of staff booking a known lead. The two genuinely shared parts were extracted instead -
  `linkLeadToBooking` and `afterBookingCommitted` - so the board move, the journey link, the
  automation trigger, Zoom and the WhatsApp confirmation cannot drift apart.
- **Not built** (no field or no screen behind them): appointment title, description, internal
  notes, meeting-location choice, attendees. Booking an SSS from here is also out - it needs an
  OutreachJourney, which is Outreach's to create.
- Blocking takes one date and a time range rather than two datetimes; a whole day is 00:00-23:59.
- Clicks are delegated: every half-hour lane carries `data-lane="<day>:<minutes>"` and the New
  button `data-new-entry`, both read by `CalendarHost` - the same listener that opens the drawer.
