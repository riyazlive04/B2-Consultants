/**
 * Commission rates — the founder's standing rule: "it must be flexible from the admin".
 *
 * Part 2 §7.2 states the business consequence outright: a rate change must never need a code
 * change, because "a code change would be a blocker". These tests defend that property rather
 * than any particular number — the spec's 3/5/8 and the shipped 5/3/4 are both just starting
 * positions the founder is free to overwrite.
 *
 * `everyRateSurvivesARoundTrip` is the one that matters. The console posts its whole draft
 * object, so a rate the panel doesn't render would be silently reset to its schema default on
 * every unrelated save — the founder would set 25%, edit something else, and quietly get 20%
 * back with no error to explain it.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  DEFAULT_COMMISSION_RULES_CONFIG,
  coerceCommissionRulesConfig,
  commissionRulesConfigSchema,
} from "../config-schema";

describe("commission rates — founder-editable, never hardcoded", () => {
  test("every rate in the config round-trips through a save", () => {
    // Simulates the console posting a fully-edited draft.
    const edited = {
      bothCallsPct: 9,
      splitPct: 4.5,
      closerPct: 6,
      substitutePct: 25,
    };
    const parsed = commissionRulesConfigSchema.safeParse(edited);
    assert.equal(parsed.success, true, "a valid draft must save");
    assert.deepEqual(parsed.success && parsed.data, edited, "no rate may be dropped or reset on the way through");
  });

  test("the schema has no rate the panel cannot reach", () => {
    // If this fails, someone added a rate to the schema without an input in CommissionPanel —
    // which makes it un-editable, i.e. hardcoded in everything but name.
    const known = ["bothCallsPct", "splitPct", "closerPct", "substitutePct"].sort();
    assert.deepEqual(Object.keys(DEFAULT_COMMISSION_RULES_CONFIG).sort(), known);
  });

  test("decimal rates are allowed", () => {
    // The founders said "slightly tuned" — 2.5% must not be rounded away.
    const parsed = coerceCommissionRulesConfig({ bothCallsPct: 2.5, splitPct: 1.25, closerPct: 3.75, substitutePct: 12.5 });
    assert.equal(parsed.bothCallsPct, 2.5);
    assert.equal(parsed.splitPct, 1.25);
  });

  test("0% is a legitimate setting, not an empty one", () => {
    // Turning a leg off entirely must be expressible; falling back to a default here would
    // pay commission the founder explicitly switched off.
    const parsed = coerceCommissionRulesConfig({ bothCallsPct: 0, splitPct: 0, closerPct: 0, substitutePct: 0 });
    assert.equal(parsed.bothCallsPct, 0);
    assert.equal(parsed.closerPct, 0);
    assert.equal(parsed.substitutePct, 0);
  });

  test("an out-of-range rate is refused rather than clamped", () => {
    // A typo'd 500% should fail loudly at the form, not quietly become 100 and pay 5x.
    assert.equal(commissionRulesConfigSchema.safeParse({ bothCallsPct: 500, splitPct: 3, closerPct: 4, substitutePct: 20 }).success, false);
    assert.equal(commissionRulesConfigSchema.safeParse({ bothCallsPct: -1, splitPct: 3, closerPct: 4, substitutePct: 20 }).success, false);
  });

  test("a hand-broken settings row falls back instead of taking Finance down", () => {
    assert.deepEqual(coerceCommissionRulesConfig({ junk: true }), DEFAULT_COMMISSION_RULES_CONFIG);
    assert.deepEqual(coerceCommissionRulesConfig(null), DEFAULT_COMMISSION_RULES_CONFIG);
  });
});

describe("substitute split — arithmetic the payout report must agree with", () => {
  /** Mirrors commission-metrics: round the substitute, give the owner the remainder. */
  const split = (legInrMinor: number, substitutePct: number) => {
    const substitute = Math.round((legInrMinor * substitutePct) / 100);
    return { substitute, owner: legInrMinor - substitute };
  };

  test("the two halves always sum to the original leg", () => {
    // Rounding both sides independently would leak a paise and break reconciliation.
    for (const leg of [100, 999, 1001, 33_333, 1_234_567]) {
      for (const pct of [0, 20, 33, 50, 80, 100]) {
        const { substitute, owner } = split(leg, pct);
        assert.equal(substitute + owner, leg, `leg=${leg} pct=${pct} must not leak`);
      }
    }
  });

  test("the split divides the leg — it never adds to the payroll", () => {
    const leg = 30_000;
    const { substitute, owner } = split(leg, 20);
    assert.equal(substitute, 6_000);
    assert.equal(owner, 24_000);
    assert.equal(substitute + owner, leg, "a covered call costs the business exactly what an uncovered one does");
  });

  test("0% means the owner keeps the whole leg", () => {
    assert.deepEqual(split(5_000, 0), { substitute: 0, owner: 5_000 });
  });

  test("100% means the stand-in keeps the whole leg", () => {
    assert.deepEqual(split(5_000, 100), { substitute: 5_000, owner: 0 });
  });
});
