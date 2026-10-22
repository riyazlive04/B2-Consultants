import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  benchmarkAgainst,
  cohortAggregate,
  cohortConversionRatio,
  cohortPublishable,
  conversionRatio,
  HARD_MIN_COHORT,
  scoreStudent,
  DEFAULT_LEADERBOARD_CONFIG,
  type LeaderboardConfig,
  type MetricCounts,
  type ScoreBreakdown,
} from "../leaderboard";

/**
 * THE COHORT BENCHMARK and the conversion ratio.
 *
 * The cases worth reading are the FLOOR (the only thing between an "average" and publishing one
 * classmate's score on a cohort of two) and the empty denominator on the ratio, where returning
 * 0% would tell a student who has not started that their outreach is failing.
 */

const cfg = (over: Partial<LeaderboardConfig> = {}): LeaderboardConfig => ({
  ...DEFAULT_LEADERBOARD_CONFIG,
  ...over,
  metrics: { ...DEFAULT_LEADERBOARD_CONFIG.metrics, ...(over.metrics ?? {}) },
});

/** One student's breakdown, scored with the default rules, so the fixtures are real. */
const breakdown = (counts: MetricCounts, config = cfg(), weeks = 4): ScoreBreakdown =>
  scoreStudent(counts, config, weeks);

describe("the cohort floor", () => {
  test("a cohort smaller than the floor publishes nothing at all", () => {
    for (const size of [0, 1, 2, 4]) {
      const agg = cohortAggregate(
        Array.from({ length: size }, () => breakdown({ class_attended: 4 })),
        { minCohort: 5 },
      );
      assert.equal(agg.suppressed, true, `a cohort of ${size} must be suppressed against a floor of 5`);
      assert.equal(agg.lines.length, 0, "a suppressed aggregate must carry no per-metric lines");
      assert.equal(agg.total.mean, 0);
      // The size and the floor still travel, so the UI can say "needs 5" rather than refusing mutely.
      assert.equal(agg.size, size);
      assert.equal(agg.minCohort, 5);
    }
  });

  test("a cohort at the floor publishes", () => {
    const agg = cohortAggregate(
      Array.from({ length: 5 }, () => breakdown({ class_attended: 4 })),
      { minCohort: 5 },
    );
    assert.equal(agg.suppressed, false);
    assert.equal(agg.size, 5);
    assert.ok(agg.lines.length > 0);
  });

  test("the floor can never be set below THREE, whatever the config says", () => {
    /**
     * The reason it is three and not two.
     *
     * A student reading the board knows their own per-metric line exactly, so from the cohort
     * mean they can recover the sum of everybody else's: `mean × size − mine`. On a cohort of
     * two that sum IS their single classmate's breakdown. On a cohort of three it is a pair,
     * and a pair cannot be resolved into its members.
     *
     * So no configured value, and no hand-edited AppSetting row, may let a cohort of two
     * publish. This is the assertion that fails if someone "simplifies" the Math.max away.
     */
    assert.equal(HARD_MIN_COHORT, 3);
    for (const asked of [-5, 0, 1, 2]) {
      assert.equal(cohortPublishable(1, asked), false, `size 1 against a floor of ${asked}`);
      assert.equal(cohortPublishable(2, asked), false, `size 2 against a floor of ${asked}`);
    }
    assert.equal(cohortPublishable(3, 1), true, "three is publishable even when the config asks for less");

    const agg = cohortAggregate([breakdown({ win: 1 }), breakdown({ win: 2 })], { minCohort: 1 });
    assert.equal(agg.suppressed, true);
    assert.equal(agg.minCohort, 3, "the floor reports the value actually applied, not the one asked for");
  });

  test("a two-person cohort cannot publish its ratio either", () => {
    // Same arithmetic, same leak: pooled outreach minus your own is your one classmate's.
    assert.equal(
      cohortConversionRatio([{ application_submitted: 10 }, { application_submitted: 4 }], { minCohort: 2 }),
      null,
    );
  });

  test("the floor is the SAME decision for the averages and the pooled ratio", () => {
    // Two floors would mean one half of the card publishing what the other half hides.
    const counts = Array.from({ length: 4 }, () => ({ application_submitted: 10, hr_interview: 1 }));
    const agg = cohortAggregate(counts.map((c) => breakdown(c)), { minCohort: 5 });
    const ratio = cohortConversionRatio(counts, { minCohort: 5 });
    assert.equal(agg.suppressed, true);
    assert.equal(ratio, null);
  });
});

describe("the averages", () => {
  test("every student counts, including the ones on zero", () => {
    // Averaging only the students who did something would turn "half the cohort has not
    // started" into a benchmark saying the cohort is flying.
    const agg = cohortAggregate(
      [
        breakdown({ class_attended: 10 }),
        breakdown({ class_attended: 0 }),
        breakdown({ class_attended: 0 }),
        breakdown({ class_attended: 0 }),
        breakdown({ class_attended: 0 }),
      ],
      { minCohort: 5 },
    );
    const line = agg.lines.find((l) => l.key === "class_attended");
    assert.equal(line?.mean, 2, "10 over five students is 2, not 10");
    assert.equal(line?.median, 0, "four of five students have none, so the typical student has none");
  });

  test("the median is reported beside the mean, and an outlier separates them", () => {
    const agg = cohortAggregate(
      [
        breakdown({ application_selected: 1 }), // 200 points on default rules
        breakdown({}),
        breakdown({}),
        breakdown({}),
        breakdown({}),
      ],
      { minCohort: 5 },
    );
    assert.equal(agg.total.mean, 40);
    assert.equal(agg.total.median, 0, "one offer must not become the cohort's typical student");
  });

  test("an even-sized cohort takes the mean of the middle two", () => {
    const agg = cohortAggregate(
      [
        breakdown({ class_attended: 1 }),
        breakdown({ class_attended: 2 }),
        breakdown({ class_attended: 3 }),
        breakdown({ class_attended: 4 }),
        breakdown({ class_attended: 5 }),
        breakdown({ class_attended: 6 }),
      ],
      { minCohort: 5 },
    );
    const line = agg.lines.find((l) => l.key === "class_attended");
    assert.equal(line?.median, 3.5);
  });

  test("a metric the admin switched off gets no line", () => {
    // Otherwise it would appear as a cohort average of zero on a metric nobody is being scored
    // on - a number with no screen behind it.
    const config = cfg({
      metrics: {
        ...DEFAULT_LEADERBOARD_CONFIG.metrics,
        win: { enabled: false, points: 5, weeklyCap: 5 },
      },
    });
    const agg = cohortAggregate(
      Array.from({ length: 5 }, () => breakdown({ win: 3 }, config)),
      { minCohort: 5 },
    );
    assert.equal(agg.lines.some((l) => l.key === "win"), false);
  });

  test("the average is over the CAPPED figure the board actually scored", () => {
    // A student who hit the weekly cap must not read as behind an average that includes the
    // points the cap refused them.
    const config = cfg({
      metrics: {
        ...DEFAULT_LEADERBOARD_CONFIG.metrics,
        hr_connection: { enabled: true, points: 10, weeklyCap: 5 },
      },
    });
    // 1 elapsed week, so the ceiling is 5. Each student logged 100.
    const agg = cohortAggregate(
      Array.from({ length: 5 }, () => breakdown({ hr_connection: 100 }, config, 1)),
      { minCohort: 5 },
    );
    const line = agg.lines.find((l) => l.key === "hr_connection");
    assert.equal(line?.mean, 5, "the cohort average is the 5 that scored, not the 100 that were typed");
  });
});

describe("one student against the cohort", () => {
  test("delta is the student minus the mean, positive meaning ahead", () => {
    const peers = Array.from({ length: 5 }, () => breakdown({ class_attended: 2 }));
    const agg = cohortAggregate(peers, { minCohort: 5 });
    const mine = breakdown({ class_attended: 5 });
    const b = benchmarkAgainst(mine, agg);
    assert.ok(b);
    const line = b.lines.find((l) => l.key === "class_attended");
    assert.equal(line?.mine, 5);
    assert.equal(line?.mean, 2);
    assert.equal(line?.delta, 3);
    assert.equal(b.total.delta, 30, "three extra classes at 10 points each");
  });

  test("a suppressed aggregate yields no comparison rather than a comparison against zero", () => {
    const agg = cohortAggregate([breakdown({ class_attended: 1 })], { minCohort: 5 });
    assert.equal(benchmarkAgainst(breakdown({ class_attended: 9 }), agg), null);
  });

  test("a metric the student has none of still compares, at zero", () => {
    const agg = cohortAggregate(
      Array.from({ length: 5 }, () => breakdown({ application_submitted: 10 })),
      { minCohort: 5 },
    );
    const b = benchmarkAgainst(breakdown({}), agg);
    const line = b?.lines.find((l) => l.key === "application_submitted");
    assert.equal(line?.mine, 0);
    assert.equal(line?.delta, -10, "behind by the whole average, not absent from the list");
  });
});

describe("the conversion ratio", () => {
  test("applications and connections are the denominator, interviews the numerator", () => {
    const r = conversionRatio({ application_submitted: 30, hr_connection: 20, hr_interview: 5 });
    assert.equal(r.outreach, 50);
    assert.equal(r.interviews, 5);
    assert.equal(r.per100, 10);
    assert.equal(r.effortPerInterview, 10);
  });

  test("no outreach is NULL, never 0%", () => {
    // 0% says "you reached out and nothing came back". A student who has not started must not
    // be told that about themselves.
    const r = conversionRatio({});
    assert.equal(r.per100, null);
    assert.equal(r.effortPerInterview, null);
    assert.equal(r.outreach, 0);
  });

  test("outreach with no interviews yet is a real 0%, with no effort figure", () => {
    const r = conversionRatio({ application_submitted: 40 });
    assert.equal(r.per100, 0, "40 applications and no interview is a fact worth stating");
    assert.equal(r.effortPerInterview, null, "there is no 'one interview per N' when N produced none");
  });

  test("a reviewed application is not outreach", () => {
    // Being read is something a company did, not something the student did; counting it would
    // penalise the student whose applications got read.
    const a = conversionRatio({ application_submitted: 10, hr_interview: 1 });
    const b = conversionRatio({ application_submitted: 10, application_reviewed: 50, hr_interview: 1 });
    assert.deepEqual(a, b);
  });

  test("the cohort ratio is POOLED, not an average of each student's percentage", () => {
    // One student at 1-from-4 (25%) and one at 1-from-196 should not produce 12.5%: the pooled
    // answer to "what does an interview take on this cohort" is 2 from 200.
    const ratio = cohortConversionRatio(
      [
        { application_submitted: 4, hr_interview: 1 },
        { application_submitted: 196, hr_interview: 1 },
        {},
        {},
        {},
      ],
      { minCohort: 5 },
    );
    assert.equal(ratio?.outreach, 200);
    assert.equal(ratio?.interviews, 2);
    assert.equal(ratio?.per100, 1);
    assert.equal(ratio?.effortPerInterview, 100);
  });

  test("a cohort that has logged no outreach at all pools to null, not 0%", () => {
    const ratio = cohortConversionRatio([{}, {}, {}, {}, {}], { minCohort: 5 });
    assert.equal(ratio?.per100, null);
  });

  test("negative or fractional counts cannot bend the ratio", () => {
    // Counts arrive from `_sum.quantity` on a self-reported table, so the guard is not theoretical.
    const r = conversionRatio({ application_submitted: -5, hr_connection: 10.4, hr_interview: 1 });
    assert.equal(r.outreach, 10, "the negative is floored at zero and the fraction rounded");
    assert.equal(r.per100, 10);
  });
});
