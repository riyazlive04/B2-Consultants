/**
 * When a weekly booking pattern says a slot should exist.
 *
 * PURE, and deliberately not inside `booking-actions.ts`: that file is `"use server"`, so every
 * export there becomes a public RPC endpoint and may only be an async server action — a shared
 * helper cannot live in it. Two callers need this rule:
 *
 *   1. the founder's one-off "generate slots for this range" form (bookings → Slots), and
 *   2. `ensureBookingSlots()`, the daily cron job that keeps a rolling horizon stocked.
 *
 * They MUST agree to the millisecond. Both dedupe by exact `startsAt`, so if the cron computed
 * 15:00:00 and the form computed 15:00:30 for the same intended slot, neither would see the
 * other's row and the calendar would fill with near-duplicate pairs. One function, one rule.
 *
 * Why this matters at all: as of 23 Jul 2026 the public /book page had no bookable slot for 8
 * days. Slots were only ever hand-created, so they simply ran out, silently, at the top of the
 * funnel. A pattern the cron can replay is the fix; this is its arithmetic.
 */

export const WEEKDAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/**
 * `Date#getUTCDay()` on a UTC-midnight calendar date (how `parseDateInput` encodes an IST day)
 * gives the correct civil weekday regardless of the IST offset — the same trick `dates.ts`
 * `istToday` uses. Reading it with `getDay()` instead would shift by a day for half the world.
 */
export const WEEKDAY_FROM_JSDAY: Record<number, WeekdayKey> = {
  0: "SUN", 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT",
};

export type SlotPattern = {
  /** IST weekdays the pattern runs on. */
  weekdays: readonly WeekdayKey[];
  /** IST wall-clock "HH:MM" — first slot may start at this time. */
  startTime: string;
  /** IST wall-clock "HH:MM" — no slot may still be running after this time. */
  endTime: string;
  /** Minutes between consecutive slot STARTS, before the buffer is added. */
  intervalMins: number;
  /** How long one call runs. A slot only fits if it ends on or before `endTime`. */
  durationMins: number;
};

/**
 * How many slots one running day of the pattern yields.
 *
 * Lives here, next to `slotStartsForRange`, because the Console's availability editor needs to
 * show the founder what a pattern produces BEFORE it is saved — and it cannot call
 * `slotStartsForRange`, which needs the server-side IST date helpers. Given the same rule was
 * already duplicated once (manual generator vs. cron), a second hand-rolled copy in a React
 * component was not worth the risk: `slot-plan.test.ts` pins this against the real generator.
 *
 * Same two subtleties: the buffer is added ON TOP of the interval, and a slot counts only if it
 * ENDS on or before `endTime`.
 */
export function slotsPerRunningDay(
  pattern: Pick<SlotPattern, "startTime" | "endTime" | "intervalMins" | "durationMins">,
  bufferMinutes: number,
): number {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const start = toMin(pattern.startTime);
  const end = toMin(pattern.endTime);
  const step = pattern.intervalMins + bufferMinutes;
  if (!Number.isFinite(start) || !Number.isFinite(end) || step <= 0) return 0;

  let n = 0;
  for (let t = start; t + pattern.durationMins <= end; t += step) n++;
  return n;
}

/**
 * Every slot start instant the pattern implies across `[startDate, endDate]` inclusive.
 *
 * `bufferMinutes` comes from the founder's booking rules and sits ON TOP of the interval, so
 * consecutive slots keep a real gap instead of running back-to-back whenever interval equals
 * duration. Dates are IST day keys ("YYYY-MM-DD"); `istWallToUtc` is injected rather than
 * imported so this module stays free of the date layer and is trivially testable.
 *
 * Returns instants in ascending order, and an empty array when the window fits no slot — a
 * legitimate answer (a 30-minute window cannot hold a 60-minute call), not an error.
 */
export function slotStartsForRange(opts: {
  startDate: string;
  endDate: string;
  pattern: SlotPattern;
  bufferMinutes: number;
  /** ("YYYY-MM-DD", "HH:MM") → the UTC instant of that IST wall-clock time. */
  istWallToUtc: (dateStr: string, time: string) => Date;
  /** "YYYY-MM-DD" → the UTC-midnight Date for that day key. */
  parseDate: (dateStr: string) => Date;
  /** UTC-midnight Date → "YYYY-MM-DD". */
  formatDate: (d: Date) => string;
}): Date[] {
  const { pattern: p } = opts;
  const start = opts.parseDate(opts.startDate);
  const end = opts.parseDate(opts.endDate);
  const daySpan = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (!Number.isFinite(daySpan) || daySpan < 0) return [];

  const stepMs = (p.intervalMins + opts.bufferMinutes) * 60_000;
  if (stepMs <= 0) return [];

  const starts: Date[] = [];
  for (let i = 0; i <= daySpan; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    if (!p.weekdays.includes(WEEKDAY_FROM_JSDAY[day.getUTCDay()])) continue;

    const dateStr = opts.formatDate(day);
    const dayStartUtc = opts.istWallToUtc(dateStr, p.startTime).getTime();
    const dayEndUtc = opts.istWallToUtc(dateStr, p.endTime).getTime();
    if (!Number.isFinite(dayStartUtc) || !Number.isFinite(dayEndUtc)) continue;

    // `+ 1` so a call that ends exactly ON the window's end time still fits: a 15:00–18:00
    // window with 60-minute calls must yield a 17:00 slot, not stop at 16:00.
    for (let t = dayStartUtc; t + p.durationMins * 60_000 <= dayEndUtc + 1; t += stepMs) {
      starts.push(new Date(t));
    }
  }
  return starts;
}
