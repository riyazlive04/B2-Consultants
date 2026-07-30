import test from "node:test";
import assert from "node:assert/strict";
import { slotStartsForRange, slotsPerRunningDay, WEEKDAY_FROM_JSDAY } from "../slot-plan";

/**
 * The manual generator and the nightly top-up both call this. If they ever disagree by so much
 * as a second, dedupe stops working and the calendar fills with near-duplicate pairs — so the
 * arithmetic is pinned here rather than left to two callers to reproduce.
 */

// Minimal stand-ins for the dates layer, matching its encoding: an IST day key is stored as
// UTC midnight, and IST is UTC+5:30.
const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const formatDate = (d: Date) => d.toISOString().slice(0, 10);
const istWallToUtc = (dateStr: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return new Date(parseDate(dateStr).getTime() + (h * 60 + m - 330) * 60_000);
};

const base = {
  istWallToUtc,
  parseDate,
  formatDate,
  bufferMinutes: 0,
};

const hhmmIst = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

test("weekday map reads a UTC-midnight date as its civil day", () => {
  // 2026-07-23 is a Thursday.
  assert.equal(WEEKDAY_FROM_JSDAY[parseDate("2026-07-23").getUTCDay()], "THU");
  assert.equal(WEEKDAY_FROM_JSDAY[parseDate("2026-07-26").getUTCDay()], "SUN");
});

test("fills a window at the interval, in IST wall-clock", () => {
  const starts = slotStartsForRange({
    ...base,
    startDate: "2026-07-23",
    endDate: "2026-07-23",
    pattern: { weekdays: ["THU"], startTime: "15:00", endTime: "18:00", intervalMins: 30, durationMins: 30 },
  });
  assert.deepEqual(starts.map(hhmmIst), ["15:00", "15:30", "16:00", "16:30", "17:00", "17:30"]);
});

test("a call ending exactly on the window's end time still fits", () => {
  // The classic off-by-one: 15:00-18:00 with 60-minute calls must yield a 17:00 slot.
  const starts = slotStartsForRange({
    ...base,
    startDate: "2026-07-23",
    endDate: "2026-07-23",
    pattern: { weekdays: ["THU"], startTime: "15:00", endTime: "18:00", intervalMins: 60, durationMins: 60 },
  });
  assert.deepEqual(starts.map(hhmmIst), ["15:00", "16:00", "17:00"]);
});

test("buffer widens the step without changing the first start", () => {
  const starts = slotStartsForRange({
    ...base,
    bufferMinutes: 15,
    startDate: "2026-07-23",
    endDate: "2026-07-23",
    pattern: { weekdays: ["THU"], startTime: "15:00", endTime: "18:00", intervalMins: 30, durationMins: 30 },
  });
  assert.deepEqual(starts.map(hhmmIst), ["15:00", "15:45", "16:30", "17:15"]);
});

test("skips days not in the pattern", () => {
  const starts = slotStartsForRange({
    ...base,
    startDate: "2026-07-23", // Thu
    endDate: "2026-07-27", // Mon
    pattern: { weekdays: ["MON", "FRI"], startTime: "15:00", endTime: "16:00", intervalMins: 60, durationMins: 60 },
  });
  assert.deepEqual(starts.map(formatDate), ["2026-07-24", "2026-07-27"]);
});

test("a window too short for one call yields nothing rather than throwing", () => {
  const starts = slotStartsForRange({
    ...base,
    startDate: "2026-07-23",
    endDate: "2026-07-23",
    pattern: { weekdays: ["THU"], startTime: "15:00", endTime: "15:30", intervalMins: 60, durationMins: 60 },
  });
  assert.deepEqual(starts, []);
});

test("an inverted range yields nothing rather than looping", () => {
  const starts = slotStartsForRange({
    ...base,
    startDate: "2026-07-27",
    endDate: "2026-07-23",
    pattern: { weekdays: ["MON"], startTime: "15:00", endTime: "18:00", intervalMins: 30, durationMins: 30 },
  });
  assert.deepEqual(starts, []);
});

/**
 * The Console's availability editor previews a pattern with `slotsPerRunningDay` before the
 * founder saves it. If that count could disagree with what the cron then creates, the preview
 * would be a lie on the one screen whose whole job is stopping an empty calendar — so it is
 * pinned against the real generator across every edge the cases above cover.
 */
test("the preview count matches what the generator actually produces", () => {
  const cases = [
    { startTime: "15:00", endTime: "18:00", intervalMins: 30, durationMins: 30, buffer: 0 },
    { startTime: "15:00", endTime: "18:00", intervalMins: 60, durationMins: 60, buffer: 0 },
    { startTime: "15:00", endTime: "18:00", intervalMins: 30, durationMins: 30, buffer: 15 },
    { startTime: "15:00", endTime: "15:30", intervalMins: 60, durationMins: 60, buffer: 0 }, // fits nothing
    { startTime: "09:00", endTime: "21:00", intervalMins: 15, durationMins: 30, buffer: 5 },
    { startTime: "23:00", endTime: "23:59", intervalMins: 30, durationMins: 30, buffer: 0 },
  ] as const;

  for (const c of cases) {
    const pattern = {
      weekdays: ["THU"] as const,
      startTime: c.startTime,
      endTime: c.endTime,
      intervalMins: c.intervalMins,
      durationMins: c.durationMins,
    };
    const actual = slotStartsForRange({
      ...base,
      bufferMinutes: c.buffer,
      startDate: "2026-07-23", // a single Thursday, so the day count is exactly one
      endDate: "2026-07-23",
      pattern,
    }).length;
    assert.equal(
      slotsPerRunningDay(pattern, c.buffer),
      actual,
      `preview disagreed for ${c.startTime}-${c.endTime} @ ${c.intervalMins}+${c.buffer} × ${c.durationMins}min`,
    );
  }
});

test("re-running the same range is byte-identical — this is what makes dedupe work", () => {
  const args = {
    ...base,
    startDate: "2026-07-20",
    endDate: "2026-08-10",
    pattern: {
      weekdays: ["MON", "WED", "FRI"] as const,
      startTime: "15:00",
      endTime: "18:00",
      intervalMins: 30,
      durationMins: 30,
    },
  };
  const a = slotStartsForRange(args).map((d) => d.getTime());
  const b = slotStartsForRange(args).map((d) => d.getTime());
  assert.deepEqual(a, b);
  assert.ok(a.length > 20);
});
