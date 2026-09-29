/**
 * Batch - the rules that make ONE batch table safe for TWO business lines (ER v2 Track A).
 *
 * Pure and DB-free.
 *
 * The line/level compatibility check carries the weight here. Unifying `gn_batch` into
 * `batch` is only correct if something stops a coaching client being seated in an A1 German
 * cohort - before unification the table itself was that guard, and now it isn't.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  lineForLevelKind,
  levelFitsBatchLine,
  capacityBand,
  capacityLabel,
  normalizeBatchCode,
  batchDayNumber,
} from "../batch";

describe("batch - level ↔ line compatibility", () => {
  test("coaching tiers belong to B2, German levels and bundles to German Note", () => {
    assert.equal(lineForLevelKind("COACHING_TIER"), "B2");
    assert.equal(lineForLevelKind("GERMAN_LEVEL"), "GERMAN_NOTE");
    assert.equal(lineForLevelKind("GERMAN_BUNDLE"), "GERMAN_NOTE");
  });

  test("OTHER is ambiguous and enforces nothing", () => {
    assert.equal(lineForLevelKind("OTHER"), null);
    // Both directions must pass - refusing to seat a one-off product ANYWHERE would be a
    // worse failure than allowing it in either line.
    assert.equal(levelFitsBatchLine("OTHER", "B2"), true);
    assert.equal(levelFitsBatchLine("OTHER", "GERMAN_NOTE"), true);
  });

  test("THE guard: a coaching tier cannot be seated in a German Note batch", () => {
    assert.equal(levelFitsBatchLine("COACHING_TIER", "GERMAN_NOTE"), false);
    assert.equal(levelFitsBatchLine("GERMAN_LEVEL", "B2"), false);
  });

  test("matching line/level fits", () => {
    assert.equal(levelFitsBatchLine("COACHING_TIER", "B2"), true);
    assert.equal(levelFitsBatchLine("GERMAN_LEVEL", "GERMAN_NOTE"), true);
    assert.equal(levelFitsBatchLine("GERMAN_BUNDLE", "GERMAN_NOTE"), true);
  });
});

describe("batch - capacity banding", () => {
  test("bands across the target boundary", () => {
    assert.equal(capacityBand(0, 8), "empty");
    assert.equal(capacityBand(7, 8), "filling");
    assert.equal(capacityBand(8, 8), "full");
    assert.equal(capacityBand(9, 8), "over");
  });

  test("over capacity is a BAND, not an error - the founders overfill on purpose", () => {
    // The seat action warns and asks; it must never refuse. If this ever became a hard block,
    // the ninth person who turns up a month before the next cohort goes back on a spreadsheet.
    assert.equal(capacityBand(20, 8), "over");
    assert.equal(capacityLabel(9, 8), "9 / 8 - over capacity");
  });

  test("no target set means nothing to be full against", () => {
    assert.equal(capacityBand(5, 0), "filling");
    assert.equal(capacityLabel(5, 0), "5 seated");
  });

  test("an empty batch is empty regardless of target", () => {
    assert.equal(capacityBand(0, 0), "empty");
  });
});

describe("batch - code normalisation", () => {
  test("collapses the spellings the workbooks actually contain", () => {
    // `Batch.code` is UNIQUE. Two spellings of one cohort would create two batches and split
    // its roster - the exact failure the free-text batchA1/A2/B1 columns already caused.
    assert.equal(normalizeBatchCode("b26"), "B26");
    assert.equal(normalizeBatchCode(" B 26 "), "B26");
    assert.equal(normalizeBatchCode("b-26"), "B26");
  });

  test("returns empty when nothing usable is left, so callers can reject", () => {
    assert.equal(normalizeBatchCode("   "), "");
    assert.equal(normalizeBatchCode("---"), "");
  });

  test("caps length so a pasted paragraph cannot become a code", () => {
    assert.equal(normalizeBatchCode("A".repeat(100)).length, 24);
  });
});

describe("batch - day numbering", () => {
  const start = new Date("2026-01-10T00:00:00Z");

  test("the start date is day 1, not day 0", () => {
    assert.equal(batchDayNumber(start, new Date("2026-01-10T00:00:00Z")), 1);
    assert.equal(batchDayNumber(start, new Date("2026-01-11T00:00:00Z")), 2);
  });

  test("time of day never shifts the day number", () => {
    // A class at 21:00 and one at 09:00 on the same date are the same day of the programme.
    assert.equal(batchDayNumber(start, new Date("2026-01-15T09:00:00Z")), 6);
    assert.equal(batchDayNumber(start, new Date("2026-01-15T21:30:00Z")), 6);
  });

  test("before the start, and no start at all, are both null rather than a negative day", () => {
    assert.equal(batchDayNumber(start, new Date("2026-01-09T00:00:00Z")), null);
    assert.equal(batchDayNumber(null, new Date("2026-01-15T00:00:00Z")), null);
  });
});
