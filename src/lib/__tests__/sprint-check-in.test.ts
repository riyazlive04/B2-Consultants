import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AWAITING_COACH,
  CONCERN_STREAK,
  UNANSWERED,
  awaitsCoach,
  awaitsStudent,
  checkInState,
  isConcerning,
  nextWeekToAnswer,
  unansweredStreak,
  type CheckInWeek,
} from "../sprint-check-in";

/**
 * WHOSE MOVE IS IT - the two halves of PENDING.
 *
 * The case worth reading is `AWAITING_COACH` vs `OVERDUE`. Both are PENDING rows with a closed
 * week, and before this split the app showed a coach the same "overdue" line for both - for one
 * of which the student had already done everything asked of them.
 */

const week = (over: Partial<CheckInWeek> = {}): CheckInWeek => ({
  status: "PENDING",
  actual: null,
  weekStartYmd: "2026-10-05",
  weekEndYmd: "2026-10-11",
  ...over,
});

describe("whose move it is", () => {
  test("a week that has not started is nobody's chore", () => {
    assert.equal(checkInState(week(), "2026-10-01"), "NOT_STARTED");
    assert.equal(awaitsStudent(week(), "2026-10-01"), false);
  });

  test("inside its own week, it waits on the student", () => {
    assert.equal(checkInState(week(), "2026-10-08"), "AWAITING_STUDENT");
    // The last day still counts as open - the check-in is a weekend job, and the weekend is
    // the end of the window.
    assert.equal(checkInState(week(), "2026-10-11"), "AWAITING_STUDENT");
    assert.equal(awaitsStudent(week(), "2026-10-08"), true);
  });

  test("closed with no answer is OVERDUE - the thing the ladder chases", () => {
    assert.equal(checkInState(week(), "2026-10-12"), "OVERDUE");
    assert.equal(awaitsStudent(week(), "2026-10-12"), true);
    assert.equal(awaitsCoach(week(), "2026-10-12"), false);
  });

  test("answered but unjudged waits on the COACH, not the student", () => {
    // The founding bug: a prose target leaves the verdict to a human, so the row stays PENDING
    // with an `actual`. Treating that as the student's problem reopened the form, empty, and a
    // second submission silently replaced the first.
    const answered = week({ actual: "12 applications" });
    assert.equal(checkInState(answered, "2026-10-12"), "AWAITING_COACH");
    assert.equal(awaitsStudent(answered, "2026-10-12"), false);
    assert.equal(awaitsCoach(answered, "2026-10-12"), true);
  });

  test("an answer given early still waits on the coach, whatever the calendar says", () => {
    const answered = week({ actual: "done" });
    assert.equal(checkInState(answered, "2026-10-06"), "AWAITING_COACH");
  });

  test("an empty string counts as no answer", () => {
    // A form can submit "". If that read as answered, the week would sit in the coach's queue
    // for ever showing nothing.
    assert.equal(checkInState(week({ actual: "" }), "2026-10-12"), "OVERDUE");
  });

  test("a judged week is closed out whatever its dates", () => {
    for (const status of ["ACHIEVED", "MISSED"]) {
      assert.equal(checkInState(week({ status }), "2026-10-12"), "JUDGED");
      assert.equal(checkInState(week({ status, actual: "x" }), "2026-10-01"), "JUDGED");
    }
  });
});

describe("which week to put in front of the student", () => {
  const weeks: CheckInWeek[] = [
    { status: "ACHIEVED", actual: "10", weekStartYmd: "2026-09-21", weekEndYmd: "2026-09-27" },
    { status: "PENDING", actual: null, weekStartYmd: "2026-09-28", weekEndYmd: "2026-10-04" },
    { status: "PENDING", actual: null, weekStartYmd: "2026-10-05", weekEndYmd: "2026-10-11" },
    { status: "PENDING", actual: null, weekStartYmd: "2026-10-12", weekEndYmd: "2026-10-18" },
  ];

  test("the current week wins when it is open", () => {
    const pick = nextWeekToAnswer(weeks, "2026-10-14");
    assert.equal(pick?.weekStartYmd, "2026-10-12");
  });

  test("otherwise the OLDEST overdue one", () => {
    // Oldest first: asking about last week while the week before is still blank invites a
    // student to skip it permanently - and the oldest gap is what the concern streak counts.
    const pick = nextWeekToAnswer(weeks, "2026-10-20");
    assert.equal(pick?.weekStartYmd, "2026-09-28");
  });

  test("nothing to answer returns null rather than an arbitrary week", () => {
    const allDone: CheckInWeek[] = [
      { status: "ACHIEVED", actual: "10", weekStartYmd: "2026-09-21", weekEndYmd: "2026-09-27" },
      { status: "PENDING", actual: "sent", weekStartYmd: "2026-09-28", weekEndYmd: "2026-10-04" },
    ];
    assert.equal(nextWeekToAnswer(allDone, "2026-10-20"), null);
  });

  test("a week that has not started is never offered", () => {
    const future: CheckInWeek[] = [
      { status: "PENDING", actual: null, weekStartYmd: "2026-11-02", weekEndYmd: "2026-11-08" },
    ];
    assert.equal(nextWeekToAnswer(future, "2026-10-20"), null);
  });
});

describe("the concern streak", () => {
  const w = (start: string, end: string, over: Partial<CheckInWeek> = {}): CheckInWeek => ({
    status: "PENDING",
    actual: null,
    weekStartYmd: start,
    weekEndYmd: end,
    ...over,
  });

  test("counts consecutive unanswered closed weeks, back from the most recent", () => {
    const weeks = [
      w("2026-09-21", "2026-09-27", { status: "ACHIEVED", actual: "10" }),
      w("2026-09-28", "2026-10-04"),
      w("2026-10-05", "2026-10-11"),
      w("2026-10-12", "2026-10-18"),
    ];
    assert.equal(unansweredStreak(weeks, "2026-10-20"), 3);
    assert.equal(isConcerning(3), true);
  });

  test("an answered week ENDS the streak", () => {
    // "In a row" and "in total" are different facts, and only the first says a student has
    // stopped engaging. A student who missed three weeks in March and has answered every week
    // since is not a discontinue candidate, and a total would say they were, for ever.
    const weeks = [
      w("2026-09-07", "2026-09-13"),
      w("2026-09-14", "2026-09-20"),
      w("2026-09-21", "2026-09-27"),
      w("2026-09-28", "2026-10-04", { actual: "back on it" }),
      w("2026-10-05", "2026-10-11"),
    ];
    assert.equal(unansweredStreak(weeks, "2026-10-20"), 1);
    assert.equal(isConcerning(1), false);
  });

  test("a week the coach judged also ends it - somebody was there", () => {
    const weeks = [
      w("2026-09-28", "2026-10-04"),
      w("2026-10-05", "2026-10-11", { status: "MISSED", actual: "only 2" }),
      w("2026-10-12", "2026-10-18"),
    ];
    assert.equal(unansweredStreak(weeks, "2026-10-20"), 1);
  });

  test("the open week does not count against the student", () => {
    // Their window has not shut yet. Counting it would flag a student at 9am on the Saturday.
    const weeks = [w("2026-10-05", "2026-10-11"), w("2026-10-12", "2026-10-18")];
    assert.equal(unansweredStreak(weeks, "2026-10-14"), 1, "only the closed week counts");
  });

  test("a brand-new student has no streak", () => {
    assert.equal(unansweredStreak([], "2026-10-20"), 0);
    assert.equal(isConcerning(0), false);
  });

  test("two missed weekends is not yet a concern", () => {
    // One weekend to a wedding and the next to a cold is not a pattern, and a desk that cried
    // concern at two would be crying most weeks.
    assert.equal(CONCERN_STREAK, 3);
    assert.equal(isConcerning(2), false);
  });
});

describe("the Prisma filters say the same thing as the predicates", () => {
  /**
   * These objects are spread into `where` clauses, so nothing in the type system ties them to
   * the functions above. This is the tie: if one is edited and the other is not, a query and a
   * screen start disagreeing about the same week, which is the whole class of bug this file was
   * extracted to end.
   */
  test("AWAITING_COACH is PENDING with an answer", () => {
    assert.deepEqual({ ...AWAITING_COACH }, { status: "PENDING", actual: { not: null } });
    const matching = week({ status: "PENDING", actual: "12 applications" });
    assert.equal(awaitsCoach(matching, "2026-10-12"), true);
  });

  test("UNANSWERED is PENDING with no answer", () => {
    assert.deepEqual({ ...UNANSWERED }, { status: "PENDING", actual: null });
    const matching = week({ status: "PENDING", actual: null });
    assert.equal(awaitsStudent(matching, "2026-10-12"), true);
    assert.equal(awaitsCoach(matching, "2026-10-12"), false);
  });

  test("the two filters are mutually exclusive and cover PENDING between them", () => {
    // A row cannot be in both, and a PENDING row whose window has opened is in exactly one -
    // so a coach's two queues can never double-count a week or lose one.
    const answered = week({ actual: "x" });
    const unanswered = week();
    const today = "2026-10-12";
    assert.equal(awaitsCoach(answered, today) && awaitsStudent(answered, today), false);
    assert.equal(awaitsCoach(unanswered, today) && awaitsStudent(unanswered, today), false);
    assert.equal(awaitsCoach(answered, today) || awaitsStudent(answered, today), true);
    assert.equal(awaitsCoach(unanswered, today) || awaitsStudent(unanswered, today), true);
  });
});
