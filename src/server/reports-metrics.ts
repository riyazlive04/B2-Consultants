import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { formatMonth } from "@/lib/format";
import { istMonthKeyOf, toDateInputValue } from "@/lib/dates";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS } from "@/lib/labels";
import {
  defaultGroupBy,
  isTimeGroupBy,
  isValidGroupBy,
  measureValue,
  type ReportMeasure,
  type ReportObject,
  type ReportResult,
  type ReportRow,
  type ResolvedRange,
} from "@/lib/reports";

/**
 * Query layer for the Reports workbench (BUILD_CHECKLIST §10).
 *
 * ── WHY IN-MEMORY AGGREGATION ─────────────────────────────────────────────────────────────────
 * Still a `findMany` with a narrow `select` rather than Prisma `groupBy`. `groupBy` can't label a
 * nullable foreign key (assignedToId → user name), can't bucket a timestamp by IST month, and
 * can't compute a win rate — and this app's tables are one founder's CRM, not a warehouse.
 *
 * ── WHY ONE QUERY FOR TWO WINDOWS ─────────────────────────────────────────────────────────────
 * The comparison period is fetched in the SAME query as the current one, spanning
 * [previous.from, to), and split in memory. Measured round-trip to Supabase is ~200ms and every
 * page here is `force-dynamic`, so a second query is not "one more query", it is a fifth of a
 * second of blank screen. One trip, two windows.
 *
 * ── WHY GAPS ARE FILLED ───────────────────────────────────────────────────────────────────────
 * A month with no records must appear as a zero, not be absent. The v1 code emitted only months
 * that had rows, so a line through them skipped the empty month entirely and drew an unbroken
 * trend across a gap that was, in fact, the story.
 */

// ───────────────────────────── labels ─────────────────────────────

/** Fallback for enums with no curated label map: "SENT_TO_WORKSHOP" → "Sent to workshop". */
function titleCaseEnum(v: string): string {
  const words = v.toLowerCase().split("_");
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

function monthLabel(key: string): string {
  // Mid-month so the IST↔UTC shift can never tip the label into a neighbouring month.
  const [y, m] = key.split("-").map(Number);
  return formatMonth(new Date(Date.UTC(y, m - 1, 15)));
}

/**
 * Every IST month touched by [from, to), inclusive of both ends.
 * This is what turns "months that had rows" into "months in the period".
 */
function monthKeysBetween(from: Date, to: Date): string[] {
  const startKey = istMonthKeyOf(from);
  const endKey = istMonthKeyOf(to);
  const [sy, sm] = startKey.split("-").map(Number);
  const [ey, em] = endKey.split("-").map(Number);
  const out: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); ) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    // Guard against a pathological range producing an unbounded array.
    if (out.length > 240) break;
  }
  return out;
}

// ───────────────────────────── aggregation ─────────────────────────────

type Bucket = { label: string; count: number; sumMinor: number; wonCount: number };

type Grouped = {
  /** key → bucket, current window */
  current: Map<string, Bucket>;
  /** key → bucket, previous window (empty when the range is "all time") */
  previous: Map<string, Bucket>;
};

type RowShape = {
  createdAt: Date;
  key: string;
  label: string;
  sumMinor: number;
  won: boolean;
};

function groupRows(rows: RowShape[], range: ResolvedRange): Grouped {
  const current = new Map<string, Bucket>();
  const previous = new Map<string, Bucket>();

  for (const r of rows) {
    const t = r.createdAt.getTime();
    const inCurrent = (range.from === null || t >= range.from.getTime()) && t < range.to.getTime();
    const inPrevious =
      range.previous !== null && t >= range.previous.from.getTime() && t < range.previous.to.getTime();
    const target = inCurrent ? current : inPrevious ? previous : null;
    if (!target) continue;

    const b = target.get(r.key) ?? { label: r.label, count: 0, sumMinor: 0, wonCount: 0 };
    b.count += 1;
    b.sumMinor += r.sumMinor;
    if (r.won) b.wonCount += 1;
    target.set(r.key, b);
  }

  return { current, previous };
}

const winRateOf = (b: Bucket | undefined): number | null =>
  b && b.count > 0 ? Math.round((b.wonCount / b.count) * 1000) / 10 : null;

/**
 * Turn the two bucket maps into display rows.
 *
 * Time group-bys get the full month sequence with zeros filled, ordered chronologically, and their
 * comparison aligned FROM THE END — the most recent month of this window against the most recent
 * month of the previous one. Aligning from the start would drift whenever the two windows span a
 * different number of calendar months (30 days can touch two months or three).
 */
function toResult(
  grouped: Grouped,
  opts: {
    groupBy: string;
    measure: ReportMeasure;
    range: ResolvedRange;
    includeSum: boolean;
    includeWinRate: boolean;
    hrefFor?: (key: string) => string | undefined;
  },
): ReportResult {
  const { current, previous } = grouped;
  const chronological = isTimeGroupBy(opts.groupBy);

  let keys: string[];
  let prevAligned: Map<string, Bucket | undefined>;

  if (chronological && opts.range.from) {
    keys = monthKeysBetween(opts.range.from, opts.range.to);
    const prevKeys = opts.range.previous
      ? monthKeysBetween(opts.range.previous.from, opts.range.previous.to)
      : [];
    prevAligned = new Map(
      keys.map((k, i) => {
        // Align from the end: index i counted back from the last bucket in each series.
        const offsetFromEnd = keys.length - 1 - i;
        const prevKey = prevKeys[prevKeys.length - 1 - offsetFromEnd];
        return [k, prevKey ? previous.get(prevKey) : undefined];
      }),
    );
  } else if (chronological) {
    // "All time" — no synthetic range to walk, so use the months that actually have rows.
    keys = Array.from(current.keys()).sort();
    prevAligned = new Map(keys.map((k) => [k, undefined]));
  } else {
    // Categorical: every group present in EITHER window, so a group that vanished this period
    // still appears (at zero) with its previous figure — a disappearance is a finding.
    keys = Array.from(new Set([...current.keys(), ...previous.keys()]));
    prevAligned = new Map(keys.map((k) => [k, previous.get(k)]));
  }

  let rows: ReportRow[] = keys.map((key) => {
    const c = current.get(key);
    const p = prevAligned.get(key);
    const label = c?.label ?? previous.get(key)?.label ?? (chronological ? monthLabel(key) : key);
    return {
      key,
      label: chronological ? monthLabel(key) : label,
      count: c?.count ?? 0,
      sumMinor: opts.includeSum ? (c?.sumMinor ?? 0) : null,
      winRatePct: opts.includeWinRate ? (winRateOf(c) ?? 0) : null,
      prevCount: opts.range.previous ? (p?.count ?? 0) : null,
      prevSumMinor: opts.range.previous && opts.includeSum ? (p?.sumMinor ?? 0) : null,
      prevWinRatePct: opts.range.previous && opts.includeWinRate ? (winRateOf(p) ?? 0) : null,
      href: opts.hrefFor?.(key),
    };
  });

  rows = chronological
    ? rows.sort((a, b) => a.key.localeCompare(b.key))
    : // Rank by the measure being charted, so the chart's bar order and the table's row order
      // are the same list. Two different orderings of the same numbers on one screen is the
      // fastest way to make a reader distrust both.
      rows.sort(
        (a, b) => measureValue(b, opts.measure) - measureValue(a, opts.measure) || a.label.localeCompare(b.label),
      );

  const sumOf = (m: Map<string, Bucket>, pick: (b: Bucket) => number) =>
    Array.from(m.values()).reduce((s, b) => s + pick(b), 0);

  const totalCount = sumOf(current, (b) => b.count);
  const totalWon = sumOf(current, (b) => b.wonCount);
  const prevTotalCount = sumOf(previous, (b) => b.count);
  const prevTotalWon = sumOf(previous, (b) => b.wonCount);
  const hasPrev = opts.range.previous !== null;

  return {
    rows,
    totalCount,
    totalSumMinor: opts.includeSum ? sumOf(current, (b) => b.sumMinor) : null,
    overallWinRatePct:
      opts.includeWinRate && totalCount > 0 ? Math.round((totalWon / totalCount) * 1000) / 10 : null,
    prevTotalCount: hasPrev ? prevTotalCount : null,
    prevTotalSumMinor: hasPrev && opts.includeSum ? sumOf(previous, (b) => b.sumMinor) : null,
    prevOverallWinRatePct:
      hasPrev && opts.includeWinRate && prevTotalCount > 0
        ? Math.round((prevTotalWon / prevTotalCount) * 1000) / 10
        : null,
    chronological,
  };
}

/** Lower bound for the single fetch: the start of the comparison window, or of the range itself. */
function fetchFrom(range: ResolvedRange): Date | null {
  return range.previous?.from ?? range.from;
}

function createdAtFilter(range: ResolvedRange) {
  const from = fetchFrom(range);
  return from ? { createdAt: { gte: from, lt: range.to } } : {};
}

/** `?from=&to=` for a drill-down link, so the destination list shows the same period. */
function rangeQuery(range: ResolvedRange): string {
  if (!range.from) return "";
  return `&from=${toDateInputValue(range.from)}&to=${toDateInputValue(range.to)}`;
}

// ───────────────────────────── per-object reports ─────────────────────────────

async function getContactsReport(
  groupBy: string,
  measure: ReportMeasure,
  range: ResolvedRange,
): Promise<ReportResult> {
  const leads = await prisma.lead.findMany({
    where: { ...ACTIVE, ...createdAtFilter(range) },
    select: {
      leadSource: true,
      stage: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      createdAt: true,
    },
  });

  const rows: RowShape[] = leads.map((l) => {
    const bucket = ((): { key: string; label: string } => {
      switch (groupBy) {
        case "stage":
          return { key: l.stage, label: LEAD_STAGE_LABELS[l.stage] ?? l.stage };
        case "assignedToId":
          return l.assignedToId
            ? { key: l.assignedToId, label: l.assignedTo?.name ?? "Unknown" }
            : { key: "__unassigned", label: "Unassigned" };
        case "createdMonth":
          return { key: istMonthKeyOf(l.createdAt), label: "" };
        case "leadSource":
        default:
          return { key: l.leadSource, label: LEAD_SOURCE_LABELS[l.leadSource] ?? l.leadSource };
      }
    })();
    // Lead carries no money field and no won/lost outcome of its own.
    return { createdAt: l.createdAt, key: bucket.key, label: bucket.label, sumMinor: 0, won: false };
  });

  // /contacts supports stage / source / owner / from / to as filters, so these rows drill through
  // to the exact list behind the number. Month rows don't: there is no month filter there, and a
  // link that silently drops the filter is worse than no link.
  const q = rangeQuery(range);
  const hrefFor = (key: string): string | undefined => {
    if (groupBy === "stage") return `/contacts?stage=${encodeURIComponent(key)}${q}`;
    if (groupBy === "leadSource") return `/contacts?source=${encodeURIComponent(key)}${q}`;
    if (groupBy === "assignedToId" && key !== "__unassigned")
      return `/contacts?owner=${encodeURIComponent(key)}${q}`;
    return undefined;
  };

  return toResult(groupRows(rows, range), {
    groupBy,
    measure,
    range,
    includeSum: false,
    includeWinRate: false,
    hrefFor,
  });
}

async function getOpportunitiesReport(
  groupBy: string,
  measure: ReportMeasure,
  range: ResolvedRange,
): Promise<ReportResult> {
  const opps = await prisma.opportunity.findMany({
    where: { deletedAt: null, lead: { deletedAt: null }, ...createdAtFilter(range) },
    select: {
      status: true,
      source: true,
      stageId: true,
      stage: { select: { name: true } },
      assignedToId: true,
      assignedTo: { select: { name: true } },
      valueInrMinor: true,
      createdAt: true,
    },
  });

  const rows: RowShape[] = opps.map((o) => {
    const bucket = ((): { key: string; label: string } => {
      switch (groupBy) {
        case "status":
          return { key: o.status, label: titleCaseEnum(o.status) };
        case "stageId":
          return { key: o.stageId, label: o.stage.name };
        case "assignedToId":
          return o.assignedToId
            ? { key: o.assignedToId, label: o.assignedTo?.name ?? "Unknown" }
            : { key: "__unassigned", label: "Unassigned" };
        case "createdMonth":
          return { key: istMonthKeyOf(o.createdAt), label: "" };
        case "source":
        default:
          return o.source
            ? { key: o.source, label: LEAD_SOURCE_LABELS[o.source] ?? o.source }
            : { key: "__none", label: "No source" };
      }
    })();
    return {
      createdAt: o.createdAt,
      key: bucket.key,
      label: bucket.label,
      // BigInt → Number at the edge: values are paise, so ₹1Cr is 1e9 — three orders of
      // magnitude inside Number's exact-integer range, and BigInt is not JSON-serialisable.
      sumMinor: Number(o.valueInrMinor),
      won: o.status === "WON",
    };
  });

  return toResult(groupRows(rows, range), {
    groupBy,
    measure,
    range,
    includeSum: true,
    includeWinRate: true,
    // The opportunities board filters by pipeline only — no stage/owner/source query params — so
    // there is no honest drill-down target yet.
    hrefFor: undefined,
  });
}

async function getInvoicesReport(
  groupBy: string,
  measure: ReportMeasure,
  range: ResolvedRange,
): Promise<ReportResult> {
  const invoices = await prisma.invoice.findMany({
    where: { ...ACTIVE, ...createdAtFilter(range) },
    select: { status: true, kind: true, createdAt: true, totalInrMinor: true },
  });

  const rows: RowShape[] = invoices.map((i) => {
    const bucket = ((): { key: string; label: string } => {
      switch (groupBy) {
        case "kind":
          return { key: i.kind, label: titleCaseEnum(i.kind) };
        case "createdMonth":
          return { key: istMonthKeyOf(i.createdAt), label: "" };
        case "status":
        default:
          return { key: i.status, label: titleCaseEnum(i.status) };
      }
    })();
    return {
      createdAt: i.createdAt,
      key: bucket.key,
      label: bucket.label,
      sumMinor: Number(i.totalInrMinor),
      won: false,
    };
  });

  return toResult(groupRows(rows, range), {
    groupBy,
    measure,
    range,
    includeSum: true,
    includeWinRate: false,
    hrefFor: undefined,
  });
}

// ───────────────────────────── entry point ─────────────────────────────

/**
 * The one entry point the page calls.
 *
 * `groupByRaw` comes straight off the URL, so it is validated against the object's curated field
 * list and silently falls back to that object's default rather than erroring on a stale or
 * hand-edited link — the resolved `groupBy` rides back so the page and URL reflect what was
 * actually rendered.
 *
 * `cache` is React's per-request dedupe, not a TTL: two components asking for the same report in
 * one render share one query. Nothing here is cached ACROSS requests on purpose — a report the
 * founder just filtered must not answer with a stale aggregate.
 */
export const getReport = cache(
  async (
    object: ReportObject,
    groupByRaw: string,
    measure: ReportMeasure,
    range: ResolvedRange,
  ): Promise<{ groupBy: string; result: ReportResult }> => {
    const groupBy = isValidGroupBy(object, groupByRaw) ? groupByRaw : defaultGroupBy(object);
    const result =
      object === "contacts"
        ? await getContactsReport(groupBy, measure, range)
        : object === "opportunities"
          ? await getOpportunitiesReport(groupBy, measure, range)
          : await getInvoicesReport(groupBy, measure, range);
    return { groupBy, result };
  },
);
