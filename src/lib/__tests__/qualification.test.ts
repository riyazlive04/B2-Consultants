/**
 * Qualification catalogue - the Track D safety gate.
 *
 * The BANT verdict routes real humans to real calls. Moving scoring from 18 hardcoded
 * columns to a configurable catalogue is only safe if the new path produces IDENTICAL
 * results for every submission the current form can produce.
 *
 * `exhaustiveAgreement` below is that proof, not a sample: it enumerates the FULL cartesian
 * product of the six scored questions' option lists and asserts both scorers agree on every
 * one. A sampled test would pass while a single mistyped score sat in a rarely-hit corner of
 * the table.
 *
 * The total is DERIVED from the option lists, not hardcoded. It used to assert a literal 2,880
 * (4×4×3×4×3×5); when the intake was matched to Synamate's questions on 07/08/2026 the lists
 * changed shape and that number became a second, silently-wrong source of truth about the
 * catalogue. The product of the real lists is the only figure that cannot drift.
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

/**
 * The five questions that actually move the score - and every one is on the live form.
 *
 * `commitment` is absent on purpose: it was scored while the form had stopped asking it, which
 * divided every average by a guaranteed zero. Kept out of this list so the test fails if it is
 * ever scored again without being asked again.
 */
const SCORED_KEYS = [
  "readyToInvest",
  "currentIncome",
  "decisionMaking",
  "alreadyApplied",
  "whenStartGermany",
] as const;

describe("qualification - the catalogue reproduces today's form", () => {
  test("every intake question appears exactly once", () => {
    const keys = CATALOGUE.map((q) => q.key);
    assert.equal(keys.length, Object.keys(INTAKE_OPTIONS).length);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("the scored five carry a dimension; the rest are context-only", () => {
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

describe("qualification - EXHAUSTIVE agreement with the shipped scorer", () => {
  test("every possible submission scores identically", () => {
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

    const expected = lists.reduce((n, l) => n * l.length, 1);
    assert.equal(checked, expected);
    // A floor, not an equality: it catches a list collapsing to nothing (which would make the
    // "exhaustive" walk vacuously pass) without pinning the suite to one catalogue revision.
    // Lowered from 500 to 300 on 20/08/2026 when `commitment` stopped being scored - dropping a
    // question legitimately shrinks the space (1620 → 405), and a floor that fails on a correct
    // change is a floor nobody keeps.
    assert.ok(checked > 300, `only ${checked} combinations enumerated`);
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

describe("qualification - the rules that are easy to get wrong", () => {
  test("a dimension takes the MAX of its questions, never the sum", () => {
    // Budget has two questions. Lukewarm invest (need_clarity = 2.5) + top salary (gt_1l = 5)
    // must score 5, not 7.5 and not 2.5.
    const r = scoreFromAnswers(
      { readyToInvest: "need_clarity", currentIncome: "gt_1l" },
      CATALOGUE,
    );
    // The BOOLEAN still takes the best evidence for the dimension - that is what the pipeline
    // ranking reads, and it is unchanged.
    assert.equal(r.bantBudget, true);
    // The AVERAGE is over the five scored QUESTIONS: (2.5 + 5 + three unanswered) / 5 = 1.5.
    assert.equal(r.bantAvg, 1.5);
  });

  test("the average is per QUESTION, so a two-question dimension carries twice the weight", () => {
    // This is what separates the current rule from the old one. Both Budget questions answered at
    // the top, nothing else: per-question gives (5 + 5) / 5 = 2.0, per-dimension would give
    // 5 / 4 = 1.3. Budget's two votes are the founders' own hand-weighting, made explicit.
    const r = scoreFromAnswers({ readyToInvest: "ready_now", currentIncome: "gt_1l" }, CATALOGUE);
    assert.equal(r.bantAvg, 2);
  });

  test("an unanswered scored question stays in the denominator", () => {
    // Dropping it would quietly inflate the verdict of every incomplete submission. This is also
    // why a scored question the form never asks costs EVERY prospect a share of their score.
    const budgetOnly = CATALOGUE.filter((q) => q.dimension === "BUDGET");
    const r = scoreFromAnswers({ readyToInvest: "ready_now" }, budgetOnly);
    assert.equal(r.bantAvg, 2.5); // 5 / 2 budget questions, NOT 5 and NOT 5/4
    assert.equal(SCORED_DIMENSIONS.length, 4);
  });

  test("weight 1 is the identity - which is what makes the derived catalogue exact", () => {
    const q = CATALOGUE.find((x) => x.key === "readyToInvest")!;
    assert.equal(q.weight, 1);
    assert.equal(optionScore(q, "ready_now"), 5);
  });

  test("weight scales but clamps into 0–5 so the verdict thresholds stay meaningful", () => {
    const base = CATALOGUE.find((x) => x.key === "readyToInvest")!;
    const heavy: QuestionSpec = { ...base, weight: 3 };
    assert.equal(optionScore(heavy, "need_clarity"), 5); // 3 × 2.5 = 7.5, clamped to 5
    const half: QuestionSpec = { ...base, weight: 0.5 };
    assert.equal(optionScore(half, "ready_now"), 2.5);
  });
});
