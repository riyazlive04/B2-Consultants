"use client";

import { CalendarClock, CheckCircle2, History } from "lucide-react";
import { Pill } from "@/components/ui/kit";
import type { Tone } from "@/components/ui/kit";
import {
  BANT_VERDICT_LABELS,
  BOOKING_STATUS_LABELS,
  SLOT_RELEASE_REASON_LABELS,
  slotTypeLabel,
} from "@/lib/labels";
import type { BookingRow } from "@/server/booking-metrics";

/**
 * The bits of a booking row that both the list and its detail dialog draw.
 *
 * They live here rather than in either caller because the two must never disagree: a row that
 * reads "No show" in the table and "Booked" in the dialog behind it is worse than either being
 * wrong on its own.
 */

/**
 * Outcome, as a status badge.
 *
 * It replaces the per-row `<select>` the table used to carry. That control was one mis-click from
 * marking a live call CANCELLED - which frees the slot and messages nobody - and every copy of it
 * on screen had the same accessible name ("Booking status"), so a screen reader read twenty
 * identical controls with no way to tell whose booking each one changed. Setting an outcome now
 * happens in the detail dialog, where the prospect's name is in the dialog title and the
 * consequence is spelled out next to the control.
 */
const STATUS_TONE: Record<string, Tone> = {
  BOOKED: "primary",
  RESCHEDULED: "info",
  COMPLETED: "good",
  NO_SHOW: "bad",
  CANCELLED: "neutral",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <Pill tone={STATUS_TONE[status] ?? "neutral"}>
      {BOOKING_STATUS_LABELS[status] ?? status}
    </Pill>
  );
}

/** Confirmed / awaiting, for a live booking. Silent on a call that is over or cancelled. */
export function ConfirmPill({ row }: { row: BookingRow }) {
  if (row.status !== "BOOKED") return null;
  return row.confirmed ? (
    <Pill tone="good" title="The prospect has confirmed this time">
      <CheckCircle2 size={12} aria-hidden /> Confirmed
    </Pill>
  ) : (
    <Pill tone="warn" title="The prospect has not confirmed this time yet">
      Awaiting confirmation
    </Pill>
  );
}

/**
 * When the call is - or, for a booking that has let its slot go, when it USED to be.
 *
 * Releasing a slot nulls `slotId` (the column is unique and the slot has to be re-bookable), so
 * a cancelled row has no time of its own to print. Struck through and labelled with the reason,
 * because that time is history and must not read as an appointment somebody still has.
 */
export function CallTime({ row, size = "sm" }: { row: BookingRow; size?: "sm" | "md" }) {
  // `md` is the dialog's headline time, which should read as the heading of what you opened -
  // §2.1's h3 - rather than at the same 14px as the cell it was opened from.
  const text = size === "md" ? "font-display text-h3" : "text-sm font-medium";
  if (row.slotDay === "-" && row.released) {
    return (
      <div className="min-w-0">
        <p className={`${text} text-muted line-through`}>
          {row.released.day} <span className="tnum">· {row.released.time} IST</span>
        </p>
        <p className="text-caption text-muted">
          {SLOT_RELEASE_REASON_LABELS[row.released.reason] ?? row.released.reason}
          {row.released.promotedName ? ` · ${row.released.promotedName} moved in` : ""}
        </p>
      </div>
    );
  }
  if (row.slotDay === "-") return <span className="text-sm text-muted">No time held</span>;
  return (
    <div className="min-w-0">
      <p className={`${text} text-ink`}>
        {row.slotDay} {row.slotTime && <span className="tnum">· {row.slotTime} IST</span>}
      </p>
      <p className="text-caption text-muted">
        {row.slotCet && <>{row.slotCet} CET</>}
        {row.slotCet && row.slotDurationMins ? " · " : ""}
        {row.slotDurationMins ? slotTypeLabel(row.slotDurationMins) : ""}
      </p>
    </div>
  );
}

/**
 * "We have met this person before", as prose a screen reader can read.
 *
 * The whole history used to live in a `title` attribute on a `<span>`: invisible to the keyboard,
 * invisible to assistive tech, and invisible on a phone, where nothing hovers. The chip now says
 * the headline and carries the rest as `sr-only` text, and the dialog prints every line of it.
 */
export function historyLines(h: NonNullable<BookingRow["history"]>): string[] {
  const lines: string[] = [];
  if (h.otherEmails.length > 0) lines.push(`Also used: ${h.otherEmails.join(", ")}`);
  if (h.lastOutcome) {
    lines.push(
      `Last time: ${BOOKING_STATUS_LABELS[h.lastOutcome.status] ?? h.lastOutcome.status}` +
        (h.lastOutcome.day ? ` on ${h.lastOutcome.day}` : ""),
    );
  }
  if (h.previousCount > 0) {
    lines.push(
      `${h.previousCount} earlier booking${h.previousCount === 1 ? "" : "s"}: ` +
        [
          h.attended ? `${h.attended} attended` : "",
          h.noShows ? `${h.noShows} no-show` : "",
          h.cancelled ? `${h.cancelled} cancelled` : "",
          h.upcoming ? `${h.upcoming} still upcoming` : "",
        ]
          .filter(Boolean)
          .join(", "),
    );
  }
  if (h.previousVerdict) lines.push(`Previous BANT verdict: ${h.previousVerdict}`);
  return lines;
}

export function HistoryChip({ history }: { history: NonNullable<BookingRow["history"]> }) {
  const lines = historyLines(history);
  // Through `Pill`, so it is the §5.7 badge every other state in the app is - and warn (amber),
  // not bad (red). Someone who no-showed once and came back is MORE interested than average, not
  // a problem: this is context to read before dialling.
  return (
    <Pill tone="warn">
      <History size={11} aria-hidden className="flex-none" />
      <span className="truncate">{history.headline}</span>
      {lines.length > 0 && <span className="sr-only">. {lines.join(". ")}</span>}
    </Pill>
  );
}

/** The BANT verdict, which is an opinion about the score and so never replaces it. */
const VERDICT_TONE: Record<string, Tone> = { CONFIRM: "good", DOUBT: "warn", CANCEL: "bad" };

export function VerdictPill({ row }: { row: BookingRow }) {
  if (!row.bant) return <span className="text-caption text-muted">-</span>;
  return (
    <Pill tone={VERDICT_TONE[row.bant.verdict] ?? "neutral"}>
      {BANT_VERDICT_LABELS[row.bant.verdict]}
    </Pill>
  );
}

/** One labelled fact in the detail dialog. Blank values still print, as "-", on purpose. */
export function Fact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-label uppercase text-ink-2">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-sm text-ink">{children || "-"}</dd>
    </div>
  );
}

/** The "next call" glyph used wherever a time is offered as an action. */
export const RescheduleIcon = CalendarClock;
