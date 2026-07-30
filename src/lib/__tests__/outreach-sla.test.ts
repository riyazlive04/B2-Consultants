import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketForLead,
  istHour,
  rate,
  signalForTarget,
  slaFor,
  windowFor,
} from "../outreach-sla";

/**
 * The JD's four response clauses, tested at their boundaries.
 *
 * Every literal below is written as an explicit UTC instant with the IST wall-clock time it
 * represents in the comment, because that is exactly where this logic goes wrong: IST is
 * +05:30, so an IST evening is the same UTC *afternoon*, and an IST early morning is the
 * previous UTC *day*. A test written in local time would pass on a laptop in Chennai and
 * fail on the server.
 */

/** 2026-07-20 14:00 UTC = 19:30 IST — a daytime lead, 30 min before the night window. */
const DAY_LEAD = new Date("2026-07-20T14:00:00Z");
/** 2026-07-20 14:30 UTC = 20:00 IST — the first instant of the night window. */
const NIGHT_LEAD = new Date("2026-07-20T14:30:00Z");
/** 2026-07-20 20:00 UTC = 2026-07-21 01:30 IST — early hours of the NEXT IST day. */
const EARLY_LEAD = new Date("2026-07-20T20:00:00Z");

test("windowFor splits the day at the JD's 09:00 and 20:00 IST boundaries", () => {
  assert.equal(windowFor(DAY_LEAD), "DAY");
  assert.equal(windowFor(NIGHT_LEAD), "NIGHT");
  assert.equal(windowFor(EARLY_LEAD), "EARLY");

  // 08:59 IST is still EARLY; 09:00 IST flips to DAY.
  assert.equal(windowFor(new Date("2026-07-20T03:29:00Z")), "EARLY"); // 08:59 IST
  assert.equal(windowFor(new Date("2026-07-20T03:30:00Z")), "DAY"); // 09:00 IST
  // 19:59 IST is still DAY; 20:00 IST flips to NIGHT.
  assert.equal(windowFor(new Date("2026-07-20T14:29:00Z")), "DAY"); // 19:59 IST
  assert.equal(windowFor(new Date("2026-07-20T14:30:00Z")), "NIGHT"); // 20:00 IST
});

test("istHour reads the IST wall clock, not the UTC one", () => {
  assert.equal(istHour(DAY_LEAD), 19);
  assert.equal(istHour(NIGHT_LEAD), 20);
  assert.equal(istHour(EARLY_LEAD), 1);
});

test("a lead inside its 5 minutes is FRESH, and outranks its own window", () => {
  const threeMinutesLater = new Date(NIGHT_LEAD.getTime() + 3 * 60_000);
  const v = slaFor(NIGHT_LEAD, null, threeMinutesLater);

  assert.equal(v.state, "FRESH");
  assert.equal(v.window, "NIGHT");
  // A night lead at minute 3 belongs in the 5-minute bucket ONLY. Listing it under night
  // leads as well would double-count it and put one person in two work piles.
  assert.equal(bucketForLead(v), "FIVE_MINUTE");
  assert.ok(v.msToFiveMinute > 0, "countdown should still be running");
});

test("past 5 minutes but inside the window is DUE, and falls to its window bucket", () => {
  const tenMinutesLater = new Date(DAY_LEAD.getTime() + 10 * 60_000);
  const v = slaFor(DAY_LEAD, null, tenMinutesLater);

  assert.equal(v.state, "DUE");
  assert.equal(bucketForLead(v), "DAY_DUE");
  assert.ok(v.msToFiveMinute < 0, "countdown should have elapsed");
});

test("night leads are owed the FOLLOWING day, not the same one", () => {
  const v = slaFor(NIGHT_LEAD, null, new Date(NIGHT_LEAD.getTime() + 60 * 60_000));
  // Arrived 20:00 IST on 20 July → due by the end of 21 July IST, i.e. 00:00 IST on 22 July,
  // which is 18:30 UTC on 21 July.
  assert.equal(v.dueBy.toISOString(), "2026-07-21T18:30:00.000Z");
});

test("daytime leads are owed the SAME day", () => {
  const v = slaFor(DAY_LEAD, null, new Date(DAY_LEAD.getTime() + 60 * 60_000));
  // Arrived 19:30 IST on 20 July → due by end of 20 July IST = 18:30 UTC on 20 July.
  assert.equal(v.dueBy.toISOString(), "2026-07-20T18:30:00.000Z");
});

test("an early-hours lead is owed the IST day it arrived in, not the UTC one", () => {
  // 20 July 20:00 UTC is already 21 July 01:30 IST — the deadline must be the end of
  // 21 July IST. Anchoring on the UTC date would give 20 July and mark it overdue on sight.
  const v = slaFor(EARLY_LEAD, null, new Date(EARLY_LEAD.getTime() + 60 * 60_000));
  assert.equal(v.window, "EARLY");
  assert.equal(v.dueBy.toISOString(), "2026-07-21T18:30:00.000Z");
});

test("connection is graded against the FIRST connection, on both clocks", () => {
  const inTime = new Date(DAY_LEAD.getTime() + 4 * 60_000);
  const met = slaFor(DAY_LEAD, inTime, new Date(DAY_LEAD.getTime() + DAY_MS()));
  assert.equal(met.state, "MET");
  assert.equal(met.metFiveMinute, true);
  assert.equal(met.metWindow, true);

  // Connected the same day but well past 5 minutes: misses the 90% target, meets the 100% one.
  const late = slaFor(DAY_LEAD, new Date(DAY_LEAD.getTime() + 90 * 60_000), new Date(DAY_LEAD.getTime() + DAY_MS()));
  assert.equal(late.state, "LATE");
  assert.equal(late.metFiveMinute, false);
  assert.equal(late.metWindow, true);

  // Connected two days later: misses both.
  const missed = slaFor(DAY_LEAD, new Date(DAY_LEAD.getTime() + 2 * DAY_MS()), new Date(DAY_LEAD.getTime() + 3 * DAY_MS()));
  assert.equal(missed.state, "MISSED");
  assert.equal(missed.metWindow, false);
});

test("never connected and past the deadline is OVERDUE, and stays on the queue", () => {
  const v = slaFor(DAY_LEAD, null, new Date(DAY_LEAD.getTime() + 2 * DAY_MS()));
  assert.equal(v.state, "OVERDUE");
  // Still bucketed — an overdue lead is the one most needing a call, so it must not vanish.
  assert.equal(bucketForLead(v), "DAY_DUE");
});

test("a connected lead is off the queue entirely", () => {
  const v = slaFor(DAY_LEAD, new Date(DAY_LEAD.getTime() + 60_000), new Date(DAY_LEAD.getTime() + DAY_MS()));
  assert.equal(bucketForLead(v), null);
});

test("signalForTarget uses the JD threshold, and stays silent with no data", () => {
  assert.equal(signalForTarget("fiveMinuteRate", 92), "ok");
  assert.equal(signalForTarget("fiveMinuteRate", 80), "watch");
  assert.equal(signalForTarget("fiveMinuteRate", 40), "risk");

  // The JD's 30–40% band: 30 passes, and exceeding the top of the range is not punished.
  assert.equal(signalForTarget("leadToBooked", 30), "ok");
  assert.equal(signalForTarget("leadToBooked", 55), "ok");
  assert.equal(signalForTarget("leadToBooked", 26), "watch");

  // No leads arrived → no verdict. A red 0% would train everyone to ignore the colours.
  assert.equal(signalForTarget("dayConnect", null), null);
});

test("rate refuses to invent a denominator", () => {
  assert.equal(rate(3, 4), 75);
  assert.equal(rate(0, 0), null);
  assert.equal(rate(0, 5), 0);
});

function DAY_MS() {
  return 86_400_000;
}
