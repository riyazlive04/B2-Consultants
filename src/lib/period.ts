/**
 * ONE definition of "which period am I looking at" for the whole app.
 *
 * ── The problem ─────────────────────────────────────────────────────────────────
 * Every screen that shows money or leads answered this differently, or not at all:
 *
 *   Finance      no control — hardcoded to `istMonthRange()`, i.e. the current calendar month
 *   Pipeline     no control — and a `<Pill>This month</Pill>` that LOOKS like one but is text
 *   Payments     no control
 *   Outreach     no control
 *   Cash         `?period=`
 *   Reports      `?range=`   ← a second vocabulary for the same idea
 *   Contacts     rich filters, no date filter at all
 *
 * So "show me July" was unanswerable on the four screens where it is asked most, two screens
 * disagreed about the query-string name, and CSV export — which exports the rows currently on
 * screen — could therefore only ever export the current month.
 *
 * ── The contract ────────────────────────────────────────────────────────────────
 * IST-anchored and HALF-OPEN: `[start, endExclusive)`. Both match `istMonthRange`, which the
 * finance queries already use, so adopting this changes no boundary arithmetic and no figure
 * double-counts a day. `previous` is the immediately preceding window of the same length, which
 * is what every "vs last period" delta on the app needs.
 *
 * Pure and isomorphic — no `server-only`, no DB. The server parses it from `searchParams`, the
 * client renders `<PeriodBar>` from it, and both agree because there is one parser.
 */

import { istToday, istMonthRange, istWeekRange, parseDateInput, toDateInputValue } from "./dates";

export type PeriodKind = "week" | "month" | "quarter" | "year" | "custom" | "all";

export type PeriodSpec = {
  kind: PeriodKind;
  /** Any day inside the wanted window, as YYYY-MM-DD. Ignored when `kind` is "all". */
  anchor: string;
  /** Only for `kind: "custom"` — an explicit inclusive-start / inclusive-end pair. */
  from?: string;
  to?: string;
};

export type ResolvedPeriod = {
  spec: PeriodSpec;
  start: Date;
  /** EXCLUSIVE. A row at exactly this instant belongs to the next window. */
  endExclusive: Date;
  /** e.g. "July 2026", "1–7 Jul 2026", "All time". */
  label: string;
  /** The window immediately before this one, same length. Null for "all". */
  previous: { start: Date; endExclusive: Date } | null;
  /** Round-trips through `parsePeriod` — for building links that keep the current view. */
  query: string;
};

export const DEFAULT_PERIOD: PeriodSpec = { kind: "month", anchor: "" };

const KINDS: readonly PeriodKind[] = ["week", "month", "quarter", "year", "custom", "all"];

/** The earliest date the app will look back to on "all time". B2's ledger starts well after. */
const EPOCH = new Date(Date.UTC(2000, 0, 1));

const isDateStr = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Read a period off a URL's query params.
 *
 * Deliberately TOTAL — it never throws and never returns null. A malformed `?period=` is a
 * bookmark someone edited or a link that aged out, and answering it with a crash (or an empty
 * screen) is worse than answering it with this month. Unknown input falls back silently.
 *
 * Accepts `?period=month&on=2026-07-15`, or `?period=custom&from=…&to=…`.
 */
export function parsePeriod(params: {
  period?: string;
  on?: string;
  from?: string;
  to?: string;
  /**
   * Legacy names still in the wild: Cash shipped `?period=` with its own vocabulary and Reports
   * shipped `?range=`. Both are accepted so existing bookmarks and dashboard links keep working
   * — this is a rename, and a rename that breaks saved links is a regression.
   */
  range?: string;
} = {}): PeriodSpec {
  const raw = (params.period ?? params.range ?? "").trim().toLowerCase();
  const anchor = isDateStr(params.on) ? params.on : "";

  if (raw === "custom" && isDateStr(params.from) && isDateStr(params.to)) {
    // Swapped dates are a typo, not an error worth a screen. Order them and move on.
    const [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    return { kind: "custom", anchor: from, from, to };
  }
  if ((KINDS as readonly string[]).includes(raw)) return { kind: raw as PeriodKind, anchor };

  // Legacy Reports vocabulary: `?range=30` / `90` / `365` meant "last N days".
  const days = Number(raw);
  if (Number.isFinite(days) && days > 0) {
    const end = istToday();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - Math.min(days, 3650));
    return { kind: "custom", anchor: toDateInputValue(start), from: toDateInputValue(start), to: toDateInputValue(end) };
  }

  return DEFAULT_PERIOD;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Turn a spec into real boundaries, a label, and the comparable previous window. */
export function resolvePeriod(spec: PeriodSpec = DEFAULT_PERIOD, today = istToday()): ResolvedPeriod {
  const ref = isDateStr(spec.anchor) ? parseDateInput(spec.anchor) : today;

  let start: Date;
  let endExclusive: Date;
  let label: string;

  switch (spec.kind) {
    case "all": {
      start = EPOCH;
      // Tomorrow, so anything stamped later today is inside "all time".
      endExclusive = new Date(today);
      endExclusive.setUTCDate(today.getUTCDate() + 1);
      label = "All time";
      break;
    }
    case "custom": {
      const from = isDateStr(spec.from) ? parseDateInput(spec.from) : ref;
      const to = isDateStr(spec.to) ? parseDateInput(spec.to) : ref;
      start = from;
      // `to` is INCLUSIVE in the query string (it is what a human picks in a date field) and the
      // boundary is exclusive, so the window runs to the start of the following day. Getting this
      // wrong silently drops every row from the last day of the range.
      endExclusive = new Date(to);
      endExclusive.setUTCDate(to.getUTCDate() + 1);
      label = `${DAY_SHORT.format(from)} – ${DAY_LABEL.format(to)}`;
      break;
    }
    case "week": {
      const w = istWeekRange(ref);
      start = w.start;
      endExclusive = w.end;
      const last = new Date(w.end);
      last.setUTCDate(w.end.getUTCDate() - 1);
      label = `${DAY_SHORT.format(w.start)} – ${DAY_LABEL.format(last)}`;
      break;
    }
    case "quarter": {
      const q = Math.floor(ref.getUTCMonth() / 3);
      start = new Date(Date.UTC(ref.getUTCFullYear(), q * 3, 1));
      endExclusive = new Date(Date.UTC(ref.getUTCFullYear(), q * 3 + 3, 1));
      label = `Q${q + 1} ${ref.getUTCFullYear()}`;
      break;
    }
    case "year": {
      start = new Date(Date.UTC(ref.getUTCFullYear(), 0, 1));
      endExclusive = new Date(Date.UTC(ref.getUTCFullYear() + 1, 0, 1));
      label = String(ref.getUTCFullYear());
      break;
    }
    case "month":
    default: {
      const m = istMonthRange(ref);
      start = m.start;
      endExclusive = m.end;
      label = MONTH_LABEL.format(m.start);
      break;
    }
  }

  // The window immediately before, of the SAME length — so a 7-day week compares with the prior
  // 7 days and a 31-day month with the prior 31, not with "last calendar month" of a different
  // length. Calendar kinds shift by their own unit so "vs last month" stays intuitive.
  const previous = (() => {
    if (spec.kind === "all") return null;
    if (spec.kind === "month") {
      const p = istMonthRange(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
      return { start: p.start, endExclusive: p.end };
    }
    if (spec.kind === "quarter") {
      return {
        start: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 3, 1)),
        endExclusive: start,
      };
    }
    if (spec.kind === "year") {
      return { start: new Date(Date.UTC(start.getUTCFullYear() - 1, 0, 1)), endExclusive: start };
    }
    const span = endExclusive.getTime() - start.getTime();
    return { start: new Date(start.getTime() - span), endExclusive: start };
  })();

  return { spec, start, endExclusive, label, previous, query: periodQuery(spec) };
}

/** Serialise a spec back to a query string (no leading "?"). */
export function periodQuery(spec: PeriodSpec): string {
  const p = new URLSearchParams();
  p.set("period", spec.kind);
  if (spec.kind === "custom" && spec.from && spec.to) {
    p.set("from", spec.from);
    p.set("to", spec.to);
  } else if (spec.anchor) {
    p.set("on", spec.anchor);
  }
  return p.toString();
}

/**
 * The spec one window earlier or later — what the ‹ › arrows navigate to.
 *
 * "all" has no neighbours and returns itself, so the arrows can be rendered disabled rather
 * than special-cased at every call site.
 */
export function shiftPeriod(spec: PeriodSpec, direction: -1 | 1, today = istToday()): PeriodSpec {
  if (spec.kind === "all") return spec;
  const r = resolvePeriod(spec, today);

  if (spec.kind === "custom") {
    const span = r.endExclusive.getTime() - r.start.getTime();
    const from = new Date(r.start.getTime() + direction * span);
    const to = new Date(r.endExclusive.getTime() + direction * span - 86_400_000);
    return { kind: "custom", anchor: toDateInputValue(from), from: toDateInputValue(from), to: toDateInputValue(to) };
  }

  // Anchor on a day INSIDE the neighbouring window rather than on its boundary — a boundary
  // date re-resolves to the same window under a different `kind` and the arrows would stick.
  const next = new Date(direction === 1 ? r.endExclusive : r.start);
  if (direction === -1) next.setUTCDate(next.getUTCDate() - 1);
  return { kind: spec.kind, anchor: toDateInputValue(next) };
}

/** True when this window contains today — the "Today"/"This month" button is then a no-op. */
export function periodIsCurrent(r: ResolvedPeriod, today = istToday()): boolean {
  return today >= r.start && today < r.endExclusive;
}
