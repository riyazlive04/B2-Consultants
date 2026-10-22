import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildWeeklyReport, type WeekInput } from "../weekly-report";

/**
 * THE WEEKLY PROGRESS REPORT.
 *
 * The case worth reading is the attendance NULL. A week in which no register was taken has no
 * attendance percentage, and reporting it as 0% would show a coach their own outstanding
 * register back as their student's absence - which is the one reading that would make this
 * table worse than not having it.
 *
 * The second is the trend, which is null in three different situations. Collapsing any of them
 * into "level" would be a claim the data does not support.
 */

const TODAY = "2026-10-20";

/** A sprint week. Dates default to a fully closed week well before TODAY. */
const week = (over: Partial<WeekInput> = {}): WeekInput => ({
  id: over.id ?? `w${over.weekIndex ?? 1}`,
  weekIndex: 1,
  weekStartYmd: "2026-09-28",
  weekEndYmd: "2026-10-04",
  target: "15 applications",
  actual: "15 applications",
  status: "ACHIEVED",
  note: null,
  counts: {},
  classesHeld: 0,
  classesMarked: 0,
  ...over,
});

describe("attendance: a dash is not a zero", () => {
  test("no register taken that week means NO percentage", () => {
    const r = buildWeeklyReport([week({ classesHeld: 2, classesMarked: 0 })], TODAY);
    assert.equal(r.rows[0].attendance, null);
  });

  test("the denominator is MARKED classes, not held ones", () => {
    // Three classes, one marked, the student was there: that is 1 of 1, not 1 of 3. The other
    // two are evidence of nothing, and putting them in the denominator would report a 33% to a
    // coach who simply has two registers outstanding.
    const r = buildWeeklyReport(
      [week({ classesHeld: 3, classesMarked: 1, counts: { class_attended: 1 } })],
      TODAY,
    );
    assert.deepEqual(r.rows[0].attendance, { attended: 1, of: 1, pct: 100 });
  });

  test("a marked class the student missed IS a real zero", () => {
    // The distinction the whole rule exists for: a register that exists and does not mention
    // this student is evidence of an absence.
    const r = buildWeeklyReport(
      [week({ classesHeld: 2, classesMarked: 2, counts: {} })],
      TODAY,
    );
    assert.deepEqual(r.rows[0].attendance, { attended: 0, of: 2, pct: 0 });
  });

  test("the summary average skips the weeks with no register entirely", () => {
    const r = buildWeeklyReport(
      [
        week({ weekIndex: 1, id: "a", classesHeld: 2, classesMarked: 2, counts: { class_attended: 2 } }),
        week({ weekIndex: 2, id: "b", weekStartYmd: "2026-10-05", weekEndYmd: "2026-10-11", classesHeld: 2, classesMarked: 0 }),
      ],
      TODAY,
    );
    // 2 of 2, not 2 of 4 - the unmarked week contributes to neither side.
    assert.deepEqual(r.summary.attendance, { attended: 2, of: 2, pct: 100 });
  });

  test("a sprint where nothing was ever marked has a null summary average", () => {
    const r = buildWeeklyReport([week({ classesHeld: 3, classesMarked: 0 })], TODAY);
    assert.equal(r.summary.attendance, null);
  });
});

describe("the trend", () => {
  const w = (i: number, start: string, end: string, outreach: number): WeekInput =>
    week({
      id: `w${i}`,
      weekIndex: i,
      weekStartYmd: start,
      weekEndYmd: end,
      counts: { application_submitted: outreach },
    });

  test("the first week has no trend - there is nothing before it", () => {
    const r = buildWeeklyReport([w(1, "2026-09-28", "2026-10-04", 10)], TODAY);
    assert.equal(r.rows[0].trend, null);
    assert.equal(r.rows[0].delta, null);
  });

  test("up, down and level against the previous closed week", () => {
    const r = buildWeeklyReport(
      [
        w(1, "2026-09-21", "2026-09-27", 10),
        w(2, "2026-09-28", "2026-10-04", 16),
        w(3, "2026-10-05", "2026-10-11", 4),
        w(4, "2026-10-12", "2026-10-18", 4),
      ],
      TODAY,
    );
    assert.deepEqual(
      r.rows.map((x) => [x.trend, x.delta]),
      [
        [null, null],
        ["UP", 6],
        ["DOWN", -12],
        ["LEVEL", 0],
      ],
    );
  });

  test("a week still running gets NO trend", () => {
    // Comparing a half-finished week against a complete one would show a student having a
    // perfectly normal Tuesday as sharply down, every Tuesday.
    const r = buildWeeklyReport(
      [w(1, "2026-10-05", "2026-10-11", 20), w(2, "2026-10-19", "2026-10-25", 3)],
      TODAY,
    );
    assert.equal(r.rows[1].trend, null, "the open week is not compared");
  });

  test("the comparison skips over an open week rather than using it", () => {
    // Weeks 1 and 2 are closed, week 3 is open. Week 3 must not become week 4's baseline, or a
    // full week would be compared against a partial one.
    const r = buildWeeklyReport(
      [
        w(1, "2026-09-21", "2026-09-27", 10),
        w(2, "2026-09-28", "2026-10-04", 12),
        w(3, "2026-10-19", "2026-10-25", 1),
      ],
      TODAY,
    );
    assert.equal(r.rows[1].delta, 2);
    assert.equal(r.rows[2].trend, null);
  });

  test("weeks are ordered by index, not by the order they arrive", () => {
    // The trend means "against the week before", and an unsorted list would make that whatever
    // the database happened to return first.
    const r = buildWeeklyReport(
      [w(2, "2026-09-28", "2026-10-04", 20), w(1, "2026-09-21", "2026-09-27", 5)],
      TODAY,
    );
    assert.deepEqual(r.rows.map((x) => x.weekIndex), [1, 2]);
    assert.equal(r.rows[1].delta, 15);
  });
});

describe("outreach and the counts", () => {
  test("outreach is applications PLUS accepted connections", () => {
    const r = buildWeeklyReport(
      [week({ counts: { application_submitted: 12, hr_connection: 8, hr_interview: 2 } })],
      TODAY,
    );
    assert.equal(r.rows[0].outreach, 20);
    assert.equal(r.rows[0].interviews, 2);
  });

  test("a reviewed application is not outreach", () => {
    // Being read is something a company did, not something the student did - the same rule the
    // leaderboard's conversion ratio applies, so the two screens agree about one week.
    const a = buildWeeklyReport([week({ counts: { application_submitted: 10 } })], TODAY);
    const b = buildWeeklyReport(
      [week({ counts: { application_submitted: 10, application_reviewed: 40 } })],
      TODAY,
    );
    assert.equal(a.rows[0].outreach, b.rows[0].outreach);
  });

  test("negative and fractional counts cannot bend a week", () => {
    // Counts arrive partly from `_sum.quantity` on a self-reported table, so the guard is real.
    const r = buildWeeklyReport(
      [week({ counts: { application_submitted: -5, hr_connection: 10.4 } })],
      TODAY,
    );
    assert.equal(r.rows[0].outreach, 10);
  });
});

describe("the summary", () => {
  const closed = (i: number, start: string, end: string, over: Partial<WeekInput> = {}) =>
    week({ id: `w${i}`, weekIndex: i, weekStartYmd: start, weekEndYmd: end, ...over });

  test("achieved and missed come off the STATUS, which is the only thing that separates them", () => {
    // `checkInState` deliberately collapses both into JUDGED - for "whose move is it" they are
    // the same answer. Here they are opposites.
    const r = buildWeeklyReport(
      [
        closed(1, "2026-09-21", "2026-09-27", { status: "ACHIEVED" }),
        closed(2, "2026-09-28", "2026-10-04", { status: "MISSED", actual: "4" }),
        closed(3, "2026-10-05", "2026-10-11", { status: "ACHIEVED" }),
      ],
      TODAY,
    );
    assert.equal(r.summary.achieved, 2);
    assert.equal(r.summary.missed, 1);
  });

  test("a closed week the student never answered counts as unanswered, not missed", () => {
    // MISSED is a coach's verdict that the target was not hit. Silence is a different fact, and
    // reporting it as MISSED would record a judgement nobody made.
    const r = buildWeeklyReport(
      [closed(1, "2026-09-28", "2026-10-04", { status: "PENDING", actual: null })],
      TODAY,
    );
    assert.equal(r.summary.unanswered, 1);
    assert.equal(r.summary.missed, 0);
    assert.equal(r.rows[0].state, "OVERDUE");
  });

  test("answered-but-unjudged is counted as waiting on the coach", () => {
    const r = buildWeeklyReport(
      [closed(1, "2026-09-28", "2026-10-04", { status: "PENDING", actual: "did 12" })],
      TODAY,
    );
    assert.equal(r.summary.awaitingCoach, 1);
    assert.equal(r.summary.unanswered, 0);
    assert.equal(r.rows[0].state, "AWAITING_COACH");
  });

  test("weeksClosed counts only the closed ones", () => {
    const r = buildWeeklyReport(
      [closed(1, "2026-09-28", "2026-10-04"), closed(2, "2026-10-19", "2026-10-25")],
      TODAY,
    );
    assert.equal(r.summary.weeksClosed, 1);
  });

  test("the best week is by outreach, and a tie goes to the EARLIER week", () => {
    // The sentence this exists for is "you did 30 in week 2 - what was different then", and the
    // earlier instance is the one with more weeks after it to learn from.
    const r = buildWeeklyReport(
      [
        closed(1, "2026-09-21", "2026-09-27", { counts: { application_submitted: 30 } }),
        closed(2, "2026-09-28", "2026-10-04", { counts: { application_submitted: 30 } }),
        closed(3, "2026-10-05", "2026-10-11", { counts: { application_submitted: 5 } }),
      ],
      TODAY,
    );
    assert.deepEqual(r.summary.bestWeek, { weekIndex: 1, outreach: 30 });
  });

  test("a sprint with no outreach at all has no best week, rather than a best week of zero", () => {
    const r = buildWeeklyReport([closed(1, "2026-09-28", "2026-10-04")], TODAY);
    assert.equal(r.summary.bestWeek, null);
  });

  test("an open week cannot be the best week", () => {
    // It is still accruing. Crowning it would move the crown off a finished week halfway
    // through the following Tuesday.
    const r = buildWeeklyReport(
      [
        closed(1, "2026-09-28", "2026-10-04", { counts: { application_submitted: 10 } }),
        closed(2, "2026-10-19", "2026-10-25", { counts: { application_submitted: 99 } }),
      ],
      TODAY,
    );
    assert.deepEqual(r.summary.bestWeek, { weekIndex: 1, outreach: 10 });
  });

  test("the silent streak is carried, so the screen does not recompute it", () => {
    const r = buildWeeklyReport(
      [
        closed(1, "2026-09-28", "2026-10-04", { status: "PENDING", actual: null }),
        closed(2, "2026-10-05", "2026-10-11", { status: "PENDING", actual: null }),
        closed(3, "2026-10-12", "2026-10-18", { status: "PENDING", actual: null }),
      ],
      TODAY,
    );
    assert.equal(r.summary.unansweredStreak, 3);
  });
});

describe("weeks that have not happened", () => {
  test("a future week appears in the rows, marked NOT_STARTED and uncompared", () => {
    // It stays in the report because the coach sets targets on it in the tracker above; the
    // table drops it. It is not a gap and must never be counted as one.
    const r = buildWeeklyReport(
      [week({ weekStartYmd: "2026-11-02", weekEndYmd: "2026-11-08", status: "PENDING", actual: null })],
      TODAY,
    );
    assert.equal(r.rows[0].state, "NOT_STARTED");
    assert.equal(r.rows[0].trend, null);
    assert.equal(r.summary.unanswered, 0);
    assert.equal(r.summary.weeksClosed, 0);
  });

  test("no weeks at all is an empty report, not a crash", () => {
    const r = buildWeeklyReport([], TODAY);
    assert.deepEqual(r.rows, []);
    assert.equal(r.summary.weeksClosed, 0);
    assert.equal(r.summary.attendance, null);
    assert.equal(r.summary.bestWeek, null);
  });
});
