import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CALL_DISTRIBUTION,
  coerceCallDistribution,
  type CallDistributionConfig,
} from "../config-schema";

/**
 * The hazard these cover is not "does zod work" - it is that `coerceCallDistribution` falls back
 * to the SHIPPED DEFAULTS on any parse failure. Add a required field to the schema and every
 * config blob already sitting in AppSetting stops parsing, so the founder's window, cap and
 * ranking weights silently revert on the next read with nothing logged and nothing to see.
 * The new fields are `.default()`ed precisely to stop that, and this is the check that says so.
 */
describe("call distribution config - forward compatibility", () => {
  const legacy = {
    lookbackDays: 14,
    dailyCapPerPerson: 25,
    handOutSplitsByShare: true,
    priority: {
      bantPerPoint: 12,
      highlyQualifiedBonus: 20,
      freshWithinDays: 3,
      freshBonus: 40,
      idleAfterDays: 5,
      idlePenaltyPerDay: 2,
      idlePenaltyMax: 30,
    },
  };

  it("a config written before autoAssignPct existed keeps every setting it had", () => {
    const got = coerceCallDistribution(legacy);
    assert.equal(got.lookbackDays, 14, "the founder's window survived");
    assert.equal(got.dailyCapPerPerson, 25);
    assert.equal(got.handOutSplitsByShare, true);
    assert.equal(got.priority.freshBonus, 40);
  });

  it("and fills the new dials with the shipped defaults", () => {
    const got = coerceCallDistribution(legacy);
    assert.equal(got.autoAssignPct, 100, "an existing install keeps assigning every lead");
    assert.equal(got.followUpRestHours, 24);
  });

  it("still falls back wholesale on genuine rubbish", () => {
    assert.deepEqual(coerceCallDistribution({ lookbackDays: "soon" }), DEFAULT_CALL_DISTRIBUTION);
    assert.deepEqual(coerceCallDistribution(null), DEFAULT_CALL_DISTRIBUTION);
  });

  it("rejects a percentage outside 0-100 rather than clamping it", () => {
    const over: unknown = { ...legacy, autoAssignPct: 140 };
    assert.deepEqual(coerceCallDistribution(over), DEFAULT_CALL_DISTRIBUTION);
  });

  it("the shipped default assigns everything, which is the behaviour before the dial existed", () => {
    const d: CallDistributionConfig = DEFAULT_CALL_DISTRIBUTION;
    assert.equal(d.autoAssignPct, 100);
  });
});
