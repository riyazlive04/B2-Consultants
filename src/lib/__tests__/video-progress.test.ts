/**
 * Video completion — spec §10.3 / §17: "Tracked watch % overrides self-reported 'watched'".
 *
 * The founders' actual complaint is the first test here: a student ticks "watched" having
 * seen 40%. If the tick wins, the whole feature is decorative — so `trackedBeatsTheTick` is
 * the test this module exists to pass.
 *
 * `mergeWatchProgress` guards the subtler bug: progress is a HIGH-WATER MARK. Storing the
 * latest heartbeat instead would let someone who rewatches the intro of a finished video
 * overwrite 100% with 5%, silently un-completing work they'd already done.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { resolveWatchTruth, mergeWatchProgress, COMPLETION_THRESHOLD_PCT } from "../video-progress";

describe("watch truth — tracking is the source of truth", () => {
  test("tracked % beats a self-reported tick (LMS-004)", () => {
    // The exact scenario in the spec: claims watched, actually saw 40%.
    const t = resolveWatchTruth({ watchedPct: 40, selfReported: true });
    assert.equal(t.pct, 40, "must report what was measured, not what was claimed");
    assert.equal(t.complete, false);
    assert.equal(t.basis, "tracked");
    assert.equal(t.disputed, true, "the disagreement is the thing the founders want to see");
  });

  test("the disputed explanation says plainly which number won", () => {
    const t = resolveWatchTruth({ watchedPct: 40, selfReported: true });
    assert.match(t.explain, /40%/);
    assert.match(t.explain, /source of truth/i);
  });

  test("tracked completion is not disputed", () => {
    const t = resolveWatchTruth({ watchedPct: 95, selfReported: true });
    assert.equal(t.complete, true);
    assert.equal(t.disputed, false);
  });

  test("watching without ticking still counts", () => {
    const t = resolveWatchTruth({ watchedPct: 95, selfReported: false });
    assert.equal(t.complete, true);
    assert.equal(t.basis, "tracked");
  });

  test("the completion threshold is inclusive", () => {
    assert.equal(resolveWatchTruth({ watchedPct: COMPLETION_THRESHOLD_PCT, selfReported: false }).complete, true);
    assert.equal(resolveWatchTruth({ watchedPct: COMPLETION_THRESHOLD_PCT - 1, selfReported: false }).complete, false);
  });
});

describe("watch truth — no tracking available", () => {
  test("an untracked tick still counts (legacy rows must not be erased)", () => {
    // Before tracking existed, a tick was all we had. Treating those as 0% would rewrite
    // every student's history the day this shipped.
    const t = resolveWatchTruth({ watchedPct: null, selfReported: true });
    assert.equal(t.complete, true);
    assert.equal(t.basis, "self_reported");
    assert.equal(t.pct, 100);
  });

  test("nothing at all reads as not started", () => {
    const t = resolveWatchTruth({ watchedPct: null, selfReported: false });
    assert.equal(t.pct, 0);
    assert.equal(t.complete, false);
    assert.equal(t.basis, "none");
  });

  test("0% tracked and untracked are different claims", () => {
    // "watched none of it" vs "we have no idea" — the nullable column exists for this.
    assert.equal(resolveWatchTruth({ watchedPct: 0, selfReported: false }).basis, "tracked");
    assert.equal(resolveWatchTruth({ watchedPct: null, selfReported: false }).basis, "none");
  });
});

describe("watch progress — high-water mark", () => {
  test("rewatching the intro does not undo completion", () => {
    assert.equal(mergeWatchProgress(100, 5, 600), 100);
  });

  test("progress advances when they get further", () => {
    assert.equal(mergeWatchProgress(40, 300, 600), 50);
  });

  test("first heartbeat sets the mark", () => {
    assert.equal(mergeWatchProgress(null, 300, 600), 50);
  });

  test("a zero or unknown duration cannot divide by zero", () => {
    assert.equal(mergeWatchProgress(40, 10, 0), 40);
    assert.equal(mergeWatchProgress(null, 10, 0), 0);
    assert.equal(mergeWatchProgress(40, 10, Number.NaN), 40);
  });

  test("a position past the end clamps to 100, never above", () => {
    assert.equal(mergeWatchProgress(null, 700, 600), 100);
  });

  test("a negative position cannot produce negative progress", () => {
    assert.equal(mergeWatchProgress(null, -10, 600), 0);
  });
});
