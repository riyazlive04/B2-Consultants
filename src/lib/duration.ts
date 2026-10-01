/**
 * Minute-granular waiting windows, written the way a person says them: "36h", "90m", "1h 30m".
 *
 * Every cadence field in the app started life in whole HOURS, which is fine for "remind them the
 * day before" and useless for "give them fifteen minutes to reply". Rather than bolt a second
 * number box onto each field, every window is now stored in MINUTES and typed as a short
 * duration string, so one input can express both ends of that range.
 *
 * BACKWARD COMPATIBILITY IS THE POINT OF THE BARE-NUMBER RULE: every value stored or typed
 * before this parser existed meant hours ("24, 2"), so a unit-less entry still means hours.
 * Anything the operator wants in minutes must say so - `90m` - which is exactly the reading a
 * person expects from a box that used to be labelled "hours".
 *
 * Pure and dependency-free: the engines that consume these windows are tested at their edges,
 * and the parsing has to be testable the same way.
 */

export const MINUTE_MS = 60_000;

/** A `240h` ceiling, expressed in minutes - the bound every window field has always carried. */
export const MAX_WINDOW_MINUTES = 240 * 60;

/**
 * `"90m"` / `"2h"` / `"1h30m"` / `"1.5h"` / `"24"` → whole minutes. `null` when it isn't a
 * duration at all, so a caller can tell "the operator typed nonsense" from "they typed zero".
 */
export function parseDurationMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  // Unit-less = hours. See the note above: this is what the field has always meant.
  if (/^\d+(\.\d+)?$/.test(s)) return round(Number(s) * 60);
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:m(?:ins?|inutes?)?)?)?$/.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const mins = (m[1] ? Number(m[1]) * 60 : 0) + (m[2] ? Number(m[2]) : 0);
  return Number.isFinite(mins) && mins >= 0 ? round(mins) : null;
}

function round(mins: number): number {
  return Math.round(mins);
}

/** Parse + clamp into a stored field's range. Returns `fallback` for anything unparseable. */
export function coerceDurationMinutes(raw: unknown, fallback: number, max = MAX_WINDOW_MINUTES): number {
  const parsed = parseDurationMinutes(raw);
  if (parsed === null) return fallback;
  return Math.min(Math.max(parsed, 0), max);
}

/** Minutes → the shortest honest spelling: `0m`, `45m`, `36h`, `1h 30m`. */
export function formatDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "0m";
  const whole = Math.round(mins);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The same in prose, for a sentence rather than a field: "36 hours", "90 minutes", "1h 30m". */
export function describeDuration(mins: number): string {
  const whole = Math.round(mins);
  if (whole <= 0) return "0 minutes";
  if (whole % 60 === 0) {
    const h = whole / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (whole < 60) return `${whole} minute${whole === 1 ? "" : "s"}`;
  return formatDuration(whole);
}

/**
 * A comma-separated list of windows ("36h, 24h, 90m") → minutes, de-duplicated and sorted widest
 * first, which is the order every rung-based engine reads them in. Zero and negative entries are
 * dropped: a "0 minutes before" rung would fire at the moment of the call itself.
 */
export function parseDurationListMinutes(raw: unknown): number[] {
  if (typeof raw !== "string") return [];
  const list = raw
    .split(",")
    .map((part) => parseDurationMinutes(part))
    .filter((n): n is number => n !== null && n > 0 && n <= MAX_WINDOW_MINUTES);
  return [...new Set(list)].sort((a, b) => b - a);
}

/** Minutes[] → the string that round-trips back through `parseDurationListMinutes`. */
export function formatDurationList(mins: readonly number[]): string {
  return mins.map((m) => formatDuration(m).replace(" ", "")).join(", ");
}
