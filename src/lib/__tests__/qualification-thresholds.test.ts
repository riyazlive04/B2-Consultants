import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BANT_MAX,
  DEFAULT_BANT_THRESHOLDS,
  bantVerdictFor,
  computeBant,
  type BantThresholds,
} from "../booking-intake";
import { bantSignal, bantSignalFor } from "../bant-view";
import { qualifiedFromBant } from "../outreach-sop";
import { scoreFromAnswers } from "../qualification";
import {
  DEFAULT_QUALIFICATION_CONFIG,
  coerceQualificationConfig,
  qualificationConfigSchema,
} from "../config-schema";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  THE BANT CUTOFFS BECAME CONFIG, AND MUST STAY CONFIG  (1 Nov 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Until now the three verdict cutoffs were literals in `booking-intake.ts`. Moving them cost a
 * code change, a deploy and - the last time it happened, on 22/09/2026 - a data migration. They
 * are a sales judgement, so they are now `qualificationConfig.thresholds`, editable in
 * Console → Sales ops → Qualification.
 *
 * This file guards the two failures that would make that pointless, in the shape
 * `worry-thresholds-are-config.test.ts` established:
 *
 *   1. THE DEFAULT DRIFTING. The shipped default has to reproduce the behaviour of the literals
 *      it replaced, exactly, or converting them changed every prospect's verdict on the day it
 *      shipped. §1 pins the three numbers and the bands they produce.
 *
 *   2. THE LITERAL COMING BACK. The quiet one. A later edit re-introduces `2.4` at a point of
 *      use, so the Console panel still shows a number, still saves it, and nothing reads it.
 *      Everything looks configured and behaves as though it is not. §3 greps the files.
 *
 * It also pins the one thing that is deliberately NOT configurable - `BANT_MAX` - because a
 * future reader will reasonably wonder why the scale was left out, and the answer is load-bearing
 * (§4).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, "..");
const read = (rel: string) => fs.readFileSync(path.join(LIB, rel), "utf8");

/* ───────────────────────────── §1 the default is the old behaviour ───────────────────────── */

describe("the shipped default reproduces the literals it replaced", () => {
  test("the three cutoffs are still 2.4 / 1.6 / 2.4 on the 0-4 scale", () => {
    assert.equal(BANT_MAX, 4);
    assert.deepEqual(DEFAULT_BANT_THRESHOLDS, {
      confirmAbove: 2.4,
      doubtFrom: 1.6,
      dimensionMetAt: 2.4,
    });
  });

  test("the default config carries them", () => {
    assert.deepEqual(DEFAULT_QUALIFICATION_CONFIG.thresholds, DEFAULT_BANT_THRESHOLDS);
    assert.equal(DEFAULT_QUALIFICATION_CONFIG.scorer, "shipped");
  });

  /**
   * The boundaries, stated as the behaviour rather than as the numbers - these are the four
   * assertions that would have caught the Prisma enum comment being wrong by a whole point.
   */
  test("verdict bands: confirm is STRICTLY above, doubt is inclusive at both ends", () => {
    assert.equal(bantVerdictFor(2.5), "CONFIRM");
    assert.equal(bantVerdictFor(2.4), "DOUBT", "2.4 is not above 2.4");
    assert.equal(bantVerdictFor(1.6), "DOUBT", "the doubt floor is inclusive");
    assert.equal(bantVerdictFor(1.59), "CANCEL");
    assert.equal(bantVerdictFor(0), "CANCEL");
    assert.equal(bantVerdictFor(BANT_MAX), "CONFIRM");
  });

  test("every reader of the bands agrees with the verdict at the boundaries", () => {
    for (const avg of [0, 1.59, 1.6, 2.4, 2.41, 4]) {
      const verdict = bantVerdictFor(avg);
      const expected = verdict === "CONFIRM" ? "ok" : verdict === "DOUBT" ? "watch" : "risk";
      assert.equal(bantSignal(avg), expected, `bantSignal disagrees at ${avg}`);
      assert.equal(bantSignalFor(verdict), expected, `bantSignalFor disagrees at ${avg}`);
      const qualified = qualifiedFromBant(avg);
      const expectedQ = verdict === "CONFIRM" ? "YES" : verdict === "DOUBT" ? "MAYBE" : "NO";
      assert.equal(qualified, expectedQ, `qualifiedFromBant disagrees at ${avg}`);
    }
  });
});

/* ───────────────────────────── §2 a configured value is honoured ─────────────────────────── */

describe("a configured cutoff actually moves the verdict", () => {
  const LENIENT: BantThresholds = { confirmAbove: 2.0, doubtFrom: 1.0, dimensionMetAt: 2.0 };
  const STRICT: BantThresholds = { confirmAbove: 3.5, doubtFrom: 3.0, dimensionMetAt: 3.5 };

  test("the same average lands in three different verdicts under three configs", () => {
    assert.equal(bantVerdictFor(2.2), "DOUBT", "shipped");
    assert.equal(bantVerdictFor(2.2, LENIENT), "CONFIRM");
    assert.equal(bantVerdictFor(2.2, STRICT), "CANCEL");
  });

  test("qualifiedFromBant follows the config, so Step 11 cannot disagree with the CRM", () => {
    assert.equal(qualifiedFromBant(2.2, LENIENT), "YES");
    assert.equal(qualifiedFromBant(2.2, STRICT), "NO");
  });

  test("bantSignal follows the config, so the colour cannot disagree with the label", () => {
    assert.equal(bantSignal(2.2, LENIENT), "ok");
    assert.equal(bantSignal(2.2, STRICT), "risk");
  });

  /**
   * `dimensionMetAt` drives the four booleans the pipeline's "call these first" ranking consumes,
   * which is a different question from the verdict - so it gets its own assertion rather than
   * riding on the ones above.
   */
  test("dimensionMetAt moves the dimension booleans in computeBant", () => {
    // readyToInvest/currentIncome feed Budget; whenStartGermany feeds Timeline.
    const input = { readyToInvest: "yes_ready", whenStartGermany: "immediately" };
    const shipped = computeBant(input);
    const strict = computeBant(input, { ...DEFAULT_BANT_THRESHOLDS, dimensionMetAt: BANT_MAX });
    assert.ok(
      strict.bantScore <= shipped.bantScore,
      "raising the met-at line cannot increase the number of dimensions met",
    );
    const lenient = computeBant(input, { ...DEFAULT_BANT_THRESHOLDS, dimensionMetAt: 0 });
    assert.equal(lenient.bantScore, 4, "a met-at of 0 means every dimension counts as met");
  });

  test("both scorers take the same thresholds argument", () => {
    // An empty catalogue scores nothing, which is enough to prove the parameter is threaded:
    // the verdict for an average of 0 differs between a shipped and a zero-floor config.
    const zeroFloor: BantThresholds = { confirmAbove: 0, doubtFrom: 0, dimensionMetAt: 0 };
    assert.equal(scoreFromAnswers({}, []).bantVerdict, "CANCEL");
    assert.equal(scoreFromAnswers({}, [], zeroFloor).bantVerdict, "DOUBT");
    assert.equal(computeBant({}).bantVerdict, "CANCEL");
    assert.equal(computeBant({}, zeroFloor).bantVerdict, "DOUBT");
  });
});

/* ───────────────────────────── §3 the literal is gone ────────────────────────────────────── */

describe("no point of use re-introduces the literal", () => {
  /**
   * The files that APPLY a cutoff. Each must reach it through a parameter, never through a
   * number typed in place. `booking-intake.ts` is excluded because it is where the default is
   * declared - §1 pins its values instead.
   */
  const POINTS_OF_USE = ["bant-view.ts", "qualification.ts", "outreach-sop.ts"];

  for (const file of POINTS_OF_USE) {
    test(`${file} compares against thresholds, not a number`, () => {
      const src = read(file);
      /**
       * Strip comments first. Every one of these files legitimately NAMES the shipped values in
       * its prose ("> 2.4 confirm · 1.6-2.4 doubt"), and documentation is not a point of use -
       * failing on it would train the next reader to delete the explanation.
       */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const literal of ["2.4", "1.6"]) {
        assert.ok(
          !code.includes(literal),
          `${file} contains the literal ${literal} in executable code. A cutoff must come from ` +
            `the thresholds argument, or the Console panel saves a number nothing reads.`,
        );
      }
    });
  }

  test("the shipped-constant aliases are not used to make a DECISION anywhere", () => {
    /**
     * `BANT_CONFIRM_ABOVE` / `BANT_DOUBT_FROM` / `DIMENSION_MET_AT` survive as named exports
     * because a tooltip may quote the default. What they must never do again is decide something:
     * that is what made /bookings print one band and count another.
     */
    for (const file of POINTS_OF_USE) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const alias of ["BANT_CONFIRM_ABOVE", "BANT_DOUBT_FROM", "DIMENSION_MET_AT"]) {
        assert.ok(
          !code.includes(alias),
          `${file} still reads ${alias}. Take the value from the thresholds argument instead.`,
        );
      }
    }
  });
});

/* ───────────────────────────── §4 the schema, and what it refuses ────────────────────────── */

describe("the config schema", () => {
  test("an absent thresholds block reads as the shipped default", () => {
    assert.deepEqual(coerceQualificationConfig({ scorer: "shipped" }).thresholds, DEFAULT_BANT_THRESHOLDS);
    assert.deepEqual(coerceQualificationConfig(null), DEFAULT_QUALIFICATION_CONFIG);
    assert.deepEqual(coerceQualificationConfig(undefined), DEFAULT_QUALIFICATION_CONFIG);
    assert.deepEqual(coerceQualificationConfig("nonsense"), DEFAULT_QUALIFICATION_CONFIG);
    assert.deepEqual(coerceQualificationConfig([]), DEFAULT_QUALIFICATION_CONFIG);
  });

  test("a doubt cutoff ABOVE the confirm cutoff is refused", () => {
    // Left unrefused this does not error - it silently makes DOUBT unreachable, because
    // `bantVerdictFor` tests confirm first.
    const bad = qualificationConfigSchema.safeParse({
      scorer: "shipped",
      thresholds: { confirmAbove: 1.0, doubtFrom: 3.0, dimensionMetAt: 2.4 },
    });
    assert.equal(bad.success, false);
  });

  test("a cutoff outside 0-BANT_MAX is refused", () => {
    for (const thresholds of [
      { confirmAbove: 9, doubtFrom: 1.6, dimensionMetAt: 2.4 },
      { confirmAbove: 2.4, doubtFrom: -1, dimensionMetAt: 2.4 },
      { confirmAbove: 2.4, doubtFrom: 1.6, dimensionMetAt: 99 },
    ]) {
      assert.equal(
        qualificationConfigSchema.safeParse({ scorer: "shipped", thresholds }).success,
        false,
        `accepted an out-of-range cutoff: ${JSON.stringify(thresholds)}`,
      );
    }
  });

  test("equal cutoffs are allowed - that is a two-way split, not an error", () => {
    const ok = qualificationConfigSchema.safeParse({
      scorer: "shipped",
      thresholds: { confirmAbove: 2, doubtFrom: 2, dimensionMetAt: 2 },
    });
    assert.equal(ok.success, true);
    // Everything at or above 2 that is not above 2 is DOUBT; 2 exactly is the only such value.
    assert.equal(bantVerdictFor(2, { confirmAbove: 2, doubtFrom: 2, dimensionMetAt: 2 }), "DOUBT");
    assert.equal(bantVerdictFor(2.1, { confirmAbove: 2, doubtFrom: 2, dimensionMetAt: 2 }), "CONFIRM");
  });

  /**
   * A bad thresholds block must not take the scorer down with it. The two are independent
   * decisions sharing one row, and falling back wholesale would move a "catalogue" install
   * silently back onto the shipped scorer - a change to who gets rejected.
   */
  test("a broken thresholds block does not discard the scorer choice", () => {
    const got = coerceQualificationConfig({
      scorer: "catalogue",
      thresholds: { confirmAbove: 1, doubtFrom: 3, dimensionMetAt: 2 },
    });
    assert.equal(got.scorer, "catalogue", "the scorer choice survived");
    assert.deepEqual(got.thresholds, DEFAULT_BANT_THRESHOLDS, "the bad block fell back");
  });

  test("a broken scorer value does not discard valid thresholds", () => {
    const got = coerceQualificationConfig({
      scorer: "made-up",
      thresholds: { confirmAbove: 3, doubtFrom: 2, dimensionMetAt: 3 },
    });
    assert.equal(got.scorer, "shipped");
    assert.deepEqual(got.thresholds, { confirmAbove: 3, doubtFrom: 2, dimensionMetAt: 3 });
  });

  /**
   * BANT_MAX IS DELIBERATELY NOT A SETTING, and this test is the note explaining why.
   *
   * The scale is not a threshold. Changing it does not rescale the scores already stored on every
   * lead and booking, so a founder who "tried 5" would reinterpret every historical verdict
   * against a scale it was never scored on. The 0-5 to 0-4 move on 22/09/2026 was a code change
   * AND the `20260922180000_bant_scale_out_of_4` data migration, and it stays that shape.
   */
  test("the scale is not accepted as a config field", () => {
    const parsed = qualificationConfigSchema.safeParse({
      scorer: "shipped",
      thresholds: DEFAULT_BANT_THRESHOLDS,
      max: 5,
      bantMax: 5,
    });
    assert.equal(parsed.success, true, "unknown keys are ignored, not rejected");
    assert.ok(
      !Object.keys(parsed.success ? parsed.data : {}).includes("max"),
      "a scale smuggled into the config must not survive parsing",
    );
    assert.equal(BANT_MAX, 4, "the scale is a constant; a rescale is a migration plus a restate");
  });
});
