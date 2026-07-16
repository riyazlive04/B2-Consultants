/**
 * Quiet-hours window maths for the Automation engine's Global Workflow Settings. Pure and
 * isomorphic: every function takes the instant explicitly (no hidden `new Date()`), so the
 * boundaries are testable without fake timers — same contract as outreach-engine.ts.
 *
 * The window is expressed in IST hours because that's the app's business timezone (CONTEXT §6),
 * and IST is a fixed +05:30 with no DST, so this is exact arithmetic.
 *
 * The engine (server/automation.ts) and the settings screen's plain-English summary both read
 * from here, so what the founder is told matches what actually happens.
 */

import { istMinutesOfDay } from "./dates";

const DAY_MINUTES = 1440;

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Is `instant` inside the quiet window?
 *
 * The window normally wraps midnight (21:00 → 09:00), hence the two branches: a non-wrapping
 * window is a simple between, a wrapping one is "after start OR before end". A zero-width
 * window (start === end) means "nothing is quiet" rather than "everything is" — the safer
 * reading, since the alternative would silently freeze every send.
 */
export function inQuietWindow(instant: Date, startHour: number, endHour: number): boolean {
  const start = startHour * 60;
  const end = endHour * 60;
  if (start === end) return false;
  const now = istMinutesOfDay(instant);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** The next instant at which the quiet window ends and sending may resume. */
export function quietWindowEndsAt(instant: Date, endHour: number): Date {
  let delta = endHour * 60 - istMinutesOfDay(instant);
  if (delta <= 0) delta += DAY_MINUTES; // the window ends tomorrow
  return new Date(instant.getTime() + delta * 60_000);
}

/** Plain-English summary for the settings screen, so the wrap-past-midnight case is unambiguous. */
export function describeQuietWindow(startHour: number, endHour: number): string {
  if (startHour === endHour) return "Start and end are the same, so nothing is held.";
  const wraps = startHour > endHour;
  return `Email and SMS steps that come up between ${fmtHour(startHour)} and ${fmtHour(endHour)} IST${wraps ? " (overnight)" : ""} are held, then sent at ${fmtHour(endHour)}.`;
}
