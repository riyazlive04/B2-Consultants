import { test } from "node:test";
import assert from "node:assert/strict";
import { isRecurring, monthlyEquivalentMinor, nextOccurrence } from "../payable-frequency";

/**
 * H5 asked for the rule per frequency to be defined AND tested. The interesting cases are the
 * ones that were silently wrong before: a stale anchor, a month-end date, and the one-time
 * payable that must never behave like a recurring one.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("monthly equivalent divides by the period", () => {
  assert.equal(monthlyEquivalentMinor(120000, "MONTHLY"), 120000);
  assert.equal(monthlyEquivalentMinor(120000, "QUARTERLY"), 40000);
  assert.equal(monthlyEquivalentMinor(120000, "ANNUAL"), 10000);
});

test("a one-time cost contributes NOTHING to the recurring base", () => {
  // Counting it would raise break-even every month for something that happens once, making the
  // business look permanently less viable than it is.
  assert.equal(monthlyEquivalentMinor(500000, "ONE_TIME"), 0);
  assert.equal(isRecurring("ONE_TIME"), false);
  assert.equal(isRecurring("MONTHLY"), true);
});

test("an unknown frequency contributes nothing rather than throwing", () => {
  assert.equal(monthlyEquivalentMinor(120000, "FORTNIGHTLY"), 0);
});

test("a future due date is left exactly as entered", () => {
  const anchor = d("2026-09-15");
  assert.equal(nextOccurrence(anchor, "MONTHLY", d("2026-07-23")).toISOString(), anchor.toISOString());
});

test("THE bug: a stale monthly anchor rolls forward to the real next date", () => {
  // Set up in January, viewed in July. It used to keep reporting 15 January - a date six months
  // in the past - on a payable explicitly marked monthly.
  const next = nextOccurrence(d("2026-01-15"), "MONTHLY", d("2026-07-23"));
  assert.equal(next.toISOString().slice(0, 10), "2026-08-15");
});

test("it lands on TODAY's date rather than skipping it", () => {
  // Due on the 23rd, viewed on the 23rd: today is still due, not already missed.
  const next = nextOccurrence(d("2026-01-23"), "MONTHLY", d("2026-07-23"));
  assert.equal(next.toISOString().slice(0, 10), "2026-07-23");
});

test("quarterly and annual step by their own period, not by one month", () => {
  assert.equal(nextOccurrence(d("2026-01-10"), "QUARTERLY", d("2026-07-23")).toISOString().slice(0, 10), "2026-10-10");
  assert.equal(nextOccurrence(d("2024-03-05"), "ANNUAL", d("2026-07-23")).toISOString().slice(0, 10), "2027-03-05");
});

test("a 31st anchor clamps in short months instead of spilling into the next", () => {
  // 31 Jan → the February occurrence is the 28th, not 3 March. Same as a standing order.
  const feb = nextOccurrence(d("2026-01-31"), "MONTHLY", d("2026-02-01"));
  assert.equal(feb.toISOString().slice(0, 10), "2026-02-28");
  // …and the day is not lost afterwards: March still lands on the 31st.
  const mar = nextOccurrence(d("2026-01-31"), "MONTHLY", d("2026-03-01"));
  assert.equal(mar.toISOString().slice(0, 10), "2026-03-31");
});

test("a one-time payable never rolls forward, however stale", () => {
  const anchor = d("2020-01-01");
  assert.equal(nextOccurrence(anchor, "ONE_TIME", d("2026-07-23")).toISOString(), anchor.toISOString());
});

test("a years-stale anchor still resolves in one call", () => {
  const next = nextOccurrence(d("2019-06-07"), "MONTHLY", d("2026-07-23"));
  assert.equal(next.toISOString().slice(0, 10), "2026-08-07");
});
