import { test } from "node:test";
import assert from "node:assert/strict";
import { closesWithDecision, stageAfterCall, stageAfterDiscovery } from "../call-outcome";

/**
 * These two functions look alike and mean opposite things, which is the whole risk: a dial
 * outcome almost never moves the lead, a discovery outcome always does. Getting them the
 * wrong way round would silently mis-file leads — visible only weeks later in the funnel.
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
  // A courtesy call to a won customer logged as "not interested" must not undo the sale —
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
  // Describes the appointment, not the person — the lead goes back to being chased.
  assert.equal(stageAfterDiscovery("NO_SHOW"), "NO_SHOW");
});

test("an unrecognised outcome moves nothing rather than guessing", () => {
  assert.equal(stageAfterDiscovery("SOMETHING_NEW"), null);
  assert.equal(stageAfterCall("NEW_LEAD", "SOMETHING_NEW"), null);
});

test("only a decision counts an old lead as worked", () => {
  // The JD counts old leads "closed with interested / not interested" — a dial nobody
  // picked up is not a lead worked, however many times it was tried.
  assert.equal(closesWithDecision("SPOKE"), true);
  assert.equal(closesWithDecision("NOT_INTERESTED"), true);
  assert.equal(closesWithDecision("NO_ANSWER"), false);
  assert.equal(closesWithDecision("BUSY"), false);
  assert.equal(closesWithDecision("CALLBACK"), false);
});
