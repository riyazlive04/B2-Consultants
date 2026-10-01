/**
 * When the remaining instalments of a plan fall due.
 *
 * Typing four dates by hand for every plan is how a schedule ends up half-filled, and a due date
 * nobody wrote down raises no reminder - the whole receivable quietly stops being chased. So the
 * form offers to fill them, on one of the two rules a plan is actually agreed on.
 *
 * Pure and UTC-only: these are calendar dates (`@db.Date`), never instants, so there is no zone to
 * get wrong. Dates in, dates out, as `YYYY-MM-DD`.
 */

/** The two ways a plan is written down. */
export type DueDateScheme =
  /** The 1st of each following month - how a plan phrased "monthly" is nearly always meant. */
  | "MONTH_FIRST"
  /** Exactly 30 days apart, counting from the first payment. */
  | "DAYS_30";

export const DUE_DATE_SCHEME_LABELS: Record<DueDateScheme, string> = {
  MONTH_FIRST: "1st of each month",
  DAYS_30: "Every 30 days",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(iso: string): Date | null {
  if (!ISO.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const toIso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The `n`th due date after `anchor` (n starts at 1), or "" when the anchor is unusable.
 *
 * MONTH_FIRST deliberately counts from the month the anchor falls in, so a payment taken on the
 * 1st still schedules the next one a clear month later rather than the same day. DAYS_30 is plain
 * addition - 30 days, not "a month", which is what makes it different from the other rule in
 * February.
 */
export function dueDateFor(scheme: DueDateScheme, anchorIso: string, n: number): string {
  const anchor = parseIso(anchorIso);
  if (!anchor || n < 1) return "";
  if (scheme === "DAYS_30") {
    const d = new Date(anchor.getTime());
    d.setUTCDate(d.getUTCDate() + 30 * n);
    return toIso(d);
  }
  // The 1st, n months on. Day-of-month is forced to 1, so there is no month-end clamping to do
  // and no 31 Jan -> 3 Mar overflow.
  return toIso(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + n, 1)));
}

/**
 * Every remaining due date for a plan of `count` instalments whose first was paid on `anchorIso`.
 *
 * `count - 1` dates, because the instalment being recorded right now is the first one. A plan of
 * one instalment is a full payment with extra steps and schedules nothing.
 */
export function dueDateSeries(scheme: DueDateScheme, anchorIso: string, count: number): string[] {
  const remaining = Math.floor(count) - 1;
  if (!Number.isFinite(remaining) || remaining < 1) return [];
  return Array.from({ length: remaining }, (_, i) => dueDateFor(scheme, anchorIso, i + 1));
}
