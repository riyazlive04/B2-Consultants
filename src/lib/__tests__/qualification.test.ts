/**
 * Qualification catalogue — the Track D safety gate.
 *
 * The BANT verdict routes real humans to real calls. Moving scoring from 18 hardcoded
 * columns to a configurable catalogue is only safe if the new path produces IDENTICAL
 * results for every submission the current form can produce.
 *
 * `exhaustiveAgreement` below is that proof, not a sample: it enumerates the FULL cartesian
 * product of the six scored questions' option lists (4×4×3×4×3×5 = 2,880 submissions) and
 * asserts both scorers agree on every one. A sampled test would pass while a single mistyped
 * score sat in a rarely-hit corner of the table.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  catalogueFromIntake,
  scoreFromAnswers,
  optionScore,
  bantResultsAgree,
  SCORED_DIMENSIONS,
  type QuestionSpec,
} from "../qualification";
import { computeBant, INTAKE_OPTIONS, type BantInput } from "../booking-intake";

const CATALOGUE = catalogueFromIntake();

/** The six questions that actually move the score. */
const SCORED_KEYS = [
  "readyToInvest",
  "currentIncome",
  "decisionMaking",
  "alreadyApplied",
  "commitment",
  "whenStartGermany",
] as const;

describe("qualification — the catalogue reproduces today's form", () => {
  test("every intake question appears exactly once", () => {
    const keys = CATALOGUE.map((q) => q.key);
    assert.equal(keys.length, Object.keys(INTAKE_OPTIONS).length);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("the scored six carry a dimension; the rest are context-only", () => {
    for (const q of CATALOGUE) {
      const expected = (SCORED_KEYS as readonly string[]).includes(q.key);
      assert.equal(q.dimension !== "NONE", expected, `${q.key} dimension`);
    }
  });

  test("option values and labels are the intake lists verbatim", () => {
    for (const q of CATALOGUE) {
      const source = INTAKE_OPTIONS[q.key as keyof typeof INTAKE_OPTIONS] as readonly {
        value: string;
        label: string;
      }[];
      assert.deepEqual(
        q.options.map((o) => ({ value: o.value, label: o.label })),
        source.map((o) => ({ value: o.value, label: o.label })),
        `${q.key} options`,
      );
    }
  });
});

describe("qualification — EXHAUSTIVE agreement with the shipped scorer", () => {
  test("all 2,880 possible submissions score identically", () => {
    const lists = SCORED_KEYS.map(
      (k) => (INTAKE_OPTIONS[k] as readonly { value: string }[]).map((o) => o.value),
    );

    let checked = 0;
    const walk = (depth: number, acc: Record<string, string>) => {
      if (depth === SCORED_KEYS.length) {
        const legacy = computeBant(acc as BantInput);
        const catalogue = scoreFromAnswers(acc, CATALOGUE);
        assert.ok(
          bantResultsAgree(legacy, catalogue),
          `disagreement on ${JSON.stringify(acc)}: legacy ${JSON.stringify(legacy)} vs catalogue ${JSON.stringify(catalogue)}`,
        );
        checked++;
        return;
      }
      for (const value of lists[depth]) {
        walk(depth + 1, { ...acc, [SCORED_KEYS[depth]]: value });
      }
    };
    walk(0, {});

    assert.equal(checked, lists.reduce((n, l) => n * l.length, 1));
    assert.equal(checked, 2880);
  });

  test("a completely empty submission also agrees", () => {
    // The all-unanswered case scores 0 on every dimension → CANCEL. Worth pinning: it is the
    // one a partial form post produces, and it must not be treated as "no opinion".
    assert.ok(bantResultsAgree(computeBant({}), scoreFromAnswers({}, CATALOGUE)));
    assert.equal(scoreFromAnswers({}, CATALOGUE).bantVerdict, "CANCEL");
  });

  test("unknown answer values score zero rather than throwing", () => {
    const r = scoreFromAnswers({ readyToInvest: "not_a_real_option" }, CATALOGUE);
    assert.equal(r.bantAvg, 0);
  });
});

describe("qualification — the rules that are easy to get wrong", () => {
  test("a dimension takes the MAX of its questions, never the sum", () => {
    // Budget has two questions. Lukewarm invest (need_plan = 3) + high income (gt_20l = 5)
    // must score 5, not 8 and not 4.
    const r = scoreFromAnswers(
      { readyToInvest: "need_plan", currentIncome: "gt_20l" },
      CATALOGUE,
    );
    // Budget 5, the other three unanswered → 0. Mean = 1.25 → rounded 1.3.
    assert.equal(r.bantBudget, true);
    assert.equal(r.bantAvg, 1.3);
  });

  test("the mean always divides by four dimensions, even if a catalogue omits one", () => {
    // Dropping an absent dimension from the denominator would quietly inflate every verdict.
    const budgetOnly = CATALOGUE.filter((q) => q.dimension === "BUDGET");
    const r = scoreFromAnswers({ readyToInvest: "ready_now" }, budgetOnly);
    assert.equal(r.bantAvg, 1.3); // 5 / 4 = 1.25 → 1.3, NOT 5
    assert.equal(SCORED_DIMENSIONS.length, 4);
  });

  test("weight 1 is the identity — which is what makes the derived catalogue exact", () => {
    const q = CATALOGUE.find((x) => x.key === "readyToInvest")!;
    assert.equal(q.weight, 1);
    assert.equal(optionScore(q, "ready_now"), 5);
  });

  test("weight scales but clamps into 0–5 so the verdict thresholds stay meaningful", () => {
    const base = CATALOGUE.find((x) => x.key === "readyToInvest")!;
    const heavy: QuestionSpec = { ...base, weight: 3 };
    assert.equal(optionScore(heavy, "need_plan"), 5); // 3 × 3 = 9, clamped to 5
    const half: QuestionSpec = { ...base, weight: 0.5 };
    assert.equal(optionScore(half, "ready_now"), 2.5);
  });
});
