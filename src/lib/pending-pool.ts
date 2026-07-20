/**
 * Batch-opening logic (spec Part 2 §2).
 *
 * The founders' rule, in their words: "Numbers are assigned only to batches that can
 * realistically fill… If a workshop yields only one joiner, no batch is assigned yet (wait
 * for the next workshop to accumulate enough)." Hence the gaps in batch numbers — B23, B24,
 * B25 … B26 — which look like a bug in the sheet and are actually the policy working.
 *
 * Pure: candidates and config are passed in. No DB, no session.
 */

/** A joiner waiting for a seat. */
export type PoolJoiner = {
  id: string;
  level: string;
  preference: "WEEKDAY" | "WEEKEND" | "EITHER";
};

export type OpenBatchSuggestion = {
  level: string;
  /** The timetable this batch would run on. */
  slot: "WEEKDAY" | "WEEKEND";
  /** Joiners who could fill it, best-fit first. */
  joinerIds: string[];
  count: number;
  /** True when count clears minToOpen — i.e. this batch can realistically fill. */
  openable: boolean;
  reason: string;
};

/**
 * How many waiting joiners justify opening a batch.
 *
 * The spec is explicit that ONE is not enough and gives no other number. It is NOT the
 * class cap (8): waiting for 8 before opening anything would stall every batch, and the
 * founders plainly open batches that later fill. So this is a floor on viability, and it is
 * a parameter rather than a constant because only the founders can set it.
 */
export const DEFAULT_MIN_TO_OPEN = 2;

/**
 * Group the pool into batches worth opening.
 *
 * EITHER joiners are counted toward BOTH timetables while pending — they are genuinely
 * available for either — but each is offered to whichever slot is closest to opening, so one
 * person is never double-counted into two real batches.
 */
export function suggestBatchesToOpen(
  pool: PoolJoiner[],
  minToOpen: number = DEFAULT_MIN_TO_OPEN,
): OpenBatchSuggestion[] {
  const out: OpenBatchSuggestion[] = [];
  const levels = Array.from(new Set(pool.map((j) => j.level))).sort();

  for (const lvl of levels) {
    const atLevel = pool.filter((j) => j.level === lvl);
    const weekday = atLevel.filter((j) => j.preference === "WEEKDAY");
    const weekend = atLevel.filter((j) => j.preference === "WEEKEND");
    const either = atLevel.filter((j) => j.preference === "EITHER");

    // Give the flexible joiners to whichever fixed group is closer to viable — that is what
    // "assign numbers only to batches that can realistically fill" means in practice.
    const weekdayFirst = weekday.length >= weekend.length;
    const primary = weekdayFirst ? weekday : weekend;
    const secondary = weekdayFirst ? weekend : weekday;
    const primarySlot: "WEEKDAY" | "WEEKEND" = weekdayFirst ? "WEEKDAY" : "WEEKEND";
    const secondarySlot: "WEEKDAY" | "WEEKEND" = weekdayFirst ? "WEEKEND" : "WEEKDAY";

    // Top the primary group up to viability first.
    const needed = Math.max(0, minToOpen - primary.length);
    const toPrimary = either.slice(0, needed);
    let rest = either.slice(needed);

    // Only spin up the SECOND timetable if somebody actually needs it — i.e. someone asked
    // for it specifically. Handing leftover flexible joiners to an empty secondary would
    // split (say) three all-flexible people into a batch of two plus one stranded person,
    // when all three would happily sit in one batch. That is the precise opposite of
    // "assign numbers only to batches that can realistically fill".
    let toSecondary: PoolJoiner[] = [];
    if (secondary.length > 0) {
      const secondaryNeeded = Math.max(0, minToOpen - secondary.length);
      toSecondary = rest.slice(0, secondaryNeeded);
      rest = rest.slice(secondaryNeeded);
    }

    for (const [slot, group] of [
      // Anything still flexible after both groups are viable joins the primary batch rather
      // than waiting alone.
      [primarySlot, [...primary, ...toPrimary, ...rest]],
      [secondarySlot, [...secondary, ...toSecondary]],
    ] as const) {
      if (group.length === 0) continue;
      const openable = group.length >= minToOpen;
      out.push({
        level: lvl,
        slot,
        joinerIds: group.map((j) => j.id),
        count: group.length,
        openable,
        reason: openable
          ? `${group.length} waiting — can fill, open a batch.`
          : `${group.length} waiting — below ${minToOpen}, hold in the pool for the next workshop.`,
      });
    }
  }
  return out;
}
