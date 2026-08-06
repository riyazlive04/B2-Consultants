import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assignVariant, hashUnit, pickWeighted, weightShares } from "../ab";

const control = { id: "step-control", abWeight: 50 };
const variantB = { id: "step-b", abWeight: 50 };

describe("hashUnit", () => {
  test("is deterministic and lands inside [0, 1)", () => {
    for (const seed of ["a", "visitor-1:step-control", "", "ζ✓"]) {
      const v = hashUnit(seed);
      assert.equal(v, hashUnit(seed), `unstable for ${JSON.stringify(seed)}`);
      assert.ok(v >= 0 && v < 1, `${seed} → ${v}`);
    }
  });

  test("spreads cuid-shaped ids evenly enough to split traffic", () => {
    // The real risk with a cheap hash is not collisions, it is CLUSTERING: ids that differ only
    // in their last characters (which is what a cuid sequence looks like) landing in the same
    // half, so a 50/50 test quietly runs 80/20. 2000 sequential ids must come out near even.
    let low = 0;
    for (let i = 0; i < 2000; i++) if (hashUnit(`clxk9q2${i.toString(36)}:step-control`) < 0.5) low++;
    assert.ok(Math.abs(low - 1000) < 100, `expected ~1000 in the low half, got ${low}`);
  });
});

describe("pickWeighted", () => {
  test("splits at the cumulative boundary", () => {
    assert.equal(pickWeighted([control, variantB], 0)?.id, "step-control");
    assert.equal(pickWeighted([control, variantB], 0.49)?.id, "step-control");
    assert.equal(pickWeighted([control, variantB], 0.5)?.id, "step-b");
    assert.equal(pickWeighted([control, variantB], 0.999999)?.id, "step-b");
  });

  test("honours uneven weights — 90/10 is not 50/50", () => {
    const cands = [{ id: "a", abWeight: 90 }, { id: "b", abWeight: 10 }];
    assert.equal(pickWeighted(cands, 0.89)?.id, "a");
    assert.equal(pickWeighted(cands, 0.91)?.id, "b");
  });

  test("weights are shares, not percentages — they need not sum to 100", () => {
    // Three variants at weight 1 each is a clean three-way split. Requiring percentages would
    // have made that 33/33/34 and unrepresentable without rounding by hand.
    const cands = [{ id: "a", abWeight: 1 }, { id: "b", abWeight: 1 }, { id: "c", abWeight: 1 }];
    assert.equal(pickWeighted(cands, 0.2)?.id, "a");
    assert.equal(pickWeighted(cands, 0.5)?.id, "b");
    assert.equal(pickWeighted(cands, 0.9)?.id, "c");
  });

  test("a zero-weighted variant is paused, never served", () => {
    const cands = [control, { id: "paused", abWeight: 0 }];
    for (let i = 0; i < 100; i++) assert.equal(pickWeighted(cands, i / 100)?.id, "step-control");
  });

  test("all-zero weights fall back to the control rather than a blank page", () => {
    const cands = [{ id: "a", abWeight: 0 }, { id: "b", abWeight: 0 }];
    assert.equal(pickWeighted(cands, 0.7)?.id, "a");
  });

  test("negative and non-finite weights are treated as paused", () => {
    const cands = [control, { id: "bad", abWeight: -20 }, { id: "worse", abWeight: NaN }];
    assert.equal(pickWeighted(cands, 0.99)?.id, "step-control");
  });
});

describe("assignVariant", () => {
  test("is sticky — the same visitor gets the same page every time", () => {
    const first = assignVariant([control, variantB], "vis-42", control.id)?.id;
    for (let i = 0; i < 25; i++) {
      assert.equal(assignVariant([control, variantB], "vis-42", control.id)?.id, first);
    }
  });

  test("a visitor with no cookie sees the control", () => {
    assert.equal(assignVariant([control, variantB], null, control.id)?.id, "step-control");
  });

  test("buckets are independent per experiment", () => {
    // If the seed ignored the step id, a visitor in the control of one test would be in the
    // control of every test — several separate experiments silently sampling one cohort.
    const other = [{ id: "s2-control", abWeight: 50 }, { id: "s2-b", abWeight: 50 }];
    let differing = 0;
    for (let i = 0; i < 200; i++) {
      const a = assignVariant([control, variantB], `v${i}`, control.id)!;
      const b = assignVariant(other, `v${i}`, "s2-control")!;
      if ((a.id === variantB.id) !== (b.id === "s2-b")) differing++;
    }
    assert.ok(differing > 60, `expected the two tests to disagree often, got ${differing}/200`);
  });

  test("a 50/50 test really splits a population near 50/50", () => {
    let b = 0;
    for (let i = 0; i < 1000; i++) {
      if (assignVariant([control, variantB], `clxvisitor${i.toString(36)}`, control.id)?.id === "step-b") b++;
    }
    assert.ok(Math.abs(b - 500) < 60, `expected ~500 on the variant, got ${b}`);
  });
});

describe("weightShares", () => {
  test("reports percentages for display", () => {
    assert.deepEqual(weightShares([control, variantB]), [50, 50]);
    assert.deepEqual(weightShares([{ id: "a", abWeight: 3 }, { id: "b", abWeight: 1 }]), [75, 25]);
  });

  test("all paused reads as 100% control, matching what is actually served", () => {
    assert.deepEqual(weightShares([{ id: "a", abWeight: 0 }, { id: "b", abWeight: 0 }]), [100, 0]);
  });
});
