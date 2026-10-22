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

/**
 * ── WHICH COHORT IS RUNNING, WHICH IS NEXT ───────────────────────────────────────────
 *
 * Added for the agreement form, where "Batch" used to be a free-text box: the founder typed
 * "Batch 12" into a contract while the app already knew the real cohorts by name. A chooser
 * needs to say which of them is running today and which one starts next, and that question is
 * pure arithmetic on two nullable dates - so it lives here with the rest of the batch rules.
 *
 * UNDATED is its own case and not folded into RUNNING. Every batch on the live database has a
 * null `startDate` (the German Note cohorts predate the ER-v2 column), so a classifier that
 * guessed "running" for them would describe twenty batches as in-progress without evidence.
 * They are still offered - they are the real cohorts - just not described as something they
 * may not be.
 */
export type BatchTiming = "UPCOMING" | "RUNNING" | "UNDATED" | "FINISHED";

export const BATCH_TIMING_LABELS: Record<BatchTiming, string> = {
  UPCOMING: "Starts soon",
  RUNNING: "Running now",
  UNDATED: "No start date",
  FINISHED: "Finished",
};

/** Floor to the calendar day: `startDate`/`endDate` are `@db.Date`, so time of day is noise. */
const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Where a batch sits relative to `on` (pass the caller's "today" rather than reading the clock,
 * which is what makes this testable).
 *
 * A batch with no `endDate` that has started is RUNNING and stays RUNNING - open-ended is how
 * the founders actually run a cohort, and inventing a length to expire it by would be a guess.
 */
export function batchTiming(
  b: { startDate: Date | null; endDate: Date | null },
  on: Date,
): BatchTiming {
  if (!b.startDate) return "UNDATED";
  const today = dayOf(on);
  if (dayOf(b.startDate) > today) return "UPCOMING";
  if (b.endDate && dayOf(b.endDate) < today) return "FINISHED";
  return "RUNNING";
}

/** One batch as a chooser needs it - the only fields the offer rules below read. */
export type BatchChoice = {
  id: string;
  /** The founders' label for this cohort - what a contract would name. */
  label: string;
  level: string;
  timing: BatchTiming;
  /** `yyyy-mm-dd`, already serialized: these cross to a client component and feed a date input. */
  startDate: string | null;
  filled: number;
  targetStrength: number;
};

const TIMING_RANK: Record<BatchTiming, number> = {
  UPCOMING: 0,
  RUNNING: 1,
  UNDATED: 2,
  FINISHED: 3,
};

/**
 * The order a chooser offers batches in: what starts next, then what is running, then the
 * undated ones, then anything already over.
 *
 * "Next" first rather than "running" first on purpose - someone signing today joins the cohort
 * that has not started yet far more often than one already half-way through.
 */
export function compareBatchChoices(a: BatchChoice, b: BatchChoice): number {
  const rank = TIMING_RANK[a.timing] - TIMING_RANK[b.timing];
  if (rank !== 0) return rank;
  if (a.timing === "UPCOMING") {
    // Soonest first: the next intake is the useful one.
    return (a.startDate ?? "").localeCompare(b.startDate ?? "");
  }
  if (a.timing === "RUNNING" || a.timing === "FINISHED") {
    // Most recent first - the one that started last is the one still taking joiners.
    return (b.startDate ?? "").localeCompare(a.startDate ?? "");
  }
  // Undated: newest label first. The codes count up ("B07" … "B28"), so a descending string
  // compare puts the current cohort at the top, which is the only signal these rows carry.
  return b.label.localeCompare(a.label);
}

/**
 * Which batch to OPEN the form on - a suggestion, never a decision.
 *
 * Priority, in the order a human would reason:
 *   1. the batch this person is already seated in. A fact, so it wins even if that cohort is
 *      full or finished: the contract must name where they actually are.
 *   2. the first batch in offer order that still has room AND matches their programme level.
 *   3. the first batch in offer order that still has room, whatever its level.
 *
 * Full and over-capacity batches are skipped from 2 and 3 - `capacityBand` exists because the
 * founders overfill on purpose, but a DEFAULT should never do that on their behalf. A finished
 * cohort is skipped for the same reason. Returns null when nothing qualifies, and the form then
 * simply asks.
 */
// Generic in the row type, so a caller that passes richer rows gets its own type back rather
// than the bare `BatchChoice` this file reasons about.
export function defaultBatchChoice<T extends BatchChoice>(
  choices: T[],
  opts: { seatedId?: string | null; preferLevel?: string | null } = {},
): T | null {
  if (opts.seatedId) {
    const seated = choices.find((c) => c.id === opts.seatedId);
    if (seated) return seated;
  }
  const open = choices
    .filter((c) => c.timing !== "FINISHED")
    .filter((c) => {
      const band = capacityBand(c.filled, c.targetStrength);
      return band !== "full" && band !== "over";
    })
    .sort(compareBatchChoices);
  if (opts.preferLevel) {
    const onLevel = open.find((c) => c.level === opts.preferLevel);
    if (onLevel) return onLevel;
  }
  return open[0] ?? null;
}
