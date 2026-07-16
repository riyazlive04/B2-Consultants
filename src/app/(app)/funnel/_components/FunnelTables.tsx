"use client";

// The three DataTable instances on the Conversion Funnel page, split into their own Client
// Component. `funnel/page.tsx` is an async Server Component; `Column.cell`/`Column.value` are
// functions, and functions cannot be passed as props from a Server Component into a Client
// Component (DataTable is "use client") — Next.js throws at render/serialize time, a bug the
// Mobile & Tables migration introduced by defining these columns directly in page.tsx. Moving the
// column definitions in here (client-side) alongside DataTable fixes it; page.tsx now only passes
// plain, serializable data as props.

import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { LEAD_SOURCE_LABELS } from "@/lib/labels";
import type { FunnelOverview } from "@/server/funnel-metrics";

type Month = FunnelOverview["months"][number];
type AttributionRow = FunnelOverview["attribution"][number];
type SnapshotRow = FunnelOverview["recentSnapshots"][number];

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

export function FunnelMetricsTable({ months }: { months: Month[] }) {
  const metricRows: Array<{ label: string; value: (m: Month) => string }> = [
    { label: "Awareness → lead rate", value: (m) => formatPct(pct(m.leads, m.awareness)) },
    { label: "Lead → call rate", value: (m) => formatPct(pct(m.calls, m.leads)) },
    { label: "Call → proposal rate", value: (m) => formatPct(pct(m.proposals, m.calls)) },
    { label: "Proposal → enrollment rate", value: (m) => formatPct(pct(m.enrollTotal, m.proposals)) },
    { label: "Overall conversion rate", value: (m) => formatPct(pct(m.enrollTotal, m.leads)) },
    { label: "Solo enrollment %", value: (m) => formatPct(pct(m.enrollSolo, m.enrollTotal)) },
    { label: "Guided enrollment %", value: (m) => formatPct(pct(m.enrollGuided, m.enrollTotal)) },
    { label: "Elite enrollment %", value: (m) => formatPct(pct(m.enrollElite, m.enrollTotal)) },
    { label: "Ghosted Blueprint → call rate", value: (m) => formatPct(pct(m.gbCallsCompleted, m.ghostedDownloads)) },
    {
      label: "Revenue per lead",
      value: (m) => (m.leads > 0 ? formatInrMinor(m.revenueInr / m.leads, { compact: true }) : "-"),
    },
  ];

  // Transposed table: each row is a metric, each column a month. Kept non-sortable throughout
  // since this is a fixed side-by-side comparison grid, not a sortable list.
  const metricsColumns: Column<(typeof metricRows)[number]>[] = [
    {
      key: "metric", header: "Metric", sortable: false,
      cell: (row) => (
        <span className={row.label === "Overall conversion rate" ? "font-semibold" : ""}>
          {row.label}
          {row.label === "Overall conversion rate" && (
            <span
              tabIndex={0}
              aria-label="Enrollments ÷ leads captured in the month — how much of the top of the funnel becomes paying students."
              title="Enrollments ÷ leads captured in the month — how much of the top of the funnel becomes paying students."
              className="ml-1.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line bg-surface-2 text-caption leading-none text-muted"
            >
              i
            </span>
          )}
        </span>
      ),
    },
    ...months.slice().reverse().map((m, i) => ({
      key: m.key,
      header: `${m.label}${i === 0 ? " (now)" : ""}`,
      align: "right" as const,
      sortable: false,
      cell: (row: (typeof metricRows)[number]) => row.value(m),
    })),
  ];

  return <DataTable rows={metricRows} columns={metricsColumns} filterPlaceholder="Filter metrics…" />;
}

export function FunnelAttributionTable({ attribution }: { attribution: AttributionRow[] }) {
  const attributionColumns: Column<AttributionRow>[] = [
    { key: "source", header: "Source", sortable: false, cell: (a) => <span className="font-medium">{LEAD_SOURCE_LABELS[a.source] ?? a.source}</span> },
    { key: "leads", header: "Leads", align: "right", sortable: false, cell: (a) => a.leads },
    { key: "calls", header: "Calls done", align: "right", sortable: false, cell: (a) => a.callsCompleted },
    { key: "won", header: "Won", align: "right", sortable: false, cell: (a) => a.won },
    { key: "students", header: "Students", align: "right", sortable: false, cell: (a) => a.students },
    { key: "revenue", header: "Revenue", align: "right", sortable: false, cell: (a) => <span className="font-semibold">{formatInrMinor(a.revenueInr, { compact: true })}</span> },
    {
      key: "revenuePerLead", header: "Revenue / lead", align: "right", sortable: false,
      cell: (a) => (a.revenuePerLeadInr === null ? "-" : formatInrMinor(a.revenuePerLeadInr, { compact: true })),
    },
  ];

  return <DataTable rows={attribution} columns={attributionColumns} filterPlaceholder="Filter sources…" />;
}

export function FunnelSnapshotsTable({ snapshots }: { snapshots: SnapshotRow[] }) {
  const snapshotColumns: Column<SnapshotRow>[] = [
    { key: "week", header: "Week", sortable: false, cell: (s) => <a href={`/funnel?week=${s.weekStart.slice(0, 10)}`} className="text-accent hover:underline tnum">{formatDate(s.weekStart)}</a> },
    { key: "awareness", header: "Awareness", align: "right", sortable: false, cell: (s) => s.awarenessReach.toLocaleString("en-IN") },
    { key: "leads", header: "Leads", align: "right", sortable: false, cell: (s) => s.leadsCaptured },
    { key: "calls", header: "Calls", align: "right", sortable: false, cell: (s) => s.callsCompleted },
    { key: "proposals", header: "Proposals", align: "right", sortable: false, cell: (s) => s.proposalsSent },
    { key: "enrollments", header: "Enrollments", align: "right", sortable: false, cell: (s) => s.enrollments },
    { key: "gb", header: "GB downloads", align: "right", sortable: false, cell: (s) => s.ghostedDownloads },
    { key: "workshop", header: "Workshop", align: "right", sortable: false, cell: (s) => s.workshopAttendees },
    { key: "notes", header: "Notes", sortable: false, cell: (s) => <span className="max-w-64 truncate text-muted">{s.notes ?? ""}</span> },
  ];

  return <DataTable rows={snapshots} columns={snapshotColumns} filterPlaceholder="Filter weeks…" />;
}
