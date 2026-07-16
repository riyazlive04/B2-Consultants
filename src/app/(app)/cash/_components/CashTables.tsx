"use client";

// Split out of cash/page.tsx (an async Server Component) for the same reason as
// funnel/_components/FunnelTables.tsx: Column.cell/value are functions, and functions can't be
// passed as props from a Server Component into DataTable ("use client") — Next.js throws at
// render time. Keeping the column definitions here, alongside DataTable, fixes it.

import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatInrMinor } from "@/lib/format";
import type { CashOverview } from "@/server/cash-metrics";

type ReceivableRow = CashOverview["receivables"]["rows"][number];

export function TopReceivablesTable({ rows }: { rows: ReceivableRow[] }) {
  const topRows = [...rows].sort((a, b) => b.balanceInr - a.balanceInr).slice(0, 10);
  const maxBalance = Math.max(1, ...topRows.map((r) => r.balanceInr));

  const columns: Column<ReceivableRow>[] = [
    { key: "student", header: "Student", cell: (r) => <span className="max-w-[140px] truncate font-medium">{r.studentName}</span>, value: (r) => r.studentName },
    {
      key: "balance", header: "Balance", align: "right",
      cell: (r) => (
        <span className="flex items-center justify-end gap-2">
          <span className="h-2 w-16 flex-none overflow-hidden rounded-full bg-surface-2 sm:w-24">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(r.balanceInr / maxBalance) * 100}%`, background: "var(--chart-1)" }}
            />
          </span>
          <span className="tnum">{formatInrMinor(r.balanceInr, { compact: true })}</span>
        </span>
      ),
      value: (r) => r.balanceInr,
    },
    { key: "nextDue", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"), value: (r) => (r.nextDueDate ? new Date(r.nextDueDate).getTime() : null) },
    {
      key: "status", header: "Status",
      cell: (r) => r.overdue ? <span className="font-medium text-risk">Overdue {r.daysOverdue}d</span> : <span className="text-muted">On schedule</span>,
      value: (r) => (r.overdue ? `Overdue ${r.daysOverdue}d` : "On schedule"),
    },
  ];

  return <DataTable rows={topRows} columns={columns} filterPlaceholder="Filter students…" emptyMessage="No pending balances 🎉" />;
}

export function ReceivablesTable({ rows }: { rows: ReceivableRow[] }) {
  const columns: Column<ReceivableRow>[] = [
    { key: "student", header: "Student", cell: (r) => r.studentName, value: (r) => r.studentName },
    { key: "balance", header: "Balance", align: "right", cell: (r) => formatInrMinor(r.balanceInr), value: (r) => r.balanceInr },
    { key: "nextDue", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"), value: (r) => (r.nextDueDate ? new Date(r.nextDueDate).getTime() : null) },
    {
      key: "status", header: "Status",
      cell: (r) => (r.overdue ? `Overdue ${r.daysOverdue}d` : "On schedule"),
      value: (r) => (r.overdue ? `Overdue ${r.daysOverdue}d` : "On schedule"),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowClassName={(r) => (r.overdue ? "bg-risk-soft" : undefined)}
      filterPlaceholder="Filter students…"
      emptyMessage="No pending balances 🎉"
    />
  );
}
