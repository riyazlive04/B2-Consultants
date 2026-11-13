/**
 * The rules behind "block this time off", kept pure so they are the same on the form and in the
 * action - and so the one thing that is easy to get wrong here (a range that ends before it
 * starts, silently blocking nothing) is tested rather than hoped for.
 */

/** "HH:MM" as minutes past midnight, or null when it is not a time. */
export function hhmmToMin(t: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const h = Number(t.slice(0, 2));
  const m = Number(t.slice(3));
  return h > 23 || m > 59 ? null : h * 60 + m;
}

/** The reason this range cannot be blocked, or null when it can. */
export function blockRangeError(from: string, to: string): string | null {
  const a = hhmmToMin(from);
  const b = hhmmToMin(to);
  if (a === null || b === null) return "Pick a start and an end time.";
  if (b <= a) return "The end time has to be after the start time.";
  return null;
}

/**
 * What blocking a range actually does to the slots inside it: only the OPEN ones are taken, and
 * a booked call keeps its time (Synamate says the same - "existing appointments will still
 * remain"), because blocking a diary should never quietly cancel someone's call.
 */
export function blockPlan<T extends { id: string; status: string }>(slots: T[]): { block: string[]; kept: T[] } {
  return {
    block: slots.filter((s) => s.status === "OPEN").map((s) => s.id),
    kept: slots.filter((s) => s.status === "BOOKED"),
  };
}
