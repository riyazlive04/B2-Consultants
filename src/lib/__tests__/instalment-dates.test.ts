import test from "node:test";
import assert from "node:assert/strict";
import { dueDateFor, dueDateSeries } from "../instalment-dates";

/**
 * These dates become receivables that get chased, so the edges matter more than the happy path:
 * a plan agreed on 31 January must not schedule 31 February and silently land in March.
 */

test("the 1st-of-the-month rule lands on the 1st, every month", () => {
  assert.deepEqual(dueDateSeries("MONTH_FIRST", "2026-10-01", 4), ["2026-11-01", "2026-12-01", "2027-01-01"]);
});

test("the 1st-of-the-month rule crosses the year end", () => {
  assert.deepEqual(dueDateSeries("MONTH_FIRST", "2026-11-18", 3), ["2026-12-01", "2027-01-01"]);
});

test("a month-end anchor cannot overflow, because the day is forced to the 1st", () => {
  // 31 Jan + 1 month has no 31 Feb to clamp - this rule sidesteps the trap entirely.
  assert.deepEqual(dueDateSeries("MONTH_FIRST", "2026-01-31", 4), ["2026-02-01", "2026-03-01", "2026-04-01"]);
});

test("the 30-day rule is plain addition, not calendar months", () => {
  // Across February: 30 days from 31 Jan is 2 Mar in a non-leap year, which is the point of
  // offering this rule separately from the monthly one.
  assert.deepEqual(dueDateSeries("DAYS_30", "2026-01-31", 3), ["2026-03-02", "2026-04-01"]);
});

test("the 30-day rule accumulates from the anchor, not from the previous date", () => {
  assert.deepEqual(dueDateSeries("DAYS_30", "2026-10-01", 4), ["2026-10-31", "2026-11-30", "2026-12-30"]);
});

test("a leap day is counted like any other", () => {
  assert.equal(dueDateFor("DAYS_30", "2028-02-01", 1), "2028-03-02"); // 2028 is a leap year
});

test("one instalment schedules nothing - it is a full payment with extra steps", () => {
  assert.deepEqual(dueDateSeries("MONTH_FIRST", "2026-10-01", 1), []);
  assert.deepEqual(dueDateSeries("MONTH_FIRST", "2026-10-01", 0), []);
});

test("count - 1 dates, because the first instalment is the one being recorded", () => {
  assert.equal(dueDateSeries("MONTH_FIRST", "2026-10-01", 6).length, 5);
});

test("an unusable anchor yields nothing rather than an invalid date", () => {
  assert.equal(dueDateFor("MONTH_FIRST", "", 1), "");
  assert.equal(dueDateFor("DAYS_30", "not-a-date", 1), "");
  assert.equal(dueDateFor("MONTH_FIRST", "2026-13-45", 1), "");
  assert.deepEqual(dueDateSeries("DAYS_30", "", 4), ["", "", ""]);
});
