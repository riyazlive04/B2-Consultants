# Testing

- Unit: `npm test` (node:test via tsx, `src/**/__tests__/*.test.ts`). Test names prefixed with the
  feature + AC id, e.g. `calendar-core AC5: touching events do not overlap`.
- Typecheck: throwaway `tsconfig.check.json` (main tsconfig has dead `.next-*` includes).
- Lint: `npx next lint` must stay clean.
- Browser: local preview (:3011, local DB) via Playwright; never against live.

## Results
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
