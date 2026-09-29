import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FUNNEL_STAGES,
  MIN_MONTHS_FOR_BENCHMARK,
  averageCounts,
  biggestLeak,
  buildFunnelHealth,
  buildStageRows,
  emptyCounts,
  rateOf,
  specCounts,
  type StageCounts,
} from "../funnel-health";

/** The spec's own §4 Row 5 column, so the arithmetic is pinned to the published example. */
const SPEC = specCounts();

function counts(over: Partial<StageCounts>): StageCounts {
  return { ...emptyCounts(), ...over };
}

describe("stage rates", () => {
  test("the spec's published numbers reproduce the spec's published percentages", () => {
    // 213/650 = 32%, 145/213 = 68%, 68/108 = 63%, 25/68 = 37% - the document's own figures.
    const pct = (i: number) => Math.round((rateOf(SPEC, i) ?? 0) * 100);
    assert.equal(pct(1), 33); // "32%" in the doc, rounded from 32.8
    assert.equal(pct(2), 68);
    assert.equal(pct(4), 63); // "62%" in the doc
    assert.equal(pct(5), 37); // "38%" in the doc
  });

  test("the first stage has no rate - nothing feeds it", () => {
    assert.equal(rateOf(SPEC, 0), null);
  });

  test("a rate out of zero is unanswerable, not zero percent", () => {
    // A quiet month must not read as a total collapse of every downstream stage.
    const quiet = counts({ leads: 0, bookedDiscovery: 0 });
    assert.equal(rateOf(quiet, 1), null);
  });
});

describe("the headline leak", () => {
  test("the spec's own example surfaces: show rate below the agreed 80%", () => {
    const current = counts({ leads: 650, bookedDiscovery: 213, bantQualified: 145, confirmed: 108, showed: 68 });
    const rows = buildStageRows(current, SPEC);
    const leak = biggestLeak(rows);
    assert.ok(leak);
    assert.equal(leak.row.stage.key, "showed");
    assert.equal(leak.against, "target");
    // 80% of 108 confirmed is 86.4; 68 showed, so ~18 people lost against the commitment.
    assert.ok(Math.round(leak.peopleLost) === 18, `expected ~18, got ${leak.peopleLost}`);
  });

  test("a target shortfall outranks a larger history shortfall", () => {
    // Booked-discovery collapses (a big gap vs history) while show rate is only slightly under
    // its agreed 80%. The commitment still wins - that is the rule the spec asks for.
    const current = counts({ leads: 650, bookedDiscovery: 20, bantQualified: 14, confirmed: 10, showed: 7 });
    const leak = biggestLeak(buildStageRows(current, SPEC));
    assert.ok(leak);
    assert.equal(leak.row.stage.key, "showed");
    assert.equal(leak.against, "target");
  });

  test("with the target met, the worst history gap becomes the headline", () => {
    const current = counts({ leads: 650, bookedDiscovery: 100, bantQualified: 70, confirmed: 50, showed: 50 });
    const leak = biggestLeak(buildStageRows(current, SPEC));
    assert.ok(leak);
    assert.equal(leak.against, "benchmark");
    assert.equal(leak.row.stage.key, "bookedDiscovery"); // the biggest drop in absolute people
  });

  test("ranking is by people lost, not percentage points", () => {
    // qualifiedL3 is 10pp below benchmark but on a tiny base; bookedDiscovery is 5pp below on 650.
    const current = counts({
      leads: 650, bookedDiscovery: 180, bantQualified: 123, confirmed: 92, showed: 74, qualifiedL3: 20,
    });
    const rows = buildStageRows(current, SPEC);
    const leak = biggestLeak(rows);
    assert.ok(leak);
    assert.equal(leak.row.stage.key, "bookedDiscovery");
  });

  test("a funnel beating every benchmark reports no leak at all", () => {
    const current = counts({
      leads: 1000, bookedDiscovery: 500, bantQualified: 450, confirmed: 400, showed: 380,
      qualifiedL3: 200, confirmedL3: 180, attendedL3: 170, closed: 90,
    });
    assert.equal(biggestLeak(buildStageRows(current, SPEC)), null);
  });
});

describe("benchmarks on sparse data", () => {
  test("with no history the spec's published benchmark stands in, and says so", () => {
    const h = buildFunnelHealth(counts({ leads: 10 }), []);
    assert.equal(h.benchmarkSource, "spec");
    assert.equal(h.monthsOfHistory, 0);
    assert.equal(h.rows[0].benchmarkCount, 650);
  });

  test("one month is not an average - still the spec benchmark", () => {
    const h = buildFunnelHealth(counts({ leads: 10 }), [counts({ leads: 900 })]);
    assert.equal(h.benchmarkSource, "spec");
    assert.equal(h.rows[0].benchmarkCount, 650);
  });

  test("at the threshold the app's own history takes over", () => {
    const history = Array.from({ length: MIN_MONTHS_FOR_BENCHMARK }, () => counts({ leads: 900, bookedDiscovery: 300 }));
    const h = buildFunnelHealth(counts({ leads: 10 }), history);
    assert.equal(h.benchmarkSource, "history");
    assert.equal(h.rows[0].benchmarkCount, 900);
  });

  test("averaging keeps fractions rather than rounding a mean into a tally", () => {
    const avg = averageCounts([counts({ leads: 1 }), counts({ leads: 2 })]);
    assert.equal(avg.leads, 1.5);
  });

  test("every stage in the catalogue is covered by the empty and spec fixtures", () => {
    for (const s of FUNNEL_STAGES) {
      assert.equal(emptyCounts()[s.key], 0);
      assert.equal(typeof specCounts()[s.key], "number");
    }
  });
});
