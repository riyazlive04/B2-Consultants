import test from "node:test";
import assert from "node:assert/strict";
import {
  callbackVerdict,
  callbackRoundLabel,
  hoursSince,
  summariseCalls,
  DEFAULT_CALLBACK_CHASE,
  EMPTY_CALL_SUMMARY,
  type CallbackChaseConfig,
} from "../callback-chase";

const CFG: CallbackChaseConfig = { ...DEFAULT_CALLBACK_CHASE };
const H = 3_600_000;
const T0 = new Date("2026-08-27T04:00:00.000Z"); // 09:30 IST
const at = (hoursFromT0: number) => new Date(T0.getTime() + hoursFromT0 * H);
const spoke = (h: number) => ({ calledAt: at(h), outcome: "SPOKE" });
const noAnswer = (h: number) => ({ calledAt: at(h), outcome: "NO_ANSWER" });

// ─────────────────────────── summariseCalls ───────────────────────────

test("no calls summarises to the empty shape", () => {
  assert.deepEqual(summariseCalls([]), EMPTY_CALL_SUMMARY);
});

test("the pitch call is not itself a call-back", () => {
  const s = summariseCalls([spoke(0)]);
  assert.equal(s.callbacksMade, 0);
  assert.deepEqual(s.firstSpokeAt, at(0));
  assert.deepEqual(s.lastCallAt, at(0));
});

test("dials after the first connection are the call-backs", () => {
  const s = summariseCalls([spoke(0), noAnswer(4), spoke(8)]);
  assert.equal(s.callbacksMade, 2);
  assert.deepEqual(s.firstSpokeAt, at(0));
  assert.deepEqual(s.lastCallAt, at(8));
  assert.equal(s.lastOutcome, "SPOKE");
});

test("dials BEFORE anyone got through never burn a call-back", () => {
  // Three attempts that rang out, then a connection. The chase starts at the connection, so the
  // prospect still has their full budget - the misses belong to the SLA queue.
  const s = summariseCalls([noAnswer(0), noAnswer(1), noAnswer(2), spoke(3)]);
  assert.equal(s.callbacksMade, 0);
  assert.deepEqual(s.firstSpokeAt, at(3));
});

test("never connected leaves the chase unstarted", () => {
  const s = summariseCalls([noAnswer(0), noAnswer(5)]);
  assert.equal(s.firstSpokeAt, null);
  assert.equal(s.callbacksMade, 0);
});

test("rows arriving out of order still yield the right first and last", () => {
  // An offline queue flushing after a lost connection posts yesterday's dial behind today's.
  const s = summariseCalls([spoke(8), spoke(0), noAnswer(4)]);
  assert.deepEqual(s.firstSpokeAt, at(0));
  assert.deepEqual(s.lastCallAt, at(8));
  assert.equal(s.callbacksMade, 2);
});

test("the earliest SPOKE wins when there are several", () => {
  const s = summariseCalls([spoke(2), spoke(0), spoke(6)]);
  assert.deepEqual(s.firstSpokeAt, at(0));
  assert.equal(s.callbacksMade, 2);
});

// ─────────────────────────── the four-hour loop ───────────────────────────

test("never connected is not a call-back", () => {
  const v = callbackVerdict(summariseCalls([noAnswer(0)]), CFG, at(9));
  assert.equal(v.state, "NOT_STARTED");
  assert.equal(v.nextDueAt, null);
});

test("inside the gap the lead is resting, not listed", () => {
  const v = callbackVerdict(summariseCalls([spoke(0)]), CFG, at(3.9));
  assert.equal(v.state, "RESTING");
  assert.deepEqual(v.nextDueAt, at(4));
  assert.ok(v.msToNextDue > 0);
});

test("exactly on the gap boundary the call-back is due", () => {
  const v = callbackVerdict(summariseCalls([spoke(0)]), CFG, at(4));
  assert.equal(v.state, "DUE");
  assert.equal(v.msToNextDue, 0);
  assert.equal(callbackRoundLabel(v), "Call-back 1 of 3");
});

test("calling again restarts the four hours", () => {
  // The founder's rule: "if the telecaller calls again, do not show until next 4 hours".
  const calls = [spoke(0), spoke(4)];
  assert.equal(callbackVerdict(summariseCalls(calls), CFG, at(5)).state, "RESTING");
  assert.equal(callbackVerdict(summariseCalls(calls), CFG, at(8)).state, "DUE");
});

test("a call-back that rang out still restarts the gap", () => {
  // The telecaller did the work. Only the prospect's answer decides whether we keep going.
  const v = callbackVerdict(summariseCalls([spoke(0), noAnswer(4)]), CFG, at(5));
  assert.equal(v.state, "RESTING");
  assert.deepEqual(v.nextDueAt, at(8));
});

test("the full three-call-back cycle, then exhaustion", () => {
  const cycle = [spoke(0)];
  // Call-back 1
  assert.equal(callbackVerdict(summariseCalls(cycle), CFG, at(4)).state, "DUE");
  assert.equal(callbackRoundLabel(callbackVerdict(summariseCalls(cycle), CFG, at(4))), "Call-back 1 of 3");
  cycle.push(spoke(4));
  // Call-back 2
  assert.equal(callbackVerdict(summariseCalls(cycle), CFG, at(8)).state, "DUE");
  assert.equal(callbackRoundLabel(callbackVerdict(summariseCalls(cycle), CFG, at(8))), "Call-back 2 of 3");
  cycle.push(spoke(8));
  // Call-back 3
  assert.equal(callbackVerdict(summariseCalls(cycle), CFG, at(12)).state, "DUE");
  assert.equal(callbackRoundLabel(callbackVerdict(summariseCalls(cycle), CFG, at(12))), "Call-back 3 of 3");
  cycle.push(spoke(12));
  // Budget spent. Still rests one final gap - they may yet book in those four hours.
  assert.equal(callbackVerdict(summariseCalls(cycle), CFG, at(15)).state, "RESTING");
  assert.equal(callbackVerdict(summariseCalls(cycle), CFG, at(16)).state, "EXHAUSTED");
});

test("exhaustion waits out the last gap before closing", () => {
  // The regression this guards: closing the moment the third call-back is logged would give the
  // prospect no window at all to act on the conversation that just happened.
  const spent = [spoke(0), spoke(4), spoke(8), spoke(12)];
  const v = callbackVerdict(summariseCalls(spent), CFG, at(13));
  assert.equal(v.state, "RESTING");
  assert.deepEqual(v.nextDueAt, at(16));
});

test("an exhausted verdict carries the instant the chase ran out", () => {
  const v = callbackVerdict(summariseCalls([spoke(0), spoke(4), spoke(8), spoke(12)]), CFG, at(20));
  assert.equal(v.state, "EXHAUSTED");
  assert.deepEqual(v.nextDueAt, at(16));
  assert.equal(v.callbacksMade, 3);
});

test("not interested ends the chase whatever the round count", () => {
  const v = callbackVerdict(
    summariseCalls([spoke(0), { calledAt: at(4), outcome: "NOT_INTERESTED" }]),
    CFG,
    at(99),
  );
  assert.equal(v.state, "REFUSED");
  assert.equal(v.nextDueAt, null);
});

test("a wrong number ends the chase", () => {
  const v = callbackVerdict(
    summariseCalls([spoke(0), { calledAt: at(4), outcome: "WRONG_NUMBER" }]),
    CFG,
    at(99),
  );
  assert.equal(v.state, "REFUSED");
});

test("a refusal followed by a later successful call re-opens the chase", () => {
  // Append-only correction: a mis-logged "wrong number" is fixed by logging the real outcome,
  // never by editing. The LAST dial is what counts, so the correction has to take effect.
  const v = callbackVerdict(
    summariseCalls([spoke(0), { calledAt: at(1), outcome: "WRONG_NUMBER" }, spoke(2)]),
    CFG,
    at(6),
  );
  assert.equal(v.state, "DUE");
});

// ─────────────────────────── the admin dial ───────────────────────────

test("the founder's cap decides how many times the lead is listed", () => {
  const once: CallbackChaseConfig = { ...CFG, maxCallbacks: 1 };
  assert.equal(callbackVerdict(summariseCalls([spoke(0)]), once, at(4)).state, "DUE");
  assert.equal(callbackVerdict(summariseCalls([spoke(0), spoke(4)]), once, at(8)).state, "EXHAUSTED");

  const five: CallbackChaseConfig = { ...CFG, maxCallbacks: 5 };
  assert.equal(callbackVerdict(summariseCalls([spoke(0), spoke(4)]), five, at(8)).state, "DUE");
});

test("the gap is configurable and the boundary moves with it", () => {
  const twelve: CallbackChaseConfig = { ...CFG, gapHours: 12 };
  assert.equal(callbackVerdict(summariseCalls([spoke(0)]), twelve, at(11)).state, "RESTING");
  assert.equal(callbackVerdict(summariseCalls([spoke(0)]), twelve, at(12)).state, "DUE");
});

test("the round label never runs past the cap", () => {
  // Display guard: an exhausted lead with four dials must not read "Call-back 4 of 3".
  const v = callbackVerdict(summariseCalls([spoke(0), spoke(4), spoke(8), spoke(12)]), CFG, at(20));
  assert.equal(callbackRoundLabel(v), "Call-back 3 of 3");
});

test("hoursSince floors and never goes negative", () => {
  assert.equal(hoursSince(at(0), at(3.99)), 3);
  assert.equal(hoursSince(at(0), at(4)), 4);
  assert.equal(hoursSince(at(5), at(0)), 0);
});
