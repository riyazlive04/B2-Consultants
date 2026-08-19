import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closesWithDecision,
  resolveStageAfterCall,
  SETTER_NEXT_STAGES,
  stageAfterCall,
  stageAfterDiscovery,
} from "../call-outcome";

/**
 * These two functions look alike and mean opposite things, which is the whole risk: a dial
 * outcome almost never moves the lead, a discovery outcome always does. Getting them the
 * wrong way round would silently mis-file leads - visible only weeks later in the funnel.
 */

test("a dial outcome moves the lead ONLY when it is unambiguous", () => {
  // The two that have exactly one meaning.
  assert.equal(stageAfterCall("NEW_LEAD", "NOT_INTERESTED"), "LOST");
  assert.equal(stageAfterCall("DISCO_BOOKED", "WRONG_NUMBER"), "LOST");

  // SPOKE deliberately does NOT advance: a conversation can end in a booking, a callback,
  // a workshop referral or a flat no, and guessing would file the lead wrongly.
  assert.equal(stageAfterCall("NEW_LEAD", "SPOKE"), null);

  // Non-events. Nothing happened to the lead, so nothing moves.
  assert.equal(stageAfterCall("NEW_LEAD", "NO_ANSWER"), null);
  assert.equal(stageAfterCall("NEW_LEAD", "BUSY"), null);
  assert.equal(stageAfterCall("NEW_LEAD", "CALLBACK"), null);
});

test("a dial outcome never drags a finished lead backwards", () => {
  // A courtesy call to a won customer logged as "not interested" must not undo the sale -
  // that would corrupt both the conversion count and the commission paid on it.
  assert.equal(stageAfterCall("WON", "NOT_INTERESTED"), null);
  assert.equal(stageAfterCall("WON", "WRONG_NUMBER"), null);
  assert.equal(stageAfterCall("LOST", "NOT_INTERESTED"), null);
});

test("every discovery outcome routes, because the specialist has just decided", () => {
  assert.equal(stageAfterDiscovery("QUALIFIED_FOR_SSS"), "SSS_BOOKED");
  assert.equal(stageAfterDiscovery("NOT_QUALIFIED_FOR_SSS"), "LOST");
  assert.equal(stageAfterDiscovery("SENT_TO_WORKSHOP"), "SENT_TO_WORKSHOP");
  assert.equal(stageAfterDiscovery("FOLLOW_UP_NEEDED"), "DISCO_COMPLETED");
  // Describes the appointment, not the person - the lead goes back to being chased.
  assert.equal(stageAfterDiscovery("NO_SHOW"), "NO_SHOW");
});

test("an unrecognised outcome moves nothing rather than guessing", () => {
  assert.equal(stageAfterDiscovery("SOMETHING_NEW"), null);
  assert.equal(stageAfterCall("NEW_LEAD", "SOMETHING_NEW"), null);
});

test("only a decision counts an old lead as worked", () => {
  // The JD counts old leads "closed with interested / not interested" - a dial nobody
  // picked up is not a lead worked, however many times it was tried.
  assert.equal(closesWithDecision("SPOKE"), true);
  assert.equal(closesWithDecision("NOT_INTERESTED"), true);
  assert.equal(closesWithDecision("NO_ANSWER"), false);
  assert.equal(closesWithDecision("BUSY"), false);
  assert.equal(closesWithDecision("CALLBACK"), false);
});

/**
 * `resolveStageAfterCall` - the specialist's own answer to "where did that leave them?".
 *
 * This is the control that makes the JD's "pipeline updated by EOD: 100%" reachable from the
 * desk instead of only from the Pipeline board. It sits on top of `stageAfterCall` rather than
 * replacing it, so the risk being tested here is precedence: an explicit choice must never be
 * able to override an outcome that has only one meaning, and neither must be able to resurrect
 * a finished lead.
 */

test("an explicit stage applies only where the outcome was ambiguous", () => {
  // The case this exists for: "spoke to them" said nothing, the specialist says what happened.
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", "DISCO_BOOKED"), "DISCO_BOOKED");
  assert.equal(resolveStageAfterCall("NEW_LEAD", "CALLBACK", "DISCO_NOT_BOOKED"), "DISCO_NOT_BOOKED");
  assert.equal(resolveStageAfterCall("NEW_LEAD", "NO_ANSWER", "SENT_TO_WORKSHOP"), "SENT_TO_WORKSHOP");
});

test("leaving the stage alone is still the default", () => {
  // Empty string is what the form posts for "leave the stage as it is" - behaviour must be
  // byte-identical to before this control existed.
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", ""), null);
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", null), null);
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", undefined), null);
});

test("an unambiguous outcome BEATS whatever is in the select", () => {
  // The dangerous case: the specialist picks a stage, then changes the outcome to
  // "not interested" without clearing it. The lead is dead - a stale dropdown must not
  // resurrect someone they just closed.
  assert.equal(resolveStageAfterCall("NEW_LEAD", "NOT_INTERESTED", "DISCO_BOOKED"), "LOST");
  assert.equal(resolveStageAfterCall("NEW_LEAD", "WRONG_NUMBER", "DISCO_BOOKED"), "LOST");
});

test("a finished lead cannot be dragged back by logging a call against it", () => {
  // Same protection stageAfterCall already gives - a WON lead's stage feeds the conversion
  // count and the commission it was paid on.
  assert.equal(resolveStageAfterCall("WON", "SPOKE", "DISCO_BOOKED"), null);
  assert.equal(resolveStageAfterCall("LOST", "SPOKE", "DISCO_BOOKED"), null);
  assert.equal(resolveStageAfterCall("WON", "NOT_INTERESTED", "DISCO_NOT_BOOKED"), null);
});

test("only Level 1 stages are accepted, whatever the form posts", () => {
  // The select offers four; the server trusts none of them. A crafted or stale value must
  // leave the card alone rather than filing a lead under a stage no phone call can establish.
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", "WON"), null);
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", "LOST"), null);
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", "DEPOSIT_PAID"), null);
  assert.equal(resolveStageAfterCall("NEW_LEAD", "SPOKE", "not_a_stage"), null);
});

test("choosing the stage it is already on is a no-op, not a history row", () => {
  // Otherwise every re-log of an unchanged lead writes a LeadStageHistory entry, and the
  // "moved to" audit trail fills with moves that never happened.
  assert.equal(resolveStageAfterCall("DISCO_BOOKED", "SPOKE", "DISCO_BOOKED"), null);
});

test("every offered stage is one the resolver will actually accept", () => {
  // Guards the seam between the dropdown and the validator: adding an option to
  // SETTER_NEXT_STAGES without teaching the resolver would silently do nothing on submit.
  for (const stage of SETTER_NEXT_STAGES) {
    assert.equal(
      resolveStageAfterCall("NEW_LEAD", "SPOKE", stage),
      stage,
      `${stage} is offered in the UI but rejected by the resolver`,
    );
  }
  assert.ok(!SETTER_NEXT_STAGES.includes("WON" as never), "WON must never be a call-log outcome");
  assert.ok(!SETTER_NEXT_STAGES.includes("LOST" as never), "LOST is reached by 'not interested'");
});
