/**
 * Date-only values are stored as UTC midnight (@db.Date). "Today", weeks and months
 * are business concepts in IST (CONTEXT §6) - these helpers derive IST calendar
 * boundaries and express them as UTC-midnight dates for querying.
 */

export const IST_ZONE = "Asia/Kolkata";

/** The calendar date (YYYY-MM-DD) an instant falls on in a given IANA zone. */
export function ymdInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function istToday(): Date {
  return istDayOf(new Date());
}

/**
 * The IST calendar DAY an instant falls on, as UTC midnight - the @db.Date encoding.
 *
 * The boundary every "which week is it" question has to cross first. `istWeekRange` and the
 * rest below do their arithmetic with `setUTCDate`, which preserves the TIME of the value
 * handed to them: given a real instant rather than a day, they return "Monday, at whatever
 * o'clock it happens to be now", and anything built from that - a deadline, a week key - is
 * then wrong by up to a day.
 *
 * It cost a real bug. The weekly report's window is "opens Friday 10:00 IST"; computed from a
 * raw `new Date()` at 00:12 IST on a Friday, "Friday 00:00" came out as Friday 18:45 UTC - six
 * hours in the FUTURE on a day that had already started - so the cron opened nothing, silently,
 * and the only symptom was a cohort that never got asked.
 */
export function istDayOf(instant: Date): Date {
  return parseDateInput(ymdInZone(instant, IST_ZONE));
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

/**
 * The ISO-8601 week an IST date falls in, as "2026-W44".
 *
 * A key, not a label: the weekly report uses it to recognise the same calendar week
 * across cohorts that started months apart, so it has to agree with itself at a year
 * boundary. Hence the Thursday rule rather than "week 1 starts on 1 January" - the week
 * of 29 Dec 2026 is 2026-W53 and the week of 31 Dec 2025 is 2026-W01, and a naive
 * year-plus-week-number would file those under the wrong year and collide.
 */
export function istIsoWeekKey(ref = istToday()): string {
  // Thursday of this ISO week decides which ISO YEAR the week belongs to.
  const thursday = new Date(ref);
  thursday.setUTCDate(ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7) + 3);
  const isoYear = thursday.getUTCFullYear();

  // 4 January is always in ISO week 1, so the Thursday of its week is week 1's Thursday.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursday = new Date(jan4);
  firstThursday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
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
 * (changedAt / createdAt / statusChangedAt) - querying those with the raw
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
 * The IST calendar month a real INSTANT falls in, as "YYYY-MM".
 *
 * For bucketing timestamp columns (changedAt / createdAt / qualifiedAt) into months without
 * running one query per month. Taking the UTC month of the raw instant would push everything
 * between 00:00 and 05:30 IST on the 1st into the previous month.
 *
 * For a `@db.Date` column, use `d.toISOString().slice(0, 7)` directly - those are already
 * UTC-midnight day boundaries and must NOT be shifted.
 */
export function istMonthKeyOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
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
 * functions (the top-bar runway badge, the notification centre, MonthHero, Cash Health)
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
/**
 * Cash-chart period control (Error Log F6). The chart was hardcoded to 12 weeks, so a founder
 * asking "how has cash moved this year" had no way to see it.
 *
 * NOT the spec's literal list. F6 asks for "last 7 days / 12 weeks / 12 months / 4 quarters",
 * but a CashPosition is one entry PER WEEK - a 7-day window plots a single point and a straight
 * line through it, which looks broken rather than informative. These four windows all yield a
 * readable series from weekly data while covering the same span of intent: recent detail through
 * to the whole year.
 */
export type CashPeriodKey = "12w" | "6m" | "12m" | "4q";

export const CASH_PERIOD_OPTIONS: ReadonlyArray<{ value: CashPeriodKey; label: string }> = [
  { value: "12w", label: "12 weeks" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "4q", label: "4 quarters" },
] as const;

export function parseCashPeriod(v: string | string[] | undefined): CashPeriodKey {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw === "6m" || raw === "12m" || raw === "4q" ? raw : "12w";
}

/** Start of the window, as a UTC-midnight date. Exclusive of nothing - callers filter `>=`. */
export function cashPeriodStart(key: CashPeriodKey, ref = istToday()): Date {
  const d = new Date(ref);
  switch (key) {
    case "6m":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 6, d.getUTCDate()));
    case "12m":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, d.getUTCDate()));
    // 4 quarters IS twelve months of data; it differs in how the reader groups it, not in span.
    case "4q":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, d.getUTCDate()));
    default: {
      const twelveWeeks = new Date(d);
      twelveWeeks.setUTCDate(d.getUTCDate() - 12 * 7);
      return twelveWeeks;
    }
  }
}

export function parseDateInput(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Format a Date as YYYY-MM-DD for <input type="date"> defaults. */
export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The date an entry form should PRE-FILL for someone recording something right now (FIN-02).
 *
 * The books run on IST, so the server used to pre-fill India's date everywhere. But the person
 * doing the typing is often in Germany, where the day turns over 3.5 hours later: any time after
 * 20:30 Berlin, India is already on the NEXT date, so the untouched default recorded a payment on
 * a day that had not happened yet - into tomorrow, and at month end into next month. Worse, the
 * calendar beside it rang the browser's day as "today", so the two halves of the same field
 * disagreed and nothing on screen said which one would be saved.
 *
 * So the default is the day the PERSON is having - except that it may never run ahead of the day
 * the BOOKS are having. A browser east of IST (travel) would otherwise post a future-dated entry
 * into an IST ledger, which is the same bug seen from the other side. For India and Germany, the
 * only two places this is used from, the cap never bites and this is simply the local date.
 *
 * Pure on purpose: both arguments are YYYY-MM-DD, which compares correctly as a string.
 */
export function entryDateFor(localYmd: string, istYmd: string): string {
  return localYmd < istYmd ? localYmd : istYmd;
}

/**
 * `entryDateFor` as the browser sees it - the local calendar day, capped at India's.
 * Client-side only: on the server "local" is the VPS clock (UTC), which is nobody's day.
 */
export function entryTodayYmd(now = new Date()): string {
  const local = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return entryDateFor(local, ymdInZone(now, IST_ZONE));
}


/**
 * Interpret a wall-clock date + time as Asia/Kolkata and return the UTC instant.
 * IST is a fixed +05:30 offset (no DST), so the ISO offset form is exact. Used when
 * Admin generates appointment slots by IST clock time (Wave-1 booking).
 */
export function istWallToUtc(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+05:30`);
}
