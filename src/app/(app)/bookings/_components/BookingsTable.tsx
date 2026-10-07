"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { BantChip, BantDimensions } from "@/components/ui/BantChip";
import { IconButton, SegmentedControl } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { BANT_VERDICT_LABELS, BOOKING_STATUS_LABELS } from "@/lib/labels";
import type { BookingRow, OpenSlotOption, TeamMemberOption } from "@/server/booking-metrics";
import { BookingDetail } from "./BookingDetail";
import { RescheduleDialog } from "./RescheduleDialog";
import { CallTime, ConfirmPill, HistoryChip, StatusPill, VerdictPill } from "./booking-view";

/**
 * Booking requests, as a list that works on a phone.
 *
 * ── What was wrong with the table this replaces ───────────────────────────────────
 * Fourteen columns, four of them holding controls. On a laptop it scrolled sideways, and what
 * scrolled off first was the right-hand edge where the actions lived. On a phone the shared
 * table fell back to its generic key-value dump - fourteen labelled rows per booking, with a
 * `<select>`, a chip and three links crushed into the right-hand column at `text-xs`, none of
 * them near the 40px hit-target floor (§7). And the meaning was carried almost entirely by
 * `title` attributes: the BANT letters, the "we have met them before" history and the WhatsApp
 * state each said what they meant on hover only - which is to say never, on the device most of
 * this team works from. Two columns had no header at all, so their cells were announced as
 * nothing.
 *
 * ── The shape now ─────────────────────────────────────────────────────────────────
 * Columns that fit, holding what you scan: who, when, who with, how qualified, where it stands.
 * Everything else - the intake answers, the full history, the messaging state, and every action
 * that CHANGES something - moved into `BookingDetail`, one tap away, where the dialog's title
 * supplies the context that twenty identically-named row controls never could. The phone gets a
 * card of its own rather than the generic dump, with two real buttons.
 *
 * Quick filters sit above it because the first question here is not "show me everything", it is
 * "who do I have to confirm today".
 */

type QuickFilter = "all" | "upcoming" | "unconfirmed" | "done" | "lost";

const FILTER_LABELS: Record<QuickFilter, string> = {
  all: "All",
  upcoming: "Upcoming",
  unconfirmed: "To confirm",
  done: "Completed",
  lost: "Cancelled & no-shows",
};

/**
 * "Upcoming" is decided by the SLOT, not by the status: a BOOKED row whose time has passed with
 * no outcome recorded is not something anyone is waiting for, and filing it under today's work is
 * how a stale row gets chased instead of closed.
 */
function isFuture(row: BookingRow): boolean {
  return !!row.slotStartsAt && new Date(row.slotStartsAt).getTime() > Date.now();
}

function matchesFilter(row: BookingRow, f: QuickFilter): boolean {
  switch (f) {
    case "upcoming":
      return row.status === "BOOKED" && isFuture(row);
    case "unconfirmed":
      return row.status === "BOOKED" && isFuture(row) && !row.confirmed;
    case "done":
      return row.status === "COMPLETED";
    case "lost":
      return row.status === "CANCELLED" || row.status === "NO_SHOW";
    default:
      return true;
  }
}

export function BookingsTable({
  rows,
  waStatus = {},
  teamMembers = [],
  openSlots = [],
  canExport = false,
}: {
  rows: BookingRow[];
  waStatus?: Record<string, WhatsAppStatusCell>;
  teamMembers?: TeamMemberOption[];
  openSlots?: OpenSlotOption[];
  /** §5.6: the CSV button is Admin-only. The page knows the role; this list does not. */
  canExport?: boolean;
}) {
  const [teamFilter, setTeamFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  /**
   * The record being READ, and the one being given a new time. Separate states, because the
   * detail dialog hands over to the reschedule one and closes itself: two stacked dialogs trap
   * focus in the wrong panel and leave the reader guessing what Escape will close.
   */
  const [detailFor, setDetailFor] = useState<BookingRow | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<BookingRow | null>(null);

  const counts = useMemo(() => {
    const out: Record<QuickFilter, number> = { all: rows.length, upcoming: 0, unconfirmed: 0, done: 0, lost: 0 };
    for (const r of rows) {
      if (matchesFilter(r, "upcoming")) out.upcoming++;
      if (matchesFilter(r, "unconfirmed")) out.unconfirmed++;
      if (matchesFilter(r, "done")) out.done++;
      if (matchesFilter(r, "lost")) out.lost++;
    }
    return out;
  }, [rows]);

  const visibleRows = useMemo(
    () => rows.filter((r) => matchesFilter(r, quick) && (!teamFilter || r.assignedToId === teamFilter)),
    [rows, quick, teamFilter],
  );

  /** What a screen reader hears before opening a row, instead of "Open this record" three hundred times. */
  const rowLabel = (r: BookingRow) =>
    `Open ${r.name}'s booking - ${BOOKING_STATUS_LABELS[r.status] ?? r.status}` +
    (r.slotDay !== "-" ? `, ${r.slotDay} ${r.slotTime} IST` : "");

  const actionLabel = (r: BookingRow) => (r.status === "BOOKED" ? "Reschedule" : "Re-book");

  const columns: Column<BookingRow>[] = [
    {
      key: "name",
      header: "Prospect",
      cell: (r) => (
        <div className="min-w-0 max-w-[13rem] space-y-1">
          <p className="truncate font-medium text-ink" title={r.name}>
            {r.name}
          </p>
          <p className="tnum text-caption text-muted">{r.phone}</p>
          {r.history && <HistoryChip history={r.history} />}
        </div>
      ),
      // The history joins the filter/CSV value, so "no-show" finds everyone who has missed one.
      value: (r) => [r.name, r.phone, r.jobTitle, r.history?.headline ?? ""].filter(Boolean).join(" "),
    },
    {
      key: "slot",
      header: "Call time",
      cell: (r) => <CallTime row={r} />,
      // Sorted and exported on whichever time the row actually has, so a cancelled call is not
      // dumped at one end of the sort for want of a value.
      value: (r) => r.slotStartsAt ?? (r.released ? `${r.released.day} ${r.released.time} (released)` : ""),
    },
    {
      key: "assigned",
      header: "With",
      cell: (r) => <span className="text-sm text-ink-2">{r.assignedToName ?? "-"}</span>,
      value: (r) => r.assignedToName ?? "",
    },
    {
      key: "bant",
      header: "Qualification",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <BantChip bant={r.bant} />
          <BantDimensions bant={r.bant} />
        </span>
      ),
      // -1 for unscored, so a sort puts "not scored" below a genuine 0.0 rather than tying with
      // it. They are different facts and the ordering should say so.
      value: (r) => r.bant?.avg ?? -1,
    },
    {
      key: "verdict",
      header: "Verdict",
      cell: (r) => <VerdictPill row={r} />,
      value: (r) => (r.bant ? BANT_VERDICT_LABELS[r.bant.verdict] : ""),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusPill status={r.status} />
          <ConfirmPill row={r} />
        </span>
      ),
      value: (r) => BOOKING_STATUS_LABELS[r.status] ?? r.status,
      // The funnel order of an outcome, not the alphabet - see Column.order.
      order: ["BOOKED", "RESCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"],
    },
    {
      /**
       * `actions` by convention, which is what pins this column against the right edge whatever
       * the table is doing (DataTable's `stickyKey`) - the actions being the one thing that must
       * never be the part that scrolls out of reach.
       */
      key: "actions",
      header: "Actions",
      sortable: false,
      align: "right",
      cell: (r) => (
        <span className="flex items-center justify-end gap-1">
          {/*
            The prospect's NAME is in every label - twenty buttons all called "Reschedule" are
            twenty buttons a screen-reader user cannot tell apart - and a disabled one SAYS why,
            rather than leaving grey as the only cue (§7).
          */}
          <IconButton
            label={
              r.status === "COMPLETED"
                ? `${r.name}'s call has happened - it cannot be moved`
                : `${actionLabel(r)} ${r.name}'s call`
            }
            onClick={() => setRescheduleFor(r)}
            disabled={r.status === "COMPLETED"}
          >
            <CalendarClock size={16} aria-hidden />
          </IconButton>
          <IconButton label={`Open ${r.name}'s booking`} onClick={() => setDetailFor(r)}>
            <ChevronRight size={16} aria-hidden />
          </IconButton>
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <div className="space-y-3">
      {/* ── Filters. They WRAP on a narrow screen rather than scrolling sideways. ── */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={quick}
          onChange={setQuick}
          ariaLabel="Filter bookings by what needs doing"
          options={(Object.keys(FILTER_LABELS) as QuickFilter[]).map((f) => ({
            value: f,
            label: `${FILTER_LABELS[f]} (${counts[f]})`,
          }))}
        />
        {teamMembers.length > 0 && (
          <Select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            aria-label="Filter by team member"
            options={[
              { value: "", label: "All team members" },
              ...teamMembers.map((u) => ({ value: u.id, label: u.name ?? "Unnamed" })),
            ]}
          />
        )}
      </div>

      <DataTable
        rows={visibleRows}
        columns={columns}
        csvName={canExport ? "bookings" : undefined}
        filterPlaceholder="Search bookings…"
        defaultSort={{ key: "slot", dir: "desc" }}
        onRowClick={setDetailFor}
        rowLabel={rowLabel}
        emptyMessage={
          quick === "all"
            ? "No bookings yet. Share your /book link to start receiving them."
            : `No bookings are ${FILTER_LABELS[quick].toLowerCase()}`
        }
        /**
         * ── The phone card ────────────────────────────────────────────────────────────
         * Name, when, how qualified, where it stands - the four things that decide whether you
         * act on this row - and then two full-width buttons. Everything else is one tap away in
         * the dialog, which is a better home for it than a fourteen-row key-value list nobody
         * scrolls to the bottom of.
         */
        mobileCard={(r) => (
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{r.name}</p>
                <p className="tnum text-caption text-muted">{r.phone}</p>
              </div>
              <StatusPill status={r.status} />
            </div>

            <CallTime row={r} />

            <div className="flex flex-wrap items-center gap-1.5">
              <BantChip bant={r.bant} />
              <BantDimensions bant={r.bant} />
              <ConfirmPill row={r} />
            </div>

            {r.assignedToName && <p className="text-caption text-muted">With {r.assignedToName}</p>}
            {r.history && <HistoryChip history={r.history} />}

            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setRescheduleFor(r)}
                disabled={r.status === "COMPLETED"}
                aria-label={
                  r.status === "COMPLETED"
                    ? `${r.name}'s call has happened - it cannot be moved`
                    : `${actionLabel(r)} ${r.name}'s call`
                }
                className="press inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-btn border border-line-strong bg-surface text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-2 disabled:text-ink-disabled"
              >
                <CalendarClock size={15} aria-hidden />
                {actionLabel(r)}
              </button>
              <button
                type="button"
                onClick={() => setDetailFor(r)}
                aria-label={`Open ${r.name}'s booking`}
                className="press inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-btn bg-primary text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong"
              >
                Details
                <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          </div>
        )}
      />

      {detailFor && (
        <BookingDetail
          key={detailFor.id}
          booking={detailFor}
          whatsapp={waStatus[detailFor.id]}
          onReschedule={() => {
            const row = detailFor;
            setDetailFor(null);
            setRescheduleFor(row);
          }}
          onClose={() => setDetailFor(null)}
        />
      )}

      {rescheduleFor && (
        <RescheduleDialog
          key={rescheduleFor.id}
          booking={rescheduleFor}
          openSlots={openSlots}
          teamMembers={teamMembers}
          onClose={() => setRescheduleFor(null)}
        />
      )}
    </div>
  );
}
