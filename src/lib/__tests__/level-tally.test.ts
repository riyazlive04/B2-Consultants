import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GERMAN_NOTE_BUCKET,
  NO_LEVEL_LABEL,
  levelBreakdownRows,
  levelTallyRows,
  levelTallyTotal,
  tally,
  type LevelTally,
} from "../level-tally";
import { B2_LEVEL_KINDS, type LevelSummary } from "../levels";

/**
 * A BY-LEVEL BREAKDOWN SUMS TO THE CARD ABOVE IT.
 *
 * Levels stopped being the `ProgramLevel` enum and became founder-editable rows in `Level`. The
 * enrolment forms and their validation followed; eleven METRIC sites did not, and each one failed
 * differently once a fourth tier existed:
 *
 *   - Pipeline's wins headline was `conv.SOLO + conv.GUIDED + conv.ELITE` over a tally that had a
 *     fourth bucket, so a deal won at a new tier was not counted at all.
 *   - Students' popups listed three rows beneath a card that counted every active enrolment.
 *   - The at-risk list printed `level === "GUIDED" ? "Guided" : "Elite"`, labelling a C1 student
 *     "Elite" on the one screen where a coach reads a name and a tier together.
 *
 * The first half of this file tests the rule. The second half is a SOURCE SCAN, because the
 * remaining defects of this family do not live in a value - they live in a `where` clause and in
 * a ternary, and the only way to ask "has anyone re-derived the three tiers again?" is to read
 * the files as text.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

function level(code: string, label: string, order: number, over: Partial<LevelSummary> = {}): LevelSummary {
  return {
    code,
    label,
    kind: "COACHING_TIER",
    order,
    active: true,
    locked: false,
    incomeAccountCode: "4000",
    booksCostInrMinor: null,
    tutorCostInrMinor: null,
    bundleMembers: [],
    ...over,
  };
}

/** Three seeded tiers, one the founders added, and one German level from the other half. */
const CATALOGUE: LevelSummary[] = [
  level("SOLO", "Solo", 1),
  level("GUIDED", "Guided", 2),
  level("ELITE", "Elite", 3),
  level("C1_INTENSIVE", "C1 Intensive", 4),
  level("GN_A1", "A1", 1, { kind: "GERMAN_LEVEL" }),
];

describe("a by-level breakdown always sums to its card", () => {
  test("every active tier gets a row, even at zero", () => {
    const t: LevelTally = { GUIDED: 2 };
    const rows = levelTallyRows(t, CATALOGUE, B2_LEVEL_KINDS);
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Solo", "Guided", "Elite", "C1 Intensive"],
      "a tier at zero is a fact about the catalogue, not a row to hide",
    );
    assert.equal(rows.find((r) => r.label === "Solo")!.value, 0);
  });

  test("a tier the founders added is NAMED, not swept into Other", () => {
    const t: LevelTally = { SOLO: 1, GUIDED: 1, C1_INTENSIVE: 3 };
    const rows = levelTallyRows(t, CATALOGUE, B2_LEVEL_KINDS);
    const c1 = rows.find((r) => r.key === "C1_INTENSIVE");
    assert.ok(c1, "the new tier must appear");
    assert.equal(c1.label, "C1 Intensive");
    assert.equal(c1.value, 3);
    assert.equal(
      rows.reduce((s, r) => s + r.value, 0),
      levelTallyTotal(t),
      "THE INVARIANT: the rows sum to the tally the card is counting",
    );
  });

  test("a code from outside this screen's kinds still shows when it carries data", () => {
    // A lead can be won at a German level; the B2 pipeline card must not silently drop it.
    const t: LevelTally = { GUIDED: 1, GN_A1: 2 };
    const rows = levelTallyRows(t, CATALOGUE, B2_LEVEL_KINDS);
    assert.equal(rows.find((r) => r.key === "GN_A1")?.label, "A1");
    assert.equal(rows.reduce((s, r) => s + r.value, 0), 3);
  });

  test("a retired tier is named from the catalogue, not printed as a raw code", () => {
    const retired = [...CATALOGUE, level("LEGACY_PRO", "Legacy Pro", 9, { active: false })];
    const rows = levelTallyRows({ LEGACY_PRO: 4 }, retired, B2_LEVEL_KINDS);
    assert.equal(rows.find((r) => r.key === "LEGACY_PRO")?.label, "Legacy Pro");
  });

  test("a code the catalogue has never heard of reads as itself rather than vanishing", () => {
    const rows = levelTallyRows({ ANCIENT_ENUM: 1 }, CATALOGUE, B2_LEVEL_KINDS);
    assert.equal(rows.find((r) => r.key === "ANCIENT_ENUM")?.label, "ANCIENT_ENUM");
    assert.equal(rows.reduce((s, r) => s + r.value, 0), 1);
  });

  test("no level recorded is a row, because a won deal can genuinely have none", () => {
    const t: LevelTally = {};
    tally(t, "GUIDED");
    tally(t, null);
    tally(t, "   ");
    assert.equal(t[""], 2, "null and blank are the same bucket");
    const rows = levelTallyRows(t, CATALOGUE, B2_LEVEL_KINDS);
    assert.equal(rows.find((r) => r.key === "")?.label, NO_LEVEL_LABEL);
    assert.equal(rows.reduce((s, r) => s + r.value, 0), levelTallyTotal(t));
  });

  test("zero-value extras stay out, so the tail is not a list of codes nobody uses", () => {
    const rows = levelTallyRows({ GUIDED: 1, ANCIENT_ENUM: 0 }, CATALOGUE, B2_LEVEL_KINDS);
    assert.equal(rows.some((r) => r.key === "ANCIENT_ENUM"), false);
  });

  test("rows follow catalogue order, not the order the data arrived in", () => {
    const rows = levelBreakdownRows(["ELITE", "SOLO"], CATALOGUE, B2_LEVEL_KINDS);
    assert.deepEqual(rows.map((r) => r.key), ["SOLO", "GUIDED", "ELITE", "C1_INTENSIVE"]);
  });

  test("the German Note rollup key cannot collide with a level code", () => {
    // Finance rolls every German level into one bar. That bucket must not be mistakable for a
    // `Level.code`, which `normalizeLevelCode` can never produce with leading underscores.
    assert.match(GERMAN_NOTE_BUCKET, /^__/);
    assert.equal(CATALOGUE.some((l) => l.code === GERMAN_NOTE_BUCKET), false);
  });
});

describe("no screen re-derives the three seeded tiers", () => {
  test("the 90/120 tracker selects by DURATION, not by a list of level names", () => {
    const src = read("src/server/students-metrics.ts");
    assert.match(
      src,
      /where:\s*\{\s*status:\s*"ACTIVE",\s*duration:\s*\{\s*not:\s*"LIFETIME"\s*\}\s*\}/,
      "the tracker pass must admit any enrolment with an end date - it read " +
        'programLevel: { in: ["GUIDED", "ELITE"] }, so a tier the founders gave a 90-day ' +
        "duration never reached the tracker that counts its days",
    );
  });

  test("nothing turns a level NAME into a number of days", () => {
    // `programDays(duration)` in lib/milestones.ts is the one place that answers this.
    const offenders: string[] = [];
    for (const f of [
      "src/server/students-metrics.ts",
      "src/server/student-portal.ts",
      "src/app/(app)/students/[id]/_components/SprintTracker.tsx",
    ]) {
      const src = read(f);
      // A level code tested against, with 90/120/13/18 on the same line. Comment lines are
      // skipped: the fix's own note quotes the code it replaced, which is the point of the note.
      for (const line of src.split("\n")) {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
        if (/(programLevel|wonLevel)\s*===\s*"(SOLO|GUIDED|ELITE)"/.test(line) && /\b(90|120|13|18)\b/.test(line)) {
          offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a programme's length is stored on the enrolment as its `duration` - read it with " +
        "`programDays`, which is the only thing that knows a tier added after this was written",
    );
  });

  test("the by-level cards name no tier in source", () => {
    // Each of these screens renders a breakdown. If all three seeded codes appear as string
    // literals on a row list again, the breakdown has been re-hardcoded.
    const offenders: string[] = [];
    for (const f of [
      "src/app/(app)/students/page.tsx",
      "src/app/(app)/pipeline/page.tsx",
      "src/app/(app)/page.tsx",
      "src/app/(app)/finance/page.tsx",
      "src/app/(app)/_components/HeadCoachStudents.tsx",
    ]) {
      const src = read(f);
      const named = ['label: "Solo"', 'label: "Guided"', 'label: "Elite"'].filter((s) => src.includes(s));
      if (named.length > 0) offenders.push(`${f}: ${named.join(", ")}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "build the rows with `levelTallyRows` against the live catalogue instead - a hand-written " +
        "row list stops summing to the card above it the day a tier is added",
    );
  });

  test("the metrics expose level-keyed tallies, not three named fields", () => {
    const students = read("src/server/students-metrics.ts");
    for (const gone of ["activeSolo", "activeGuided", "activeElite", "avgSolo", "avgGuided", "avgElite"]) {
      assert.equal(
        students.includes(`${gone}:`),
        false,
        `${gone} is a promise that there are exactly three tiers - key the tally by level code`,
      );
    }
    assert.ok(students.includes("activeByLevel"), "the replacement must be the keyed tally");
    assert.ok(students.includes("avgByLevel"), "the replacement must be the keyed tally");
  });
});
