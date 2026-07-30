/**
 * Milestones (Track I) + attribution (Track F) — the pure rules.
 *
 * Both modules exist to feed a RADAR the founders are meant to act on, so the cases that
 * matter most are the ones that would make a radar lie:
 *   · a Solo/LIFETIME student showing permanently overdue (there is no deadline to miss);
 *   · a milestone hit late showing red forever;
 *   · a campaign with no spend showing a ₹0 cost per lead and sorting to the top of
 *     "cheapest acquisition".
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  programDays,
  defaultMilestoneLadder,
  programDayNumber,
  milestoneHealth,
  overdueCount,
  ladderCompletionPct,
} from "../milestones";
import { economicsFor, bandByMedian, medianOf, type SourceTotals } from "../attribution";

describe("milestones — the ladder", () => {
  test("programme lengths follow the tracker", () => {
    assert.equal(programDays("DAYS_90"), 90);
    assert.equal(programDays("DAYS_120"), 120);
    assert.equal(programDays("LIFETIME"), null);
  });

  test("the SAME ladder scales to 90 and 120 days — no second hand-maintained list", () => {
    const guided = defaultMilestoneLadder(90);
    const elite = defaultMilestoneLadder(120);
    assert.equal(guided.length, elite.length);
    assert.deepEqual(guided.map((m) => m.key), elite.map((m) => m.key));
    assert.equal(guided.at(-1)!.targetDay, 90);
    assert.equal(elite.at(-1)!.targetDay, 120);
  });

  test("no milestone lands on day 0 — the founders count enrolment day as day one", () => {
    for (const m of defaultMilestoneLadder(90)) assert.ok(m.targetDay >= 1, `${m.key}`);
  });

  test("LIFETIME gets NO ladder, so Solo students are never permanently overdue", () => {
    // A milestone with no deadline isn't a milestone. Seeding day-0 rows here would put every
    // Solo student on the at-risk radar forever — the false alarm that gets a radar ignored.
    assert.deepEqual(defaultMilestoneLadder(null), []);
    assert.deepEqual(defaultMilestoneLadder(0), []);
  });
});

describe("milestones — health", () => {
  test("achieved is done even when it was hit late", () => {
    // Consulted BEFORE the deadline: a milestone hit late is still hit.
    assert.equal(milestoneHealth("ACHIEVED", 10, 99), "done");
  });

  test("past the target day and not achieved is overdue", () => {
    assert.equal(milestoneHealth("NOT_STARTED", 10, 11), "overdue");
    assert.equal(milestoneHealth("IN_PROGRESS", 10, 11), "overdue");
  });

  test("exactly on the target day is due, not yet overdue", () => {
    assert.equal(milestoneHealth("NOT_STARTED", 10, 10), "due");
  });

  test("before the programme starts nothing can be late", () => {
    assert.equal(milestoneHealth("NOT_STARTED", 10, null), "on_track");
  });

  test("overdueCount is a count, not a boolean — one slip in seven is normal", () => {
    const items = [
      { status: "ACHIEVED" as const, targetDay: 5 },
      { status: "NOT_STARTED" as const, targetDay: 10 },
      { status: "NOT_STARTED" as const, targetDay: 20 },
    ];
    assert.equal(overdueCount(items, 15), 1);
    assert.equal(overdueCount(items, 3), 0);
  });

  test("completion percentage handles an empty ladder without NaN", () => {
    assert.equal(ladderCompletionPct([]), 0);
    assert.equal(ladderCompletionPct([{ status: "ACHIEVED" }, { status: "NOT_STARTED" }]), 50);
  });

  test("day numbering is 1-based and ignores time of day", () => {
    const start = new Date("2026-03-01T00:00:00Z");
    assert.equal(programDayNumber(start, new Date("2026-03-01T23:00:00Z")), 1);
    assert.equal(programDayNumber(start, new Date("2026-03-11T02:00:00Z")), 11);
    assert.equal(programDayNumber(start, new Date("2026-02-28T00:00:00Z")), null);
  });
});

const src = (over: Partial<SourceTotals> & { sourceId: string }): SourceTotals => ({
  channel: "META_ADS",
  campaign: "c",
  spendInrMinor: 0n,
  leads: 0,
  bookings: 0,
  enrolments: 0,
  revenueInrMinor: 0n,
  ...over,
});

describe("attribution — economics", () => {
  test("computes CPL, CAC, ROAS and conversion", () => {
    // ₹10,000 spend = 1,000,000 paise · 100 leads · 5 enrolments · ₹50,000 revenue.
    const e = economicsFor(
      src({ sourceId: "a", spendInrMinor: 10_000_00n, leads: 100, enrolments: 5, revenueInrMinor: 50_000_00n }),
    );
    assert.equal(e.cplInrMinor, 10_000); // ₹100 per lead, in paise
    assert.equal(e.cacInrMinor, 200_000); // ₹2,000 per enrolment, in paise
    assert.equal(e.roas, 5);
    assert.equal(e.conversionPct, 5);
  });

  test("NO SPEND yields null ratios, never zero", () => {
    // A ₹0 cost-per-lead would sort an unpaid campaign to the top of "cheapest acquisition"
    // and move the budget onto it. Null renders as "—".
    const e = economicsFor(src({ sourceId: "b", leads: 40, enrolments: 2 }));
    assert.equal(e.cplInrMinor, null);
    assert.equal(e.cacInrMinor, null);
    assert.equal(e.roas, null);
    assert.equal(e.conversionPct, 5); // conversion needs no spend, so it is still real
  });

  test("spend but no enrolments yet gives a null CAC, not Infinity", () => {
    const e = economicsFor(src({ sourceId: "c", spendInrMinor: 5_000_00n, leads: 10 }));
    assert.equal(e.cacInrMinor, null);
    assert.equal(e.roas, 0);
  });
});

describe("attribution — banding against the period's own median", () => {
  const rows = [
    economicsFor(src({ sourceId: "hi", spendInrMinor: 100n, revenueInrMinor: 900n })), // roas 9
    economicsFor(src({ sourceId: "mid", spendInrMinor: 100n, revenueInrMinor: 500n })), // roas 5
    economicsFor(src({ sourceId: "lo", spendInrMinor: 100n, revenueInrMinor: 100n })), // roas 1
  ];

  test("bands high / mid / low relative to the running set, not a magic constant", () => {
    const b = bandByMedian(rows);
    assert.equal(b.get("hi"), "high");
    assert.equal(b.get("mid"), "mid");
    assert.equal(b.get("lo"), "low");
  });

  test("a source with no spend is UNRATED, not low", () => {
    // Calling it low would bury an organic channel that costs nothing and converts fine.
    const withOrganic = [...rows, economicsFor(src({ sourceId: "organic", leads: 50, enrolments: 4 }))];
    assert.equal(bandByMedian(withOrganic).get("organic"), "unrated");
  });

  test("a single campaign is 'mid' — there is no comparison to report", () => {
    const one = [economicsFor(src({ sourceId: "solo", spendInrMinor: 100n, revenueInrMinor: 400n }))];
    assert.equal(bandByMedian(one).get("solo"), "mid");
  });

  test("no rated rows at all returns everything unrated rather than throwing", () => {
    const none = [economicsFor(src({ sourceId: "x", leads: 3 }))];
    assert.equal(bandByMedian(none).get("x"), "unrated");
  });

  test("median takes the middle pair on even lengths", () => {
    assert.equal(medianOf([1, 2, 3]), 2);
    assert.equal(medianOf([1, 2, 3, 4]), 2.5);
    assert.equal(medianOf([]), 0);
  });
});
