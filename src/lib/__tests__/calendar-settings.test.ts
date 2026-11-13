import test from "node:test";
import assert from "node:assert/strict";
import { calendarSettingRows, type SlotTally } from "../calendar-settings";

/** Feature 7 (build-docs/features/calendar-settings.md): the calendar list, derived not stored. */

const team = [
  { id: "u-asma", name: "Asma" },
  { id: "u-ameen", name: "Ameen" },
];

const pattern = (o: Partial<Parameters<typeof calendarSettingRows>[0]["patterns"][number]> = {}) => ({
  id: "c1", name: "Asma weekdays", enabled: true, weekdays: ["MON", "TUE", "WED", "THU", "FRI"],
  startTime: "15:00", endTime: "18:00", durationMins: 30, assignedToId: "u-asma", ...o,
});

const tally = (ownerId: string | null, openAhead: number): SlotTally => ({ ownerId, openAhead, lastAheadAt: null });

const build = (p: {
  patterns?: ReturnType<typeof pattern>[];
  sss?: { ownerId: string | null; slotDurationMins: number };
  disco?: SlotTally[];
  sssT?: SlotTally[];
}) =>
  calendarSettingRows(
    {
      patterns: p.patterns ?? [],
      sss: p.sss ?? { ownerId: null, slotDurationMins: 45 },
      discoTallies: p.disco ?? [],
      sssTallies: p.sssT ?? [],
    },
    team,
  );

test("calendar-settings AC1: one row per discovery pattern, plus the one strategy calendar", () => {
  const rows = build({ patterns: [pattern()], disco: [tally("u-asma", 12)], sss: { ownerId: "u-ameen", slotDurationMins: 45 }, sssT: [tally("u-ameen", 3)] });
  assert.deepEqual(rows.map((r) => r.key), ["disco:c1", "sss"]);
  assert.equal(rows[0].ownerName, "Asma");
  assert.equal(rows[0].status, "ACTIVE");
  assert.equal(rows[0].schedule, "Mon, Tue, Wed, Thu, Fri · 15:00-18:00");
  assert.equal(rows[1].ownerName, "Ameen");
  assert.equal(rows[1].status, "ACTIVE");
});

test("calendar-settings: the three ways a calendar produces nothing are told apart", () => {
  // Switched off beats everything: it is why there is nothing, and the cure is one toggle.
  assert.equal(build({ patterns: [pattern({ enabled: false })] })[0].status, "SWITCHED_OFF");
  // On, but no weekdays - the trap that emptied production once.
  assert.equal(build({ patterns: [pattern({ weekdays: [] })] })[0].status, "NO_DAYS");
  // Properly configured and still offering nothing: a real, different problem.
  assert.equal(build({ patterns: [pattern()], disco: [tally("u-asma", 0)] })[0].status, "NO_AVAILABILITY");
});

test("calendar-settings: slots no pattern explains get their own row, and only when bookable", () => {
  const rows = build({ patterns: [pattern()], disco: [tally("u-asma", 4), tally(null, 6), tally("u-ameen", 0)] });
  // The unassigned pile has open slots and no pattern, so it is listed...
  assert.deepEqual(rows.map((r) => r.key), ["disco:c1", "disco-loose:none", "sss"]);
  assert.equal(rows[1].ownerName, "Unassigned");
  assert.equal(rows[1].openAhead, 6);
  // ...while an owner with no open slots and no pattern is not a calendar at all.
  assert.equal(rows.some((r) => r.key.includes("u-ameen")), false);
});

test("calendar-settings edge: no SSS owner says so rather than reading as broken", () => {
  const [sss] = build({});
  assert.equal(sss.key, "sss");
  assert.equal(sss.status, "NO_OWNER");
  assert.equal(sss.ownerName, "Unassigned");
  assert.equal(sss.editHref, "/bookings?tab=sss");
});

test("calendar-settings edge: an unassigned pattern is one calendar, not a missing owner", () => {
  const rows = build({ patterns: [pattern({ assignedToId: "" })], disco: [tally(null, 2)] });
  assert.equal(rows.length, 2); // the pattern explains the unassigned pile - no loose row
  assert.equal(rows[0].ownerName, "Unassigned");
  assert.equal(rows[0].openAhead, 2);
});
