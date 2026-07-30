/**
 * What a payable's frequency actually MEANS (Error Log H5).
 *
 * The frequencies were a label with two different behaviours attached and no definition of
 * either: break-even divided by them, and the due date ignored them entirely. Set a payable to
 * MONTHLY and its "Next due" stayed on whatever date was typed in — three months later it still
 * read that date, in the past, forever. You picked monthly and nothing monthly happened.
 *
 * Both rules live here, pure, so they can be stated once and tested rather than re-derived.
 */

export type PayableFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONE_TIME";

/** Months between occurrences. ONE_TIME has no period — it never recurs. */
const PERIOD_MONTHS: Record<PayableFrequency, number | null> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
  ONE_TIME: null,
};

/**
 * A payable's contribution to the MONTHLY fixed-cost base that break-even is computed from.
 *
 * ONE_TIME contributes ZERO, deliberately. A one-off cost is not a standing commitment, and
 * folding it in would raise the break-even line for every future month on the strength of
 * something that happens once — quietly making the business look permanently less viable than
 * it is. It still appears in expenses; it just isn't part of the recurring base.
 */
export function monthlyEquivalentMinor(amountMinor: number | bigint, frequency: string): number {
  const months = PERIOD_MONTHS[frequency as PayableFrequency];
  if (!months) return 0;
  return Number(amountMinor) / months;
}

/**
 * The next real occurrence of a recurring payable, given the anchor date it was set up with.
 *
 * DERIVED, NOT STORED. Rolling the stored date forward on a schedule would mutate the founder's
 * data behind their back and destroy the anchor (the "due on the 15th" fact) the moment a month
 * was skipped. Computing it at read time keeps the stored row exactly as entered while the UI
 * shows the truth.
 *
 * Steps whole periods from the anchor until it lands on or after `today`, so it is correct
 * whether the anchor is one month or three years stale. Returns the anchor unchanged for
 * ONE_TIME (there is no next one) and for any date not yet reached.
 *
 * Day-of-month is preserved by construction, with one honest exception: a 31st anchor in a
 * 30-day month clamps to the last day of that month rather than spilling into the next one,
 * which is how a bank standing order behaves too.
 */
export function nextOccurrence(anchor: Date, frequency: string, today: Date): Date {
  const months = PERIOD_MONTHS[frequency as PayableFrequency];
  if (!months) return anchor;
  if (anchor >= today) return anchor;

  const day = anchor.getUTCDate();
  const anchorMonths = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth();
  const todayMonths = today.getUTCFullYear() * 12 + today.getUTCMonth();

  // How many whole periods have elapsed, then one more if this month's date has already gone.
  let steps = Math.max(0, Math.ceil((todayMonths - anchorMonths) / months));
  let candidate = buildDate(anchor, anchorMonths + steps * months, day);
  while (candidate < today) {
    steps += 1;
    candidate = buildDate(anchor, anchorMonths + steps * months, day);
  }
  return candidate;
}

/** Month index → a real date, clamping the day to the target month's length. */
function buildDate(anchor: Date, monthIndex: number, day: number): Date {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(day, lastDay), anchor.getUTCHours(), anchor.getUTCMinutes()),
  );
}

/** Whether this frequency recurs at all — the one-time branch several screens need. */
export function isRecurring(frequency: string): boolean {
  return PERIOD_MONTHS[frequency as PayableFrequency] !== null;
}
