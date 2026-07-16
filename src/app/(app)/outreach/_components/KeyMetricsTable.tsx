"use client";

import { useTransition } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/form";
import type { KeyMetricsRow } from "@/server/outreach-metrics";
import { OUTREACH_PHASE_LABELS, QUALIFIED_LABELS } from "@/lib/outreach-sop";
import { assignResponsibilities } from "@/server/outreach-actions";

/**
 * "Key Metrics Sales B2_2026.xlsx" — the SOP's Step 12 sheet, in-app.
 *
 * Every column the SOP writes is here, and every one of them EXPORTS. That is the point: the
 * existing bookings CSV renders CET on screen but drops it from the file (and omits email and
 * phone entirely), which is exactly the kind of gap that keeps a spreadsheet alive alongside the
 * app. Each column below therefore carries an explicit `value` for the CSV, not just a `cell`.
 */

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-caption font-semibold"
      style={
        on
          ? { background: "var(--accent-soft)", color: "var(--accent)" }
          : { background: "var(--surface-2)", color: "var(--muted)" }
      }
    >
      {on ? "YES" : "NO"}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

function AssignSelect({
  row,
  field,
  users,
}: {
  row: KeyMetricsRow;
  field: "respTouchpointId" | "respDiscoId";
  users: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const currentName = field === "respTouchpointId" ? row.respTouchpoint : row.respDisco;
  const otherField = field === "respTouchpointId" ? "respDiscoId" : "respTouchpointId";
  const otherName = field === "respTouchpointId" ? row.respDisco : row.respTouchpoint;
  const idOf = (name: string | null) => users.find((u) => u.name === name)?.id ?? "";

  return (
    <Select
      size="sm"
      defaultValue={idOf(currentName)}
      disabled={pending}
      onChange={(e) => {
        const f = new FormData();
        f.set("journeyId", row.journeyId);
        f.set(field, e.target.value);
        // The action writes BOTH assignment columns, so carry the other one through unchanged —
        // otherwise picking a Touchpoint owner would silently clear the Disco owner.
        f.set(otherField, idOf(otherName));
        start(async () => void (await assignResponsibilities(f)));
      }}
      className="w-full"
      aria-label={field === "respTouchpointId" ? "Responsible for touchpoint" : "Responsible for disco"}
      options={[{ value: "", label: "—" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
    />
  );
}

export function KeyMetricsTable({
  rows,
  users,
}: {
  rows: KeyMetricsRow[];
  users: { id: string; name: string }[];
}) {
  return (
    <DataTable
      rows={rows}
      csvName="key-metrics"
      emptyMessage="No booked prospects yet — Key Metrics fills in once a lead books a discovery call."
      filterPlaceholder="Filter by name, email, owner…"
      // The SOP's "mark the entire row in RED colour text" (Steps 16/18/21/23).
      rowClassName={(r) => (r.red ? "text-[color:var(--risk)]" : undefined)}
      columns={[
        {
          key: "apptDate",
          header: "Appointment date",
          sortable: true,
          value: (r) => r.apptDate ?? "",
          cell: (r) => <span className="tnum">{r.apptDate ?? "—"}</span>,
        },
        {
          key: "apptTime",
          // The zone label follows the real zone: Europe/Berlin is CEST (UTC+2) for ~7 months a
          // year, so a hardcoded "CET" would be wrong more often than not.
          header: "Appointment time",
          sortable: true,
          value: (r) => (r.apptTimeCet ? `${r.apptTimeCet} ${r.cetLabel}` : ""),
          cell: (r) =>
            r.apptTimeCet ? (
              <span className="tnum">
                {r.apptTimeCet} <span className="text-caption text-muted">{r.cetLabel}</span>
              </span>
            ) : (
              <span className="text-muted">—</span>
            ),
        },
        { key: "name", header: "Name", sortable: true, value: (r) => r.name, cell: (r) => r.name },
        { key: "email", header: "Email", value: (r) => r.email ?? "", cell: (r) => r.email ?? "—" },
        { key: "phone", header: "Phone", value: (r) => r.phone ?? "", cell: (r) => r.phone ? <span className="tnum">{r.phone}</span> : <span className="text-muted">—</span> },
        {
          key: "bant",
          header: "BANT score",
          sortable: true,
          align: "right",
          value: (r) => r.bantScore ?? "",
          cell: (r) => <span className="tnum">{r.bantScore !== null ? r.bantScore.toFixed(1) : "—"}</span>,
        },
        {
          key: "qualified",
          header: "Qualified",
          sortable: true,
          value: (r) => (r.qualified ? QUALIFIED_LABELS[r.qualified] : ""),
          cell: (r) =>
            r.qualified ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
                {r.qualified}
              </span>
            ) : (
              <span className="text-muted">—</span>
            ),
        },
        {
          key: "touchpoint",
          header: "Resp. for TOUCHPOINT",
          value: (r) => r.respTouchpoint ?? "",
          cell: (r) => <AssignSelect row={r} field="respTouchpointId" users={users} />,
        },
        {
          key: "disco",
          header: "Resp. for DISCO",
          value: (r) => r.respDisco ?? "",
          cell: (r) => <AssignSelect row={r} field="respDiscoId" users={users} />,
        },
        {
          key: "waSent",
          header: "WhatsApp Sent",
          value: (r) => (r.whatsappSent ? "YES" : "NO"),
          cell: (r) => <Flag on={r.whatsappSent} label="WhatsApp sent" />,
        },
        {
          key: "waConfirmed",
          header: "WhatsApp Confirmed",
          value: (r) => (r.whatsappConfirmed ? "YES" : "NO"),
          cell: (r) => <Flag on={r.whatsappConfirmed} label="WhatsApp confirmed" />,
        },
        {
          key: "salesConfirmed",
          header: "Sales Call Confirmed",
          value: (r) => (r.salesCallConfirmed ? "YES" : "NO"),
          cell: (r) => <Flag on={r.salesCallConfirmed} label="Sales call confirmed" />,
        },
        {
          key: "hq",
          header: "Highly Qualified",
          value: (r) => (r.highlyQualified === null ? "" : r.highlyQualified ? "YES" : "NO"),
          cell: (r) =>
            r.highlyQualified === null ? (
              <span className="text-caption text-muted">Pending</span>
            ) : (
              <Flag on={r.highlyQualified} label="highly qualified" />
            ),
        },
        {
          key: "phase",
          header: "Stage",
          sortable: true,
          value: (r) => OUTREACH_PHASE_LABELS[r.phase] ?? r.phase,
          cell: (r) => <span className="text-xs text-muted">{OUTREACH_PHASE_LABELS[r.phase] ?? r.phase}</span>,
        },
      ]}
    />
  );
}
