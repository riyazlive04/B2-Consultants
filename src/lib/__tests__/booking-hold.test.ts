import test from "node:test";
import assert from "node:assert/strict";
import { askAt, releaseAt, slotHold } from "../booking-hold";
import { DEFAULT_BOOKING_RULES_CONFIG } from "../config-schema";

/**
 * The hold on a booked slot, and the moment it is released.
 *
 * These numbers are shown to a founder as "this slot comes back at 14:30", so they have to match
 * what server/booking-automation.ts will actually do - two conditions ANDed together, the later of
 * which decides. A screen that promises a release that never comes (or misses one that does) is
 * worse than showing nothing.
 */

const armed = { ...DEFAULT_BOOKING_RULES_CONFIG, autoCancelEnabled: true };
const slot = new Date("2026-10-10T09:00:00.000Z");

test("a confirmed booking is simply theirs - no release, no question", () => {
  const h = slotHold({ slotStartsAt: slot, confirmedAt: new Date(), confirmSentAt: new Date(), rules: armed });
  assert.equal(h.state, "CONFIRMED");
});

test("booked but not yet asked reports when the request goes out", () => {
  const h = slotHold({ slotStartsAt: slot, confirmedAt: null, confirmSentAt: null, rules: armed });
  assert.equal(h.state, "NOT_ASKED");
  // 24h lead by default
  assert.equal(h.state === "NOT_ASKED" && h.askAt?.toISOString(), "2026-10-09T09:00:00.000Z");
});

test("the cancel window decides when the grace ran out long ago", () => {
  // Asked 24h before, 30m grace: the grace expires 23.5h before the call, but the engine will not
  // act until the call is within the 3h auto-cancel window. The later moment wins.
  const askedAt = new Date(slot.getTime() - 24 * 60 * 60_000);
  const h = slotHold({ slotStartsAt: slot, confirmedAt: null, confirmSentAt: askedAt, rules: armed });
  assert.equal(h.state, "AWAITING_REPLY");
  assert.equal(h.state === "AWAITING_REPLY" && h.releaseAt?.toISOString(), "2026-10-10T06:00:00.000Z");
});

test("the reply grace decides when the call was booked at short notice", () => {
  // Booked and asked 90 minutes out - already inside the 3h window, so the only thing left to
  // wait for is their 30 minutes to answer.
  const askedAt = new Date(slot.getTime() - 90 * 60_000);
  const h = slotHold({ slotStartsAt: slot, confirmedAt: null, confirmSentAt: askedAt, rules: armed });
  assert.equal(h.state === "AWAITING_REPLY" && h.releaseAt?.toISOString(), "2026-10-10T08:00:00.000Z");
});

test("no release at all when the grace outlasts the call", () => {
  // Asked 20 minutes before with a 30-minute grace: silence only becomes a "no" after the call has
  // already started, and the engine never touches a past slot. A person decides this one.
  const askedAt = new Date(slot.getTime() - 20 * 60_000);
  assert.equal(releaseAt(slot, askedAt, armed), null);
});

test("nothing is promised while the loop is off", () => {
  const off = { ...DEFAULT_BOOKING_RULES_CONFIG, autoCancelEnabled: false };
  const askedAt = new Date(slot.getTime() - 24 * 60 * 60_000);
  assert.equal(releaseAt(slot, askedAt, off), null);
  assert.equal(askAt(slot, off), null);
  const h = slotHold({ slotStartsAt: slot, confirmedAt: null, confirmSentAt: askedAt, rules: off });
  assert.equal(h.state, "AWAITING_REPLY", "the hold is still unanswered - we just will not act on it");
  assert.equal(h.state === "AWAITING_REPLY" && h.releaseAt, null);
});

test("a 0m ask lead means no request is ever sent", () => {
  const noAsk = { ...armed, confirmRequestLeadMinutes: 0 };
  assert.equal(askAt(slot, noAsk), null);
  const h = slotHold({ slotStartsAt: slot, confirmedAt: null, confirmSentAt: null, rules: noAsk });
  assert.equal(h.state === "NOT_ASKED" && h.askAt, null);
});

test("minute-granular windows survive the arithmetic", () => {
  const tight = { ...armed, confirmRequestLeadMinutes: 90, autoCancelMinutes: 20, confirmReplyGraceMinutes: 5 };
  assert.equal(askAt(slot, tight)?.toISOString(), "2026-10-10T07:30:00.000Z");
  const askedAt = new Date(slot.getTime() - 90 * 60_000);
  assert.equal(releaseAt(slot, askedAt, tight)?.toISOString(), "2026-10-10T08:40:00.000Z");
});
