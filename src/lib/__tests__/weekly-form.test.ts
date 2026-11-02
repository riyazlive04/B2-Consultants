import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  batchWeekNumber,
  orderedQuestions,
  validateWeeklyAnswer,
  validateWeeklySubmission,
  weekRefFor,
  weeklyAcceptance,
  weeklyOtherField,
  weeklyWindowState,
  WEEKLY_OTHER_VALUE,
  type WeeklyQuestion,
} from "../weekly-form";
import { istIsoWeekKey, parseDateInput } from "../dates";

function q(over: Partial<WeeklyQuestion> = {}): WeeklyQuestion {
  return {
    id: "q1",
    key: "applications",
    version: 1,
    kind: "NUMBER",
    metric: "APPLICATIONS",
    label: "Applications sent",
    required: true,
    orderIndex: 0,
    allowOther: false,
    ...over,
  };
}

const BLOCKERS = q({
  id: "q6",
  key: "blockers",
  kind: "SINGLE_SELECT",
  metric: "BLOCKERS",
  label: "Biggest blocker",
  allowOther: true,
  options: [
    { value: "none", label: "No blockers - I'm on track" },
    { value: "no_postings", label: "Can't find relevant job postings" },
  ],
});

const HOURS = q({
  id: "q3",
  key: "learning_hours",
  kind: "SINGLE_SELECT",
  metric: "LEARNING_HOURS",
  label: "German learning hours",
  options: [
    { value: "0", label: "0", numeric: 0 },
    { value: "1-2", label: "1-2 hours", numeric: 1 },
    { value: "3-5", label: "3-5 hours", numeric: 3 },
  ],
});

describe("numbers", () => {
  test("a whole number is accepted and counted", () => {
    const res = validateWeeklyAnswer(q(), "12");
    assert.deepEqual(res, { ok: true, value: 12, numeric: 12 });
  });

  test('"10+" is refused', () => {
    // This exact value is all over the founders' sheet, and it is the reason a column of
    // numbers could not be totalled. Better to refuse it at the form than to store it and
    // discover on the dashboard that the cohort's applications do not add up.
    const res = validateWeeklyAnswer(q(), "10+");
    assert.equal(res.ok, false);
  });

  test("prose in a number field is refused", () => {
    assert.equal(validateWeeklyAnswer(q(), "about ten").ok, false);
  });

  test("a negative count is refused", () => {
    assert.equal(validateWeeklyAnswer(q(), "-3").ok, false);
  });

  test("zero is a real answer, not a blank", () => {
    // "I applied to nothing this week" is the single most important answer the form can
    // collect - it is what the red flag rules look for. Treating 0 as empty would make the
    // students most at risk invisible.
    assert.deepEqual(validateWeeklyAnswer(q(), "0"), { ok: true, value: 0, numeric: 0 });
  });

  test("an absurd figure is refused", () => {
    assert.equal(validateWeeklyAnswer(q(), "999999").ok, false);
  });

  test("a question's own bounds win over the defaults", () => {
    assert.equal(validateWeeklyAnswer(q({ min: 1, max: 5 }), "6").ok, false);
    assert.equal(validateWeeklyAnswer(q({ min: 1, max: 5 }), "5").ok, true);
  });
});

describe("required and blank", () => {
  test("a required question refuses a blank", () => {
    assert.equal(validateWeeklyAnswer(q(), "").ok, false);
  });

  test("an optional blank is accepted as no answer at all", () => {
    assert.deepEqual(validateWeeklyAnswer(q({ required: false }), ""), {
      ok: true,
      value: null,
      numeric: null,
    });
  });

  test("an unanswered optional question stores no answer row", () => {
    // Nothing-was-given and nothing-was-asked have to stay distinguishable on read, which
    // they cannot be if an empty row is written for every skipped question.
    const out = validateWeeklySubmission([q({ required: false })], { applications: "" });
    assert.ok(out.ok);
    assert.equal(out.answers.length, 0);
  });
});

describe("selects", () => {
  test("a listed option is accepted", () => {
    assert.deepEqual(validateWeeklyAnswer(BLOCKERS, "no_postings"), {
      ok: true,
      value: "no_postings",
      numeric: null,
    });
  });

  test("an option that is not on the list is refused", () => {
    assert.equal(validateWeeklyAnswer(BLOCKERS, "something_else").ok, false);
  });

  test("other carries the typed text through, not the sentinel", () => {
    // The live sheet already had free text in its blockers column, so this path is a
    // description of what students actually do rather than a nicety.
    const res = validateWeeklyAnswer(BLOCKERS, WEEKLY_OTHER_VALUE, "A2 exam on the 18th");
    assert.deepEqual(res, { ok: true, value: "A2 exam on the 18th", numeric: null });
  });

  test("other with nothing typed is refused rather than stored as the sentinel", () => {
    assert.equal(validateWeeklyAnswer(BLOCKERS, WEEKLY_OTHER_VALUE, "  ").ok, false);
  });

  test("other is refused on a question that does not offer it", () => {
    const strict = { ...BLOCKERS, allowOther: false };
    assert.equal(validateWeeklyAnswer(strict, WEEKLY_OTHER_VALUE, "anything").ok, false);
  });

  test("a bucket option contributes its floor to the totals", () => {
    // The founders ask for learning hours as ranges. A dashboard still has to be able to
    // say roughly how much studying a cohort did, so a bucket may declare a number.
    assert.deepEqual(validateWeeklyAnswer(HOURS, "3-5"), { ok: true, value: "3-5", numeric: 3 });
  });

  test("a bucket with no declared number contributes nothing rather than a guess", () => {
    const res = validateWeeklyAnswer(BLOCKERS, "none");
    assert.ok(res.ok);
    assert.equal(res.numeric, null);
  });

  test("multi-select counts its selections", () => {
    const multi = { ...BLOCKERS, kind: "MULTI_SELECT" as const };
    const res = validateWeeklyAnswer(multi, ["none", "no_postings"]);
    assert.deepEqual(res, { ok: true, value: ["none", "no_postings"], numeric: 2 });
  });

  test("multi-select rejects the whole answer if one choice is unknown", () => {
    const multi = { ...BLOCKERS, kind: "MULTI_SELECT" as const };
    assert.equal(validateWeeklyAnswer(multi, ["none", "made_up"]).ok, false);
  });
});

describe("yes/no and text", () => {
  test("yes and no map to booleans and to 1 and 0", () => {
    const yn = q({ kind: "YES_NO", key: "ok" });
    assert.deepEqual(validateWeeklyAnswer(yn, "yes"), { ok: true, value: true, numeric: 1 });
    assert.deepEqual(validateWeeklyAnswer(yn, "no"), { ok: true, value: false, numeric: 0 });
  });

  test("anything else on a yes/no is refused", () => {
    assert.equal(validateWeeklyAnswer(q({ kind: "YES_NO" }), "maybe").ok, false);
  });

  test("text is trimmed and capped", () => {
    const t = q({ kind: "TEXT", key: "note" });
    assert.deepEqual(validateWeeklyAnswer(t, "  hello  "), { ok: true, value: "hello", numeric: null });
    assert.equal(validateWeeklyAnswer(t, "x".repeat(501)).ok, false);
  });

  test("long text allows more room", () => {
    assert.equal(validateWeeklyAnswer(q({ kind: "LONG_TEXT" }), "x".repeat(3000)).ok, true);
  });
});

describe("a whole submission", () => {
  const questions = [q(), HOURS, BLOCKERS];

  test("every error comes back at once, not just the first", () => {
    // A student who got two fields wrong should be told both, on one screen. Returning one
    // at a time turns a four-minute form into four trips.
    const out = validateWeeklySubmission(questions, {
      applications: "ten",
      learning_hours: "9-11",
      blockers: "none",
    });
    assert.equal(out.ok, false);
    assert.deepEqual(Object.keys(out.errors).sort(), ["applications", "learning_hours"]);
  });

  test("a valid submission yields one answer per answered question", () => {
    const out = validateWeeklySubmission(questions, {
      applications: "10",
      learning_hours: "1-2",
      blockers: WEEKLY_OTHER_VALUE,
      [weeklyOtherField("blockers")]: "In hospital for a small operation",
    });
    assert.ok(out.ok);
    assert.equal(out.answers.length, 3);
    assert.deepEqual(
      out.answers.map((a) => a.numeric),
      [10, 1, null],
    );
  });

  test("questions are shown in the founder's order", () => {
    const shuffled = [q({ key: "c", orderIndex: 2 }), q({ key: "a", orderIndex: 0 }), q({ key: "b", orderIndex: 1 })];
    assert.deepEqual(
      orderedQuestions(shuffled).map((x) => x.key),
      ["a", "b", "c"],
    );
  });
});

describe("which week it is", () => {
  test("a week runs Monday to Sunday", () => {
    // 2026-10-29 is a Thursday.
    const ref = weekRefFor(parseDateInput("2026-10-29"));
    assert.equal(ref.weekStart, "2026-10-26");
    assert.equal(ref.weekEnd, "2026-11-01");
  });

  test("a real instant is read as its IST day, not as the moment it is", () => {
    /**
     * THE REGRESSION. 2026-10-29T18:45Z is already Friday 00:15 in IST, and the week helpers
     * preserve the time of whatever they are handed. Before `istDayOf`, this instant produced
     * a week whose Monday carried 18:45 on it, so "Friday 00:00 IST" came out six hours in the
     * future on a day that had already started - and the weekly report's cron opened nothing,
     * silently, for a cohort that simply never got asked.
     */
    const lateThursdayUtc = new Date("2026-10-29T18:45:00.000Z");
    const ref = weekRefFor(lateThursdayUtc);
    assert.equal(ref.weekStart, "2026-10-26", "the Monday of the IST week, as a date");
    assert.equal(ref.weekEnd, "2026-11-01");
    assert.equal(ref.isoWeek, istIsoWeekKey(parseDateInput("2026-10-30")));
  });

  test("an instant just before IST midnight still belongs to the day that is ending", () => {
    const ref = weekRefFor(new Date("2026-10-29T18:25:00.000Z")); // 23:55 IST on Thursday
    assert.equal(ref.weekStart, "2026-10-26");
  });

  test("every day of a week gives the same key", () => {
    const keys = ["2026-10-26", "2026-10-29", "2026-11-01"].map(
      (d) => weekRefFor(parseDateInput(d)).isoWeek,
    );
    assert.equal(new Set(keys).size, 1);
  });

  test("1 January 2026 is in week 1", () => {
    assert.equal(istIsoWeekKey(parseDateInput("2026-01-01")), "2026-W01");
  });

  test("the last days of 2025 belong to 2026's first week", () => {
    // The Thursday rule, and the reason the key carries its own year: a naive
    // year-plus-number would file this Monday under 2025 and split one week in two.
    assert.equal(istIsoWeekKey(parseDateInput("2025-12-29")), "2026-W01");
  });

  test("2026 has a week 53", () => {
    assert.equal(istIsoWeekKey(parseDateInput("2026-12-31")), "2026-W53");
  });

  test("1 January 2027 is still 2026's week 53", () => {
    assert.equal(istIsoWeekKey(parseDateInput("2027-01-01")), "2026-W53");
  });
});

describe("which week of the programme it is", () => {
  test("the cohort's opening week is week 1", () => {
    const n = batchWeekNumber(parseDateInput("2026-04-03"), parseDateInput("2026-03-30"));
    assert.equal(n, 1);
  });

  test("four weeks on is week 5", () => {
    const n = batchWeekNumber(parseDateInput("2026-04-03"), parseDateInput("2026-04-27"));
    assert.equal(n, 5);
  });

  test("a cohort with no start date has no week number rather than a guessed one", () => {
    // It would appear on a tutor's screen as a fact about their curriculum.
    assert.equal(batchWeekNumber(null, parseDateInput("2026-04-27")), null);
  });

  test("a week before the cohort began has no number", () => {
    assert.equal(batchWeekNumber(parseDateInput("2026-04-03"), parseDateInput("2026-03-16")), null);
  });
});

describe("the window", () => {
  const opensAt = new Date("2026-10-26T04:00:00.000Z");
  const closesAt = new Date("2026-11-01T18:29:00.000Z");
  const cycle = { status: "OPEN" as const, opensAt, closesAt };

  test("before it opens, nothing is accepted", () => {
    const state = weeklyWindowState(cycle, new Date("2026-10-25T10:00:00.000Z"));
    assert.equal(state, "NOT_OPEN");
    assert.deepEqual(weeklyAcceptance(state), { accept: false, late: false });
  });

  test("inside the window a submission is on time", () => {
    const state = weeklyWindowState(cycle, new Date("2026-10-28T10:00:00.000Z"));
    assert.equal(state, "OPEN");
    assert.deepEqual(weeklyAcceptance(state), { accept: true, late: false });
  });

  test("past the deadline it still counts, and counts as late", () => {
    // The founders' own sheet has three values for "Form Submitted?" - Yes, No and Late.
    // That is them saying a late answer is worth more than no answer.
    const state = weeklyWindowState(cycle, new Date("2026-11-02T06:00:00.000Z"));
    assert.equal(state, "LATE");
    assert.deepEqual(weeklyAcceptance(state), { accept: true, late: true });
  });

  test("a closed week accepts nothing", () => {
    const state = weeklyWindowState({ ...cycle, status: "CLOSED" }, new Date("2026-10-28T10:00:00.000Z"));
    assert.equal(state, "CLOSED");
    assert.equal(weeklyAcceptance(state).accept, false);
  });
});
