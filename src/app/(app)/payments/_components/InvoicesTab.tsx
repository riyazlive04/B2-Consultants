"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Receipt, Filter } from "lucide-react";
import type { InvoiceRow } from "@/server/payments-metrics";
import type { Tone } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { EmptyState, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";

function statusTone(s: string): Tone {
  if (s === "PAID" || s === "ACCEPTED") return "good";
  if (s === "OVERDUE" || s === "DECLINED") return "bad";
  if (s === "SENT" || s === "PARTIAL") return "warn";
  return "neutral";
}

/** Parse a formatted money string (₹1,00,000.99) into a number for sorting. */
function amountValue(s: string): number {
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function InvoicesTab({ rows, kind }: { rows: InvoiceRow[]; kind: "INVOICE" | "ESTIMATE" }) {
  const noun = kind === "ESTIMATE" ? "estimate" : "invoice";
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))).sort(), [rows]);

  // Text search + per-column sort + pagination are now DataTable's job; only the
  // status filter (categorical, not a DataTable feature) still pre-filters here.
  const filtered = useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter],
  );

  const columns: Column<InvoiceRow>[] = [
    { key: "number", header: "Number", cell: (r) => <Link href={`/payments/${r.id}`} className="font-mono text-sm font-semibold text-ink hover:text-primary">{r.number}</Link>, value: (r) => r.number },
    { key: "customer", header: "Customer", cell: (r) => r.customerName, value: (r) => r.customerName },
    { key: "status", header: "Status", cell: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill>, value: (r) => r.status },
    { key: "total", header: "Total", align: "right", cell: (r) => <span className="font-medium text-ink">{r.totalDisplay}</span>, value: (r) => amountValue(r.totalDisplay) },
    { key: "balance", header: "Balance", align: "right", cell: (r) => r.balanceDisplay, value: (r) => amountValue(r.balanceDisplay) },
    { key: "issued", header: "Issued", align: "right", cell: (r) => <DateText date={r.issueDate} />, value: (r) => r.issueDate.getTime() },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar: Filters · Sort · Search · New */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${showFilters || statusFilter ? "border-primary-tint bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2"}`}
        >
          <Filter size={14} /> Filters{statusFilter ? " · 1" : ""}
        </button>
        <div className="flex-1" />
        <Link href={`/payments/new?kind=${kind}`}>
          <Btn size="sm" icon={<Plus size={15} />}>New {noun}</Btn>
        </Link>
      </div>

      {/* Status filter chips (behind Filters) */}
      {showFilters && statuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2.5">
          <span className="text-caption font-semibold uppercase text-ink-3">Status</span>
          <button onClick={() => setStatusFilter(null)} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === null ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>All</button>
          {statuses.map((s) => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${statusFilter === s ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<Receipt size={20} />} title={`No ${noun}s yet`} body={`Create your first ${noun}.`} action={<Link href={`/payments/new?kind=${kind}`}><Btn icon={<Plus size={16} />}>New {noun}</Btn></Link>} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          csvName={kind === "ESTIMATE" ? "estimates" : "invoices"}
          filterPlaceholder={`Search ${noun} number, customer, status…`}
          emptyMessage={`No ${noun}s match. Try a different search or status filter.`}
        />
      )}
    </div>
  );
}
