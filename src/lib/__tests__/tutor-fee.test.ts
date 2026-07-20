/**
 * Trainer fee — the batch-size rule from spec Part 2 §5.
 *
 * Pure and DB-free: every input is passed in, so this is the whole rule under test.
 *
 * The boundary cases carry the weight. The rule reads "≥ 5 students → ₹7,000", and an
 * off-by-one there is invisible on screen but pays the tutor the wrong rate on every batch
 * that lands exactly on 5 — which, at a target class size of 8, is a lot of them.
 *
 * Guarding a specific past bug: the shipped code keyed this rate on LEVEL (A1=7000,
 * A2=8000, B1=12000) rather than on headcount. Those numbers look right — 7,000 and 8,000
 * both appear — so the mistake reads as correct until you check which variable moves them.
 * `rateIgnoresLevelByDefault` is the case that would have caught it.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { tutorRatePerHeadRupees, tutorFeeForBatchInrMinor, tutorFeeBandLabel } from "../tutor-fee";
import { DEFAULT_TUTOR_FEE_CONFIG, coerceTutorFeeConfig } from "../config-schema";

describe("tutor fee — rate bands", () => {
  test("5 students earns the at-or-above rate (FIN-004)", () => {
    assert.equal(tutorRatePerHeadRupees("A1", 5, DEFAULT_TUTOR_FEE_CONFIG), 7000);
  });

  test("4 students earns the below rate (FIN-005)", () => {
    assert.equal(tutorRatePerHeadRupees("A1", 4, DEFAULT_TUTOR_FEE_CONFIG), 8000);
  });

  test("the threshold is inclusive, not exclusive", () => {
    // The whole rule turns on this: "≥ 5", so 5 must NOT fall in the below band.
    assert.equal(tutorRatePerHeadRupees("A1", 5, DEFAULT_TUTOR_FEE_CONFIG), 7000);
    assert.equal(tutorRatePerHeadRupees("A1", 6, DEFAULT_TUTOR_FEE_CONFIG), 7000);
    assert.equal(tutorRatePerHeadRupees("A1", 1, DEFAULT_TUTOR_FEE_CONFIG), 8000);
  });

  test("rate is driven by headcount, not by level, by default", () => {
    // Regression guard: the rate must move with the batch size and stay put across levels.
    for (const level of ["A1", "A2", "B1"] as const) {
      assert.equal(tutorRatePerHeadRupees(level, 5, DEFAULT_TUTOR_FEE_CONFIG), 7000, `${level} at 5`);
      assert.equal(tutorRatePerHeadRupees(level, 4, DEFAULT_TUTOR_FEE_CONFIG), 8000, `${level} at 4`);
    }
  });
});

describe("tutor fee — totals (paise)", () => {
  test("the spec's worked examples reproduce exactly", () => {
    // Part 2 §5: "5 people → 5 × ₹7,000; 3 people → ₹8,000 tier"
    assert.equal(tutorFeeForBatchInrMinor("A1", 5, DEFAULT_TUTOR_FEE_CONFIG), 3_500_000); // ₹35,000
    assert.equal(tutorFeeForBatchInrMinor("A1", 3, DEFAULT_TUTOR_FEE_CONFIG), 2_400_000); // ₹24,000
  });

  test("an empty batch costs nothing", () => {
    assert.equal(tutorFeeForBatchInrMinor("A1", 0, DEFAULT_TUTOR_FEE_CONFIG), 0);
  });

  test("a negative headcount cannot produce a negative fee", () => {
    // Not reachable through the UI, but a fee that goes negative would silently credit the
    // business on a batch P&L rather than fail loudly.
    assert.equal(tutorFeeForBatchInrMinor("A1", -3, DEFAULT_TUTOR_FEE_CONFIG), 0);
  });
});

describe("tutor fee — config", () => {
  const tuned = coerceTutorFeeConfig({
    thresholdStudents: 4,
    ratesByLevel: {
      A1: { atOrAbove: 6500, below: 9000 },
      A2: { atOrAbove: 7000, below: 8000 },
      B1: { atOrAbove: 12000, below: 12000 },
    },
  });

  test("a tuned threshold is honoured", () => {
    assert.equal(tutorRatePerHeadRupees("A1", 4, tuned), 6500);
    assert.equal(tutorRatePerHeadRupees("A1", 3, tuned), 9000);
  });

  test("rates may differ per level (Part 2 §5: 'can differ per level')", () => {
    assert.equal(tutorRatePerHeadRupees("B1", 2, tuned), 12000);
    assert.equal(tutorRatePerHeadRupees("A1", 2, tuned), 9000);
  });

  test("an invalid config falls back to the shipped rates instead of throwing", () => {
    // This is read on finance paths; a hand-edited AppSetting row must not blank a P&L page.
    assert.equal(tutorRatePerHeadRupees("A1", 5, coerceTutorFeeConfig({ nonsense: true })), 7000);
    assert.equal(tutorRatePerHeadRupees("A1", 4, coerceTutorFeeConfig(null)), 8000);
    assert.equal(tutorRatePerHeadRupees("A1", 4, coerceTutorFeeConfig(undefined)), 8000);
  });

  test("a partial config is rejected wholesale rather than half-applied", () => {
    // Half a rate table is worse than none: it would pay some levels from the founder's
    // intent and others from a default nobody chose.
    const partial = coerceTutorFeeConfig({ thresholdStudents: 4, ratesByLevel: { A1: { atOrAbove: 1, below: 2 } } });
    assert.deepEqual(partial, DEFAULT_TUTOR_FEE_CONFIG);
  });
});

describe("tutor fee — band label", () => {
  test("states which side of the threshold a batch landed on", () => {
    assert.match(tutorFeeBandLabel("A1", 5), /at-or-above 5/);
    assert.match(tutorFeeBandLabel("A1", 5), /7,000/);
    assert.match(tutorFeeBandLabel("A1", 1), /below 5/);
  });

  test("singular for one student", () => {
    assert.match(tutorFeeBandLabel("A1", 1), /^1 student /);
    assert.match(tutorFeeBandLabel("A1", 2), /^2 students /);
  });
});
