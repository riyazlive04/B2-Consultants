/**
 * Instalment-plan arithmetic — the surcharge lookup, the exact split, and the due-date walk.
 *
 * All pure, no DB, no clock: dates are passed in. The split cases carry the weight — a plan
 * that doesn't sum back to the total means a receivable that can never reach zero, so the
 * student stays "owing" forever after paying in full. That is the failure this file exists
 * to prevent, and it only shows up on totals that don't divide evenly.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  instalmentDueDates,
  instalmentExtraFor,
  splitInstalments,
  totalToCollect,
  type MoneyMinor,
} from "../instalment-plan";
import { DEFAULT_INSTALMENT_PLAN_CONFIG, type InstalmentPlanConfig } from "../config-schema";

const m = (inr: number, eur = 0): MoneyMinor => ({ inr: BigInt(inr), eur: BigInt(eur) });
const sum = (rows: MoneyMinor[]) =>
  rows.reduce((a, r) => ({ inr: a.inr + r.inr, eur: a.eur + r.eur }), m(0));

const CONFIG: InstalmentPlanConfig = {
  defaultIntervalDays: 30,
  tiers: [
    { count: 2, extraInrMinor: 40_000, extraEurMinor: 370 },
    { count: 3, extraInrMinor: 60_000, extraEurMinor: 550 },
  ],
};

describe("instalmentExtraFor", () => {
  test("returns the tier's flat surcharge for a priced length", () => {
    assert.deepEqual(instalmentExtraFor(3, CONFIG), m(60_000, 550));
  });

  test("an unpriced length costs nothing — never an invented charge", () => {
    assert.deepEqual(instalmentExtraFor(7, CONFIG), m(0, 0));
  });

  test("the shipped default prices only the 3-part plan the founder stated", () => {
    assert.deepEqual(instalmentExtraFor(3, DEFAULT_INSTALMENT_PLAN_CONFIG), m(60_000, 0));
    assert.deepEqual(instalmentExtraFor(2, DEFAULT_INSTALMENT_PLAN_CONFIG), m(0, 0));
    assert.deepEqual(instalmentExtraFor(4, DEFAULT_INSTALMENT_PLAN_CONFIG), m(0, 0));
  });

  test("the surcharge is flat, NOT per instalment", () => {
    // ₹600 once on a 3-part plan — the whole point of the founder's answer.
    const extra = instalmentExtraFor(3, CONFIG);
    assert.equal(extra.inr, BigInt(60_000));
    assert.notEqual(extra.inr, BigInt(60_000) * BigInt(3));
  });
});

describe("totalToCollect", () => {
  test("adds the surcharge to the agreed fee", () => {
    // ₹1,50,000 fee + ₹600 plan extra = ₹1,50,600
    assert.deepEqual(totalToCollect(m(15_000_000), m(60_000)), m(15_060_000));
  });

  test("keeps the two currencies independent", () => {
    assert.deepEqual(totalToCollect(m(0, 140_000), m(0, 550)), m(0, 140_550));
  });
});

describe("splitInstalments", () => {
  test("splits an even total into equal parts", () => {
    const rows = splitInstalments(m(15_060_000), 3);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.inr), [BigInt(5_020_000), BigInt(5_020_000), BigInt(5_020_000)]);
  });

  test("an indivisible total still sums back exactly — remainder on the last row", () => {
    // 100 paise over 3 → 33 / 33 / 34
    const rows = splitInstalments(m(100), 3);
    assert.deepEqual(rows.map((r) => Number(r.inr)), [33, 33, 34]);
    assert.equal(sum(rows).inr, BigInt(100));
  });

  test("sums back exactly across many awkward totals and counts", () => {
    for (const total of [1, 7, 99, 100_001, 15_060_001, 999_999_999]) {
      for (const count of [2, 3, 4, 6, 7, 11, 24]) {
        const rows = splitInstalments(m(total, total), count);
        assert.equal(rows.length, count);
        assert.equal(sum(rows).inr, BigInt(total), `inr ${total}/${count}`);
        assert.equal(sum(rows).eur, BigInt(total), `eur ${total}/${count}`);
      }
    }
  });

  test("every instalment before the last is the amount the student was quoted", () => {
    const rows = splitInstalments(m(100), 3);
    assert.equal(rows[0].inr, rows[1].inr);
  });

  test("a single instalment takes the whole total", () => {
    assert.deepEqual(splitInstalments(m(12_345), 1), [m(12_345)]);
  });

  test("a nonsense count yields no schedule rather than dividing by zero", () => {
    assert.deepEqual(splitInstalments(m(100), 0), []);
    assert.deepEqual(splitInstalments(m(100), -3), []);
    assert.deepEqual(splitInstalments(m(100), 2.5), []);
  });
});

describe("instalmentDueDates", () => {
  const first = new Date(Date.UTC(2026, 7, 15)); // 15 Aug 2026

  test("walks forward by the interval from the first due date", () => {
    const dates = instalmentDueDates(first, 3, 30);
    assert.deepEqual(
      dates.map((d) => d.toISOString().slice(0, 10)),
      ["2026-08-15", "2026-09-14", "2026-10-14"],
    );
  });

  test("crosses a month and a year boundary correctly", () => {
    const dates = instalmentDueDates(new Date(Date.UTC(2026, 11, 20)), 3, 30);
    assert.deepEqual(
      dates.map((d) => d.toISOString().slice(0, 10)),
      ["2026-12-20", "2027-01-19", "2027-02-18"],
    );
  });

  test("does not mutate the date it was handed", () => {
    const before = first.toISOString();
    instalmentDueDates(first, 6, 30);
    assert.equal(first.toISOString(), before);
  });

  test("no drift accumulates — the nth date is exactly n intervals out", () => {
    const dates = instalmentDueDates(first, 12, 30);
    const days = (dates[11].getTime() - dates[0].getTime()) / 86_400_000;
    assert.equal(days, 11 * 30);
  });

  test("stays at UTC midnight so it matches the @db.Date columns", () => {
    for (const d of instalmentDueDates(first, 4, 30)) {
      assert.equal(d.toISOString().slice(10), "T00:00:00.000Z");
    }
  });

  test("a nonsense count yields no dates", () => {
    assert.deepEqual(instalmentDueDates(first, 0, 30), []);
  });
});
