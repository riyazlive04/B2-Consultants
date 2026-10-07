"use client";

// Split out of cash/page.tsx (an async Server Component) for the same reason as
// funnel/_components/FunnelTables.tsx: Column.cell/value are functions, and functions can't be
// passed as props from a Server Component into DataTable ("use client") - Next.js throws at
// render time. Keeping the column definitions here, alongside DataTable, fixes it.

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ReceivableDetailModal } from "@/components/finance/ReceivableDetailModal";
import { formatDate, formatInrMinor } from "@/lib/format";
import type { CashOverview } from "@/server/cash-metrics";

type ReceivableRow = CashOverview["receivables"]["rows"][number];

/**
 * The student cell, as the way INTO the receivable.
 *
 * Both tables named a person and an amount and then stopped - there was nothing to click, so
 * acting on an overdue balance meant leaving for the Finance page and finding the row again by
 * name. The same panel the age-analysis bars open (components/finance/ReceivableDetailModal)
 * carries the detail and the controls, so the two halves of this page behave alike.
 */
function StudentCell({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      title={name}
      className="inline-flex max-w-[180px] items-center gap-1 rounded-field text-left font-medium text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <span className="truncate">{name}</span>
      <ChevronRight size={13} className="flex-none text-muted" />
    </button>
  );
}

export function TopReceivablesTable({ rows }: { rows: ReceivableRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const topRows = [...rows].sort((a, b) => b.balanceInr - a.balanceInr).slice(0, 10);
  const maxBalance = Math.max(1, ...topRows.map((r) => r.balanceInr));

  const columns: Column<ReceivableRow>[] = [
    { key: "student", header: "Student", cell: (r) => <StudentCell name={r.studentName} onOpen={() => setOpenId(r.id)} />, value: (r) => r.studentName },
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

  return (
    <>
      <DataTable rows={topRows} columns={columns} filterPlaceholder="Filter students…" emptyMessage="No pending balances 🎉" />
      <ReceivableDetailModal planId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

export function ReceivablesTable({ rows }: { rows: ReceivableRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: Column<ReceivableRow>[] = [
    { key: "student", header: "Student", cell: (r) => <StudentCell name={r.studentName} onOpen={() => setOpenId(r.id)} />, value: (r) => r.studentName },
    { key: "balance", header: "Balance", align: "right", cell: (r) => formatInrMinor(r.balanceInr), value: (r) => r.balanceInr },
    { key: "nextDue", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"), value: (r) => (r.nextDueDate ? new Date(r.nextDueDate).getTime() : null) },
    {
      key: "status", header: "Status",
      cell: (r) => (r.overdue ? `Overdue ${r.daysOverdue}d` : "On schedule"),
      value: (r) => (r.overdue ? `Overdue ${r.daysOverdue}d` : "On schedule"),
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowClassName={(r) => (r.overdue ? "bg-risk-soft" : undefined)}
        filterPlaceholder="Filter students…"
        // The one Cash Health tab with no export at all (issue 23) - and the one whose list people
        // most want in a spreadsheet, because chasing receivables happens off-screen.
        csvName="receivables"
        emptyMessage="No pending balances 🎉"
      />
      <ReceivableDetailModal planId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
