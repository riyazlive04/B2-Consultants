import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  scoreStudent,
  rankRows,
  ordinal,
  anonLabel,
  weeksElapsed,
  DEFAULT_LEADERBOARD_CONFIG,
  LEADERBOARD_METRICS,
  METRIC_BY_KEY,
  type LeaderboardConfig,
} from "../leaderboard";

/**
 * The leaderboard's arithmetic.
 *
 * The cases worth reading are the weekly cap (the only thing standing between a self-reported
 * quantity box and the top of a board that names people) and the tie handling (because two
 * students on the same score can both see the board).
 */

const cfg = (over: Partial<LeaderboardConfig> = {}): LeaderboardConfig => ({
  ...DEFAULT_LEADERBOARD_CONFIG,
  ...over,
  metrics: { ...DEFAULT_LEADERBOARD_CONFIG.metrics, ...(over.metrics ?? {}) },
});

describe("the catalogue", () => {
  test("every metric is reachable by key", () => {
    for (const m of LEADERBOARD_METRICS) assert.equal(METRIC_BY_KEY[m.key].label, m.label);
  });

  test("only the self-reported metrics carry a weekly cap by default", () => {
    // The point of the cap is that quantity is typed in by the person being ranked. You cannot
    // attend a class twice, so capping a derived metric would only ever lose someone real points.
    for (const m of LEADERBOARD_METRICS) {
      if (m.source === "derived") {
        assert.equal(m.defaultWeeklyCap, null, `${m.key} is derived and should not be capped`);
      } else {
        assert.ok(m.defaultWeeklyCap !== null, `${m.key} is self-reported and needs a cap`);
      }
    }
  });
});

describe("scoreStudent", () => {
  test("multiplies counts by the admin's points", () => {
    const s = scoreStudent({ class_attended: 6, task_completed: 3 }, cfg(), 1);
    // 6 × 10 + 3 × 10
    assert.equal(s.total, 90);
    assert.equal(s.capped, false);
  });

  test("a disabled metric scores nothing and is left off the breakdown", () => {
    const s = scoreStudent(
      { class_attended: 6 },
      cfg({ metrics: { ...DEFAULT_LEADERBOARD_CONFIG.metrics, class_attended: { enabled: false, points: 10, weeklyCap: null } } }),
      1,
    );
    assert.equal(s.total, 0);
    assert.equal(s.lines.find((l) => l.key === "class_attended"), undefined);
  });

  test("changing the points changes the board - the admin owns the arithmetic", () => {
    const s = scoreStudent(
      { class_attended: 6 },
      cfg({ metrics: { ...DEFAULT_LEADERBOARD_CONFIG.metrics, class_attended: { enabled: true, points: 1, weeklyCap: null } } }),
      1,
    );
    assert.equal(s.total, 6);
  });

  test("THE CAP: a weekly ceiling scales with elapsed weeks, not the whole sprint", () => {
    // hr_connection defaults to 10 points, capped at 25/week. In week one, 300 logged
    // connections must score 25 - otherwise the quantity box is wired straight to first place.
    const week1 = scoreStudent({ hr_connection: 300 }, cfg(), 1);
    assert.equal(week1.lines.find((l) => l.key === "hr_connection")!.counted, 25);
    assert.equal(week1.lines.find((l) => l.key === "hr_connection")!.count, 300);
    assert.equal(week1.capped, true);

    // By week four the same student may legitimately have 100.
    const week4 = scoreStudent({ hr_connection: 300 }, cfg(), 4);
    assert.equal(week4.lines.find((l) => l.key === "hr_connection")!.counted, 100);
  });

  test("a count under the cap is untouched and does not flag as capped", () => {
    const s = scoreStudent({ hr_connection: 10 }, cfg(), 1);
    assert.equal(s.lines.find((l) => l.key === "hr_connection")!.counted, 10);
    assert.equal(s.capped, false);
  });

  test("weeks below 1 are treated as 1, so a same-day sprint still caps", () => {
    const s = scoreStudent({ hr_connection: 300 }, cfg(), 0);
    assert.equal(s.lines.find((l) => l.key === "hr_connection")!.counted, 25);
  });

  test("missing, negative and fractional counts are all read as sane", () => {
    const s = scoreStudent({ class_attended: -5, task_completed: 2.6 }, cfg(), 1);
    assert.equal(s.lines.find((l) => l.key === "class_attended")!.count, 0);
    assert.equal(s.lines.find((l) => l.key === "task_completed")!.count, 3);
  });

  test("an uncapped metric is never limited however long the period", () => {
    const s = scoreStudent({ application_submitted: 500 }, cfg(), 1);
    assert.equal(s.lines.find((l) => l.key === "application_submitted")!.counted, 500);
  });
});

describe("rankRows", () => {
  test("orders by total, highest first", () => {
    const ranked = rankRows([
      { name: "Priya", total: 388 },
      { name: "Arjun", total: 412 },
      { name: "Sneha", total: 350 },
    ]);
    assert.deepEqual(ranked.map((r) => r.name), ["Arjun", "Priya", "Sneha"]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
  });

  test("EQUAL TOTALS SHARE A RANK, and the next place skips", () => {
    // Standard competition ranking: 1, 2, 2, 4. Breaking a real tie on something arbitrary
    // invents a difference the students can see is not real - on a board that names them.
    const ranked = rankRows([
      { name: "Arjun", total: 400 },
      { name: "Priya", total: 300 },
      { name: "Sneha", total: 300 },
      { name: "Rahul", total: 100 },
    ]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 2, 4]);
  });

  test("ties are ordered by name, so the board does not shuffle between reads", () => {
    const a = rankRows([{ name: "Zara", total: 10 }, { name: "Asha", total: 10 }]);
    const b = rankRows([{ name: "Asha", total: 10 }, { name: "Zara", total: 10 }]);
    assert.deepEqual(a.map((r) => r.name), b.map((r) => r.name));
    assert.deepEqual(a.map((r) => r.rank), [1, 1]);
  });

  test("everyone on zero is joint first rather than ordered arbitrarily", () => {
    // A cohort whose sprint has not started yet. Ranking them 1..6 would tell five students
    // they are behind on the strength of nothing at all.
    const ranked = rankRows([
      { name: "A", total: 0 },
      { name: "B", total: 0 },
      { name: "C", total: 0 },
    ]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 1]);
  });

  test("an empty cohort is an empty board, not a crash", () => {
    assert.deepEqual(rankRows([]), []);
  });
});

describe("ordinal", () => {
  test("handles the teens, which is where naive suffixes break", () => {
    assert.equal(ordinal(1), "1st");
    assert.equal(ordinal(2), "2nd");
    assert.equal(ordinal(3), "3rd");
    assert.equal(ordinal(4), "4th");
    assert.equal(ordinal(11), "11th");
    assert.equal(ordinal(12), "12th");
    assert.equal(ordinal(13), "13th");
    assert.equal(ordinal(21), "21st");
    assert.equal(ordinal(111), "111th");
  });
});

describe("anonLabel", () => {
  test("is POSITIONAL, so a pseudonym is not stable across weeks", () => {
    // A label derived from the person would be stable, and a stable pseudonym on a six-person
    // cohort stops being anonymous by about week three.
    assert.equal(anonLabel(0), "Student A");
    assert.equal(anonLabel(2), "Student C");
    assert.equal(anonLabel(25), "Student Z");
    assert.equal(anonLabel(26), "Student 1A");
  });
});

describe("weeksElapsed", () => {
  test("counts part weeks as whole ones, and never returns zero", () => {
    assert.equal(weeksElapsed("2026-10-01", "2026-10-01"), 1);
    assert.equal(weeksElapsed("2026-10-01", "2026-10-03"), 1);
    assert.equal(weeksElapsed("2026-10-01", "2026-10-08"), 1);
    assert.equal(weeksElapsed("2026-10-01", "2026-10-09"), 2);
    // A sprint start in the future (a cohort still in its taught weeks) is still week one.
    assert.equal(weeksElapsed("2026-12-01", "2026-10-01"), 1);
  });
});
