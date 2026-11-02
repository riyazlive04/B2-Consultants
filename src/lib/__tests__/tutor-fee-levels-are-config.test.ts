import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TUTOR_FEE_BAND,
  DEFAULT_TUTOR_FEE_CONFIG,
  TUTOR_FEE_LEVELS,
  coerceTutorFeeConfig,
  tutorFeeConfigSchema,
} from "../config-schema";
import { computeTutorFee, tutorFeeLevelFromCode, stripLevelPrefix } from "../tutor-fee-record";
import { tutorRatePerHeadRupees } from "../tutor-fee";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  WHICH LEVELS CARRY A TRAINER FEE IS THE FOUNDER'S CARD  (1 Nov 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Levels have been founder-editable for months. The tutor-fee rate card was not: its schema had
 * three fixed keys (A1, A2, B1) and `tutorFeeLevelFromCode` hardcoded the same three. So a GN_B2
 * batch was dropped from the tutor-cost table **silently** - the German Note P&L counted no
 * trainer for it, and no screen said a level was being skipped.
 *
 * Three guarantees, in order of how much money they protect:
 *
 *   1. OMISSION IS PRESERVED. An unpriced level is still SKIPPED, not priced at a guess. Adding
 *      the ability to price B2 must not retroactively start charging for it - that would restate
 *      the German Note margin for every month already reported. §1.
 *   2. ONE RULE, ONE PLACE. "Which levels cost a trainer" had THREE copies - the schema keys,
 *      `tutorFeeLevelFromCode`, and a `LEVEL_TO_FEE_LEVEL` map in `batch-costs-metrics.ts`. All
 *      three had forgotten B2. The map is gone and the gate is the single answer. §3.
 *   3. THE DEFAULT IS UNCHANGED. Still A1/A2/B1 at 7000/8000, so nothing moved on ship day. §2.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "..", "server");

/** Comments stripped: prose may name the old three, executable code may not key on them. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ─────────────── §1 the invariant: an unpriced level is omitted, never guessed ────────────── */

describe("an unpriced level carries no fee at all", () => {
  test("a German level with no row on the card is omitted, exactly as before", () => {
    // GN_B2 was omitted by a hardcoded comparison; it is now omitted by an absent row. Same
    // outcome, and now it is a decision somebody can change.
    assert.equal(tutorFeeLevelFromCode("GN_B2"), null);
    assert.equal(computeTutorFee("GN_B2", 8), null, "must be skipped, not priced at a default");
  });

  test("a coaching tier is omitted - they are taught by a coach on salary", () => {
    for (const code of ["GUIDED", "SOLO", "ELITE"]) {
      assert.equal(tutorFeeLevelFromCode(code), null, `${code} should carry no trainer fee`);
      assert.equal(computeTutorFee(code, 10), null);
    }
  });

  test("a bundle is omitted", () => {
    assert.equal(tutorFeeLevelFromCode("GN_BUNDLE"), null);
  });

  /** THE ASSERTION THIS FILE EXISTS FOR. */
  test("adding B2 to the card starts pricing it, and ONLY then", () => {
    const before = computeTutorFee("GN_B2", 8);
    assert.equal(before, null, "unpriced before the founder adds a row");

    const withB2 = coerceTutorFeeConfig({
      thresholdStudents: 5,
      ratesByLevel: {
        ...DEFAULT_TUTOR_FEE_CONFIG.ratesByLevel,
        B2: { atOrAbove: 9000, below: 11000 },
      },
    });
    const after = computeTutorFee("GN_B2", 8, withB2);
    assert.ok(after, "priced once the row exists");
    assert.equal(after.headcount, 8);
    // 8 students at or above the threshold of 5 → 9000/head → ₹72,000 → 7,200,000 paise.
    assert.equal(after.amountInrMinor, 7_200_000n);
  });

  test("removing a level stops pricing it again", () => {
    const withoutB1 = coerceTutorFeeConfig({
      thresholdStudents: 5,
      ratesByLevel: {
        A1: { ...DEFAULT_TUTOR_FEE_BAND },
        A2: { ...DEFAULT_TUTOR_FEE_BAND },
      },
    });
    assert.equal(computeTutorFee("GN_B1", 8, withoutB1), null);
    assert.ok(computeTutorFee("GN_A1", 8, withoutB1), "the levels still on the card are unaffected");
  });

  test("the GN_ prefix is stripped, and a bare code works too", () => {
    assert.equal(stripLevelPrefix("GN_A1"), "A1");
    assert.equal(stripLevelPrefix("A1"), "A1");
    assert.equal(tutorFeeLevelFromCode("GN_A1"), "A1");
    assert.equal(tutorFeeLevelFromCode("A2"), "A2");
  });
});

/* ─────────────── §2 the default is what shipped ───────────────────────────────────────────── */

describe("the default card is the three levels that were hardcoded", () => {
  test("exactly A1, A2 and B1, at the two shipped rates", () => {
    assert.deepEqual(Object.keys(DEFAULT_TUTOR_FEE_CONFIG.ratesByLevel).sort(), ["A1", "A2", "B1"]);
    for (const level of TUTOR_FEE_LEVELS) {
      assert.deepEqual(DEFAULT_TUTOR_FEE_CONFIG.ratesByLevel[level], { atOrAbove: 7000, below: 8000 });
    }
    assert.equal(DEFAULT_TUTOR_FEE_CONFIG.thresholdStudents, 5);
  });

  test("the default is built from TUTOR_FEE_LEVELS, so the two cannot drift", () => {
    assert.equal(
      Object.keys(DEFAULT_TUTOR_FEE_CONFIG.ratesByLevel).length,
      TUTOR_FEE_LEVELS.length,
    );
  });

  test("an absent or unreadable card reads as the default", () => {
    for (const bad of [null, undefined, "nonsense", [], 7]) {
      assert.deepEqual(coerceTutorFeeConfig(bad), DEFAULT_TUTOR_FEE_CONFIG, `failed on ${String(bad)}`);
    }
  });

  test("a level absent from BOTH the card and the default does not throw", () => {
    // The old fallback indexed `DEFAULT_TUTOR_FEE_CONFIG.ratesByLevel[level]`, which was safe only
    // while the keys were fixed. With a record it returned undefined and threw on `.atOrAbove`,
    // turning a newly added level into a crashed German Note P&L.
    assert.equal(tutorRatePerHeadRupees("C1", 8), DEFAULT_TUTOR_FEE_BAND.atOrAbove);
    assert.equal(tutorRatePerHeadRupees("C1", 1), DEFAULT_TUTOR_FEE_BAND.below);
  });
});

/* ─────────────── §3 one rule, one place ───────────────────────────────────────────────────── */

describe("which levels cost a trainer is answered in one place", () => {
  test("batch-costs-metrics no longer keeps its own level map", () => {
    const src = code(path.join(SERVER, "batch-costs-metrics.ts"));
    assert.ok(
      !src.includes("LEVEL_TO_FEE_LEVEL"),
      "the third copy of the level map is back. It had forgotten B2 along with the other two.",
    );
    assert.ok(src.includes("tutorFeeLevelFromCode"), "it no longer goes through the shared gate");
  });

  test("the gate is handed the founder's card, not left on its default", () => {
    // Calling `tutorFeeLevelFromCode(x)` with no config silently answers from the SHIPPED card,
    // so a founder who added B2 would still see its batches omitted on that screen.
    for (const file of ["batch-costs-metrics.ts", "tutor-fees.ts"]) {
      const src = code(path.join(SERVER, file));
      const bare = src.match(/tutorFeeLevelFromCode\([^),]*\)/g) ?? [];
      assert.deepEqual(
        bare,
        [],
        `${file} calls tutorFeeLevelFromCode without passing the config: ${bare.join(", ")}`,
      );
    }
  });

  test("no executable code keys on the old fixed three", () => {
    const src = code(path.join(HERE, "..", "tutor-fee-record.ts"));
    assert.ok(
      !/stripped === "A1"/.test(src),
      "the hardcoded level comparison is back in the gate",
    );
  });
});

/* ─────────────── §4 what the schema accepts as a level code ───────────────────────────────── */

describe("the schema keeps the card readable", () => {
  const withLevels = (ratesByLevel: Record<string, unknown>) =>
    tutorFeeConfigSchema.safeParse({ thresholdStudents: 5, ratesByLevel });

  test("plain level codes are accepted", () => {
    for (const key of ["A1", "B2", "C1", "A1_A2"]) {
      assert.equal(withLevels({ [key]: { ...DEFAULT_TUTOR_FEE_BAND } }).success, true, key);
    }
  });

  /**
   * A `GN_` prefix is the dangerous one: every lookup strips the prefix, so a row keyed "GN_A1"
   * could never be found. The founder would add a rate, save it, see it listed - and the level
   * would still be omitted everywhere. A key that cannot match is worse than a rejected one.
   */
  test("a prefixed or lower-case code is refused", () => {
    for (const key of ["GN_A1", "GN_B2", "a1", "a 1", ""]) {
      assert.equal(
        withLevels({ [key]: { ...DEFAULT_TUTOR_FEE_BAND } }).success,
        false,
        `accepted a malformed level code: "${key}"`,
      );
    }
  });

  /**
   * Surrounding whitespace is NORMALISED rather than refused, and the key is trimmed in the
   * output - so a hand-edited row with a stray space still prices its level instead of becoming
   * a key nothing can look up.
   */
  test("whitespace around a code is trimmed away, not rejected", () => {
    const parsed = withLevels({ " A1": { ...DEFAULT_TUTOR_FEE_BAND } });
    assert.equal(parsed.success, true);
    assert.deepEqual(
      Object.keys(parsed.success ? parsed.data.ratesByLevel : {}),
      ["A1"],
      "the key must come out trimmed, or the lookup still misses it",
    );
  });

  test("an empty card is legal - it means nothing is paid a trainer", () => {
    // Legal, and loud: the panel warns that no batch will show a tutor cost. Refusing it would
    // make "we pay no trainers" impossible to express.
    assert.equal(withLevels({}).success, true);
  });

  test("a negative rate is refused", () => {
    assert.equal(withLevels({ A1: { atOrAbove: -1, below: 8000 } }).success, false);
  });
});
