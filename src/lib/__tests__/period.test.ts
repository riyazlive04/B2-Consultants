import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERIOD,
  parsePeriod,
  periodIsCurrent,
  periodQuery,
  resolvePeriod,
  shiftPeriod,
  type PeriodSpec,
} from "../period";

/**
 * The period maths sits under every money figure and every lead count in the app, and its
 * failure mode is silent: an off-by-one boundary does not throw, it just quietly drops or
 * double-counts a day's revenue. So the boundaries are the thing under test, not the labels.
 *
 * `istToday()` is injected everywhere as `today` so these never depend on the wall clock.
 */

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const TODAY = d("2026-07-15"); // a Wednesday, mid-month, mid-Q3

test("month is half-open [1st, 1st of next month)", () => {
  const r = resolvePeriod({ kind: "month", anchor: "2026-07-15" }, TODAY);
  assert.equal(r.start.toISOString(), d("2026-07-01").toISOString());
  assert.equal(r.endExclusive.toISOString(), d("2026-08-01").toISOString());
  assert.equal(r.label, "July 2026");
});

test("month's previous window is the previous CALENDAR month, not 31 days back", () => {
  // July has 31 days, June has 30. A naive same-length shift would start "previous" on 31 May.
  const r = resolvePeriod({ kind: "month", anchor: "2026-07-15" }, TODAY);
  assert.equal(r.previous?.start.toISOString(), d("2026-06-01").toISOString());
  assert.equal(r.previous?.endExclusive.toISOString(), d("2026-07-01").toISOString());
});

test("week runs Monday → next Monday", () => {
  const r = resolvePeriod({ kind: "week", anchor: "2026-07-15" }, TODAY);
  assert.equal(r.start.getUTCDay(), 1, "starts on a Monday");
  assert.equal(r.endExclusive.getTime() - r.start.getTime(), 7 * 86_400_000);
  assert.equal(r.previous?.endExclusive.toISOString(), r.start.toISOString(), "previous abuts");
});

test("custom range INCLUDES its end day", () => {
  // The single most dangerous boundary here: `to` is what a human picked in a date field, so a
  // range ending 31 July must contain 31 July. Treating it as exclusive silently drops the last
  // day of every month-end report.
  const r = resolvePeriod({ kind: "custom", anchor: "2026-07-01", from: "2026-07-01", to: "2026-07-31" }, TODAY);
  assert.equal(r.start.toISOString(), d("2026-07-01").toISOString());
  assert.equal(r.endExclusive.toISOString(), d("2026-08-01").toISOString());
});

test("quarter and year resolve to calendar boundaries", () => {
  const q = resolvePeriod({ kind: "quarter", anchor: "2026-07-15" }, TODAY);
  assert.equal(q.start.toISOString(), d("2026-07-01").toISOString());
  assert.equal(q.endExclusive.toISOString(), d("2026-10-01").toISOString());
  assert.equal(q.label, "Q3 2026");

  const y = resolvePeriod({ kind: "year", anchor: "2026-07-15" }, TODAY);
  assert.equal(y.start.toISOString(), d("2026-01-01").toISOString());
  assert.equal(y.endExclusive.toISOString(), d("2027-01-01").toISOString());
});

test("'all' includes today and has no previous window", () => {
  const r = resolvePeriod({ kind: "all", anchor: "" }, TODAY);
  assert.ok(r.start < TODAY);
  assert.ok(r.endExclusive > TODAY, "today must fall inside all-time");
  assert.equal(r.previous, null);
});

test("shifting steps exactly one window and does not stick on a boundary", () => {
  const july: PeriodSpec = { kind: "month", anchor: "2026-07-15" };
  const june = resolvePeriod(shiftPeriod(july, -1, TODAY), TODAY);
  assert.equal(june.label, "June 2026");
  const august = resolvePeriod(shiftPeriod(july, 1, TODAY), TODAY);
  assert.equal(august.label, "August 2026");

  // Stepping back then forward returns to the same window - the anchor must land INSIDE the
  // neighbour, never on its boundary, or the arrows stall.
  const back = shiftPeriod(july, -1, TODAY);
  assert.equal(resolvePeriod(shiftPeriod(back, 1, TODAY), TODAY).label, "July 2026");
});

test("shifting a custom range moves it by its own length, keeping the inclusive end", () => {
  const week: PeriodSpec = { kind: "custom", anchor: "2026-07-08", from: "2026-07-08", to: "2026-07-14" };
  const prev = shiftPeriod(week, -1, TODAY);
  assert.equal(prev.from, "2026-07-01");
  assert.equal(prev.to, "2026-07-07");
});

test("shifting 'all' is a no-op so the arrows can simply be disabled", () => {
  const all: PeriodSpec = { kind: "all", anchor: "" };
  assert.deepEqual(shiftPeriod(all, -1, TODAY), all);
  assert.deepEqual(shiftPeriod(all, 1, TODAY), all);
});

test("parsePeriod never throws and falls back to the default", () => {
  assert.deepEqual(parsePeriod({}), DEFAULT_PERIOD);
  assert.deepEqual(parsePeriod({ period: "nonsense" }), DEFAULT_PERIOD);
  assert.deepEqual(parsePeriod({ period: "month", on: "not-a-date" }), DEFAULT_PERIOD);
  // custom without both ends is not a custom range
  assert.deepEqual(parsePeriod({ period: "custom", from: "2026-07-01" }), { kind: "custom", anchor: "" });
});

test("parsePeriod orders a backwards custom range instead of rejecting it", () => {
  const p = parsePeriod({ period: "custom", from: "2026-07-31", to: "2026-07-01" });
  assert.equal(p.from, "2026-07-01");
  assert.equal(p.to, "2026-07-31");
});

test("legacy ?range=N days still parses - saved links must not break", () => {
  const p = parsePeriod({ range: "90" });
  assert.equal(p.kind, "custom");
  assert.ok(p.from && p.to, "resolves to a concrete window");
});

test("query round-trips through parsePeriod", () => {
  for (const spec of [
    { kind: "month", anchor: "2026-07-15" },
    { kind: "week", anchor: "2026-07-15" },
    { kind: "all", anchor: "" },
    { kind: "custom", anchor: "2026-07-01", from: "2026-07-01", to: "2026-07-31" },
  ] as PeriodSpec[]) {
    const q = Object.fromEntries(new URLSearchParams(periodQuery(spec)));
    assert.deepEqual(parsePeriod(q), spec, `round-trip failed for ${spec.kind}`);
  }
});

test("periodIsCurrent is true only for the window containing today", () => {
  assert.equal(periodIsCurrent(resolvePeriod({ kind: "month", anchor: "" }, TODAY), TODAY), true);
  assert.equal(periodIsCurrent(resolvePeriod({ kind: "month", anchor: "2026-05-02" }, TODAY), TODAY), false);
});
