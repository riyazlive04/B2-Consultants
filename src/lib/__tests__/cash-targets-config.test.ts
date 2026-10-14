/**
 * Cash Health's targets - the numbers that used to be literals in the code.
 *
 * `TARGET_INR = 80_000_000` lived in `server/cash-metrics.ts` and drove "Months to ₹8L / month",
 * so reaching ₹8L made the card read "Reached" for ever and raising the bar needed a deploy. The
 * runway's ≥6 / 3-6 / <3 bands were in `lib/signals.ts`, burn averaged three months because a
 * `-3` was written into a query, and a bill due this week was flagged at "less than twice it in
 * the bank".
 *
 * These tests defend the PROPERTIES, not the numbers:
 *   · the shipped defaults equal the literals they replaced, so an install that never opens the
 *     panel reads exactly as it did before;
 *   · a hand-edited or partial setting falls back to the defaults instead of taking Cash Health
 *     down (`coerce…`), which is the house rule for every founder config;
 *   · the green/amber bands cannot cross, because the same runway would then be two colours;
 *   · `signalForRunway` honours whichever bands it is handed - including bands that make a
 *     runway the old hardcoded version would have called green read as red.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  cashTargetsConfigSchema,
  coerceCashTargetsConfig,
  DEFAULT_CASH_TARGETS_CONFIG,
} from "../config-schema";
import { signalForRunway } from "../signals";

describe("the shipped defaults are the old hardcoded literals", () => {
  test("every one of them, exactly", () => {
    assert.deepEqual(DEFAULT_CASH_TARGETS_CONFIG, {
      monthlyRevenueTargetInrMinor: 80_000_000, // ₹8,00,000 - cash-metrics.ts TARGET_INR
      runwayGreenMonths: 6, // signals.ts
      runwayAmberMonths: 3, // signals.ts
      runwayHorizonMonths: 12, // the gauge's old /12
      payableBufferMultiple: 2, // the old `cash < 2 * payable` red rule
      burnWindowMonths: 3, // the old "last 3 calendar months"
    });
  });

  test("and `signalForRunway` with no bands still applies them", () => {
    assert.equal(signalForRunway(6), "ok");
    assert.equal(signalForRunway(5.9), "watch");
    assert.equal(signalForRunway(3), "watch");
    assert.equal(signalForRunway(2.9), "risk");
  });
});

describe("a bad stored value can never take Cash Health down", () => {
  test("rubbish, a partial object and null all fall back to the defaults", () => {
    assert.deepEqual(coerceCashTargetsConfig(null), DEFAULT_CASH_TARGETS_CONFIG);
    assert.deepEqual(coerceCashTargetsConfig("nonsense"), DEFAULT_CASH_TARGETS_CONFIG);
    assert.deepEqual(
      coerceCashTargetsConfig({ runwayGreenMonths: 9 }),
      DEFAULT_CASH_TARGETS_CONFIG,
      "a partial object is not merged - a half-config is a hand-edit, not an intention",
    );
  });

  test("a complete, valid object is kept as-is", () => {
    const mine = {
      monthlyRevenueTargetInrMinor: 150_000_000,
      runwayGreenMonths: 9,
      runwayAmberMonths: 4.5,
      runwayHorizonMonths: 18,
      payableBufferMultiple: 1.5,
      burnWindowMonths: 6,
    };
    assert.deepEqual(coerceCashTargetsConfig(mine), mine);
  });
});

describe("the bands cannot cross", () => {
  test("green below amber is refused", () => {
    const parsed = cashTargetsConfigSchema.safeParse({
      ...DEFAULT_CASH_TARGETS_CONFIG,
      runwayGreenMonths: 2,
      runwayAmberMonths: 5,
    });
    assert.equal(parsed.success, false);
  });

  test("green equal to amber is allowed - it just removes the amber band", () => {
    const parsed = cashTargetsConfigSchema.safeParse({
      ...DEFAULT_CASH_TARGETS_CONFIG,
      runwayGreenMonths: 4,
      runwayAmberMonths: 4,
    });
    assert.equal(parsed.success, true);
    assert.equal(signalForRunway(4, { green: 4, amber: 4 }), "ok");
    assert.equal(signalForRunway(3.9, { green: 4, amber: 4 }), "risk");
  });

  test("a zero revenue target is allowed - it retires the card, it is not invalid", () => {
    assert.equal(
      cashTargetsConfigSchema.safeParse({
        ...DEFAULT_CASH_TARGETS_CONFIG,
        monthlyRevenueTargetInrMinor: 0,
      }).success,
      true,
    );
  });
});

describe("the founder's bands are what decide the verdict", () => {
  test("a stricter business calls 8 months amber where the default calls it green", () => {
    const strict = { green: 12, amber: 6 };
    assert.equal(signalForRunway(8), "ok", "under the shipped bands");
    assert.equal(signalForRunway(8, strict), "watch", "under the founder's");
    assert.equal(signalForRunway(5, strict), "risk");
    assert.equal(signalForRunway(12, strict), "ok");
  });

  test("zero runway is red under any bands", () => {
    assert.equal(signalForRunway(0), "risk");
    assert.equal(signalForRunway(0, { green: 0, amber: 0 }), "ok", "unless the founder sets 0 as safe");
  });
});
