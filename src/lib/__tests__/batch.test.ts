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
  batchTiming,
  compareBatchChoices,
  defaultBatchChoice,
  type BatchChoice,
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

describe("batch - timing", () => {
  const on = new Date("2026-10-22T00:00:00Z");

  test("no start date is UNDATED, never 'running'", () => {
    // Every batch on the live database has a null startDate. Calling those "running" would
    // describe twenty cohorts as in progress on no evidence at all.
    assert.equal(batchTiming({ startDate: null, endDate: null }, on), "UNDATED");
  });

  test("a start in the future is UPCOMING, today or earlier is RUNNING", () => {
    assert.equal(batchTiming({ startDate: new Date("2026-11-03"), endDate: null }, on), "UPCOMING");
    assert.equal(batchTiming({ startDate: new Date("2026-10-22"), endDate: null }, on), "RUNNING");
    assert.equal(batchTiming({ startDate: new Date("2026-09-01"), endDate: null }, on), "RUNNING");
  });

  test("open-ended means it STAYS running - a length is never invented to expire it by", () => {
    assert.equal(batchTiming({ startDate: new Date("2024-01-01"), endDate: null }, on), "RUNNING");
  });

  test("FINISHED only once the end date is actually past", () => {
    assert.equal(
      batchTiming({ startDate: new Date("2026-08-01"), endDate: new Date("2026-10-21") }, on),
      "FINISHED",
    );
    // The last day is still a running day.
    assert.equal(
      batchTiming({ startDate: new Date("2026-08-01"), endDate: new Date("2026-10-22") }, on),
      "RUNNING",
    );
  });

  test("time of day never decides it", () => {
    assert.equal(
      batchTiming({ startDate: new Date("2026-10-22T23:00:00Z"), endDate: null }, on),
      "RUNNING",
    );
  });
});

describe("batch - offer order and the default suggestion", () => {
  const choice = (over: Partial<BatchChoice> & { id: string }): BatchChoice => ({
    label: over.id,
    level: "GN_A1",
    timing: "UNDATED",
    startDate: null,
    filled: 0,
    targetStrength: 8,
    ...over,
  });

  test("next intake first, then running, then undated, then finished", () => {
    const rows = [
      choice({ id: "done", timing: "FINISHED", startDate: "2026-01-01" }),
      choice({ id: "undated" }),
      choice({ id: "running", timing: "RUNNING", startDate: "2026-10-01" }),
      choice({ id: "next", timing: "UPCOMING", startDate: "2026-11-03" }),
    ];
    assert.deepEqual(
      [...rows].sort(compareBatchChoices).map((c) => c.id),
      ["next", "running", "undated", "done"],
    );
  });

  test("soonest intake first; among running ones, the one that started last", () => {
    const upcoming = [
      choice({ id: "dec", timing: "UPCOMING", startDate: "2026-12-01" }),
      choice({ id: "nov", timing: "UPCOMING", startDate: "2026-11-03" }),
    ].sort(compareBatchChoices);
    assert.deepEqual(upcoming.map((c) => c.id), ["nov", "dec"]);

    const running = [
      choice({ id: "old", timing: "RUNNING", startDate: "2026-06-01" }),
      choice({ id: "recent", timing: "RUNNING", startDate: "2026-10-01" }),
    ].sort(compareBatchChoices);
    assert.deepEqual(running.map((c) => c.id), ["recent", "old"]);
  });

  test("undated rows fall back to the newest label - the only signal they carry", () => {
    const rows = [choice({ id: "B07", label: "B07" }), choice({ id: "B28", label: "B28" })];
    assert.deepEqual([...rows].sort(compareBatchChoices).map((c) => c.label), ["B28", "B07"]);
  });

  test("the default is the next intake with room", () => {
    const rows = [
      choice({ id: "running", timing: "RUNNING", startDate: "2026-10-01" }),
      choice({ id: "next", timing: "UPCOMING", startDate: "2026-11-03" }),
    ];
    assert.equal(defaultBatchChoice(rows)?.id, "next");
  });

  test("a full or over-capacity cohort is never suggested, though it is still offerable", () => {
    // `capacityBand` allows overfilling on purpose - but a DEFAULT must not do it for them.
    const rows = [
      choice({ id: "full", timing: "UPCOMING", startDate: "2026-11-03", filled: 8 }),
      choice({ id: "over", timing: "UPCOMING", startDate: "2026-11-10", filled: 9 }),
      choice({ id: "room", timing: "UPCOMING", startDate: "2026-12-01", filled: 3 }),
    ];
    assert.equal(defaultBatchChoice(rows)?.id, "room");
  });

  test("a finished cohort is never suggested", () => {
    const rows = [choice({ id: "done", timing: "FINISHED", startDate: "2026-01-01" })];
    assert.equal(defaultBatchChoice(rows), null);
  });

  test("the student's own level wins over mere order", () => {
    const rows = [
      choice({ id: "a1", timing: "UPCOMING", startDate: "2026-11-03", level: "GN_A1" }),
      choice({ id: "a2", timing: "UPCOMING", startDate: "2026-11-10", level: "GN_A2" }),
    ];
    assert.equal(defaultBatchChoice(rows, { preferLevel: "GN_A2" })?.id, "a2");
    // No batch on their level - offer order decides rather than nothing at all.
    assert.equal(defaultBatchChoice(rows, { preferLevel: "GN_B1" })?.id, "a1");
  });

  test("A SEAT IS A FACT: it wins even when that cohort is full and finished", () => {
    // The contract has to name where this person actually is, not where there is room.
    const rows = [
      choice({ id: "seated", timing: "FINISHED", startDate: "2026-01-01", filled: 12 }),
      choice({ id: "room", timing: "UPCOMING", startDate: "2026-11-03" }),
    ];
    assert.equal(defaultBatchChoice(rows, { seatedId: "seated" })?.id, "seated");
    // A seat id that names no offered cohort (archived since) falls through to the suggestion.
    assert.equal(defaultBatchChoice(rows, { seatedId: "gone" })?.id, "room");
  });

  test("nothing to offer is null, and the form simply asks", () => {
    assert.equal(defaultBatchChoice([]), null);
  });
});
