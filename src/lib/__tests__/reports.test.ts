/**
 * Reports workbench - period resolution, chart selection and measure semantics.
 *
 * All pure, and all three are places where a wrong answer looks completely plausible: a
 * comparison window off by a month, a ranking drawn as a line, or a "share of total win rate".
 * None of those throw; they just quietly mislead the person deciding where the ad budget goes.
 *
 * `resolveReportRange` takes its `ref` instant explicitly, so no fake timers.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  GROUP_BY_FIELDS,
  MEASURES,
  RANGE_OPTIONS,
  chartShapeFor,
  defaultGroupBy,
  defaultMeasure,
  isTimeGroupBy,
  isValidGroupBy,
  isValidMeasure,
  measureIsAdditive,
  measurePrevValue,
  measureValue,
  parseReportRange,
  reportHref,
  resolveReportRange,
  type ReportObject,
  type ReportRow,
} from "../reports";

const REF = new Date("2026-07-29T12:00:00.000Z");

describe("parseReportRange", () => {
  test("defaults to 90 days for anything absent or unrecognised", () => {
    assert.equal(parseReportRange(undefined), "90d");
    assert.equal(parseReportRange("nonsense"), "90d");
    // A hand-edited or stale link must degrade, never throw.
    assert.equal(parseReportRange(["30d", "90d"]), "30d");
  });

  test("accepts every advertised preset", () => {
    for (const o of RANGE_OPTIONS) assert.equal(parseReportRange(o.value), o.value);
  });
});

describe("resolveReportRange", () => {
  test("the comparison window is equal-length and immediately prior - never year-ago", () => {
    const r = resolveReportRange("30d", REF);
    assert.ok(r.from && r.previous);
    const span = r.to.getTime() - r.from.getTime();
    const prevSpan = r.previous.to.getTime() - r.previous.from.getTime();
    assert.equal(prevSpan, span, "windows must be the same length or every delta is a lie");
    assert.equal(r.previous.to.getTime(), r.from.getTime(), "the windows must be adjacent");
  });

  test("windows do not overlap, so no record is counted in both", () => {
    for (const key of ["30d", "90d", "6m", "12m", "ytd"] as const) {
      const r = resolveReportRange(key, REF);
      assert.ok(r.previous && r.from);
      assert.ok(r.previous.to.getTime() <= r.from.getTime(), `${key} overlaps`);
    }
  });

  test("all time has no lower bound and nothing to compare", () => {
    const r = resolveReportRange("all", REF);
    assert.equal(r.from, null);
    assert.equal(r.previous, null);
    assert.equal(r.compareLabel, "", "an empty compare label is what switches every delta off");
  });

  test("ytd starts on 1 January of the reference year", () => {
    const r = resolveReportRange("ytd", REF);
    assert.ok(r.from);
    assert.equal(r.from.getUTCFullYear(), 2026);
    assert.equal(r.from.getUTCMonth(), 0);
    assert.equal(r.from.getUTCDate(), 1);
  });

  test("the upper bound is the reference instant, so today's records are included", () => {
    const r = resolveReportRange("90d", REF);
    assert.equal(r.to.getTime(), REF.getTime());
  });

  test("month-based presets step by calendar months, not by 30-day blocks", () => {
    const r = resolveReportRange("6m", REF);
    assert.ok(r.from);
    assert.equal(r.from.getUTCMonth(), 0, "July minus six months is January");
    assert.equal(r.from.getUTCFullYear(), 2026);
  });
});

describe("chartShapeFor", () => {
  test("categorical groupings always rank as bars - never a line across categories", () => {
    assert.equal(chartShapeFor("leadSource", 4), "bars");
    assert.equal(chartShapeFor("stage", 30), "bars");
  });

  test("few time buckets compare as columns; many read as a trend line", () => {
    assert.equal(chartShapeFor("createdMonth", 3), "column");
    assert.equal(chartShapeFor("createdMonth", 6), "column");
    assert.equal(chartShapeFor("createdMonth", 7), "line");
    assert.equal(chartShapeFor("createdMonth", 12), "line");
  });

  test("isTimeGroupBy is the single source for what counts as chronological", () => {
    assert.equal(isTimeGroupBy("createdMonth"), true);
    assert.equal(isTimeGroupBy("stage"), false);
  });
});

describe("measures", () => {
  const row: ReportRow = {
    key: "k",
    label: "Instagram",
    count: 40,
    sumMinor: 125000,
    winRatePct: 25,
    prevCount: 30,
    prevSumMinor: 100000,
    prevWinRatePct: 20,
  };

  test("measureValue and measurePrevValue read the same field", () => {
    assert.equal(measureValue(row, "count"), 40);
    assert.equal(measurePrevValue(row, "count"), 30);
    assert.equal(measureValue(row, "value"), 125000);
    assert.equal(measurePrevValue(row, "value"), 100000);
    assert.equal(measureValue(row, "winRate"), 25);
    assert.equal(measurePrevValue(row, "winRate"), 20);
  });

  test("a missing previous window stays null rather than collapsing to zero", () => {
    // Zero would render as "▼ 100%" - a confident claim that something dropped, from no data.
    const noPrev: ReportRow = { ...row, prevCount: null, prevSumMinor: null, prevWinRatePct: null };
    assert.equal(measurePrevValue(noPrev, "count"), null);
    assert.equal(measurePrevValue(noPrev, "value"), null);
    assert.equal(measurePrevValue(noPrev, "winRate"), null);
  });

  test("win rate is not additive - no share column, no total row", () => {
    assert.equal(measureIsAdditive("count"), true);
    assert.equal(measureIsAdditive("value"), true);
    assert.equal(measureIsAdditive("winRate"), false, "a 'share of total win rate' is nonsense");
  });

  test("contacts offer only count - they carry no money or outcome field", () => {
    assert.deepEqual(MEASURES.contacts.map((m) => m.key), ["count"]);
    assert.equal(defaultMeasure("contacts"), "count");
    assert.equal(isValidMeasure("contacts", "value"), false);
    assert.equal(isValidMeasure("opportunities", "value"), true);
  });
});

describe("catalogue integrity", () => {
  const objects: ReportObject[] = ["contacts", "opportunities", "invoices"];

  test("every object's default group-by is one of its own fields", () => {
    for (const o of objects) {
      assert.ok(isValidGroupBy(o, defaultGroupBy(o)), `${o} default group-by is not in its list`);
    }
  });

  test("a group-by from one object is rejected by another", () => {
    // This is what makes switching object safe: the stale param cannot survive the jump.
    assert.equal(isValidGroupBy("contacts", "kind"), false);
    assert.equal(isValidGroupBy("invoices", "leadSource"), false);
  });

  test("group-by keys are unique per object", () => {
    for (const o of objects) {
      const keys = GROUP_BY_FIELDS[o].map((f) => f.key);
      assert.equal(new Set(keys).size, keys.length, `${o} has a duplicate group-by key`);
    }
  });
});

describe("reportHref", () => {
  test("carries all four choices, so a shared link reproduces the exact report", () => {
    const href = reportHref({ object: "opportunities", groupBy: "source", measure: "value", range: "30d" });
    const q = new URLSearchParams(href.split("?")[1]);
    assert.equal(q.get("object"), "opportunities");
    assert.equal(q.get("groupBy"), "source");
    assert.equal(q.get("measure"), "value");
    assert.equal(q.get("range"), "30d");
  });
});
