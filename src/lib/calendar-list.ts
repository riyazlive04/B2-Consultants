/**
 * Synamate's saved appointment lists, as a pure function of the events already on the calendar.
 *
 * The same `CalEvent` the grid draws, read a second way - so a call can never appear in one and
 * not the other, and neither view needs its own query.
 */

import type { CalEvent } from "./calendar-event";

export type ListView = "upcoming" | "cancelled" | "all" | "sss" | "disco";

export const LIST_VIEWS: { value: ListView; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
  { value: "disco", label: "Upcoming discovery" },
  { value: "sss", label: "Upcoming strategy" },
];

/** A call that is over is not "upcoming", even if it starts before now and runs past it. */
const over = (ev: CalEvent, nowIso: string) => ev.endsAt <= nowIso;
const dead = (ev: CalEvent) => ev.status === "CANCELLED" || ev.status === "NO_SHOW";

/**
 * The rows of one saved view, in the order that view wants them.
 *
 * Blocked time is never listed: it is not an appointment, it is the absence of one. It stays on
 * the grid, where it is doing its job.
 */
export function viewRows(events: CalEvent[], view: ListView, nowIso: string): CalEvent[] {
  const calls = events.filter((e) => e.kind === "APPOINTMENT");
  const asc = (a: CalEvent, b: CalEvent) => a.startsAt.localeCompare(b.startsAt);

  if (view === "cancelled") {
    // Newest first: a cancellation is something that just happened, not something coming up.
    return calls.filter(dead).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }
  if (view === "all") return [...calls].sort(asc);

  const upcoming = calls.filter((e) => !over(e, nowIso) && !dead(e));
  if (view === "sss") return upcoming.filter((e) => e.calendar.type === "SSS").sort(asc);
  if (view === "disco") return upcoming.filter((e) => e.calendar.type === "DISCO").sort(asc);
  return upcoming.sort(asc);
}
