import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDurationMinutes,
  coerceDurationMinutes,
  formatDuration,
  describeDuration,
  parseDurationListMinutes,
  formatDurationList,
} from "../duration";

/**
 * The bare-number rule is the one that can quietly break a live cadence: every window stored
 * before this parser existed was a number of HOURS, so "3" must keep meaning three hours, and
 * three minutes must be typed "3m". A regression here doesn't error - it silently multiplies
 * every configured window by sixty.
 */

test("a unit-less number is still hours", () => {
  assert.equal(parseDurationMinutes("24"), 1440);
  assert.equal(parseDurationMinutes("3"), 180);
  assert.equal(parseDurationMinutes("0"), 0);
});

test("h and m are read as written", () => {
  assert.equal(parseDurationMinutes("36h"), 2160);
  assert.equal(parseDurationMinutes("90m"), 90);
  assert.equal(parseDurationMinutes("15min"), 15);
  assert.equal(parseDurationMinutes("15 minutes"), 15);
  assert.equal(parseDurationMinutes("1h30m"), 90);
  assert.equal(parseDurationMinutes("1h 30"), 90);
  assert.equal(parseDurationMinutes("1.5h"), 90);
  assert.equal(parseDurationMinutes("  2H  "), 120);
});

test("nonsense is null, not zero - a caller must be able to tell them apart", () => {
  for (const bad of ["", "   ", "soon", "h", "m", "-5m", "1h2h", "2 days", null, 30]) {
    assert.equal(parseDurationMinutes(bad as unknown), null, `${String(bad)} should not parse`);
  }
});

test("coerce falls back and clamps instead of throwing", () => {
  assert.equal(coerceDurationMinutes("nonsense", 180), 180);
  assert.equal(coerceDurationMinutes("45m", 180), 45);
  assert.equal(coerceDurationMinutes("9999h", 180), 240 * 60);
  assert.equal(coerceDurationMinutes("500m", 180, 240), 240);
});

test("formatting round-trips back through the parser", () => {
  for (const mins of [5, 45, 60, 90, 120, 1440, 2160]) {
    assert.equal(parseDurationMinutes(formatDuration(mins)), mins, `${mins} should round-trip`);
  }
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(2160), "36h");
  assert.equal(formatDuration(90), "1h 30m");
});

test("prose spelling reads as a person would say it", () => {
  assert.equal(describeDuration(60), "1 hour");
  assert.equal(describeDuration(180), "3 hours");
  assert.equal(describeDuration(30), "30 minutes");
  assert.equal(describeDuration(1), "1 minute");
  assert.equal(describeDuration(90), "1h 30m");
});

test("a list is de-duplicated and widest-first, whatever order it was typed in", () => {
  assert.deepEqual(parseDurationListMinutes("2h, 36h, 90m, 24"), [2160, 1440, 120, 90]);
  assert.deepEqual(parseDurationListMinutes("36, 24, 2"), [2160, 1440, 120]);
  assert.deepEqual(parseDurationListMinutes("2h, 120m"), [120], "the same window twice is one rung");
});

test("a zero or unparseable entry is dropped, not treated as 'now'", () => {
  assert.deepEqual(parseDurationListMinutes("24, 0, soon, 2h"), [1440, 120]);
  assert.deepEqual(parseDurationListMinutes(""), []);
});

test("a formatted list parses back to the same rungs", () => {
  const rungs = [2160, 1440, 90];
  assert.equal(formatDurationList(rungs), "36h, 24h, 1h30m");
  assert.deepEqual(parseDurationListMinutes(formatDurationList(rungs)), rungs);
});
