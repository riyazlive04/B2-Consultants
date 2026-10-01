"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SLOT_RELEASE_REASON_LABELS, SLOT_STATUS_LABELS, slotTypeLabel } from "@/lib/labels";
import type { SlotReleaseRow } from "@/server/slot-release";

/**
 * Bookings → Cancelled slots. Every booked slot that went back on the calendar, with what became
 * of it.
 *
 * WHY IT IS A SEPARATE VIEW. A release is the only booking event that leaves no trace anywhere
 * else: freeing the slot NULLS `BookingRequest.slotId` (the column is unique, so the slot cannot be
 * re-booked while a cancelled booking still points at it), which erases the booking's own time -
 * the Booking requests table printed "-" exactly where "when was it?" needed answering - and the
 * slot reopens looking like one nobody ever took. So neither of the two existing views could show
 * a cancellation at all.
 *
 * The columns are chosen to answer one question per column: WHEN was the call, WHY did it come
 * back, WHO let it go, and - the only one that is about money - did anybody end up using it.
 */

const REASON_FILTERS = [
  { value: "CANCELS", label: "Cancellations only" },
  { value: "NO_CONFIRMATION", label: "No reply (auto-cancelled)" },
  { value: "CANCELLED", label: "Cancelled by hand" },
  { value: "NO_SHOW", label: "No show" },
  { value: "POSTPONED", label: "Postponed" },
  { value: "", label: "Everything" },
];

/** The three reasons that mean "this call is not happening", as opposed to a postpone. */
const CANCEL_REASONS = new Set(["NO_CONFIRMATION", "CANCELLED", "NO_SHOW"]);

const REASON_TINT: Record<string, string> = {
  NO_CONFIRMATION: "bg-watch-soft text-watch",
  CANCELLED: "bg-risk-soft text-risk",
  NO_SHOW: "bg-risk-soft text-risk",
  POSTPONED: "bg-surface-2 text-muted",
};

/**
 * What came of the slot, as one phrase.
 *
 * `promotedName` is the engine's own claim that it moved somebody in, and it is stamped only after
 * the promote survived its concurrency guard - so it is trusted first. Otherwise the slot's CURRENT
 * status answers it: re-booked by somebody else, still open, or blocked because it was released too
 * close to the call for the public form to accept it.
 */
function outcome(r: SlotReleaseRow): { text: string; tone: string } {
  if (r.promotedName) return { text: `${r.promotedName} moved in`, tone: "text-ok" };
  if (r.slotStatusNow === null) return { text: "Slot since removed", tone: "text-muted" };
  if (r.slotStatusNow === "BOOKED") {
    return { text: r.rebookedName ? `Re-booked - ${r.rebookedName}` : "Re-booked", tone: "text-ok" };
  }
  if (r.slotStatusNow === "BLOCKED") {
    return { text: "Blocked - too close to book", tone: "text-muted" };
  }
  return { text: "Still open", tone: "text-watch" };
}

export function CancelledSlotsTable({ rows }: { rows: SlotReleaseRow[] }) {
  // Cancellations by default: a postpone is not a lost slot, and mixing the two is how the number
  // at the top of this tab stops meaning anything.
  const [reason, setReason] = useState("CANCELS");

  const shown = useMemo(
    () =>
      rows.filter((r) =>
        reason === "" ? true : reason === "CANCELS" ? CANCEL_REASONS.has(r.reason) : r.reason === reason,
      ),
    [rows, reason],
  );

  const columns: Column<SlotReleaseRow>[] = [
    {
      key: "prospect",
      header: "Held for",
      value: (r) => r.prospectName,
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">{r.prospectName}</span>
          {r.leadId ? (
            <Link href={`/leads/${r.leadId}`} className="text-caption text-accent hover:underline">
              Open lead
            </Link>
          ) : (
            <span className="text-caption text-muted">No lead record</span>
          )}
        </span>
      ),
    },
    {
      key: "slot",
      header: "Slot that was freed",
      // Sorted and exported on the instant, not the formatted string - "Fri 03 Oct" sorts
      // alphabetically into nonsense.
      value: (r) => r.slotStartsAt,
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">
            {r.slotDay} · {r.slotTime} IST
          </span>
          <span className="truncate text-caption text-muted">
            {r.slotCet} CET · {slotTypeLabel(r.durationMins)}
          </span>
        </span>
      ),
    },
    {
      key: "reason",
      header: "Why",
      value: (r) => SLOT_RELEASE_REASON_LABELS[r.reason] ?? r.reason,
      sortable: true,
      cell: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${REASON_TINT[r.reason] ?? "bg-surface-2 text-muted"}`}>
          {SLOT_RELEASE_REASON_LABELS[r.reason] ?? r.reason}
        </span>
      ),
    },
    {
      key: "released",
      header: "Released",
      value: (r) => r.releasedAt,
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ink">
            {r.releasedDay} · {r.releasedTime}
          </span>
          {/* Null releasedByName is the automation. Naming it matters: "the system did this" and
              "a colleague decided this" are different conversations. */}
          <span className="truncate text-caption text-muted">
            {r.releasedByName ?? "Confirmation loop"}
          </span>
        </span>
      ),
    },
    {
      key: "outcome",
      header: "What came of it",
      value: (r) => outcome(r).text,
      sortable: true,
      cell: (r) => {
        const o = outcome(r);
        return (
          <span className="flex min-w-0 flex-col">
            <span className={`truncate font-medium ${o.tone}`}>{o.text}</span>
            {r.slotStatusNow && (
              <span className="truncate text-caption text-muted">
                Slot is {(SLOT_STATUS_LABELS[r.slotStatusNow] ?? r.slotStatusNow).toLowerCase()} now
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Every booked slot that went back on the calendar. A slot released by the confirmation loop
        is one nobody replied <span className="font-medium">YES</span> to; it returns to the public
        booking page straight away, unless it was released so close to the call that the page would
        refuse it, in which case it is blocked instead.
      </p>
      <DataTable
        rows={shown}
        columns={columns}
        csvName="cancelled-slots"
        defaultSort={{ key: "released", dir: "desc" }}
        filterPlaceholder="Filter by name, time or reason…"
        emptyMessage={
          reason === "CANCELS"
            ? "No slots have been cancelled. A call released for no reply, by hand, or marked no-show appears here with the time it freed up."
            : "Nothing matches that filter."
        }
        toolbarExtra={
          <Select
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            options={REASON_FILTERS}
            size="sm"
          />
        }
      />
    </div>
  );
}
