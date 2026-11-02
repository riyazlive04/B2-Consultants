/**
 * By-level breakdowns - the one rule for "which rows does this card show?".
 *
 * NO prisma, NO server-only: the pages that render these breakdowns are server components and
 * client components in roughly equal measure. The catalogue reader lives in `server/levels.ts`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 * Levels stopped being the `ProgramLevel` enum and became rows in the `Level` table, so the
 * founders can add a tier from the dashboard (docs/CONFIGURABLE_LEVELS_PLAN.md). The enrolment
 * forms and the validation followed; the METRICS did not. Eleven screens still named Solo,
 * Guided and Elite in source, and what each one did with a fourth tier differed:
 *
 *   - Pipeline's "Wins" headline added three buckets and dropped the rest, so a win at a new
 *     tier was not merely unnamed - it was not counted.
 *   - Students' popups listed three rows under a card that counted everyone, so the rows did
 *     not sum to the figure above them.
 *   - The tracker table printed `level === "GUIDED" ? "Guided" : "Elite"`, which labels a C1
 *     student "Elite".
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────────────────────
 * A breakdown's rows SUM TO ITS CARD. That is the whole point of the helper, and it is what the
 * tests assert. It follows from two decisions:
 *
 *   1. Every ACTIVE level of the kinds this screen covers gets a row, even at zero - so the
 *      breakdown reads as the product catalogue and "Solo 0" is a fact, not an omission.
 *   2. Any OTHER code the data actually carries also gets a row. A retired level, a level from
 *      the other half of the business, a historical enum value, or no level at all: all of them
 *      are real rows in the database and all of them are shown rather than silently dropped.
 */

import type { LevelKind } from "@prisma/client";
import type { LevelSummary } from "./levels";

/** A by-level tally, keyed by `Level.code`. The empty string is "no level recorded". */
export type LevelTally = Record<string, number>;

export type LevelBreakdownRow = { key: string; label: string };

/** What a row with no level on it is called. A won lead can genuinely have no level. */
export const NO_LEVEL_LABEL = "Not recorded";

/**
 * The one deliberate rollup: every German level and bundle is ONE row on a B2 P&L.
 *
 * It is not a level code, which is why it is spelled out here rather than guessed at - the
 * finance screen and `finance-metrics` must agree on it, and no `Level.code` may collide with
 * it (`normalizeLevelCode` would have to produce exactly this string, which a German level's
 * code never does: they are administered as GERMAN_LEVEL/GERMAN_BUNDLE kinds).
 */
export const GERMAN_NOTE_BUCKET = "__GERMAN_NOTE__";

/** Add one to `code`'s bucket. A null/blank code tallies under "" - never dropped. */
export function tally(t: LevelTally, code: string | null | undefined): void {
  const key = code?.trim() ?? "";
  t[key] = (t[key] ?? 0) + 1;
}

/**
 * The rows a by-level card should show, in catalogue order.
 *
 * @param present  the codes the data actually carries a value for - the CALLER decides what
 *                 "carries a value" means, because the value may be a count or a money pair.
 * @param levels   the whole catalogue, as `getActiveLevels()` or `getAllLevels()` returns it.
 * @param kinds    which half of the catalogue this screen is about (`B2_LEVEL_KINDS`, …).
 */
export function levelBreakdownRows(
  present: Iterable<string>,
  levels: LevelSummary[],
  kinds: LevelKind[],
): LevelBreakdownRow[] {
  const shown = levels
    .filter((l) => l.active && kinds.includes(l.kind))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((l) => ({ key: l.code, label: l.label }));

  const seen = new Set(shown.map((r) => r.key));
  const labels = new Map(levels.map((l) => [l.code, l.label]));
  // Deliberately NOT sorted: extras follow the catalogue rows in the order the data offers
  // them, which keeps "Not recorded" and retired tiers at the end where they read as a tail.
  for (const code of present) {
    const key = code?.trim() ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    shown.push({ key, label: key === "" ? NO_LEVEL_LABEL : labels.get(key) ?? key });
  }
  return shown;
}

/** `levelBreakdownRows` over a numeric tally: extras appear only when they carry a count. */
export function levelTallyRows(
  t: LevelTally,
  levels: LevelSummary[],
  kinds: LevelKind[],
): { key: string; label: string; value: number }[] {
  const present = Object.entries(t).filter(([, v]) => v > 0).map(([k]) => k);
  return levelBreakdownRows(present, levels, kinds).map((r) => ({ ...r, value: t[r.key] ?? 0 }));
}

/** The total a tally's rows must sum to. Used by the cards, and by the tests that pin them. */
export function levelTallyTotal(t: LevelTally): number {
  return Object.values(t).reduce((sum, v) => sum + v, 0);
}
