"use client";

// Split out of ledger/page.tsx (an async Server Component) for the same reason as
// funnel/_components/FunnelTables.tsx and cash/_components/CashTables.tsx: Column.cell/value are
// functions, and functions can't be passed as props from a Server Component into DataTable
// ("use client") — Next.js throws at render time.

import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill } from "@/components/ui/kit";
import { formatInrMinor } from "@/lib/format";
import type { TrialBalanceRow } from "@/server/ledger";

export function TrialBalanceTable({ rows }: { rows: TrialBalanceRow[] }) {
  const columns: Column<TrialBalanceRow>[] = [
    { key: "code", header: "Code", cell: (r) => <span className="tnum text-muted">{r.code}</span>, value: (r) => r.code },
    { key: "account", header: "Account", cell: (r) => <span className="font-medium text-ink">{r.name}</span>, value: (r) => r.name },
    { key: "type", header: "Type", cell: (r) => <Pill tone="neutral">{r.type.toLowerCase()}</Pill>, value: (r) => r.type },
    { key: "debit", header: "Debit", align: "right", cell: (r) => (r.debitMinor > BigInt(0) ? formatInrMinor(r.debitMinor) : "—"), value: (r) => Number(r.debitMinor) },
    { key: "credit", header: "Credit", align: "right", cell: (r) => (r.creditMinor > BigInt(0) ? formatInrMinor(r.creditMinor) : "—"), value: (r) => Number(r.creditMinor) },
  ];

  return <DataTable rows={rows} columns={columns} filterPlaceholder="Filter accounts…" />;
}
