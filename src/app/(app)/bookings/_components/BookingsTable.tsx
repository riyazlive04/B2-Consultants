"use client";

import { useState } from "react";
import { CalendarClock, Check, CircleCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { setBookingStatus, setBookingConfirmed, rescheduleBooking } from "@/server/booking-actions";
import { sendBookingConfirmationMsg, sendBookingReminderMsg } from "@/server/whatsapp-actions";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { BANT_VERDICT_LABELS, BOOKING_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import type { BookingRow, OpenSlotOption, TeamMemberOption } from "@/server/booking-metrics";

const STATUS_OPTIONS = ["BOOKED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;

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
        className={`tnum rounded-full px-1.5 py-0.5 text-caption font-semibold ${
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
            className={`grid h-4 w-4 place-items-center rounded text-caption font-bold ${
              on ? "bg-accent text-on-accent" : "bg-surface-2 text-muted"
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
  teamMembers = [],
  openSlots = [],
}: {
  rows: BookingRow[];
  waStatus?: Record<string, WhatsAppStatusCell>;
  teamMembers?: TeamMemberOption[];
  openSlots?: OpenSlotOption[];
}) {
  const [teamFilter, setTeamFilter] = useState("");
  // The booking currently being postponed (drives the reschedule modal), + the chosen target slot.
  const [postponeFor, setPostponeFor] = useState<BookingRow | null>(null);
  const [targetSlot, setTargetSlot] = useState("");
  const [busy, setBusy] = useState(false);

  const changeStatus = async (r: BookingRow, status: string) => {
    if (status === r.status) return;
    const res = await setBookingStatus(r.id, status);
    if (!res.ok) return toast(res.error, "error");
    toast(`Marked ${BOOKING_STATUS_LABELS[status]}`);
  };

  const toggleConfirm = async (r: BookingRow) => {
    const res = await setBookingConfirmed(r.id, !r.confirmed);
    if (!res.ok) return toast(res.error, "error");
    toast(r.confirmed ? "Marked unconfirmed" : "Confirmed");
  };

  const openPostpone = (r: BookingRow) => {
    setTargetSlot("");
    setPostponeFor(r);
  };

  const submitPostpone = async () => {
    if (!postponeFor || !targetSlot || busy) return;
    setBusy(true);
    const res = await rescheduleBooking(postponeFor.id, targetSlot);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast("Call postponed — prospect notified");
    setPostponeFor(null);
  };

  // Slots offered for a postpone: future OPEN slots of the SAME call length, so a 60-min strategy
  // call is never dropped into a 30-min opening. Matches on duration when the booking has one.
  const slotChoices = postponeFor
    ? openSlots.filter((s) => !postponeFor.slotDurationMins || s.durationMins === postponeFor.slotDurationMins)
    : [];

  const visibleRows = teamFilter ? rows.filter((r) => r.assignedToId === teamFilter) : rows;

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
    {
      key: "assigned", header: "Assigned to",
      cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{r.assignedToName ?? "-"}</span>,
      value: (r) => r.assignedToName ?? "",
    },
    { key: "role", header: "Role", cell: (r) => r.jobTitle || "-", value: (r) => r.jobTitle },
    { key: "when", header: "Wants to start", cell: (r) => r.whenStart, value: (r) => r.whenStart },
    { key: "invest", header: "Budget", cell: (r) => r.readyToInvest, value: (r) => r.readyToInvest },
    { key: "bant", header: "BANT", cell: (r) => <BantChips r={r} />, value: (r) => r.bantAvg ?? r.bantScore },
    {
      key: "verdict", header: "Verdict",
      cell: (r) =>
        r.bantVerdict ? (
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold ${VERDICT_STYLE[r.bantVerdict]}`}>
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
        <Select
          size="sm"
          aria-label="Booking status"
          defaultValue={r.status}
          onChange={(e) => changeStatus(r, e.target.value)}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] }))}
        />
      ),
      value: (r) => BOOKING_STATUS_LABELS[r.status],
    },
    {
      key: "confirm", header: "Confirm", sortable: false,
      cell: (r) =>
        r.status === "BOOKED" ? (
          <button
            type="button"
            onClick={() => toggleConfirm(r)}
            title={r.confirmed ? "Confirmed — click to clear" : "Mark this call confirmed"}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold transition-colors ${
              r.confirmed ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted hover:text-ink"
            }`}
          >
            {r.confirmed ? <CircleCheck size={13} /> : <Check size={13} />}
            {r.confirmed ? "Confirmed" : "Mark"}
          </button>
        ) : (
          <span className="text-xs text-muted">-</span>
        ),
      value: (r) => (r.confirmed ? "Confirmed" : ""),
    },
    {
      key: "postpone", header: "", sortable: false,
      cell: (r) =>
        r.slotId && r.status === "BOOKED" ? (
          <button
            type="button"
            onClick={() => openPostpone(r)}
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-accent hover:underline"
          >
            <CalendarClock size={13} /> Postpone
          </button>
        ) : null,
      value: () => null,
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
    <div className="space-y-3">
      {teamMembers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select
            size="sm"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            aria-label="Filter by team member"
            options={[{ value: "", label: "All team members" }, ...teamMembers.map((u) => ({ value: u.id, label: u.name }))]}
          />
        </div>
      )}
      <DataTable
        rows={visibleRows}
        columns={columns}
        csvName="bookings"
        filterPlaceholder="Filter bookings…"
        emptyMessage="No bookings yet. Share your /book link to start receiving them."
      />

      <Modal
        open={!!postponeFor}
        onClose={() => setPostponeFor(null)}
        title="Postpone call"
        subtitle={
          postponeFor
            ? `${postponeFor.name}${postponeFor.slotDay !== "-" ? ` · currently ${postponeFor.slotDay} ${postponeFor.slotTime} IST` : ""}`
            : undefined
        }
        size="md"
      >
        {slotChoices.length === 0 ? (
          <p className="text-sm text-muted">
            No open slots of the same length are available. Add availability in the Availability tab,
            then postpone.
          </p>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Move to</span>
              <Select
                value={targetSlot}
                onChange={(e) => setTargetSlot(e.target.value)}
                placeholder="Pick an open slot…"
                options={slotChoices.map((s) => ({
                  value: s.id,
                  label: `${s.day} · ${s.time} IST${s.assignedToName ? ` · ${s.assignedToName}` : ""}`,
                }))}
              />
            </label>
            <p className="text-caption text-muted">
              The old slot is freed and the prospect is told their call moved and asked to confirm the
              new time.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPostponeFor(null)}
                className="h-10 rounded-btn px-3 text-sm text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitPostpone}
                disabled={!targetSlot || busy}
                className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:opacity-60"
              >
                {busy ? "Moving…" : "Postpone call"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
