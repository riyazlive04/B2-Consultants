/**
 * Revenue recognition - straight-line over the service period.
 *
 * THE PROBLEM: `Income.date` is the day money ARRIVED, and every margin number in this app is
 * computed off it. A 120-day Elite program collected up front therefore books 100% of its revenue
 * on day one, while 119 days of delivery obligation are still outstanding. Every margin figure
 * shown to a client is wrong - and wrong in the direction they notice at month four, when the
 * cash has stopped but the costs of serving those students have not.
 *
 * WHAT THIS DELIBERATELY IS NOT: a deferred-revenue engine. No schedule rows per period, no GL
 * postings, no revenue-recognition ledger account. Straight-line over the program duration is
 * enough to make the number defensible, and the double-entry ledger already has enough moving
 * parts. If the founders later need audited deferred revenue, this is the arithmetic it would be
 * built on - but building that now would be solving a problem nobody has yet.
 *
 * CASH IS NEVER REPLACED. Both numbers are true and they answer different questions ("what did we
 * collect" vs "what did we earn"). Substituting one for the other is the same mistake in the
 * opposite direction, so callers are expected to show both.
 *
 * Pure and dependency-free - this is the arithmetic that decides what a client is told, so it has
 * to be checkable without a database.
 */

const DAY_MS = 86_400_000;

/** A payment and the service period it buys. */
export type RecognisableAmount = {
  /** Integer minor units (paise or cents). Kept opaque - this file never converts currency. */
  amountMinor: number;
  /** First day of service. For a linked enrollment this is `enrollmentDate`. */
  startDate: Date;
  /**
   * Last day of service, INCLUSIVE. Null means there is no service period - a LIFETIME (Solo)
   * program, or an income with no enrollment to spread over. See `recognise` for what happens.
   */
  endDate: Date | null;
};

export type RecognitionWindow = {
  /** Inclusive. */
  from: Date;
  /** Inclusive. */
  to: Date;
};

export type RecognitionResult = {
  /** Earned within the window. */
  recognisedMinor: number;
  /** Earned before the window opened. */
  priorMinor: number;
  /** Still unearned at the END of the window - the deferred balance. */
  deferredMinor: number;
  /** Days of the service period that fall inside the window. */
  daysInWindow: number;
  /** Total days in the service period. 1 for an immediately-recognised amount. */
  totalDays: number;
  /**
   * True when the whole amount was taken at once because there is no service period to spread
   * it over. Surfaced so a report can say WHY a number looks like cash accounting.
   */
  immediate: boolean;
};

/** Whole days from `a` to `b` inclusive. Always ≥ 1. */
export function inclusiveDays(a: Date, b: Date): number {
  const days = Math.floor((utcMidnight(b) - utcMidnight(a)) / DAY_MS) + 1;
  return Math.max(1, days);
}

/** Strips the time component so a payment at 23:00 and one at 01:00 spread identically. */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Recognises one amount over one window.
 *
 * THE ROUNDING RULE: each day's share is `floor(amount * daysElapsed / totalDays)` computed on
 * the CUMULATIVE elapsed days, never by summing per-day shares. That guarantees the whole-life
 * total is exactly the amount with no drift - a per-day rounding would leave a few paise
 * unrecognised on a 120-day program, and "revenue that never gets earned" is precisely the kind
 * of residue that makes an accountant distrust the whole report.
 */
export function recognise(item: RecognisableAmount, window: RecognitionWindow): RecognitionResult {
  const { amountMinor, startDate, endDate } = item;

  // No service period: recognise in full on the start date.
  //
  // This is the honest answer for LIFETIME (Solo), which has no end date because there is no
  // ongoing obligation to spread across - inventing a notional 12-month period would be a
  // fabrication dressed as prudence. It is also the fallback for an income with no linked
  // enrollment, where we genuinely do not know what was bought.
  if (endDate === null) {
    const inWindow =
      utcMidnight(startDate) >= utcMidnight(window.from) &&
      utcMidnight(startDate) <= utcMidnight(window.to);
    const before = utcMidnight(startDate) < utcMidnight(window.from);
    return {
      recognisedMinor: inWindow ? amountMinor : 0,
      priorMinor: before ? amountMinor : 0,
      deferredMinor: utcMidnight(startDate) > utcMidnight(window.to) ? amountMinor : 0,
      daysInWindow: inWindow ? 1 : 0,
      totalDays: 1,
      immediate: true,
    };
  }

  const totalDays = inclusiveDays(startDate, endDate);

  // Cumulative earned by the end of a given day - the only place the division happens.
  const earnedBy = (day: Date): number => {
    const elapsed = Math.floor((utcMidnight(day) - utcMidnight(startDate)) / DAY_MS) + 1;
    if (elapsed <= 0) return 0;
    if (elapsed >= totalDays) return amountMinor;
    return Math.floor((amountMinor * elapsed) / totalDays);
  };

  // The day BEFORE the window opens, so `prior` and `recognised` partition cleanly.
  const dayBeforeWindow = new Date(utcMidnight(window.from) - DAY_MS);

  const priorMinor = earnedBy(dayBeforeWindow);
  const earnedByEnd = earnedBy(window.to);
  const recognisedMinor = earnedByEnd - priorMinor;

  // Overlap of [start, end] with [from, to], in days.
  const overlapFrom = Math.max(utcMidnight(startDate), utcMidnight(window.from));
  const overlapTo = Math.min(utcMidnight(endDate), utcMidnight(window.to));
  const daysInWindow = overlapTo >= overlapFrom ? Math.floor((overlapTo - overlapFrom) / DAY_MS) + 1 : 0;

  return {
    recognisedMinor,
    priorMinor,
    deferredMinor: amountMinor - earnedByEnd,
    daysInWindow,
    totalDays,
    immediate: false,
  };
}

export type RecognitionTotals = {
  /** Money that arrived in the window, regardless of when it is earned. */
  cashMinor: number;
  /** Earned in the window, regardless of when it arrived. */
  recognisedMinor: number;
  /** Unearned at the end of the window, across every item. */
  deferredMinor: number;
  /** How many items had no service period and so were taken in full. */
  immediateCount: number;
  itemCount: number;
};

/**
 * Totals a set of amounts over one window.
 *
 * `cashMinor` is included on purpose. A report that shows only recognised revenue invites exactly
 * the mirror-image error this file exists to fix - the founders' bank balance is real, and a
 * screen that never mentions it will be distrusted and then ignored.
 */
export function recogniseAll(
  items: RecognisableAmount[],
  window: RecognitionWindow,
): RecognitionTotals {
  let cashMinor = 0;
  let recognisedMinor = 0;
  let deferredMinor = 0;
  let immediateCount = 0;

  for (const item of items) {
    const r = recognise(item, window);
    recognisedMinor += r.recognisedMinor;
    deferredMinor += r.deferredMinor;
    if (r.immediate) immediateCount++;

    const paidOn = utcMidnight(item.startDate);
    if (paidOn >= utcMidnight(window.from) && paidOn <= utcMidnight(window.to)) {
      cashMinor += item.amountMinor;
    }
  }

  return { cashMinor, recognisedMinor, deferredMinor, immediateCount, itemCount: items.length };
}

/**
 * The program end date implied by a duration, when an enrollment has no explicit one.
 *
 * Mirrors `ProgramDuration`: 90 days for Guided, 120 for Elite, and null for LIFETIME - which is
 * what routes Solo into the immediate branch above. The end day is INCLUSIVE, so a 90-day program
 * starting on the 1st ends on day 90, not day 91.
 */
export function endDateForDuration(
  start: Date,
  duration: "DAYS_90" | "DAYS_120" | "LIFETIME",
): Date | null {
  if (duration === "LIFETIME") return null;
  const days = duration === "DAYS_90" ? 90 : 120;
  return new Date(utcMidnight(start) + (days - 1) * DAY_MS);
}
