/**
 * Batch - pure rules for the unified cohort model (ER v2 Track A).
 *
 * NO prisma, NO server-only: the German Note panel, the Students batches tab and the seat
 * dialog all import from here. DB reads live in `src/server/batches.ts`, writes in
 * `src/server/batch-actions.ts`.
 *
 * Background: `Batch` was `GnBatch`. Decision D1 was "unify" - German Note already ran two
 * batch worlds (real rows for the LMS, free-text labels on workshop conversions), and a
 * separate B2 coaching batch would have made three. `line` is what keeps the one table honest.
 */

import type { BatchLine, LevelKind } from "@prisma/client";

export const BATCH_LINE_LABELS: Record<BatchLine, string> = {
  B2: "B2 Coaching",
  GERMAN_NOTE: "German Note",
};

/**
 * Which business line a level belongs to.
 *
 * Returns null for OTHER, which is genuinely ambiguous - the founders use it for one-off
 * products that belong to neither line. A null here means "don't enforce", not "reject":
 * refusing to seat an OTHER-level student anywhere would be a worse failure than allowing it.
 */
export function lineForLevelKind(kind: LevelKind): BatchLine | null {
  switch (kind) {
    case "COACHING_TIER":
      return "B2";
    case "GERMAN_LEVEL":
    case "GERMAN_BUNDLE":
      return "GERMAN_NOTE";
    case "OTHER":
      return null;
  }
}

/**
 * May a student on `levelKind` be seated in a batch on `line`?
 *
 * The rule the one-table design has to carry: without it, "unify the batch tables" would
 * silently mean "a coaching client can be seated in an A1 German cohort".
 */
export function levelFitsBatchLine(levelKind: LevelKind, line: BatchLine): boolean {
  const expected = lineForLevelKind(levelKind);
  return expected === null || expected === line;
}

export type CapacityBand = "empty" | "filling" | "full" | "over";

/**
 * How full a batch is, as a band rather than a boolean.
 *
 * `over` is deliberately NOT an error state. The founders overfill batches on purpose when a
 * ninth person turns up and the next cohort is a month away - a hard block would send them
 * back to a spreadsheet. The seat action warns and asks for confirmation; it does not refuse.
 */
export function capacityBand(filled: number, target: number): CapacityBand {
  if (filled <= 0) return "empty";
  if (target <= 0) return "filling"; // no target set → nothing to be full against
  if (filled > target) return "over";
  if (filled >= target) return "full";
  return "filling";
}

export function capacityLabel(filled: number, target: number): string {
  const band = capacityBand(filled, target);
  if (target <= 0) return `${filled} seated`;
  return band === "over"
    ? `${filled} / ${target} - over capacity`
    : `${filled} / ${target}`;
}

/**
 * Normalise the founders' batch label ("b26", " B 26 ") to the stored shape ("B26").
 *
 * `Batch.code` is UNIQUE, and these labels arrive typed by hand into workshop workbooks. Two
 * spellings of the same cohort would produce two batches and split its roster - which is the
 * exact failure the free-text `batchA1`/`batchA2`/`batchB1` columns already caused.
 * Returns "" when nothing usable is left, so callers can reject rather than store junk.
 */
export function normalizeBatchCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 24);
}

/**
 * The day-N of a batch a given date falls on, 1-based, or null when the batch has no start.
 *
 * Used by the milestone radar (Track I) to ask "is this cohort past day 45 yet".
 * Both dates are floored to UTC midnight first: the caller passes real timestamps, and a
 * class at 09:00 versus 21:00 must not shift which day of the programme it counts as.
 */
export function batchDayNumber(startDate: Date | null, on: Date): number | null {
  if (!startDate) return null;
  const MS_PER_DAY = 86_400_000;
  const floor = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.floor((floor(on) - floor(startDate)) / MS_PER_DAY);
  return days < 0 ? null : days + 1;
}
