/**
 * Receivable ageing buckets (Error Log G1).
 *
 * WEEKS, NOT MONTHS. The old buckets were 1–30 / 31–60 / 61–90 / 90+ days, which is the
 * default shape for a business on 30/60/90-day terms. This one collects in at most a
 * fortnight, so in practice every overdue receivable fell into the first column and the chart
 * carried no information at all — a payment two days late and one three weeks late looked
 * identical, when the second is the one worth a phone call.
 *
 * The boundaries are inclusive-upper (`≤ 7` is week one), so a payment on its seventh day late
 * has not yet aged into the second bucket. Anything past 28 days is one open-ended bucket: the
 * distinction between five and nine weeks late does not change what anyone does about it.
 *
 * Pure and isomorphic — the chart, and any report that later needs the same grouping, must
 * agree on where the lines fall.
 */

export type AgeBucketKey = "w1" | "w2" | "w3" | "w4plus";

export type AgeBucket = {
  key: AgeBucketKey;
  label: string;
  /** Inclusive upper bound in days; null for the open-ended final bucket. */
  maxDays: number | null;
  color: string;
};

/**
 * Ordered least-to-most overdue, which is also the render order — the reader scans down into
 * worsening debt rather than having to hunt for the bad news.
 *
 * Colour escalates with age rather than using one accent for all four: the whole point of the
 * chart is that four weeks late is not the same problem as one week late.
 */
export const AGE_BUCKETS: readonly AgeBucket[] = [
  { key: "w1", label: "1 week late", maxDays: 7, color: "var(--chart-1)" },
  { key: "w2", label: "2 weeks late", maxDays: 14, color: "var(--warn)" },
  { key: "w3", label: "3 weeks late", maxDays: 21, color: "var(--warn)" },
  { key: "w4plus", label: "4+ weeks late", maxDays: null, color: "var(--bad)" },
] as const;

/**
 * Which bucket a receivable belongs in, given how many days past due it is.
 *
 * Callers are expected to have excluded anything not actually late; a non-positive value still
 * resolves to the first bucket rather than throwing, because a chart is not the place to
 * discover a bad input.
 */
export function bucketForDaysOverdue(daysOverdue: number): AgeBucketKey {
  for (const b of AGE_BUCKETS) {
    if (b.maxDays === null || daysOverdue <= b.maxDays) return b.key;
  }
  return "w4plus";
}

/** The bucket's presentation, for a key. */
export function ageBucket(key: AgeBucketKey): AgeBucket {
  return AGE_BUCKETS.find((b) => b.key === key) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1];
}
