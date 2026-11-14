# Testing

- Unit: `npm test` (node:test via tsx, `src/**/__tests__/*.test.ts`). Test names prefixed with the
  feature + AC id, e.g. `calendar-core AC5: touching events do not overlap`.
- Typecheck: throwaway `tsconfig.check.json` (main tsconfig has dead `.next-*` includes).
- Lint: `npx next lint` must stay clean.
- Browser: local preview (:3011, local DB) via Playwright; never against live.

## Results
- 2026-11-13 **calendar-settings**: `src/lib/__tests__/calendar-settings.test.ts` 5/5 (AC1 one row
  per pattern + the strategy row; the three distinct ways a calendar produces nothing; hand-made
  slots get their own row only when bookable; no SSS owner; an unassigned PATTERN is a calendar,
  not a missing owner). Browser on the local preview: 4 cards - Asma and Ameen "No availability"
  (the hourly top-up does not run locally), the unassigned pattern "Active" with 11 open ahead,
  and the strategy calendar owned by Ameen with none laid out. Group filter counts 3 / 1.
  AC2 is met in spirit, not to the letter: the ✎ opens Console → Availability, which is where a
  discovery pattern is edited - there is no per-owner scoping to open, since that panel lists the
  calendars themselves. AC3 (no "+ New calendar" for HEAD/USER) uses the same ADMIN flag as the
  rest of the page; checked by reading, not with a second login.
- 2026-11-13 **appointment-list-view**: `src/lib/__tests__/calendar-list.test.ts` 6/6 (AC1 upcoming
  order, AC2 both type lists, cancelled newest-first, All keeps the past, blocked time never
  listed, and a call running RIGHT NOW still counts as upcoming). Browser on the local preview:
  the tab shows 11 calls; Cancelled 3, All 11, Upcoming discovery 4, Upcoming strategy 0 with its
  empty state; AC3 setting Divya Nair to Confirmed from the list persisted across a reload and the
  grid card agreed; AC4 the Export CSV button is present for an Admin, and Booking requests keeps
  its own BANT / WhatsApp / export untouched.
  Found and fixed while testing: EventCard mixed `borderLeft` with `borderStyle`, logging a React
  warning on every re-render (feature 2 bug).
  Full suite 2383 pass / 0 fail, tsc + lint clean.
- 2026-11-13 **book-appointment-modal**: `src/lib/__tests__/calendar-book.test.ts` 4/4 (AC4 open-only
  blocking, empty range, end <= start incl. the equal case, junk times). Browser on the local
  preview: AC5 clicking the 2 PM lane on Sat prefilled that date and selected the 02:00 PM slot;
  AC1 booking Rohan Pillai into it created the call on the grid AND moved the lead to "strategy
  call booked" on the pipeline; the duplicate-booking guard refused a second call for him;
  AC4 blocking 12:00-14:00 reported "Blocked 1 slot", and a range holding only a booked call
  reported it kept its time and changed nothing.
  **AC3 (the refactor's real test)**: a full public /book submission still books - "You're booked
  in", card on the calendar, lead at "strategy call booked" with BANT scored at intake.
  AC2 (two people claiming one slot at once) is NOT exercised: it is the same `updateMany` status
  guard the public path uses, checked by reading, not by running two browsers.
  Full suite 2377 pass / 0 fail, tsc + lint clean.
- 2026-11-13 **appointment-drawer**: `src/lib/__tests__/appointment-drawer.test.ts` 3/3 (AC2 status
  mapping incl. Showed -> COMPLETED, AC4 which outcomes are confirmed first). Browser on the local
  preview: AC1 a card opens the drawer with time/owner/phone/email/meeting rows; AC2 "No show"
  asked first, then the card redrew as a no-show ghost with id `release:...`, i.e. a SlotRelease
  row exists; AC3 Esc closed it and focus returned to the card; blocked entry unblocked and left
  the grid (back to OPEN, which is hidden). Full suite 2373 pass / 0 fail, tsc + lint clean.
- 2026-11-13 **calendar-manage-view**: `src/lib/__tests__/calendar-filters.test.ts` 10/10
  (AC1-AC3 + unassigned token, junk params, short-URL choice). Browser: unticking a person drops
  their events and writes `?off=<one id>`; "Blocked" leaves only the two Busy entries; Clear all
  restores `?view=week&panel=1`. Full suite 2370 pass / 0 fail, tsc + lint clean.
  Found and fixed while testing: `?users=` meant both "unassigned only" and "nobody" (now `none`);
  one untick wrote 21 ids into the URL (now stored whichever way round is shorter); the panel
  covered Sat+Sun as an overlay (now a column beside the grid).
- 2026-11-13 **calendar-view**: `src/lib/__tests__/calendar-grid.test.ts` 10/10 (AC1-AC4 + IST day
  boundaries, midnight clipping, Monday-first weeks, month padding, leap day, px helpers).
  AC5-AC7 checked in the browser on the local preview (:3011, local Postgres, seeded demo calls):
  week/day/month render, overlap side-by-side, "+N more" lists all 4, cancelled hollow + struck,
  no-show hollow, blocked grey, OPEN slots absent, now-line, nav links keep `view`/`date`/`tab`,
  dark theme correct. Full suite 2360 pass / 0 fail. tsc clean, lint clean.
  Fixed on the way: 8 AM label clipped under the sticky header; the now-line drew a dot per column
  in Day view. Not yet done: App Guide screenshots are stale (copy updated, images not re-captured).
- 2026-11-13 **calendar-core**: `src/server/__tests__/calendar-core.test.ts` 15/15 (AC1-AC6 + edges:
  unassigned, sort, clip, late-cancel ghost dedupe, AA on every fill). Full suite had 1
  pre-existing failure: `guide-manual` house-style failure (en dash "Mon–Sat" in manual-admin /
  manual-sales), fixed in `43d1e77`; now 2349 pass, 0 fail (of 2350). tsc clean, lint clean.
- 2026-11-14 **calendar-drag-reschedule**: `src/lib/__tests__/calendar-move.test.ts` 4/4 (AC1 the
  action input a drop becomes incl. the call's own length and a Day-view owner change; AC2 past
  time / its own lane / a lane that is not a time; AC2+AC3 what is draggable at all). Browser on
  the local preview (:3011, local Postgres): dragged Rohan Pillai Sat 14 Nov 14:00 -> Sun 15 Nov
  10:00, confirmed, and again 10:00 -> 13:00 into ANOTHER person's Day column; drove the same move
  by keyboard alone for Meena Shah (card -> drawer -> "Move to another time" -> Tab to a lane ->
  Enter -> Enter). Verified in the database, not just on screen: the vacated 14:00 and 10:00 slots
  are OPEN with a POSTPONED SlotRelease each, the new slots are BOOKED, `confirmedAt` is null on
  both bookings (confirmation reset), and Meena's old 11:10 slot came back BLOCKED - correct, it
  was inside the minimum notice, which is `releasedSlotStatus`, not a drag bug. AC2: a drop on a
  past lane said "That time has already passed.", asked nothing and changed nothing (DB unchanged).
  Full suite 2392 pass / 0 fail (of 2393, 1 skipped), tsc + lint clean.
  Found and fixed while testing: every card was draggable, including blocked time and the cancelled
  ghosts, because TimeGrid passed `draggable` unconditionally (now `canMove(event)`); the armed-lane
  tint never rendered because `bg-primary-soft/40` generates nothing for a var-based token (now
  `bg-surface-2`); and EventCard's React shorthand warning was back - the earlier fix replaced
  `borderLeft` but left `borderStyle`, which is also a shorthand, and this card now re-renders on
  every arm/disarm (all four sides are long-hands now).
  Not covered: a touch device (HTML5 drag has no touch support, which is why the click path exists);
  a 15-minute snap (lanes are the drop target, so the snap is 30).
