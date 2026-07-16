"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { formatDate, formatInrMinor } from "@/lib/format";
import { PROGRAM_LEVEL_LABELS } from "@/lib/labels";
import type { CommissionReport, CommissionRow } from "@/server/commission-metrics";

/**
 * Commission (client notes): 5% when one person worked both calls, 3% each on a split.
 * Everything is derived from payments + lead attribution - nothing extra to enter.
 */
export function CommissionSection({ report }: { report: CommissionReport }) {
  const columns: Column<CommissionRow>[] = [
    { key: "date", header: "Payment date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    { key: "student", header: "Student", cell: (r) => r.studentName, value: (r) => r.studentName },
    {
      key: "level", header: "Program",
      cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel,
      value: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel,
    },
    {
      key: "amount", header: "Payment (₹ agg)",
      cell: (r) => <span className="tnum">{formatInrMinor(r.amountInrMinor, { compact: true })}</span>,
      value: (r) => r.amountInrMinor,
    },
    { key: "first", header: "First call", cell: (r) => r.firstCaller ?? "-", value: (r) => r.firstCaller ?? "" },
    { key: "disco", header: "Discovery call", cell: (r) => r.discoveryCaller ?? "-", value: (r) => r.discoveryCaller ?? "" },
    {
      key: "rule", header: "Rule",
      cell: (r) => (
        <span className={r.attributed ? "" : "text-watch"}>{r.rule}</span>
      ),
      value: (r) => r.rule,
    },
    {
      key: "payouts", header: "Commission",
      cell: (r) =>
        r.payouts.length ? (
          <span className="flex flex-wrap gap-1">
            {r.payouts.map((p) => (
              <span key={p.name} className="tnum whitespace-nowrap rounded-full bg-ok-soft px-2 py-0.5 text-caption font-semibold text-ok">
                {p.name} {formatInrMinor(p.amountInrMinor, { compact: true })} ({p.pct}%)
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted">-</span>
        ),
      value: (r) => r.payouts.map((p) => `${p.name} ${p.pct}%`).join(" + "),
    },
  ];

  return (
    <section className="space-y-4">
      <Card
        title="Commission - this month"
        actions={
          <span className="text-xs text-muted">
            One person on both calls = {report.rules.bothCallsPct}% · split calls = {report.rules.splitPct}% each
          </span>
        }
      >
        {report.totals.length === 0 ? (
          <p className="text-sm text-muted">
            No commissionable payments yet this month. A payment earns commission once it&apos;s
            linked to a student whose lead has a first-caller and a discovery outcome.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {report.totals.map((t) => (
              <div key={t.name} className="min-w-44 flex-1 rounded-field border border-line bg-surface-2 px-4 py-3 sm:flex-none">
                <p className="text-xs font-medium text-muted">{t.name}</p>
                <p className="mt-0.5 font-display text-2xl font-bold tracking-tight">
                  {formatInrMinor(t.amountInrMinor, { compact: true })}
                </p>
                <p className="text-xs text-muted">{t.deals} payment{t.deals === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        )}
        {report.unattributed > 0 && (
          <p className="mt-3 rounded-field bg-watch-soft px-3 py-2 text-xs font-medium text-watch">
            {report.unattributed} payment{report.unattributed === 1 ? "" : "s"} without call attribution -
            assign the lead a first-caller on Pipeline and make sure the discovery outcome is recorded.
          </p>
        )}
      </Card>

      <DataTable
        rows={report.rows}
        columns={columns}
        csvName={`commission-${report.month}`}
        filterPlaceholder="Filter payments…"
        emptyMessage="No student-linked payments this month."
      />
    </section>
  );
}
