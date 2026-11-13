# Testing

- Unit: `npm test` (node:test via tsx, `src/**/__tests__/*.test.ts`). Test names prefixed with the
  feature + AC id, e.g. `calendar-core AC5: touching events do not overlap`.
- Typecheck: throwaway `tsconfig.check.json` (main tsconfig has dead `.next-*` includes).
- Lint: `npx next lint` must stay clean.
- Browser: local preview (:3011, local DB) via Playwright; never against live.

## Results
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
