/**
 * Curriculum - the rule that turns a programme timetable into one cohort's dates.
 *
 * Pure and DB-free.
 *
 * THE TEST THAT MATTERS is `reproduces Batch 14`. The founders' sheet is the specification
 * here, and the obvious reading of it ("week 3 = start + 14 days") produces the wrong dates
 * for three of Batch 14's eight sessions - it double-books Hidden and Open Job Market on the
 * same Sunday and pulls the final Q&A a week forward. The sequential rule in `planTimetable`
 * was written against this fixture and has to keep matching it exactly.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  addDaysYmd,
  dayCellLabel,
  dayOfWeekOf,
  formatDuration,
  onOrAfter,
  planTimetable,
  sortRows,
  strictlyAfter,
  GUIDED_CURRICULUM_SEED,
  type CurriculumRow,
} from "../curriculum";

/** The seed with ids attached - what the planner actually consumes. */
const seedRows: CurriculumRow[] = GUIDED_CURRICULUM_SEED.map((r, i) => ({ ...r, id: `item-${i}` }));

describe("day arithmetic", () => {
  test("day-of-week matches the Gregorian calendar", () => {
    assert.equal(dayOfWeekOf("2026-09-05"), 6); // Saturday
    assert.equal(dayOfWeekOf("2026-09-06"), 0); // Sunday
  });

  test("onOrAfter keeps a date that already falls on the day", () => {
    assert.equal(onOrAfter("2026-09-05", 6), "2026-09-05");
    assert.equal(onOrAfter("2026-09-06", 6), "2026-09-12");
  });

  test("strictlyAfter always moves - this is what makes a crowded week spill", () => {
    assert.equal(strictlyAfter("2026-09-20", 0), "2026-09-27");
    assert.equal(strictlyAfter("2026-09-13", 6), "2026-09-19");
  });

  test("addDaysYmd crosses month and year ends", () => {
    assert.equal(addDaysYmd("2026-10-04", 90), "2027-01-02");
  });
});

describe("planTimetable", () => {
  /**
   * Batch 14 of the founders' sheet, start date Saturday 5 September 2026. Every date below is
   * read off that sheet, not computed - that is the whole point of the fixture.
   */
  test("reproduces Batch 14 exactly, spill included", () => {
    const plan = planTimetable(seedRows, "2026-09-05", { sprintDays: 90 });

    assert.deepEqual(
      plan.sessions.map((s) => [s.title, s.dateYmd, s.timeHm]),
      [
        ["Kick Off", "2026-09-05", "10:30"],
        ["Resume Building", "2026-09-12", "10:30"],
        ["Social Profile Building", "2026-09-13", "19:00"],
        ["Special Q&A", "2026-09-19", "20:00"],
        ["Hidden Job Market", "2026-09-20", "10:30"],
        // The spill: week 3's third session cannot fit in week 3's weekend.
        ["Open Job Market", "2026-09-27", "10:30"],
        // Pre-recorded: released with the preceding session, no clock.
        ["German Interview Structure", "2026-09-27", null],
        ["Special Q&A & Sprint Start", "2026-10-04", "20:00"],
      ],
    );
  });

  test("the sprint runs from the last live session, landing on the sheet's own date", () => {
    const plan = planTimetable(seedRows, "2026-09-05", { sprintDays: 90 });
    assert.equal(plan.sprintStartYmd, "2026-10-04");
    assert.equal(plan.sprintEndYmd, "2027-01-02");
  });

  test("no sprint length means no sprint dates at all", () => {
    const plan = planTimetable(seedRows, "2026-09-05", { sprintDays: null });
    assert.equal(plan.sprintStartYmd, null);
    assert.equal(plan.sprintEndYmd, null);
  });

  test("a pre-recorded module never shifts the live classes around it", () => {
    const withoutVideo = seedRows.filter((r) => r.delivery === "LIVE");
    const withVideo = planTimetable(seedRows, "2026-09-05");
    const noVideo = planTimetable(withoutVideo, "2026-09-05");
    assert.deepEqual(
      noVideo.sessions.map((s) => s.dateYmd),
      withVideo.sessions.filter((s) => s.delivery === "LIVE").map((s) => s.dateYmd),
    );
  });

  test("a start date mid-week waits for the first session's weekday", () => {
    // Wednesday 2 Sep: the Kick Off is a Saturday session, so it waits for the 5th.
    const plan = planTimetable(seedRows, "2026-09-02");
    assert.equal(plan.sessions[0].dateYmd, "2026-09-05");
  });

  test("moving the start date moves the whole timetable with it", () => {
    const a = planTimetable(seedRows, "2026-09-05");
    const b = planTimetable(seedRows, "2026-09-12");
    assert.deepEqual(
      b.sessions.map((s) => s.dateYmd),
      a.sessions.map((s) => addDaysYmd(s.dateYmd, 7)),
    );
  });

  test("startsAt is the IST wall clock, not the server's", () => {
    const plan = planTimetable(seedRows, "2026-09-05");
    // 10:30 IST on 5 Sep 2026 is 05:00 UTC.
    assert.equal(plan.sessions[0].startsAt.toISOString(), "2026-09-05T05:00:00.000Z");
    // A pre-recorded module is released at IST midnight of its day.
    const video = plan.sessions.find((s) => s.delivery === "PRE_RECORDED")!;
    assert.equal(video.startsAt.toISOString(), "2026-09-26T18:30:00.000Z");
  });

  test("a live row with no time is counted, not silently dated at midnight", () => {
    const rows = seedRows.map((r) => (r.title === "Kick Off" ? { ...r, startTime: null } : r));
    const plan = planTimetable(rows, "2026-09-05");
    assert.equal(plan.missingTimes, 1);
    assert.equal(plan.sessions[0].timeHm, null);
  });

  test("a live row with no weekday sits with the session before it", () => {
    const rows: CurriculumRow[] = [
      { ...seedRows[0] },
      { ...seedRows[1], dayOfWeek: null },
    ];
    const plan = planTimetable(rows, "2026-09-05");
    assert.equal(plan.sessions[1].dateYmd, "2026-09-05");
  });

  test("rejects a start date that is not a day key", () => {
    assert.throws(() => planTimetable(seedRows, "05/09/2026"), /YYYY-MM-DD/);
  });
});

describe("presentation helpers", () => {
  test("durations read the way the sheet writes them", () => {
    assert.equal(formatDuration(90), "1.5 hrs");
    assert.equal(formatDuration(60), "1 hr");
    assert.equal(formatDuration(180), "3 hrs");
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(0), null);
  });

  test("the Day cell says what the sheet says", () => {
    assert.equal(dayCellLabel({ delivery: "LIVE", dayOfWeek: 6 }), "Saturday");
    assert.equal(dayCellLabel({ delivery: "PRE_RECORDED", dayOfWeek: null }), "Video (pre-rec)");
    assert.equal(dayCellLabel({ delivery: "LIVE", dayOfWeek: null }), "-");
  });

  test("sheet order is week first, then position within the week", () => {
    const shuffled = [seedRows[5], seedRows[0], seedRows[3]];
    assert.deepEqual(sortRows(shuffled).map((r) => r.title), [
      "Kick Off",
      "Special Q&A",
      "Open Job Market",
    ]);
  });
});

/**
 * TWO OR THREE CLASSES IN A WEEK (@34:20) - and the trap in entering them.
 *
 * The founders asked for a week to hold two or three classes depending on the plan, and that is
 * data entry rather than code: `planTimetable` emits one session per curriculum row and carries
 * `weekNumber` straight through, so a week holds however many rows carry its number.
 *
 * What is NOT obvious to whoever types those rows in is that `strictlyAfter` never places two
 * sessions on the same date. That is deliberate - it is what stops a week with two Saturday
 * rows double-booking - but the consequence is that the second Saturday row is dated a week
 * LATER while its `weekNumber` still says the earlier week. The timetable groups by
 * `weekNumber` and the register and the weekly report bucket by DATE, so the two would then
 * describe the same class differently.
 *
 * So these tests pin both halves: three distinct days stay inside their week, and two rows
 * sharing a day spill. The second is not a bug to fix; it is the answer to the bug report that
 * arrives when somebody adds a third class to a week and gives it a day already in use.
 */
describe("a week holding two or three classes", () => {
  const live = (
    weekNumber: number,
    orderIndex: number,
    title: string,
    dayOfWeek: number,
  ): CurriculumRow => ({
    id: `${weekNumber}-${orderIndex}`,
    weekNumber,
    orderIndex,
    title,
    framework: null,
    type: "LIVE_CLASS",
    delivery: "LIVE",
    durationMins: 90,
    dayOfWeek,
    startTime: "19:00",
    notes: null,
  });

  test("three classes on three different days all land inside their own week", () => {
    // Sat 5 / Tue 8 / Thu 10 September 2026 - one calendar week, three sessions.
    const rows = [
      live(1, 1, "Kick off", 6),
      live(1, 2, "Mid-week", 2),
      live(1, 3, "Clinic", 4),
    ];
    const plan = planTimetable(rows, "2026-09-05");
    assert.deepEqual(
      plan.sessions.map((x) => x.dateYmd),
      ["2026-09-05", "2026-09-08", "2026-09-10"],
    );
    // All three still report week 1, which is what the student's timetable groups by.
    assert.deepEqual(plan.sessions.map((x) => x.weekNumber), [1, 1, 1]);
  });

  test("a two-class week and a three-class week can sit in one template", () => {
    // The actual ask: the count per week is a property of the ROWS, not of the planner.
    const rows = [
      live(1, 1, "W1 a", 6),
      live(1, 2, "W1 b", 2),
      live(2, 1, "W2 a", 6),
      live(2, 2, "W2 b", 1),
      live(2, 3, "W2 c", 4),
    ];
    const plan = planTimetable(rows, "2026-09-05");
    const perWeek = plan.sessions.reduce<Record<number, number>>((acc, x) => {
      acc[x.weekNumber] = (acc[x.weekNumber] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(perWeek, { 1: 2, 2: 3 });
  });

  test("TWO ROWS SHARING A WEEKDAY are dated a week apart, though both still say the same week", () => {
    // The data-entry trap. `strictlyAfter` refuses to put two sessions on one date, so the
    // second Saturday row moves to the 12th - outside the week its `weekNumber` claims. Give
    // each class in a week its own day.
    const rows = [live(1, 1, "First", 6), live(1, 2, "Second", 6)];
    const plan = planTimetable(rows, "2026-09-05");
    assert.equal(plan.sessions[0].dateYmd, "2026-09-05");
    assert.equal(plan.sessions[1].dateYmd, "2026-09-12", "same weekday spills to the next week");
    assert.equal(plan.sessions[1].weekNumber, 1, "...while weekNumber still says week 1");
  });

  test("the sprint still starts at the LAST live session, however many a week holds", () => {
    // Adding a third class to the final taught week moves the sprint start with it - the
    // agreement has the sprint commencing immediately after the final session, not at a fixed
    // offset, so the count per week really does move the 90-day clock.
    const two = planTimetable([live(1, 1, "a", 6), live(1, 2, "b", 2)], "2026-09-05", { sprintDays: 90 });
    const three = planTimetable(
      [live(1, 1, "a", 6), live(1, 2, "b", 2), live(1, 3, "c", 4)],
      "2026-09-05",
      { sprintDays: 90 },
    );
    assert.equal(two.sprintStartYmd, "2026-09-08");
    assert.equal(three.sprintStartYmd, "2026-09-10");
  });
});
