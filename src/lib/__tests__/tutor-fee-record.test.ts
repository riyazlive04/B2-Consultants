/**
 * Tutor fee record - the rules around persisting the fee (ER v2 Track C).
 *
 * The rate arithmetic itself is covered by tutor-fee.test.ts; what is under test here is
 * everything that decides whether a row may CHANGE, and which number the money reads.
 *
 * Two cases carry the weight:
 *   · `payableAmountInrMinor` - an override that shows on screen but is ignored by the ledger
 *     is the kind of bug that is only found by an accountant, months later.
 *   · `isRecomputable` - a nightly recompute that touched APPROVED rows would silently
 *     re-price work the founder already signed off on.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  computeTutorFee,
  tutorFeeLevelFromCode,
  isRecomputable,
  canTransition,
  payableAmountInrMinor,
} from "../tutor-fee-record";
import { DEFAULT_TUTOR_FEE_CONFIG } from "../config-schema";

describe("tutor fee record - level resolution", () => {
  test("strips the GN_ prefix that Level.code carries", () => {
    assert.equal(tutorFeeLevelFromCode("GN_A1"), "A1");
    assert.equal(tutorFeeLevelFromCode("GN_B1"), "B1");
    assert.equal(tutorFeeLevelFromCode("A2"), "A2");
  });

  test("coaching tiers and unknown levels carry NO trainer fee", () => {
    // Not "zero" - coaching is delivered by a salaried coach, so the concept doesn't apply.
    assert.equal(tutorFeeLevelFromCode("GUIDED"), null);
    assert.equal(tutorFeeLevelFromCode("GN_C1"), null);
    assert.equal(tutorFeeLevelFromCode("GN_BUNDLE"), null);
  });
});

describe("tutor fee record - compute", () => {
  test("snapshots headcount, rate and total from the spec's worked example", () => {
    // 5 students in A1 → 5 × ₹7,000 = ₹35,000 (spec Part 2 §5).
    const fee = computeTutorFee("GN_A1", 5, DEFAULT_TUTOR_FEE_CONFIG);
    assert.ok(fee);
    assert.equal(fee.headcount, 5);
    assert.equal(fee.ratePerHeadInrMinor, 700_000n); // ₹7,000 in paise
    assert.equal(fee.amountInrMinor, 3_500_000n); // ₹35,000 in paise
  });

  test("below the threshold takes the higher per-head rate", () => {
    const fee = computeTutorFee("GN_A1", 3, DEFAULT_TUTOR_FEE_CONFIG);
    assert.ok(fee);
    assert.equal(fee.amountInrMinor, 2_400_000n); // 3 × ₹8,000
  });

  test("the band label explains WHICH tier applied - the founders' sheet shows the tier", () => {
    const fee = computeTutorFee("GN_A1", 5, DEFAULT_TUTOR_FEE_CONFIG);
    assert.match(fee!.bandLabel, /at or above 5/);
    const small = computeTutorFee("GN_A1", 3, DEFAULT_TUTOR_FEE_CONFIG);
    assert.match(small!.bandLabel, /below 5/);
  });

  test("returns null - not a zero row - for a level with no fee concept", () => {
    assert.equal(computeTutorFee("GUIDED", 5, DEFAULT_TUTOR_FEE_CONFIG), null);
  });

  test("an empty batch costs nothing", () => {
    assert.equal(computeTutorFee("GN_A1", 0, DEFAULT_TUTOR_FEE_CONFIG)?.amountInrMinor, 0n);
  });
});

describe("tutor fee record - freezing", () => {
  test("only DRAFT rows track the roster", () => {
    assert.equal(isRecomputable("DRAFT"), true);
    // The one that matters: a nightly recompute must never re-price signed-off work.
    assert.equal(isRecomputable("APPROVED"), false);
    assert.equal(isRecomputable("PAID"), false);
    assert.equal(isRecomputable("CANCELLED"), false);
  });

  test("status transitions follow the approval ladder", () => {
    assert.equal(canTransition("DRAFT", "APPROVED"), true);
    assert.equal(canTransition("APPROVED", "PAID"), true);
    assert.equal(canTransition("CANCELLED", "DRAFT"), true);
  });

  test("PAID is terminal, and approval cannot be skipped", () => {
    assert.equal(canTransition("PAID", "DRAFT"), false);
    assert.equal(canTransition("PAID", "APPROVED"), false);
    assert.equal(canTransition("DRAFT", "PAID"), false);
  });
});

describe("tutor fee record - what the money reads", () => {
  test("no override → the computed amount", () => {
    assert.equal(
      payableAmountInrMinor({ amountInrMinor: 3_500_000n, overrideAmountInrMinor: null }),
      3_500_000n,
    );
  });

  test("an override WINS - the P&L, the accrual and the payout must all agree with the screen", () => {
    assert.equal(
      payableAmountInrMinor({ amountInrMinor: 3_500_000n, overrideAmountInrMinor: 3_000_000n }),
      3_000_000n,
    );
  });

  test("a zero override is honoured, not treated as absent", () => {
    // `?? ` not `||` - a deliberate ₹0 fee (a trainer waived it) must not fall through to the
    // computed amount. This is exactly the case a truthiness check would get wrong.
    assert.equal(
      payableAmountInrMinor({ amountInrMinor: 3_500_000n, overrideAmountInrMinor: 0n }),
      0n,
    );
  });
});
