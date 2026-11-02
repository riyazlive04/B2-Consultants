import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_STUDENT_LIFECYCLE_CONFIG,
  coerceStudentLifecycleConfig,
} from "../config-schema";
import { GN_LEVEL_COST, gnLevelCostsFrom, standardBooksCost, standardTutorCost } from "../gn-workshop-pricing";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  A RULE THAT IS CONFIGURABLE MUST STAY CONFIGURABLE  (30 Oct 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Three sets of business rules stopped being literals on 30 Oct 2026, because the App Guide was
 * telling founders they could not be changed - and in one case the guide was simply wrong:
 *
 *   the Early-warning radar   "14 days, day 10, half-way, 21 days ... fixed in the app and
 *                              cannot be changed in the Console"
 *   onboarding's Stuck tab    "The limit is 10 days and is fixed in the app"
 *   GN delivery costs         "The standard book and tutor costs are fixed in the app" - while
 *                             the programme catalogue already held the very same three figures,
 *                             founder-editable, in `Level.booksCostInrMinor` / `tutorCostInrMinor`
 *
 * The failure this guards against is not someone deleting the settings. It is the quiet one: a
 * later edit re-introducing the literal at the point of use, so the Console panel still shows a
 * number, still saves it, and nothing reads it. Everything would look configured and behave as
 * it did before, which is the worst of both - and no behavioural test would catch it, because
 * the shipped defaults equal the old literals on purpose.
 *
 * So these read the SOURCE at the point of use. A static check is the direct way to ask "does
 * this line still consult the setting", and the repo already takes this approach where the
 * mistake lives in a declaration rather than a value (`cron-stale-thresholds.test.ts`).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

const RADAR = "src/server/students-metrics.ts";
const ONBOARDING = "src/server/onboarding-metrics.ts";
const WORKSHOPS = "src/server/german-note-workshops.ts";

describe("the early-warning radar reads its thresholds from the founder config", () => {
  test("the module is still the one that draws the radar, so this guard is pointed at something", () => {
    const src = read(RADAR);
    assert.match(src, /atRiskRadar/, `${RADAR} no longer builds atRiskRadar - re-point this test`);
    assert.match(
      src,
      /getStudentLifecycleConfig/,
      `${RADAR} no longer reads the lifecycle config at all`,
    );
  });

  /**
   * Named one by one rather than "no digits anywhere": the file is full of legitimate numbers
   * (milestone indices, a 2-day grace, slice counts), and a blanket ban would be noise that the
   * next person silences rather than a rule they keep.
   */
  for (const field of [
    "radarSilentDays",
    "radarNoSessionByDay",
    "radarPaceElapsedPct",
    "radarEndgameDays",
  ] as const) {
    test(`${field} is consulted where the flag is raised`, () => {
      assert.match(
        read(RADAR),
        new RegExp(`lifecycle\\.${field}\\b`),
        `${field} is a Console setting with nothing reading it - the panel would save a number ` +
          `that changes nothing, which looks exactly like a working setting`,
      );
    });
  }

  test("the old literals are gone from the comparisons they used to sit in", () => {
    const src = read(RADAR);
    assert.doesNotMatch(
      src,
      /daysSinceLastSession > 14\b/,
      "the 14-day silence check is a literal again",
    );
    assert.doesNotMatch(src, /dayNumber > 10\b/, "the day-10 no-session check is a literal again");
    assert.doesNotMatch(src, /pctComplete > 50\b/, "the half-way pace check is a literal again");
    assert.doesNotMatch(src, /daysLeft <= 21\b/, "the 21-day run-in check is a literal again");
  });

  test("the shipped defaults still match what the App Guide quotes", () => {
    // The guide names these four numbers to the reader. If a default moves, the guide is wrong
    // the same day - and a guide that misstates a default is worse than one that omits it.
    const d = DEFAULT_STUDENT_LIFECYCLE_CONFIG;
    assert.equal(d.radarSilentDays, 14);
    assert.equal(d.radarNoSessionByDay, 10);
    assert.equal(d.radarPaceElapsedPct, 50);
    assert.equal(d.radarEndgameDays, 21);
    assert.equal(d.stuckAfterDays, 10);
  });

  test("a stored config written before these fields existed still parses", () => {
    // Every tenant with a saved `studentLifecycle` blob predates them. If the schema demanded
    // them, the whole config would fail to parse and fall back to defaults - silently losing the
    // discontinue reasons somebody curated.
    const old = { discontinueReasons: ["Visa refused"], allowOtherReason: false, coachMayDiscontinue: false };
    const parsed = coerceStudentLifecycleConfig(old);
    assert.deepEqual(parsed.discontinueReasons, ["Visa refused"], "an old blob lost its reasons");
    assert.equal(parsed.allowOtherReason, false, "an old blob lost a toggle");
    assert.equal(parsed.radarSilentDays, 14, "a missing threshold did not fall back to its default");
  });
});

describe("onboarding's stuck limit reads the same config", () => {
  test("it consults the setting rather than its fallback constant", () => {
    const src = read(ONBOARDING);
    assert.match(src, /getStudentLifecycleConfig/, "the stuck limit no longer reads the config");
    assert.match(
      src,
      /r\.daysSinceActivity >= stuckAfterDays/,
      "the stuck comparison is not using the resolved value",
    );
  });

  test("the fallback remains, so a tenant with no saved config is not told everyone is stuck", () => {
    // A missing config must not resolve to 0 days, which would put every in-flight person on the
    // tab at once and make it useless on exactly the tenants that never configured anything.
    assert.match(read(ONBOARDING), /STUCK_AFTER_DAYS_DEFAULT = 10/);
  });
});

describe("German Note delivery costs come from the programme catalogue", () => {
  test("the workshop P&L reads the catalogue rather than the constant table", () => {
    const src = read(WORKSHOPS);
    assert.match(src, /gnLevelCostsFrom/, "the workshop rows no longer build costs from the catalogue");
    assert.match(
      src,
      /standardBooksCost\(c\.product, costs\)/,
      "books cost fell back to the module default instead of the catalogue",
    );
    assert.match(
      src,
      /standardTutorCost\(c\.product, costs\)/,
      "tutor cost fell back to the module default instead of the catalogue",
    );
  });

  test("a catalogue cost overrides the shipped figure", () => {
    const costs = gnLevelCostsFrom(
      new Map([["GN_B1", { books: 999_00, tutor: 15_000_00 }]]),
    );
    assert.equal(standardTutorCost("B1", costs), 15_000_00, "the catalogue's tutor cost was ignored");
    assert.equal(standardBooksCost("B1", costs), 999_00, "the catalogue's books cost was ignored");
  });

  test("a blank catalogue cost falls back FIELD BY FIELD, never to zero", () => {
    // Half-filled is the realistic state of a catalogue, and taking the whole fallback row for it
    // would discard the one number the founder did set. Zero would read as pure profit.
    const costs = gnLevelCostsFrom(new Map([["GN_A1", { books: null, tutor: 9_000_00 }]]));
    assert.equal(costs.A1.tutor, 9_000_00, "the set field was discarded");
    assert.equal(costs.A1.books, GN_LEVEL_COST.A1.books, "the blank field did not fall back");
    assert.equal(costs.A2.books, GN_LEVEL_COST.A2.books, "an absent level did not fall back");
    assert.notEqual(costs.A2.tutor, 0, "an absent level costed zero, which reads as pure profit");
  });

  test("a bundle still adds up every level it enrols", () => {
    const costs = gnLevelCostsFrom(new Map());
    assert.equal(
      standardTutorCost("A1_A2_B1", costs),
      GN_LEVEL_COST.A1.tutor + GN_LEVEL_COST.A2.tutor + GN_LEVEL_COST.B1.tutor,
    );
  });
});
