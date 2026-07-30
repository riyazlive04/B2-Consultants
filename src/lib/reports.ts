/**
 * Shared shapes for the Reports workbench (BUILD_CHECKLIST §10 / PRODUCT_AUDIT §15).
 *
 * Isomorphic — same pattern as automation-types.ts and sections.ts: this catalogue is code truth
 * that the server query layer (reports-metrics.ts) and the client controls both read, so the two
 * can never drift.
 *
 * ── WHAT CHANGED, AND WHY ──────────────────────────────────────────────────────────────────────
 * v1 was "pick an object → group by a field → see a table". Three things made it answer questions
 * the founder wasn't asking:
 *
 *   1. **No period.** Every figure was all-time. A source that produced 200 leads in 2024 and
 *      none since outranked one producing 40 a month right now, and nothing on screen said so.
 *      A report without a period is a census, not a report.
 *   2. **No comparison.** "42 leads" is trivia. "42 leads, down 31% on the previous 30 days" is a
 *      decision. Every row now carries its own previous-period figure.
 *   3. **No visualisation.** Ranking 16 sources by eye down a table column takes seconds per
 *      read; a ranked bar takes one glance. §5.8 has specified the chart forms all along — the
 *      surface that most needed them was the one that had none.
 *
 * The tool stays deliberately small: object + group-by + measure + period, all URL-driven. The URL
 * *is* the saved report — which is why there is still no saved-report table.
 */

export type ReportObject = "contacts" | "opportunities" | "invoices";

export type GroupByField = { key: string; label: string };

export const REPORT_OBJECTS: readonly { key: ReportObject; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "opportunities", label: "Opportunities" },
  { key: "invoices", label: "Invoices" },
] as const;

/** Curated, not exhaustive — the group-by fields a founder would actually ask about, per object. */
export const GROUP_BY_FIELDS: Record<ReportObject, readonly GroupByField[]> = {
  contacts: [
    { key: "leadSource", label: "Lead source" },
    { key: "stage", label: "Stage" },
    { key: "assignedToId", label: "Assigned to" },
    { key: "createdMonth", label: "Created (month)" },
  ],
  opportunities: [
    { key: "source", label: "Source" },
    { key: "status", label: "Status" },
    { key: "stageId", label: "Stage" },
    { key: "assignedToId", label: "Assigned to" },
    { key: "createdMonth", label: "Created (month)" },
  ],
  invoices: [
    { key: "status", label: "Status" },
    { key: "kind", label: "Kind" },
    { key: "createdMonth", label: "Created (month)" },
  ],
};

/** Group-by fields that are TIME buckets. They sort chronologically and chart as a trend. */
export const TIME_GROUP_BYS = new Set(["createdMonth"]);

export function isTimeGroupBy(groupBy: string): boolean {
  return TIME_GROUP_BYS.has(groupBy);
}

// ───────────────────────────── measures ─────────────────────────────

/**
 * What the chart plots. The table always shows every available column — the measure only decides
 * which one gets the picture, because the same group-by answers a different question depending on
 * what you measure. "Opportunities by source" ranked by *count* tells you where volume comes from;
 * ranked by *value* tells you where money comes from; ranked by *win rate* tells you which source
 * is worth a salesperson's afternoon. Those are three different decisions off one grouping.
 */
export type ReportMeasure = "count" | "value" | "winRate";

export const MEASURES: Record<ReportObject, readonly { key: ReportMeasure; label: string }[]> = {
  // Lead carries no money field and no won/lost outcome of its own.
  contacts: [{ key: "count", label: "Count" }],
  opportunities: [
    { key: "count", label: "Count" },
    { key: "value", label: "Pipeline value" },
    { key: "winRate", label: "Win rate" },
  ],
  invoices: [
    { key: "count", label: "Count" },
    { key: "value", label: "Total amount" },
  ],
};

export function defaultMeasure(object: ReportObject): ReportMeasure {
  return MEASURES[object][0].key;
}

export function isValidMeasure(object: ReportObject, m: string | undefined): m is ReportMeasure {
  return !!m && MEASURES[object].some((x) => x.key === m);
}

export function measureLabel(object: ReportObject, m: ReportMeasure): string {
  return MEASURES[object].find((x) => x.key === m)?.label ?? m;
}

/**
 * Win rate is an average, not a total — summing it across groups is meaningless, so the share
 * column and the "total" row must both suppress themselves for it. Encoded here rather than
 * re-derived at each call site, because getting it wrong produces a confident nonsense number
 * (a "share of total win rate") rather than an error.
 */
export function measureIsAdditive(m: ReportMeasure): boolean {
  return m !== "winRate";
}

// ───────────────────────────── period ─────────────────────────────

/**
 * Period presets. No "custom range" picker on purpose: five presets cover every question this
 * business actually asks, and each one has a well-defined previous period to compare against.
 * An arbitrary custom range does not — "the previous period" for 17 Feb–3 Apr is a question with
 * no good answer, and guessing one silently is worse than not offering it.
 */
export type ReportRangeKey = "30d" | "90d" | "6m" | "12m" | "ytd" | "all";

export const RANGE_OPTIONS: readonly { value: ReportRangeKey; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All time" },
] as const;

export function parseReportRange(v: string | string[] | undefined): ReportRangeKey {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "30d" || s === "90d" || s === "6m" || s === "12m" || s === "ytd" || s === "all"
    ? s
    : "90d"; // 90 days: long enough for a lead to reach an enrolment, short enough that a
             // campaign retired last quarter isn't still dragging the median.
}

export type ResolvedRange = {
  key: ReportRangeKey;
  /** null on "all time" — the query then applies no lower bound. */
  from: Date | null;
  /** Exclusive upper bound. */
  to: Date;
  /** The immediately preceding window of equal length. null when there is nothing to compare. */
  previous: { from: Date; to: Date } | null;
  label: string;
  compareLabel: string;
};

/**
 * Resolve a preset to [from, to) plus the equal-length window before it.
 *
 * The comparison window is always the SAME LENGTH and IMMEDIATELY PRIOR, never "the same period
 * last year". With five months of real history, a year-ago comparison would be empty for every
 * row and every delta would read "new" — technically true, useless.
 *
 * `ref` is injected rather than read from the clock so this is testable.
 */
export function resolveReportRange(key: ReportRangeKey, ref: Date): ResolvedRange {
  const to = ref;
  const label = RANGE_OPTIONS.find((r) => r.value === key)?.label ?? key;

  if (key === "all") {
    return { key, from: null, to, previous: null, label: "All time", compareLabel: "" };
  }

  const from = new Date(to);
  if (key === "30d") from.setUTCDate(to.getUTCDate() - 30);
  else if (key === "90d") from.setUTCDate(to.getUTCDate() - 90);
  else if (key === "6m") from.setUTCMonth(to.getUTCMonth() - 6);
  else if (key === "12m") from.setUTCMonth(to.getUTCMonth() - 12);
  else from.setTime(Date.UTC(to.getUTCFullYear(), 0, 1)); // ytd

  const span = to.getTime() - from.getTime();
  const previous = { from: new Date(from.getTime() - span), to: from };

  return {
    key,
    from,
    to,
    previous,
    label: key === "ytd" ? "Year to date" : `Last ${label}`,
    compareLabel: key === "ytd" ? "vs the same span before Jan 1" : `vs previous ${label}`,
  };
}

// ───────────────────────────── chart selection ─────────────────────────────

/**
 * Which chart form fits this result — a data-shape decision, not a taste one (§5.8).
 *
 *   time buckets, ≤ 6   → **column**  discrete periods being compared; columns invite comparing
 *                                     heights, which is what "was March better than April" is.
 *   time buckets, > 6   → **line**    enough points that the shape of the trend is the message,
 *                                     and 14 columns is a picket fence.
 *   anything else       → **bars**    named categories with long labels, ranked. Never a pie:
 *                                     the question is "which is biggest", and angle comparison
 *                                     is the slowest read available.
 */
export type ChartShape = "line" | "column" | "bars";

export function chartShapeFor(groupBy: string, bucketCount: number): ChartShape {
  if (!isTimeGroupBy(groupBy)) return "bars";
  return bucketCount <= 6 ? "column" : "line";
}

// ───────────────────────────── result shapes ─────────────────────────────

/**
 * One group. Every measure is carried for BOTH windows, so the table can show all columns while
 * the chart plots one, and switching measure never needs another round trip.
 *
 * Money is `number` (minor units) rather than bigint because this crosses the server→client
 * boundary and BigInt is not JSON-serialisable — the same reason the rest of the app's metrics
 * modules narrow at the edge. Values here are paise; ₹1 crore is 10^9, far inside Number's exact
 * integer range.
 */
export type ReportRow = {
  /** Stable bucket id — a month string sorts chronologically, an enum/id sorts stably. */
  key: string;
  label: string;
  count: number;
  /** null when the object has no money field. */
  sumMinor: number | null;
  /** count(WON) / count(total) as 0-100, one decimal. Opportunities only; null elsewhere. */
  winRatePct: number | null;
  /** Same three, previous window. null when the range is "all time" (nothing to compare). */
  prevCount: number | null;
  prevSumMinor: number | null;
  prevWinRatePct: number | null;
  /** Deep link to the list behind this row, when one exists. A report you can't act on is trivia. */
  href?: string;
};

export type ReportResult = {
  rows: ReportRow[];
  totalCount: number;
  totalSumMinor: number | null;
  overallWinRatePct: number | null;
  prevTotalCount: number | null;
  prevTotalSumMinor: number | null;
  prevOverallWinRatePct: number | null;
  /** Chronological results are already ordered; categorical ones are ranked by the measure. */
  chronological: boolean;
};

/** Pull the selected measure out of a row — one place, so chart/table/CSV can never disagree. */
export function measureValue(row: ReportRow, m: ReportMeasure): number {
  if (m === "value") return row.sumMinor ?? 0;
  if (m === "winRate") return row.winRatePct ?? 0;
  return row.count;
}

export function measurePrevValue(row: ReportRow, m: ReportMeasure): number | null {
  if (m === "value") return row.prevSumMinor;
  if (m === "winRate") return row.prevWinRatePct;
  return row.prevCount;
}

// ───────────────────────────── validation ─────────────────────────────

export function isValidObject(v: string | undefined): v is ReportObject {
  return v === "contacts" || v === "opportunities" || v === "invoices";
}

export function defaultGroupBy(object: ReportObject): string {
  return GROUP_BY_FIELDS[object][0].key;
}

export function isValidGroupBy(object: ReportObject, groupBy: string | undefined): boolean {
  return !!groupBy && GROUP_BY_FIELDS[object].some((f) => f.key === groupBy);
}

export function objectLabel(object: ReportObject): string {
  return REPORT_OBJECTS.find((o) => o.key === object)?.label ?? object;
}

export function groupByLabel(object: ReportObject, groupBy: string): string {
  return GROUP_BY_FIELDS[object].find((f) => f.key === groupBy)?.label ?? groupBy;
}

/**
 * The whole report as URL params — the shareable identity of a saved report.
 * Centralised so a link built by the controls and one built by a chart drill-down agree.
 */
export function reportHref(params: {
  object: ReportObject;
  groupBy: string;
  measure: ReportMeasure;
  range: ReportRangeKey;
}): string {
  const q = new URLSearchParams({
    object: params.object,
    groupBy: params.groupBy,
    measure: params.measure,
    range: params.range,
  });
  return `/reports?${q.toString()}`;
}
