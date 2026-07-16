/**
 * Shared shapes for the Reports pivot tool (BUILD_CHECKLIST §10 / PRODUCT_AUDIT §15 "Reporting
 * & Analytics"). Isomorphic — same pattern as automation-types.ts and sections.ts: the object /
 * group-by catalogue is code truth that both the server query layer (reports-metrics.ts) and the
 * client picker (_components/ReportControls.tsx) read from, so the two can never drift.
 *
 * This is deliberately a minimal "pick an object → group-by → aggregate" tool, not a general
 * report builder: it closes the audit's "every number lives on a hardcoded page" gap without new
 * schema, by making object + group-by + aggregate URL-driven instead of engineer-driven.
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
  ],
  invoices: [
    { key: "status", label: "Status" },
    { key: "kind", label: "Kind" },
    { key: "createdMonth", label: "Created (month)" },
  ],
};

/** Every result row: a group label, a count, and (where the object has a money field) a sum. */
export type ReportRow = {
  /** stable bucket id — a month string sorts chronologically, an enum/id sorts stably */
  key: string;
  label: string;
  count: number;
  /** formatted for display (₹ …), null when this object has no money field */
  sumInr: string | null;
  /** raw minor-unit value backing sumInr, for numeric table sorting; null with sumInr */
  sumMinor: number | null;
  /** count(status=WON) / count(total) as a 0-100 percentage, one decimal — opportunities only */
  winRatePct: number | null;
};

export type ReportResult = {
  rows: ReportRow[];
  totalCount: number;
  totalSumInr: string | null;
  /** overall win rate across every row, same rule as ReportRow.winRatePct */
  overallWinRatePct: number | null;
};

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
