"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { WHATSAPP_KIND_LABELS } from "@/lib/whatsapp";
import type { WhatsAppMessageRow } from "@/server/whatsapp-metrics";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function WhatsAppHistory({ rows }: { rows: WhatsAppMessageRow[] }) {
  const columns: Column<WhatsAppMessageRow>[] = [
    { key: "createdAt", header: "When", cell: (r) => fmt(r.createdAt), value: (r) => r.createdAt },
    { key: "direction", header: "Dir", cell: (r) => (r.direction === "INBOUND" ? "In" : "Out"), value: (r) => r.direction },
    { key: "kind", header: "Touchpoint", cell: (r) => WHATSAPP_KIND_LABELS[r.kind], value: (r) => WHATSAPP_KIND_LABELS[r.kind] },
    { key: "contact", header: "Contact", cell: (r) => r.contact ?? "—", value: (r) => r.contact ?? "" },
    { key: "toNumber", header: "Number", cell: (r) => (r.toNumber ? `+${r.toNumber}` : "—"), value: (r) => r.toNumber },
    { key: "status", header: "Status", cell: (r) => <WhatsAppStatusBadge status={r.status} />, value: (r) => r.status },
    { key: "template", header: "Template", cell: (r) => r.templateName ?? "—", value: (r) => r.templateName ?? "" },
    {
      key: "detail",
      header: "Detail",
      cell: (r) => <span className={r.error ? "text-bad" : "text-muted"}>{r.error ?? r.body ?? "—"}</span>,
      value: (r) => r.error ?? r.body ?? "",
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      csvName="whatsapp-messages"
      filterPlaceholder="Filter messages…"
      emptyMessage="No WhatsApp messages yet — nothing has been sent."
    />
  );
}
