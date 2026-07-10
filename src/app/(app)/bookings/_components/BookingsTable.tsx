"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { toast } from "@/components/ui/feedback";
import { setBookingStatus } from "@/server/booking-actions";
import { sendBookingConfirmationMsg, sendBookingReminderMsg } from "@/server/whatsapp-actions";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { BANT_VERDICT_LABELS, BOOKING_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import type { BookingRow } from "@/server/booking-metrics";

const STATUS_OPTIONS = ["BOOKED", "COMPLETED", "NO_SHOW", "CANCELLED", "RESCHEDULED"] as const;

const VERDICT_STYLE: Record<string, string> = {
  CONFIRM: "bg-ok-soft text-ok",
  DOUBT: "bg-watch-soft text-watch",
  CANCEL: "bg-risk-soft text-risk",
};

function BantChips({ r }: { r: BookingRow }) {
  const dims: [string, boolean][] = [
    ["B", r.bantBudget], ["A", r.bantAuthority], ["N", r.bantNeed], ["T", r.bantTimeline],
  ];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        title={r.bantAvg !== null ? `Weighted average ${r.bantAvg.toFixed(1)}/5` : `${r.bantScore} of 4 dimensions met`}
        className={`tnum rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
          r.bantAvg !== null
            ? r.bantAvg > 3 ? "bg-ok-soft text-ok" : r.bantAvg >= 2 ? "bg-watch-soft text-watch" : "bg-risk-soft text-risk"
            : r.bantScore >= 3 ? "bg-ok-soft text-ok" : r.bantScore >= 2 ? "bg-watch-soft text-watch" : "bg-risk-soft text-risk"
        }`}
      >
        {r.bantAvg !== null ? `${r.bantAvg.toFixed(1)}/5` : `${r.bantScore}/4`}
      </span>
      <span className="hidden gap-0.5 sm:inline-flex">
        {dims.map(([k, on]) => (
          <span
            key={k}
            title={k}
            className={`grid h-4 w-4 place-items-center rounded text-[11px] font-bold ${
              on ? "bg-accent text-white" : "bg-surface-2 text-muted"
            }`}
          >
            {k}
          </span>
        ))}
      </span>
    </span>
  );
}

export function BookingsTable({
  rows,
  waStatus = {},
}: {
  rows: BookingRow[];
  waStatus?: Record<string, WhatsAppStatusCell>;
}) {
  const changeStatus = async (r: BookingRow, status: string) => {
    if (status === r.status) return;
    const res = await setBookingStatus(r.id, status);
    if (!res.ok) return toast(res.error, "error");
    toast(`Marked ${BOOKING_STATUS_LABELS[status]}`);
  };

  const columns: Column<BookingRow>[] = [
    {
      key: "name", header: "Prospect",
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-ink">{r.name}</div>
          <div className="tnum text-xs text-muted">{r.phone}</div>
        </div>
      ),
      value: (r) => r.name,
    },
    {
      key: "slot", header: "Call time",
      cell: (r) => (
        <div className="whitespace-nowrap">
          <div>{r.slotDay} {r.slotTime && <span className="tnum">· {r.slotTime} IST</span>}</div>
          {r.slotCet && <div className="text-xs text-muted">{r.slotCet} CET</div>}
        </div>
      ),
      value: (r) => `${r.slotDay} ${r.slotTime}`,
    },
    { key: "role", header: "Role", cell: (r) => r.jobTitle || "-", value: (r) => r.jobTitle },
    { key: "when", header: "Wants to start", cell: (r) => r.whenStart, value: (r) => r.whenStart },
    { key: "invest", header: "Budget", cell: (r) => r.readyToInvest, value: (r) => r.readyToInvest },
    { key: "bant", header: "BANT", cell: (r) => <BantChips r={r} />, value: (r) => r.bantAvg ?? r.bantScore },
    {
      key: "verdict", header: "Verdict",
      cell: (r) =>
        r.bantVerdict ? (
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_STYLE[r.bantVerdict]}`}>
            {BANT_VERDICT_LABELS[r.bantVerdict]}
          </span>
        ) : (
          <span className="text-xs text-muted">-</span>
        ),
      value: (r) => (r.bantVerdict ? BANT_VERDICT_LABELS[r.bantVerdict] : ""),
    },
    {
      key: "status", header: "Status", sortable: false,
      cell: (r) => (
        <select
          defaultValue={r.status}
          onChange={(e) => changeStatus(r, e.target.value)}
          className="rounded-field border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{BOOKING_STATUS_LABELS[s]}</option>
          ))}
        </select>
      ),
      value: (r) => BOOKING_STATUS_LABELS[r.status],
    },
    { key: "booked", header: "Booked on", cell: (r) => formatDate(r.createdAt), value: (r) => r.createdAt.slice(0, 10) },
    {
      key: "whatsapp", header: "WhatsApp", sortable: false,
      cell: (r) => {
        const w = waStatus[r.id];
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            {w && <WhatsAppStatusBadge status={w.status} kind={w.kind} at={w.at} />}
            <SendWhatsAppButton action={() => sendBookingReminderMsg(r.id)} label="Remind" />
            <SendWhatsAppButton action={() => sendBookingConfirmationMsg(r.id)} label="Confirm" />
          </span>
        );
      },
      value: (r) => waStatus[r.id]?.status ?? "",
    },
    {
      key: "lead", header: "", sortable: false,
      cell: (r) => (r.leadId ? <a href="/pipeline" className="text-xs text-accent hover:underline">Pipeline →</a> : null),
      value: () => null,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      csvName="bookings"
      filterPlaceholder="Filter bookings…"
      emptyMessage="No bookings yet. Share your /book link to start receiving them."
    />
  );
}
