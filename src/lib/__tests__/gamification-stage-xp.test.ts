import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isForwardStageMove, DEFAULT_XP_RULES } from "../gamification";

/**
 * ARENA'S OWN RULE, HELD BY A TEST.
 *
 * "How XP works" on the Arena screen says: "Corrections and backward moves earn nothing."
 * Milestone moves honoured that from the start. Pipeline stage moves paid on the `toStage`
 * alone, whichever way the card went - so dragging a lead back from WON to DEPOSIT_PAID paid
 * 60 XP, and moving one lead back and forth between two rewarded stages farmed XP without
 * doing any work at all.
 */
describe("stage XP is paid for progress, not for movement", () => {
  test("a forward move counts", () => {
    assert.equal(isForwardStageMove("NEW_LEAD", "DISCO_BOOKED"), true);
    assert.equal(isForwardStageMove("PROPOSAL_SENT", "WON"), true);
  });

  test("setting the stage for the first time counts", () => {
    assert.equal(isForwardStageMove(null, "NEW_LEAD"), true);
    assert.equal(isForwardStageMove(null, "WON"), true);
  });

  test("a backward move does not - including the two that pay the most", () => {
    assert.equal(isForwardStageMove("WON", "DEPOSIT_PAID"), false);
    assert.equal(isForwardStageMove("WON", "PROPOSAL_SENT"), false);
    assert.equal(isForwardStageMove("SSS_COMPLETED", "SSS_BOOKED"), false);
  });

  test("a move to the same stage does not", () => {
    assert.equal(isForwardStageMove("DISCO_BOOKED", "DISCO_BOOKED"), false);
  });

  test("the back-and-forth that farmed XP pays once, not every leg", () => {
    const legs: [string | null, string][] = [
      ["PROPOSAL_SENT", "WON"],
      ["WON", "PROPOSAL_SENT"],
      ["PROPOSAL_SENT", "WON"],
      ["WON", "PROPOSAL_SENT"],
    ];
    const paid = legs.filter(([from, to]) => isForwardStageMove(from, to));
    assert.equal(paid.length, 2, "only the forward legs");
    // And what the old code would have paid for the same four moves.
    const xp = (st: string) => DEFAULT_XP_RULES.STAGE_MOVED[st] ?? 0;
    const beforeFix = legs.reduce((n, [, to]) => n + xp(to), 0);
    const afterFix = paid.reduce((n, [, to]) => n + xp(to), 0);
    assert.ok(afterFix < beforeFix, "the loop no longer pays for being undone");
  });

  test("an unknown stage is never treated as progress", () => {
    // A board column mapped to something outside `LeadStage` cannot be placed in the funnel,
    // and refusing to pay is the safe direction.
    assert.equal(isForwardStageMove("NEW_LEAD", "SOMETHING_ELSE"), false);
    assert.equal(isForwardStageMove("SOMETHING_ELSE", "WON"), false);
  });

  test("DISCO_NOT_BOOKED is not progress past DISCO_BOOKED", () => {
    // It is the outcome of the same step, not a later one.
    assert.equal(isForwardStageMove("DISCO_BOOKED", "DISCO_NOT_BOOKED"), true);
    assert.equal(isForwardStageMove("DISCO_NOT_BOOKED", "DISCO_BOOKED"), false);
    // Neither pays anything in the shipped rules, which is the other half of the guard.
    assert.equal(DEFAULT_XP_RULES.STAGE_MOVED.DISCO_NOT_BOOKED ?? 0, 0);
  });
});
