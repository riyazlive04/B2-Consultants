/**
 * Attribution — campaign economics (ER v2 Track F).
 *
 * `INSIGHT` in the diagram is an entity with a `performance "high|low"` column. It is NOT a
 * table here, and deliberately so: every field of it is a division over rows that already
 * exist. Storing it would be a cached quotient that goes stale the moment a lead converts.
 * This module is that division, kept pure so the numbers are testable without a database.
 *
 * All money is INR paise (BigInt in, number out at the ratio boundary — a ratio is not money).
 */

export type SourceTotals = {
  sourceId: string;
  channel: string;
  campaign: string;
  spendInrMinor: bigint;
  leads: number;
  bookings: number;
  enrolments: number;
  revenueInrMinor: bigint;
};

export type SourceEconomics = SourceTotals & {
  /** Cost per lead, paise. Null when nothing was spent — not 0, which would read as "free". */
  cplInrMinor: number | null;
  /** Cost per acquisition, paise. Null when there is no spend OR no enrolment yet. */
  cacInrMinor: number | null;
  /** Revenue ÷ spend. Null without spend — dividing by zero is not "infinite ROAS". */
  roas: number | null;
  /** Leads → enrolments, 0–100. */
  conversionPct: number;
};

const divide = (num: bigint, den: number): number | null =>
  den <= 0 ? null : Math.round(Number(num) / den);

/**
 * Per-source economics.
 *
 * Every ratio returns NULL rather than 0 or Infinity when its denominator is missing. A
 * campaign with no spend yet is not a campaign with a ₹0 cost per lead — rendering it as 0
 * would sort it to the top of a "cheapest acquisition" table and get the budget moved onto a
 * campaign that has simply not been paid for yet.
 */
export function economicsFor(t: SourceTotals): SourceEconomics {
  const spend = Number(t.spendInrMinor);
  return {
    ...t,
    cplInrMinor: spend > 0 ? divide(t.spendInrMinor, t.leads) : null,
    cacInrMinor: spend > 0 ? divide(t.spendInrMinor, t.enrolments) : null,
    roas: spend > 0 ? Math.round((Number(t.revenueInrMinor) / spend) * 100) / 100 : null,
    conversionPct: t.leads > 0 ? Math.round((t.enrolments / t.leads) * 1000) / 10 : 0,
  };
}

export type Performance = "high" | "low" | "mid" | "unrated";

/**
 * The diagram's `INSIGHT.performance`, banded against the PERIOD'S OWN MEDIAN rather than a
 * magic constant.
 *
 * A fixed "ROAS > 3 is good" threshold is wrong the first month the market moves, and nobody
 * remembers to re-tune it. Comparing each campaign to the median of the campaigns actually
 * running answers the question the founders are really asking — "where should the next rupee
 * go" — and stays correct as the baseline shifts.
 *
 * Sources with no spend are `unrated`, not `low`: they have no evidence either way, and
 * calling them low would bury an organic channel that costs nothing and converts fine.
 */
export function bandByMedian(rows: SourceEconomics[]): Map<string, Performance> {
  const rated = rows.filter((r) => r.roas !== null);
  const out = new Map<string, Performance>();
  for (const r of rows) out.set(r.sourceId, "unrated");
  if (rated.length === 0) return out;

  const sorted = [...rated].map((r) => r.roas!).sort((a, b) => a - b);
  const median = medianOf(sorted);

  for (const r of rated) {
    // A single running campaign is its own median; calling it "mid" is the honest answer,
    // where "high" or "low" would imply a comparison that was never made.
    if (rated.length === 1) out.set(r.sourceId, "mid");
    else if (r.roas! > median) out.set(r.sourceId, "high");
    else if (r.roas! < median) out.set(r.sourceId, "low");
    else out.set(r.sourceId, "mid");
  }
  return out;
}

/** Median of a PRE-SORTED ascending list. Even lengths take the mean of the middle pair. */
export function medianOf(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

export const PERFORMANCE_LABELS: Record<Performance, string> = {
  high: "Above median",
  low: "Below median",
  mid: "At median",
  unrated: "No spend recorded",
};
