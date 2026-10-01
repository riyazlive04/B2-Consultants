import test from "node:test";
import assert from "node:assert/strict";
import { coerceBookingRulesConfig, DEFAULT_BOOKING_RULES_CONFIG } from "../config-schema";

/**
 * The confirm-or-cancel windows moved from whole hours to minutes. Every row already in
 * AppSetting("bookingRulesConfig") on a live install carries the OLD keys, and a config that
 * failed to parse falls all the way back to the shipped defaults - which would quietly reset a
 * founder's 6-hour ask window to 24h. These tests are that migration.
 */

test("a row written in hours is read as the same window in minutes", () => {
  const c = coerceBookingRulesConfig({
    bufferMinutes: 15,
    minNoticeHours: 2,
    maxAdvanceDays: 30,
    autoCancelEnabled: true,
    confirmRequestLeadHours: 6,
    autoCancelHours: 1,
  });
  assert.equal(c.confirmRequestLeadMinutes, 360);
  assert.equal(c.autoCancelMinutes, 60);
  assert.equal(c.autoCancelEnabled, true, "the master switch survives the migration");
  assert.equal(c.confirmReplyGraceMinutes, 30, "a window that did not exist before gets its default");
});

test("minutes win when both are present, so a re-save is never undone by the old keys", () => {
  const c = coerceBookingRulesConfig({
    bufferMinutes: 15,
    minNoticeHours: 2,
    maxAdvanceDays: 30,
    confirmRequestLeadHours: 24,
    autoCancelHours: 3,
    confirmRequestLeadMinutes: 90,
    autoCancelMinutes: 20,
  });
  assert.equal(c.confirmRequestLeadMinutes, 90);
  assert.equal(c.autoCancelMinutes, 20);
});

test("sub-hour windows are storable - the whole point of the change", () => {
  const c = coerceBookingRulesConfig({
    ...DEFAULT_BOOKING_RULES_CONFIG,
    confirmRequestLeadMinutes: 45,
    autoCancelMinutes: 20,
    confirmReplyGraceMinutes: 10,
  });
  assert.equal(c.confirmRequestLeadMinutes, 45);
  assert.equal(c.autoCancelMinutes, 20);
  assert.equal(c.confirmReplyGraceMinutes, 10);
});

test("a cancel window wider than the ask window is refused, not stored", () => {
  const c = coerceBookingRulesConfig({
    ...DEFAULT_BOOKING_RULES_CONFIG,
    confirmRequestLeadMinutes: 30,
    autoCancelMinutes: 120,
  });
  assert.deepEqual(c, DEFAULT_BOOKING_RULES_CONFIG, "falls back rather than asking after cancelling");
});

test("no reply grace at all is refused: a promoted call would be cancelled on the next tick", () => {
  const c = coerceBookingRulesConfig({ ...DEFAULT_BOOKING_RULES_CONFIG, confirmReplyGraceMinutes: 0 });
  assert.equal(c.confirmReplyGraceMinutes, DEFAULT_BOOKING_RULES_CONFIG.confirmReplyGraceMinutes);
});

test("asking is switched off with 0, and that is a legal pair with any cancel window", () => {
  const c = coerceBookingRulesConfig({ ...DEFAULT_BOOKING_RULES_CONFIG, confirmRequestLeadMinutes: 0 });
  assert.equal(c.confirmRequestLeadMinutes, 0);
});
