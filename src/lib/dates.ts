/**
 * Date-only values are stored as UTC midnight (@db.Date). "Today", weeks and months
 * are business concepts in IST (CONTEXT §6) - these helpers derive IST calendar
 * boundaries and express them as UTC-midnight dates for querying.
 */

export function istToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** [first day of month, first day of next month) in IST terms. */
export function istMonthRange(ref = istToday()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  return { start, end };
}

/** [Monday of current week, next Monday) in IST terms. */
export function istWeekRange(ref = istToday()): { start: Date; end: Date } {
  const dow = (ref.getUTCDay() + 6) % 7; // Monday=0
  const start = new Date(ref);
  start.setUTCDate(ref.getUTCDate() - dow);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

/** [Jan 1 of current IST year, Jan 1 next year). */
export function istYearRange(ref = istToday()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(ref.getUTCFullYear(), 0, 1)),
    end: new Date(Date.UTC(ref.getUTCFullYear() + 1, 0, 1)),
  };
}

/** Parse an <input type="date"> value (YYYY-MM-DD) to a UTC-midnight Date. */
export function parseDateInput(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Format a Date as YYYY-MM-DD for <input type="date"> defaults. */
export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Interpret a wall-clock date + time as Asia/Kolkata and return the UTC instant.
 * IST is a fixed +05:30 offset (no DST), so the ISO offset form is exact. Used when
 * Admin generates appointment slots by IST clock time (Wave-1 booking).
 */
export function istWallToUtc(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+05:30`);
}
