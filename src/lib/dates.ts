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

const IST_OFFSET_MS = 5.5 * 3600000;

/**
 * Convert an IST day boundary (expressed as UTC midnight, the @db.Date encoding)
 * to the real UTC INSTANT it represents: 00:00 IST = 18:30 UTC the previous day.
 * Use this whenever an IST month/week range filters a TIMESTAMP column
 * (changedAt / createdAt / statusChangedAt) — querying those with the raw
 * UTC-midnight boundary shifts the window 5.5h late and misbuckets everything
 * that happens between 00:00 and 05:30 IST on the boundary day.
 */
export function istBoundaryToInstant(boundary: Date): Date {
  return new Date(boundary.getTime() - IST_OFFSET_MS);
}

/** istMonthRange, expressed as UTC instants for timestamp-column queries. */
export function istMonthInstantRange(ref = istToday()): { start: Date; end: Date } {
  const { start, end } = istMonthRange(ref);
  return { start: istBoundaryToInstant(start), end: istBoundaryToInstant(end) };
}

/**
 * Minutes elapsed since IST midnight for a real instant (0..1439). IST is a fixed +05:30
 * with no DST, so this is exact arithmetic rather than a timezone-database lookup.
 * Used by the automation engine's quiet-hours window.
 */
export function istMinutesOfDay(instant: Date): number {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Home-page KPI date-range control (BUILD_CHECKLIST §2). Three presets threaded into the
 * metrics functions that used to hardcode "this month" (`getPipelineSnapshot`,
 * `getRunwaySnapshot`). Default is always "this-month" so every other caller of those
 * functions (the top-bar runway badge, the notification centre, FounderPulse, Cash Health)
 * keeps its exact current behavior with no argument passed.
 */
export type KpiRangeKey = "this-month" | "last-month" | "qtd";

export const KPI_RANGE_OPTIONS: ReadonlyArray<{ value: KpiRangeKey; label: string }> = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "qtd", label: "QTD" },
];

/** Parse a `?range=` search param, defaulting to "this-month" for anything absent/unrecognised. */
export function parseKpiRange(v: string | string[] | undefined): KpiRangeKey {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "last-month" || s === "qtd" ? s : "this-month";
}

/** [start, end) day-boundary window (UTC-midnight/@db.Date encoding) for a KPI range preset. */
export function kpiDateRange(key: KpiRangeKey, ref = istToday()): { start: Date; end: Date } {
  if (key === "last-month") {
    return {
      start: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1)),
      end: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)),
    };
  }
  if (key === "qtd") {
    const quarterStartMonth = Math.floor(ref.getUTCMonth() / 3) * 3;
    return {
      start: new Date(Date.UTC(ref.getUTCFullYear(), quarterStartMonth, 1)),
      // through today, inclusive - end is the exclusive next-day boundary
      end: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + 1)),
    };
  }
  return istMonthRange(ref);
}

/** kpiDateRange, expressed as UTC instants for TIMESTAMP-column queries (changedAt, etc). */
export function kpiInstantRange(key: KpiRangeKey, ref = istToday()): { start: Date; end: Date } {
  const { start, end } = kpiDateRange(key, ref);
  return { start: istBoundaryToInstant(start), end: istBoundaryToInstant(end) };
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
