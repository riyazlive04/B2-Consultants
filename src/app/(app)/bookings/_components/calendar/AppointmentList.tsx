"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SegmentedControl } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { CALENDAR_STATUS_LABELS } from "@/lib/labels";
import { eventLook, type CalEvent, type CalStatus } from "@/lib/calendar-event";
import { istDateLabel, istTimeLabel } from "@/lib/calendar-grid";
import { LIST_VIEWS, viewRows, type ListView } from "@/lib/calendar-list";
import { EventDrawer } from "./EventDrawer";
import { applyStatusChange } from "./event-status";

/**
 * Synamate's appointment list: the calls the grid is drawing, as a table you can scan, sort,
 * search and set a status on without opening anything.
 *
 * Deliberately NOT a replacement for the Booking requests table below it. That table holds what
 * Synamate never had - the BANT verdict, the WhatsApp state, the intake answers and the export -
 * and the team works from it daily. This is the second reading Synamate gave them: both call
 * types in one list, with the saved views they are used to.
 */

const DISCO_STATUSES: CalStatus[] = ["CONFIRMED", "UNCONFIRMED", "SHOWED", "NO_SHOW", "CANCELLED"];
const SSS_STATUSES: CalStatus[] = ["CONFIRMED", "UNCONFIRMED"];
/** Oldest-to-newest meaning, so sorting the Status column follows the call's life, not the alphabet. */
const STATUS_ORDER = ["UNCONFIRMED", "CONFIRMED", "SHOWED", "NO_SHOW", "CANCELLED"] as const;

export function AppointmentList({
  events, canSetSss, canExport, nowIso,
}: {
  events: CalEvent[];
  canSetSss: boolean;
  /** Export is Admin-only, as everywhere else this table is used. */
  canExport: boolean;
  /** The server's clock, so "upcoming" is decided once rather than differing per browser. */
  nowIso: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<ListView>("upcoming");
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = viewRows(events, view, nowIso);

  const change = async (ev: CalEvent, next: CalStatus) => {
    if (busy) return;
    setBusy(ev.id);
    const res = await applyStatusChange(ev, next);
    setBusy(null);
    if (!res) return;
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) router.refresh();
  };

  const columns: Column<CalEvent>[] = [
    {
      key: "title",
      header: "Appointment",
      value: (r) => r.title,
      cell: (r) => (
        <span className="block max-w-[26ch] truncate font-medium text-ink" title={r.title}>
          {r.title}
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      value: (r) => r.contact?.name ?? "",
      cell: (r) => (
        <span className="block">
          <span className="block truncate text-ink">{r.contact?.name ?? "-"}</span>
          {r.contact?.phone && <span className="block truncate text-caption text-muted tnum">{r.contact.phone}</span>}
        </span>
      ),
    },
    {
      key: "time",
      header: "Appointment time",
      sortable: true,
      value: (r) => r.startsAt,
      cell: (r) => (
        <span className="block">
          <span className="block text-ink">{istDateLabel(r.startsAt)}</span>
          <span className="block text-caption text-muted">{istTimeLabel(r.startsAt)} (IST)</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      order: STATUS_ORDER,
      value: (r) => r.status,
      cell: (r) => <StatusCell ev={r} canSetSss={canSetSss} busy={busy === r.id} onChange={(v) => change(r, v)} />,
    },
    {
      key: "calendar",
      header: "Calendar",
      sortable: true,
      value: (r) => r.calendar.name,
      cell: (r) => <span className="block max-w-[22ch] truncate text-ink-2">{r.calendar.name}</span>,
    },
    {
      key: "owner",
      header: "Owner",
      sortable: true,
      value: (r) => r.ownerName ?? "",
      cell: (r) => <span className="text-ink-2">{r.ownerName ?? "Unassigned"}</span>,
    },
    {
      key: "details",
      header: "",
      cell: (r) => (
        <button
          type="button"
          onClick={() => setOpen(r)}
          className="rounded-btn px-2 py-1 text-sm font-semibold text-primary hover:bg-primary-soft"
        >
          Details
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <SegmentedControl value={view} onChange={setView} ariaLabel="Saved list" options={LIST_VIEWS} />
      <DataTable
        rows={rows}
        columns={columns}
        defaultSort={{ key: "time", dir: view === "cancelled" ? "desc" : "asc" }}
        csvName={canExport ? `appointments-${view}` : undefined}
        filterPlaceholder="Search by name or title…"
        emptyMessage={view === "cancelled" ? "No cancelled calls." : "No appointments in this list."}
        rowLabel={(r) => r.title}
      />
      {open && <EventDrawer ev={open} canSetSss={canSetSss} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * The status, settable where it is read. A released call has no booking left to set, and a
 * strategy session is confirmed from Outreach - both show the status as a pill instead.
 */
function StatusCell({
  ev, canSetSss, busy, onChange,
}: {
  ev: CalEvent;
  canSetSss: boolean;
  busy: boolean;
  onChange: (next: CalStatus) => void;
}) {
  const settable = ev.source.table === "slot" || (ev.calendar.type === "SSS" && canSetSss);
  if (!settable) {
    const look = eventLook(ev);
    return (
      <span
        className="inline-block rounded-full border px-2 py-0.5 text-caption font-semibold"
        style={{ background: look.bg, color: look.text, borderColor: look.border }}
      >
        {CALENDAR_STATUS_LABELS[ev.status]}
      </span>
    );
  }
  const statuses = ev.calendar.type === "SSS" ? SSS_STATUSES : DISCO_STATUSES;
  return (
    <Select
      size="sm"
      value={ev.status}
      aria-label={`Status - ${ev.contact?.name ?? ev.title}`}
      disabled={busy}
      onChange={(e) => onChange(e.target.value as CalStatus)}
      options={statuses.map((s) => ({ value: s, label: CALENDAR_STATUS_LABELS[s] }))}
    />
  );
}
