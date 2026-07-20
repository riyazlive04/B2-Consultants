/**
 * Batch-opening rule — spec Part 2 §2.
 *
 * `singleJoinerOpensNothing` is the case the founders described directly: a workshop that
 * yields one person opens no batch, and that person waits for the next workshop. It is also
 * the explanation for the "out of order" batch numbers in their sheet — the gaps are the
 * policy, not a bug.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { suggestBatchesToOpen, DEFAULT_MIN_TO_OPEN, type PoolJoiner } from "../pending-pool";

const j = (id: string, level: string, preference: PoolJoiner["preference"] = "EITHER"): PoolJoiner => ({ id, level, preference });

describe("pending pool — opening batches", () => {
  test("a single joiner opens nothing and stays pooled (BO-005)", () => {
    const out = suggestBatchesToOpen([j("a", "GN_A1")]);
    assert.equal(out.length, 1);
    assert.equal(out[0].openable, false, "one person must never open a batch");
    assert.equal(out[0].count, 1);
    assert.match(out[0].reason, /hold in the pool/i);
  });

  test("enough joiners open a batch", () => {
    const out = suggestBatchesToOpen([j("a", "GN_A1"), j("b", "GN_A1")]);
    assert.equal(out.length, 1);
    assert.equal(out[0].openable, true);
    assert.deepEqual(out[0].joinerIds.sort(), ["a", "b"]);
  });

  test("an empty pool suggests nothing", () => {
    assert.deepEqual(suggestBatchesToOpen([]), []);
  });

  test("levels never merge into one batch", () => {
    // An A1 and an A2 student are not two thirds of a batch — they're two waits.
    const out = suggestBatchesToOpen([j("a", "GN_A1"), j("b", "GN_A2")]);
    assert.equal(out.length, 2);
    assert.ok(out.every((s) => !s.openable), "one each is still one each");
  });
});

describe("pending pool — timetable preference", () => {
  test("weekday and weekend are separate batches", () => {
    const out = suggestBatchesToOpen([
      j("a", "GN_A1", "WEEKDAY"),
      j("b", "GN_A1", "WEEKDAY"),
      j("c", "GN_A1", "WEEKEND"),
    ]);
    const weekday = out.find((s) => s.slot === "WEEKDAY");
    const weekend = out.find((s) => s.slot === "WEEKEND");
    assert.equal(weekday?.openable, true, "two weekday joiners can open");
    assert.equal(weekend?.openable, false, "one weekend joiner cannot");
  });

  test("a flexible joiner is given to the slot closest to opening (§2.1: batches that can fill)", () => {
    const out = suggestBatchesToOpen([j("fixed", "GN_A1", "WEEKDAY"), j("flex", "GN_A1", "EITHER")]);
    const weekday = out.find((s) => s.slot === "WEEKDAY");
    assert.equal(weekday?.openable, true);
    assert.deepEqual(weekday?.joinerIds.sort(), ["fixed", "flex"]);
  });

  test("a flexible joiner is never counted into two real batches at once", () => {
    const out = suggestBatchesToOpen([
      j("wd", "GN_A1", "WEEKDAY"),
      j("we", "GN_A1", "WEEKEND"),
      j("flex", "GN_A1", "EITHER"),
    ]);
    const seen = out.flatMap((s) => s.joinerIds);
    assert.equal(new Set(seen).size, seen.length, "one person, one seat — no double-counting");
  });

  test("all-flexible joiners still open a batch", () => {
    const out = suggestBatchesToOpen([j("a", "GN_A1"), j("b", "GN_A1"), j("c", "GN_A1")]);
    const openable = out.filter((s) => s.openable);
    assert.equal(openable.length, 1);
    assert.equal(openable[0].count, 3);
  });
});

describe("pending pool — the floor is configurable", () => {
  test("the shipped floor is above one, per the spec", () => {
    assert.ok(DEFAULT_MIN_TO_OPEN > 1, "the one rule the spec states outright is that 1 is not enough");
  });

  test("a raised floor holds more people back", () => {
    const pool = [j("a", "GN_A1"), j("b", "GN_A1"), j("c", "GN_A1")];
    assert.equal(suggestBatchesToOpen(pool, 4)[0].openable, false);
    assert.equal(suggestBatchesToOpen(pool, 3)[0].openable, true);
  });
});
