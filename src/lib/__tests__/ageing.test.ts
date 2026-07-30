import { test } from "node:test";
import assert from "node:assert/strict";
import { AGE_BUCKETS, ageBucket, bucketForDaysOverdue } from "../ageing";

/**
 * The boundaries are the whole point of this module — the old 1–30/31–60 buckets put every
 * real receivable in one column, so where the lines fall is exactly what was wrong.
 */

test("week boundaries are inclusive-upper", () => {
  // Day 7 is still week one; day 8 has aged into week two.
  assert.equal(bucketForDaysOverdue(7), "w1");
  assert.equal(bucketForDaysOverdue(8), "w2");

  assert.equal(bucketForDaysOverdue(14), "w2");
  assert.equal(bucketForDaysOverdue(15), "w3");

  assert.equal(bucketForDaysOverdue(21), "w3");
  assert.equal(bucketForDaysOverdue(22), "w4plus");
});

test("the collection cycle is actually resolved, not flattened into one column", () => {
  // The regression this replaces: on 1–30/31–60 buckets, all four of these were one bucket.
  const spread = [2, 9, 16, 25].map(bucketForDaysOverdue);
  assert.deepEqual(spread, ["w1", "w2", "w3", "w4plus"]);
  assert.equal(new Set(spread).size, 4, "a fortnight's cycle must span more than one bucket");
});

test("the final bucket is open-ended", () => {
  assert.equal(bucketForDaysOverdue(30), "w4plus");
  assert.equal(bucketForDaysOverdue(400), "w4plus");
});

test("a non-positive input resolves rather than throwing", () => {
  // A chart is not the place to discover a bad input.
  assert.equal(bucketForDaysOverdue(0), "w1");
  assert.equal(bucketForDaysOverdue(-3), "w1");
});

test("buckets are ordered least-to-most overdue, which is the render order", () => {
  const bounded = AGE_BUCKETS.filter((b) => b.maxDays !== null).map((b) => b.maxDays as number);
  assert.deepEqual(bounded, [...bounded].sort((a, b) => a - b));
  assert.equal(AGE_BUCKETS[AGE_BUCKETS.length - 1].maxDays, null, "the last bucket must be open-ended");
});

test("every bucket key resolves to its presentation", () => {
  for (const b of AGE_BUCKETS) {
    assert.equal(ageBucket(b.key).label, b.label);
    assert.ok(b.color.startsWith("var(--"), "colours come from the design tokens, never hardcoded");
  }
});
