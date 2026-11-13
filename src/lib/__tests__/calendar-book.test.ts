import test from "node:test";
import assert from "node:assert/strict";
import { blockPlan, blockRangeError, hhmmToMin } from "../calendar-book";

/** Feature 5 (build-docs/features/book-appointment-modal.md): the rules behind blocking time. */

test("book-appointment-modal AC4: only OPEN slots are blocked, booked calls are reported and kept", () => {
  const plan = blockPlan([
    { id: "a", status: "OPEN" },
    { id: "b", status: "BOOKED" },
    { id: "c", status: "OPEN" },
    { id: "d", status: "BLOCKED" },
  ]);
  assert.deepEqual(plan.block, ["a", "c"]);
  assert.deepEqual(plan.kept.map((s) => s.id), ["b"]);
  // An already-blocked slot is neither re-blocked nor reported as a kept booking.
  assert.equal(plan.block.includes("d"), false);
});

test("book-appointment-modal: an empty range blocks nothing rather than everything", () => {
  assert.deepEqual(blockPlan([]), { block: [], kept: [] });
});

test("book-appointment-modal edge: a range that ends at or before it starts is refused", () => {
  assert.equal(blockRangeError("14:00", "16:00"), null);
  assert.ok(blockRangeError("16:00", "14:00"));
  // Equal is the dangerous one: it would pass a sanity check that only looks for "end < start",
  // then silently block nothing at all.
  assert.ok(blockRangeError("14:00", "14:00"));
});

test("book-appointment-modal edge: junk times are refused, not read as midnight", () => {
  assert.equal(hhmmToMin("09:30"), 570);
  assert.equal(hhmmToMin("24:00"), null);
  assert.equal(hhmmToMin("09:60"), null);
  assert.equal(hhmmToMin(""), null);
  assert.ok(blockRangeError("", "16:00"));
});
