/**
 * Dragging a card to another time: which cards may move, and what a drop on a given lane means.
 *
 * Pure, because every refusal here is a refusal the server repeats anyway (`rescheduleBookingToTime`
 * validates the time, the clash and the past). This half exists so the grid can say no *before*
 * asking the person to confirm a move that could not happen.
 */

import { istWallToUtc } from "./dates";
import type { CalEvent } from "./calendar-event";
import { istDateLabel, istSlot, istTimeLabel } from "./calendar-grid";

/** Where a card was dropped: `ownerId` only in Day view, where a column IS a person ("" = unassigned). */
export type MoveLane = { dayKey: string; min: number; ownerId?: string | null };

export type MovePlan = {
  bookingId: string;
  date: string;
  time: string;
  durationMins: number;
  /** "" = leave unassigned, as the reschedule action and the slot generator both read it. */
  assignedToId: string;
  /** "Move Rohan Pillai to Thu, 20 Nov 2026, 10:00 AM?" - the question the confirm asks. */
  label: string;
};

/**
 * Blocked time has no booking; a cancelled or no-show card is a SlotRelease ghost with no slot to
 * move; and a strategy session moves on its own tab, where the open SSS slots are drawn (the grid
 * does not load them, so there is nothing valid to drop onto).
 */
export function canMove(ev: CalEvent): boolean {
  return (
    ev.kind === "APPOINTMENT" &&
    ev.calendar.type === "DISCO" &&
    ev.source.table === "slot" &&
    !!ev.source.bookingId &&
    ev.status !== "CANCELLED" &&
    ev.status !== "NO_SHOW"
  );
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function movePlan(ev: CalEvent, lane: MoveLane, nowIso: string): { plan: MovePlan } | { error: string } {
  if (!canMove(ev)) return { error: "Only a booked discovery call can be dragged to a new time." };
  if (lane.min < 0 || lane.min >= 1440) return { error: "That is not a time on this calendar." };

  const time = hhmm(lane.min);
  const startsAt = istWallToUtc(lane.dayKey, time);
  if (Number.isNaN(startsAt.getTime())) return { error: "That is not a time on this calendar." };
  if (startsAt.getTime() <= new Date(nowIso).getTime()) return { error: "That time has already passed." };

  const owner = lane.ownerId === undefined ? ev.ownerId ?? "" : lane.ownerId ?? "";
  const was = istSlot(ev.startsAt);
  if (was.key === lane.dayKey && was.min === lane.min && owner === (ev.ownerId ?? "")) {
    return { error: "That call is already at this time." };
  }

  const durationMins = Math.round((new Date(ev.endsAt).getTime() - new Date(ev.startsAt).getTime()) / 60_000);
  const iso = startsAt.toISOString();
  return {
    plan: {
      bookingId: ev.source.bookingId!,
      date: lane.dayKey,
      time,
      durationMins,
      assignedToId: owner,
      label: `Move ${ev.contact?.name ?? "this call"} to ${istDateLabel(iso)}, ${istTimeLabel(iso)}?`,
    },
  };
}
