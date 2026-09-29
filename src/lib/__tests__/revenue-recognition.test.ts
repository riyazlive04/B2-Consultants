import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  recognise,
  recogniseAll,
  endDateForDuration,
  inclusiveDays,
  type RecognisableAmount,
} from "../revenue-recognition";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** ₹1,20,000 in paise - divides evenly by 120 days, so the arithmetic stays readable. */
const FEE = 12_000_000;

/** A 120-day Elite program starting 1 Jan, paid in full on day one. */
const elite: RecognisableAmount = {
  amountMinor: FEE,
  startDate: d("2026-01-01"),
  endDate: d("2026-04-30"), // 120 days inclusive
};

describe("day arithmetic", () => {
  test("inclusive days counts both endpoints", () => {
    assert.equal(inclusiveDays(d("2026-01-01"), d("2026-01-01")), 1);
    assert.equal(inclusiveDays(d("2026-01-01"), d("2026-01-31")), 31);
    assert.equal(inclusiveDays(d("2026-01-01"), d("2026-04-30")), 120);
  });

  test("a duration's end date is inclusive", () => {
    // A 90-day program starting on the 1st ends on day 90, not day 91.
    assert.equal(endDateForDuration(d("2026-01-01"), "DAYS_90")!.toISOString().slice(0, 10), "2026-03-31");
    assert.equal(inclusiveDays(d("2026-01-01"), endDateForDuration(d("2026-01-01"), "DAYS_90")!), 90);
    assert.equal(inclusiveDays(d("2026-01-01"), endDateForDuration(d("2026-01-01"), "DAYS_120")!), 120);
  });

  test("LIFETIME has no end date", () => {
    assert.equal(endDateForDuration(d("2026-01-01"), "LIFETIME"), null);
  });
});

describe("the bug this fixes", () => {
  /**
   * THE HEADLINE CASE. Cash accounting books the whole ₹1,20,000 in January. Straight-line books
   * one month of it and defers the rest - which is what makes the January margin figure
   * survivable in April.
   */
  test("a 120-day program does not book all its revenue in month one", () => {
    const jan = recognise(elite, { from: d("2026-01-01"), to: d("2026-01-31") });
    assert.equal(jan.recognisedMinor, (FEE * 31) / 120);
    assert.equal(jan.deferredMinor, FEE - (FEE * 31) / 120);
    assert.ok(jan.recognisedMinor < FEE, "the whole fee must NOT land in January");
  });

  test("the deferred balance unwinds to zero by the end of the program", () => {
    const final = recognise(elite, { from: d("2026-04-01"), to: d("2026-04-30") });
    assert.equal(final.deferredMinor, 0);
  });

  test("every month of the program earns something", () => {
    const months: [string, string][] = [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
    ];
    for (const [from, to] of months) {
      const r = recognise(elite, { from: d(from), to: d(to) });
      assert.ok(r.recognisedMinor > 0, `${from} should earn revenue`);
    }
  });
});

describe("no drift", () => {
  test("month-by-month recognition sums to exactly the fee", () => {
    // The whole point of computing on CUMULATIVE elapsed days rather than summing per-day
    // shares: a few paise left permanently unrecognised is the residue that makes an
    // accountant distrust the entire report.
    const months: [string, string][] = [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
    ];
    const total = months.reduce(
      (a, [from, to]) => a + recognise(elite, { from: d(from), to: d(to) }).recognisedMinor,
      0,
    );
    assert.equal(total, FEE);
  });

  test("an amount that divides badly still sums to exactly itself", () => {
    // 99,999 paise over 120 days divides into nothing clean.
    const awkward: RecognisableAmount = { amountMinor: 99_999, startDate: d("2026-01-01"), endDate: d("2026-04-30") };
    let total = 0;
    for (let day = 0; day < 120; day++) {
      const on = new Date(d("2026-01-01").getTime() + day * 86_400_000);
      total += recognise(awkward, { from: on, to: on }).recognisedMinor;
    }
    assert.equal(total, 99_999, "day-by-day recognition loses nothing");
  });

  test("prior + recognised + deferred always equals the amount", () => {
    const mid = recognise(elite, { from: d("2026-02-10"), to: d("2026-03-05") });
    assert.equal(mid.priorMinor + mid.recognisedMinor + mid.deferredMinor, FEE);
  });
});

describe("windows outside the service period", () => {
  test("a window entirely before the start recognises nothing and defers everything", () => {
    const r = recognise(elite, { from: d("2025-11-01"), to: d("2025-12-31") });
    assert.equal(r.recognisedMinor, 0);
    assert.equal(r.priorMinor, 0);
    assert.equal(r.deferredMinor, FEE);
    assert.equal(r.daysInWindow, 0);
  });

  test("a window entirely after the end recognises nothing new and defers nothing", () => {
    const r = recognise(elite, { from: d("2026-06-01"), to: d("2026-06-30") });
    assert.equal(r.recognisedMinor, 0);
    assert.equal(r.priorMinor, FEE, "it was all earned before this window");
    assert.equal(r.deferredMinor, 0);
  });

  test("a window spanning the whole program recognises the whole fee", () => {
    const r = recognise(elite, { from: d("2025-01-01"), to: d("2027-01-01") });
    assert.equal(r.recognisedMinor, FEE);
    assert.equal(r.deferredMinor, 0);
    assert.equal(r.daysInWindow, 120);
  });
});

describe("no service period", () => {
  const solo: RecognisableAmount = { amountMinor: 5_000_000, startDate: d("2026-02-14"), endDate: null };

  test("LIFETIME is recognised immediately, and says so", () => {
    // There is no ongoing obligation to spread across. Inventing a notional 12-month period
    // would be a fabrication dressed up as prudence.
    const r = recognise(solo, { from: d("2026-02-01"), to: d("2026-02-28") });
    assert.equal(r.recognisedMinor, 5_000_000);
    assert.equal(r.deferredMinor, 0);
    assert.equal(r.immediate, true);
  });

  test("it lands in the month it was paid, not in every month", () => {
    const march = recognise(solo, { from: d("2026-03-01"), to: d("2026-03-31") });
    assert.equal(march.recognisedMinor, 0);
    assert.equal(march.priorMinor, 5_000_000);
    assert.equal(march.deferredMinor, 0);
  });

  test("a future immediate payment is deferred until its own day", () => {
    const jan = recognise(solo, { from: d("2026-01-01"), to: d("2026-01-31") });
    assert.equal(jan.recognisedMinor, 0);
    assert.equal(jan.deferredMinor, 5_000_000);
  });
});

describe("totals", () => {
  test("cash and recognised are reported side by side and genuinely differ", () => {
    // This is the whole product of the module: in the month of sale, cash is the full fee and
    // recognised is a slice of it. A report showing only one of the two misleads either the
    // founders or their accountant.
    const totals = recogniseAll([elite], { from: d("2026-01-01"), to: d("2026-01-31") });
    assert.equal(totals.cashMinor, FEE);
    assert.equal(totals.recognisedMinor, (FEE * 31) / 120);
    assert.ok(totals.cashMinor > totals.recognisedMinor);
  });

  test("a later month shows recognised revenue with no cash at all", () => {
    const totals = recogniseAll([elite], { from: d("2026-03-01"), to: d("2026-03-31") });
    assert.equal(totals.cashMinor, 0, "nothing arrived in March");
    assert.ok(totals.recognisedMinor > 0, "but March still earned revenue");
  });

  test("immediate items are counted so a report can explain itself", () => {
    const totals = recogniseAll(
      [elite, { amountMinor: 100, startDate: d("2026-01-05"), endDate: null }],
      { from: d("2026-01-01"), to: d("2026-01-31") },
    );
    assert.equal(totals.itemCount, 2);
    assert.equal(totals.immediateCount, 1);
  });

  test("an empty set is all zeroes, not NaN", () => {
    const totals = recogniseAll([], { from: d("2026-01-01"), to: d("2026-01-31") });
    assert.deepEqual(totals, {
      cashMinor: 0,
      recognisedMinor: 0,
      deferredMinor: 0,
      immediateCount: 0,
      itemCount: 0,
    });
  });
});
