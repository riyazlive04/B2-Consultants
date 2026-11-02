import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildWeeklyFlagSeries,
  summariseWeekly,
  weeklyThresholdsFor,
  WEEKLY_THRESHOLD_DEFAULTS,
  type FlagReasonCode,
  type WeeklyWeekInput,
} from "../weekly-flags";

/**
 * Each case below quotes the row of the founders' "RED FLAG INTERVENTION SYSTEM" tab it
 * encodes, so that a change to a threshold has to argue with the source rather than with
 * a number someone typed here.
 */

/** A clean week: everything at or above target, form in on time. */
function green(isoWeek: string, over: Partial<WeeklyWeekInput> = {}): WeeklyWeekInput {
  return {
    isoWeek,
    weekStart: `2026-01-${isoWeek.slice(-2)}`,
    submitted: true,
    late: false,
    metrics: { APPLICATIONS: 10, INTERVIEWS: 0, NETWORKING: 7, LINKEDIN_POSTS: 7 },
    ...over,
  };
}

/** A week with no submission at all. */
function missed(isoWeek: string): WeeklyWeekInput {
  return {
    isoWeek,
    weekStart: `2026-01-${isoWeek.slice(-2)}`,
    submitted: false,
    late: false,
    metrics: {},
  };
}

function codes(reasons: { code: FlagReasonCode }[]): FlagReasonCode[] {
  return reasons.map((r) => r.code);
}

function lastRow(weeks: WeeklyWeekInput[], cfg = WEEKLY_THRESHOLD_DEFAULTS) {
  const rows = buildWeeklyFlagSeries(weeks, cfg);
  return rows[rows.length - 1];
}

describe("green", () => {
  test("target met on every metric is green with no reasons but ON_TRACK", () => {
    const row = lastRow([green("W01")]);
    assert.equal(row.flag, "GREEN");
    assert.deepEqual(codes(row.reasons), ["ON_TRACK"]);
  });

  test("above target is still green", () => {
    const row = lastRow([green("W01", { metrics: { APPLICATIONS: 25, NETWORKING: 20, LINKEDIN_POSTS: 12 } })]);
    assert.equal(row.flag, "GREEN");
  });

  test("a late form is noted but does not by itself cost the green", () => {
    // The tracker's third value for "Form Submitted?" is Late, beside Yes and No. It is
    // worth recording - a tutor chasing someone wants to know - but the tab lists no flag
    // for it, and inventing one here would punish the students who did eventually answer.
    const row = lastRow([green("W01", { late: true })]);
    assert.equal(row.flag, "GREEN");
    assert.ok(codes(row.reasons).includes("FORM_LATE"));
  });
});

describe("yellow: the single-week triggers", () => {
  test("missed 1 weekly form -> yellow, immediately", () => {
    // "Green -> Yellow: a single missed form or sub-10 app week moves Green to Yellow
    // immediately. No grace period."
    const row = lastRow([green("W01"), missed("W02")]);
    assert.equal(row.flag, "YELLOW");
    assert.ok(codes(row.reasons).includes("FORM_MISSED"));
  });

  test("submitted but below 10 applications -> yellow", () => {
    // "Below 10 apps/week | Submitted form but fewer than 10 applications."
    const row = lastRow([green("W01", { metrics: { APPLICATIONS: 4, NETWORKING: 7, LINKEDIN_POSTS: 7 } })]);
    assert.equal(row.flag, "YELLOW");
    assert.ok(codes(row.reasons).includes("APPS_BELOW_TARGET"));
  });

  test("below 5 on networking -> yellow", () => {
    // "Below 5 on either metric | Networking contacts below 5/week OR LinkedIn posts below 5/week."
    const row = lastRow([green("W01", { metrics: { APPLICATIONS: 10, NETWORKING: 3, LINKEDIN_POSTS: 7 } })]);
    assert.equal(row.flag, "YELLOW");
    assert.deepEqual(codes(row.reasons).includes("NETWORKING_LOW"), true);
  });

  test("below 5 on posts -> yellow", () => {
    const row = lastRow([green("W01", { metrics: { APPLICATIONS: 10, NETWORKING: 7, LINKEDIN_POSTS: 2 } })]);
    assert.equal(row.flag, "YELLOW");
    assert.ok(codes(row.reasons).includes("POSTS_LOW"));
  });

  test("zero networking for one week -> yellow, with its own reason", () => {
    // "Zero networking OR zero posts for 1 week | Submitted the weekly form but reported 0."
    const row = lastRow([green("W01", { metrics: { APPLICATIONS: 10, NETWORKING: 0, LINKEDIN_POSTS: 7 } })]);
    assert.equal(row.flag, "YELLOW");
    assert.ok(codes(row.reasons).includes("NETWORKING_ZERO"));
    assert.ok(!codes(row.reasons).includes("NETWORKING_LOW"), "zero is its own reason, not 'low'");
  });

  test("networking and posting on target but applications low -> the coaching yellow", () => {
    // "High networking + high posts + low applications | Not a punishment flag - a coaching
    // moment." It gets its own code because the message that goes out is a different message.
    const row = lastRow([
      green("W01", { metrics: { APPLICATIONS: 3, NETWORKING: 12, LINKEDIN_POSTS: 9 } }),
    ]);
    assert.equal(row.flag, "YELLOW");
    assert.ok(codes(row.reasons).includes("VISIBILITY_WITHOUT_APPLICATIONS"));
  });
});

describe("red: the two-week triggers", () => {
  test("missed 2 weekly forms in a row -> red", () => {
    // "Missed 2 weekly forms in a row | No form submission for 2 consecutive weeks."
    const row = lastRow([green("W01"), missed("W02"), missed("W03")]);
    assert.equal(row.flag, "RED");
    assert.ok(codes(row.reasons).includes("FORM_MISSED_TWICE"));
  });

  test("two misses that are not adjacent are not a red", () => {
    // "Consecutive" means adjacent. A student who missed, answered, then missed again is a
    // yellow being chased, not a ghost.
    const rows = buildWeeklyFlagSeries([missed("W01"), green("W02"), missed("W03")]);
    assert.equal(rows[2].weekFlag, "YELLOW");
    assert.ok(!codes(rows[2].reasons).includes("FORM_MISSED_TWICE"));
  });

  test("zero applications for two consecutive weeks -> red", () => {
    // "Zero applications for 2+ weeks | Form submitted but 0 apps for 2 consecutive weeks."
    const zero = { APPLICATIONS: 0, NETWORKING: 7, LINKEDIN_POSTS: 7 };
    const row = lastRow([green("W01", { metrics: zero }), green("W02", { metrics: zero })]);
    assert.equal(row.flag, "RED");
    assert.ok(codes(row.reasons).includes("APPS_ZERO_TWO_WEEKS"));
  });

  test("zero networking for two consecutive weeks -> red", () => {
    // "Zero on either metric for 2+ consecutive weeks | despite reminders."
    const zeroNet = { APPLICATIONS: 10, NETWORKING: 0, LINKEDIN_POSTS: 7 };
    const row = lastRow([green("W01", { metrics: zeroNet }), green("W02", { metrics: zeroNet })]);
    assert.equal(row.flag, "RED");
    assert.ok(codes(row.reasons).includes("NETWORKING_ZERO_TWO_WEEKS"));
  });

  test("three silent weeks is a ghost on Guided", () => {
    // "Complete ghost - no contact for 3+ weeks" / "Ghost threshold: 3 weeks silent = Red."
    const row = lastRow([green("W01"), missed("W02"), missed("W03"), missed("W04")]);
    assert.equal(row.flag, "RED");
    assert.ok(codes(row.reasons).includes("GHOST"));
  });

  test("two silent weeks is already a ghost on Elite", () => {
    // "Ghost threshold | Guided: 3 weeks silent. Elite: 2 weeks silent = Red flag + Ameen
    // calls personally. Elite students paid Rs 1.5L+."
    const elite = weeklyThresholdsFor("ELITE");
    assert.equal(elite.ghostWeeks, 2);
    const row = lastRow([green("W01"), missed("W02"), missed("W03")], elite);
    assert.ok(codes(row.reasons).includes("GHOST"));
    assert.equal(row.flag, "RED");
  });
});

describe("escalation and recovery", () => {
  test("two yellow weeks running escalate to red", () => {
    // "Yellow -> Red: if Yellow flag behavior continues for 2 consecutive weeks, auto-escalate."
    const low = { APPLICATIONS: 6, NETWORKING: 7, LINKEDIN_POSTS: 7 };
    const rows = buildWeeklyFlagSeries([green("W01", { metrics: low }), green("W02", { metrics: low })]);
    assert.equal(rows[0].flag, "YELLOW");
    assert.equal(rows[1].flag, "RED");
    assert.ok(codes(rows[1].reasons).includes("YELLOW_ESCALATED"));
  });

  test("one clean week after a red is yellow, not green", () => {
    // "Recovery: Red -> Green: student must complete 2 consecutive Green weeks to return to
    // Green status. Yellow is the interim." One good week is progress, not absolution.
    const rows = buildWeeklyFlagSeries([
      green("W01"),
      missed("W02"),
      missed("W03"),
      green("W04"),
    ]);
    assert.equal(rows[2].flag, "RED");
    assert.equal(rows[3].flag, "YELLOW");
    assert.ok(codes(rows[3].reasons).includes("RECOVERING"));
  });

  test("two clean weeks after a red return the student to green", () => {
    const rows = buildWeeklyFlagSeries([
      green("W01"),
      missed("W02"),
      missed("W03"),
      green("W04"),
      green("W05"),
    ]);
    assert.equal(rows[4].flag, "GREEN");
  });

  test("a tutor override wins, and stops the history overturning it next week", () => {
    const low = { APPLICATIONS: 2, NETWORKING: 7, LINKEDIN_POSTS: 7 };
    const rows = buildWeeklyFlagSeries([
      green("W01", { metrics: low, override: "GREEN" }),
      green("W02"),
    ]);
    assert.equal(rows[0].flag, "GREEN");
    assert.equal(rows[0].weekFlag, "YELLOW", "the derived verdict is still visible underneath");
    assert.ok(rows[0].overridden);
    assert.equal(rows[1].flag, "GREEN");
  });
});

describe("null is not zero", () => {
  test("a template that never asked about LinkedIn raises no posts flag", () => {
    // A cohort whose form has no LinkedIn question has no LinkedIn figure. Reading that as
    // "posted nothing" would flag the student for the app's own omission.
    const row = lastRow([
      {
        isoWeek: "W01",
        weekStart: "2026-01-05",
        submitted: true,
        late: false,
        metrics: { APPLICATIONS: 10 },
      },
    ]);
    assert.equal(row.flag, "GREEN");
    assert.deepEqual(codes(row.reasons), ["ON_TRACK"]);
  });

  test("a metric never asked totals to null, not to 0", () => {
    const roll = summariseWeekly([
      {
        isoWeek: "W01",
        weekStart: "2026-01-05",
        submitted: true,
        late: false,
        metrics: { APPLICATIONS: 10 },
      },
    ]);
    assert.equal(roll.totals.APPLICATIONS, 10);
    assert.equal(roll.totals.LINKEDIN_POSTS, null);
  });

  test("a missed week's absent metrics are not read as a week of zeroes", () => {
    // Otherwise a single missed form would also fire "zero networking" and "zero posts",
    // and one absence would look like three separate failures.
    const row = lastRow([green("W01"), missed("W02")]);
    assert.deepEqual(codes(row.reasons), ["FORM_MISSED"]);
  });
});

describe("the Student Master rollup", () => {
  const weeks = [green("W01"), green("W02"), missed("W03"), green("W04"), green("W05")];

  test("streak counts submitted weeks back from the latest", () => {
    assert.equal(summariseWeekly(weeks).streak, 2);
  });

  test("weeks silent is zero while they are answering", () => {
    assert.equal(summariseWeekly(weeks).weeksSilent, 0);
  });

  test("weeks silent counts the current run of silence", () => {
    assert.equal(summariseWeekly([green("W01"), missed("W02"), missed("W03")]).weeksSilent, 2);
  });

  test("last form week is the Monday of the last week they answered", () => {
    assert.equal(summariseWeekly([green("W01"), missed("W02")]).lastFormWeekStart, "2026-01-01");
  });

  test("totals sum each metric across the weeks supplied", () => {
    const roll = summariseWeekly([
      green("W01", { metrics: { APPLICATIONS: 10, INTERVIEWS: 1 } }),
      green("W02", { metrics: { APPLICATIONS: 12, INTERVIEWS: 2 } }),
    ]);
    assert.equal(roll.totals.APPLICATIONS, 22);
    assert.equal(roll.totals.INTERVIEWS, 3);
  });

  test("red escalates to the founder; a Guided yellow does not", () => {
    // "Red -> Ameen: any Red flag student must be reported to Ameen within 24 hours."
    const red = summariseWeekly([green("W01"), missed("W02"), missed("W03")]);
    assert.equal(red.flag, "RED");
    assert.ok(red.escalateToAdmin);

    const yellow = summariseWeekly([green("W01"), missed("W02")]);
    assert.equal(yellow.flag, "YELLOW");
    assert.ok(!yellow.escalateToAdmin);
  });

  test("an Elite yellow does escalate", () => {
    // "Sprint form not submitted | Elite: 1 miss = Yellow + Ameen is CC'd."
    const cfg = weeklyThresholdsFor("ELITE");
    const roll = summariseWeekly([green("W01"), missed("W02")], cfg);
    assert.equal(roll.flag, "YELLOW");
    assert.ok(roll.escalateToAdmin);
  });

  test("a student with no weeks yet is green and not escalated", () => {
    // Someone seated yesterday has missed nothing. Starting them anywhere but green would
    // put every new joiner on the attention list on their first Monday.
    const roll = summariseWeekly([]);
    assert.equal(roll.flag, "GREEN");
    assert.equal(roll.streak, 0);
    assert.equal(roll.weeksSilent, 0);
    assert.equal(roll.lastFormWeekStart, null);
    assert.ok(!roll.escalateToAdmin);
  });
});

describe("thresholds", () => {
  test("an unknown level gets the defaults", () => {
    assert.deepEqual(weeklyThresholdsFor("GN_A1"), WEEKLY_THRESHOLD_DEFAULTS);
  });

  test("a null level gets the defaults", () => {
    assert.deepEqual(weeklyThresholdsFor(null), WEEKLY_THRESHOLD_DEFAULTS);
  });

  test("level matching ignores case and padding", () => {
    assert.equal(weeklyThresholdsFor(" elite ").ghostWeeks, 2);
  });

  test("a founder's base change flows into the level overlay", () => {
    const cfg = weeklyThresholdsFor("ELITE", { ...WEEKLY_THRESHOLD_DEFAULTS, appsTarget: 15 });
    assert.equal(cfg.appsTarget, 15, "the level overlay must not reset what the founder set");
    assert.equal(cfg.ghostWeeks, 2);
  });
});
