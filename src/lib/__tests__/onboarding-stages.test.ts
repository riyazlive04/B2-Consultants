import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JOURNEY_GAP_LABELS, JOURNEY_STEPS, type JourneyStep } from "../journey-state";
import { ONBOARDING_STAGES, stageOf } from "../../app/(app)/onboarding/new/_components/stages";

/**
 * THE WIZARD'S SIX STAGES AGAINST THE JOURNEY'S TEN STEPS (refactor step D5).
 *
 * `/onboarding/new` shows the journey twice over, on purpose: six plain-language stages for "where
 * are we roughly", and the ten-step rail for "what exactly is missing". Two readings of one truth
 * is fine; two truths is not - a stage map that silently dropped a step would show somebody as
 * finished while the rail still had work on it.
 *
 * So these tests hold the map to the journey. Add an eleventh step to `JOURNEY_STEPS` and the
 * first test fails until the wizard is told which stage it belongs to.
 */

describe("onboarding wizard - the stage map covers the journey exactly", () => {
  test("every journey step belongs to exactly one stage", () => {
    const mapped = ONBOARDING_STAGES.flatMap((s) => s.steps);
    assert.equal(
      new Set(mapped).size,
      mapped.length,
      "a step is listed in two stages - the wizard would show it twice",
    );
    assert.deepEqual(
      [...mapped].sort(),
      [...JOURNEY_STEPS].sort(),
      "the stage map and the journey disagree about which steps exist",
    );
  });

  test("the stages are in journey order, not an arbitrary one", () => {
    // The founders describe it as one sequence out loud - "lead, then discovery call, then they
    // pay, then they sign, then a batch, then class" - so a stage holding an EARLIER step than
    // the stage before it would read as going backwards.
    const order = (step: JourneyStep) => JOURNEY_STEPS.indexOf(step);
    let last = -1;
    for (const stage of ONBOARDING_STAGES) {
      for (const step of stage.steps) {
        assert.ok(order(step) > last, `${step} is out of order in "${stage.title}"`);
        last = order(step);
      }
    }
  });

  test("every stage says what it is and what it means", () => {
    for (const stage of ONBOARDING_STAGES) {
      assert.ok(stage.title.length > 0);
      assert.ok(stage.blurb.length > 0, `${stage.title} has no plain-language line`);
      assert.ok(stage.steps.length > 0, `${stage.title} covers no step`);
    }
  });
});

describe("onboarding wizard - which stage am I on", () => {
  test("each step resolves to its own stage's number", () => {
    for (const [i, stage] of ONBOARDING_STAGES.entries()) {
      for (const step of stage.steps) assert.equal(stageOf(step), i + 1);
    }
  });

  test("a finished or lost journey reads as the last stage rather than throwing", () => {
    // `journey.next.step` is null once there is nothing left to do, and the header still has to
    // render a number. The last stage is the honest answer: they are at the end.
    assert.equal(stageOf(null), ONBOARDING_STAGES.length);
  });

  /**
   * Payment is a GAP, not a step - it happens at different points for different people, so it is
   * modelled as something missing rather than a position. The wizard says so in words; this pins
   * the reason, so nobody "fixes" the stage list by adding a payment stage to it.
   */
  test("payment is a gap and therefore not a stage", () => {
    assert.ok(
      "NO_PAYMENT" in JOURNEY_GAP_LABELS,
      "NO_PAYMENT is no longer a gap - revisit the wizard copy that explains why payment is not a stage",
    );
    const titles = ONBOARDING_STAGES.map((s) => s.title.toLowerCase());
    assert.ok(
      !titles.some((t) => t.includes("payment") || t.includes("pay")),
      "payment has become a stage - it is a gap, because it happens at different points",
    );
  });
});
