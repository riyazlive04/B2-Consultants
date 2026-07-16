import "server-only";

import { prisma } from "@/lib/prisma";
import { formatInrMinor, formatMonth } from "@/lib/format";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS } from "@/lib/labels";
import {
  defaultGroupBy,
  isValidGroupBy,
  type ReportObject,
  type ReportResult,
  type ReportRow,
} from "@/lib/reports";

/**
 * Query layer for the Reports pivot tool (BUILD_CHECKLIST §10). Deliberately fetches the curated
 * columns for every row of the chosen object and aggregates in memory, rather than leaning on
 * Prisma's `groupBy`: `groupBy` can't label a nullable foreign key (assignedToId → user name,
 * stageId → stage name) or bucket a timestamp by month, and this app's tables are the size of one
 * founder's CRM, not a data warehouse — a single findMany with a narrow `select` is simpler,
 * correct, and fast enough. Every number here traces back to the same models the hardcoded pages
 * already query; this just lets a group-by be a URL parameter instead of a new page.
 */

// ── enum → label ──

/** Fallback for enums with no curated label map (OpportunityStatus, InvoiceStatus, InvoiceKind):
 *  "PARTIAL" → "Partial", "SENT_TO_WORKSHOP" → "Sent to workshop". */
function titleCaseEnum(v: string): string {
  const words = v.toLowerCase().split("_");
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Year-month bucket in IST (Asia/Kolkata) — matches formatMonth's timezone so the bucket a
 *  record lands in always agrees with the label shown for it. */
const monthKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Asia/Kolkata",
});

function monthBucket(d: Date): { key: string; label: string } {
  const parts = monthKeyFormatter.formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return { key: `${year}-${month}`, label: formatMonth(d) };
}

// ── generic bucket/aggregate helpers ──

type Accumulator = { label: string; count: number; sumMinor: bigint; wonCount: number };

function bucket<T>(
  items: T[],
  keyOf: (item: T) => { key: string; label: string },
  sumOf: ((item: T) => bigint) | null,
  wonOf: ((item: T) => boolean) | null,
): Map<string, Accumulator> {
  const map = new Map<string, Accumulator>();
  for (const item of items) {
    const { key, label } = keyOf(item);
    const g = map.get(key) ?? { label, count: 0, sumMinor: BigInt(0), wonCount: 0 };
    g.count += 1;
    if (sumOf) g.sumMinor += sumOf(item);
    if (wonOf?.(item)) g.wonCount += 1;
    map.set(key, g);
  }
  return map;
}

function toReportResult(
  map: Map<string, Accumulator>,
  totalCount: number,
  opts: { includeSum: boolean; includeWinRate: boolean; chronological: boolean },
): ReportResult {
  let rows: ReportRow[] = Array.from(map.entries()).map(([key, g]) => ({
    key,
    label: g.label,
    count: g.count,
    sumInr: opts.includeSum ? formatInrMinor(g.sumMinor) : null,
    sumMinor: opts.includeSum ? Number(g.sumMinor) : null,
    winRatePct: opts.includeWinRate && g.count > 0 ? Math.round((g.wonCount / g.count) * 1000) / 10 : null,
  }));

  rows = opts.chronological
    ? rows.sort((a, b) => a.key.localeCompare(b.key))
    : rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  let totalSumMinor = BigInt(0);
  let totalWon = 0;
  for (const g of map.values()) {
    totalSumMinor += g.sumMinor;
    totalWon += g.wonCount;
  }

  return {
    rows,
    totalCount,
    totalSumInr: opts.includeSum ? formatInrMinor(totalSumMinor) : null,
    overallWinRatePct: opts.includeWinRate && totalCount > 0 ? Math.round((totalWon / totalCount) * 1000) / 10 : null,
  };
}

// ── per-object reports ──

async function getContactsReport(groupBy: string): Promise<ReportResult> {
  const leads = await prisma.lead.findMany({
    select: {
      leadSource: true,
      stage: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      createdAt: true,
    },
  });

  const keyOf = (l: (typeof leads)[number]): { key: string; label: string } => {
    switch (groupBy) {
      case "stage":
        return { key: l.stage, label: LEAD_STAGE_LABELS[l.stage] ?? l.stage };
      case "assignedToId":
        return l.assignedToId
          ? { key: l.assignedToId, label: l.assignedTo?.name ?? "Unknown" }
          : { key: "__unassigned", label: "Unassigned" };
      case "createdMonth":
        return monthBucket(l.createdAt);
      case "leadSource":
      default:
        return { key: l.leadSource, label: LEAD_SOURCE_LABELS[l.leadSource] ?? l.leadSource };
    }
  };

  // Contacts (Lead) carries no money field, so there's nothing to sum or win-rate here.
  const grouped = bucket(leads, keyOf, null, null);
  return toReportResult(grouped, leads.length, {
    includeSum: false,
    includeWinRate: false,
    chronological: groupBy === "createdMonth",
  });
}

async function getOpportunitiesReport(groupBy: string): Promise<ReportResult> {
  const opps = await prisma.opportunity.findMany({
    select: {
      status: true,
      source: true,
      stageId: true,
      stage: { select: { name: true } },
      assignedToId: true,
      assignedTo: { select: { name: true } },
      valueInrMinor: true,
    },
  });

  const keyOf = (o: (typeof opps)[number]): { key: string; label: string } => {
    switch (groupBy) {
      case "status":
        return { key: o.status, label: titleCaseEnum(o.status) };
      case "stageId":
        return { key: o.stageId, label: o.stage.name };
      case "assignedToId":
        return o.assignedToId
          ? { key: o.assignedToId, label: o.assignedTo?.name ?? "Unknown" }
          : { key: "__unassigned", label: "Unassigned" };
      case "source":
      default:
        return o.source
          ? { key: o.source, label: LEAD_SOURCE_LABELS[o.source] ?? o.source }
          : { key: "__none", label: "No source" };
    }
  };

  // This is the audit's example use case verbatim: group opportunities by [field], see count,
  // pipeline value, and win rate = count(WON) / count(total) per group.
  const grouped = bucket(
    opps,
    keyOf,
    (o) => o.valueInrMinor,
    (o) => o.status === "WON",
  );
  return toReportResult(grouped, opps.length, { includeSum: true, includeWinRate: true, chronological: false });
}

async function getInvoicesReport(groupBy: string): Promise<ReportResult> {
  const invoices = await prisma.invoice.findMany({
    select: { status: true, kind: true, createdAt: true, totalInrMinor: true },
  });

  const keyOf = (i: (typeof invoices)[number]): { key: string; label: string } => {
    switch (groupBy) {
      case "kind":
        return { key: i.kind, label: titleCaseEnum(i.kind) };
      case "createdMonth":
        return monthBucket(i.createdAt);
      case "status":
      default:
        return { key: i.status, label: titleCaseEnum(i.status) };
    }
  };

  const grouped = bucket(invoices, keyOf, (i) => i.totalInrMinor, null);
  return toReportResult(grouped, invoices.length, {
    includeSum: true,
    includeWinRate: false,
    chronological: groupBy === "createdMonth",
  });
}

/**
 * The one entry point the page calls. `groupByRaw` comes straight off the URL (?groupBy=…), so it
 * is validated against the chosen object's curated field list and silently falls back to that
 * object's default rather than erroring on a stale/hand-edited link — the resolved `groupBy` rides
 * back so the page/URL can reflect what was actually rendered.
 */
export async function getReport(
  object: ReportObject,
  groupByRaw: string,
): Promise<{ groupBy: string; result: ReportResult }> {
  const groupBy = isValidGroupBy(object, groupByRaw) ? groupByRaw : defaultGroupBy(object);
  const result =
    object === "contacts"
      ? await getContactsReport(groupBy)
      : object === "opportunities"
        ? await getOpportunitiesReport(groupBy)
        : await getInvoicesReport(groupBy);
  return { groupBy, result };
}
