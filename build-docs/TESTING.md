# Testing

- Unit: `npm test` (node:test via tsx, `src/**/__tests__/*.test.ts`). Test names prefixed with the
  feature + AC id, e.g. `calendar-core AC5: touching events do not overlap`.
- Typecheck: throwaway `tsconfig.check.json` (main tsconfig has dead `.next-*` includes).
- Lint: `npx next lint` must stay clean.
- Browser: local preview (:3011, local DB) via Playwright; never against live.

## Results
- 2026-11-13 **calendar-core**: `src/server/__tests__/calendar-core.test.ts` 15/15 (AC1-AC6 + edges:
  unassigned, sort, clip, late-cancel ghost dedupe, AA on every fill). Full suite had 1
  pre-existing failure: `guide-manual` house-style failure (en dash "Mon–Sat" in manual-admin /
  manual-sales), fixed in `43d1e77`; now 2349 pass, 0 fail (of 2350). tsc clean, lint clean.
