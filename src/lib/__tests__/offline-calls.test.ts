import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOCK_SKEW_TOLERANCE_MS,
  MAX_QUEUE_AGE_MS,
  MAX_SYNC_ATTEMPTS,
  clampCalledAt,
  isExhausted,
  syncLagLabel,
  syncLagMs,
} from "../offline-calls";

/**
 * These rules guard the one column in the app where a client's clock is trusted. The tests
 * below are written from the attack side as much as the happy path: the interesting cases are
 * a phone that claims the future, a queue that claims last month, and a retry that must not
 * become a second call.
 */

const RECEIVED = new Date("2026-07-22T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("a plausible offline claim is stored exactly as the device reported it", () => {
  // 40 minutes of lost signal — the ordinary case this feature exists for.
  const claimed = new Date(RECEIVED.getTime() - 40 * MIN);
  const r = clampCalledAt(claimed, RECEIVED);

  assert.equal(r.calledAt.toISOString(), claimed.toISOString());
  assert.equal(r.adjusted, null, "an ordinary offline call must not be adjusted");
});

test("ordinary clock drift is forgiven rather than flagged as tampering", () => {
  // A phone a minute fast is normal; treating it as an attack would flag real calls.
  const claimed = new Date(RECEIVED.getTime() + 60_000);
  const r = clampCalledAt(claimed, RECEIVED);

  assert.equal(r.adjusted, null);
  assert.equal(r.calledAt.toISOString(), claimed.toISOString());
});

test("a call claimed in the future is pulled back to its arrival instant", () => {
  // A call cannot be completed after we heard about it. Beyond drift tolerance the only
  // defensible value is "when it actually arrived".
  const claimed = new Date(RECEIVED.getTime() + CLOCK_SKEW_TOLERANCE_MS + MIN);
  const r = clampCalledAt(claimed, RECEIVED);

  assert.equal(r.adjusted, "future");
  assert.equal(r.calledAt.toISOString(), RECEIVED.toISOString());
  // The claim survives for the audit trail — clamping must not erase what was asserted.
  assert.equal(r.claimed.toISOString(), claimed.toISOString());
});

test("a back-dated clock cannot manufacture a 5-minute connection", () => {
  // The metric-gaming case: a device set back an hour claims it rang the lead moments after
  // it arrived. It is still clamped only if implausible — an hour ago IS plausible, so this
  // one is accepted and it is `syncedAt` on the row, not the clamp, that exposes it.
  const claimed = new Date(RECEIVED.getTime() - HOUR);
  const r = clampCalledAt(claimed, RECEIVED);

  assert.equal(r.adjusted, null);
  // The defence is that the row is MARKED as synced late; assert the lag is visible.
  assert.equal(syncLagMs(r.calledAt, RECEIVED), HOUR);
  assert.equal(syncLagLabel(syncLagMs(r.calledAt, RECEIVED)), "synced 1h late");
});

test("a stale queue cannot rewrite last month's numbers", () => {
  const claimed = new Date(RECEIVED.getTime() - 30 * DAY);
  const r = clampCalledAt(claimed, RECEIVED);

  assert.equal(r.adjusted, "too-old");
  assert.equal(r.calledAt.toISOString(), new Date(RECEIVED.getTime() - MAX_QUEUE_AGE_MS).toISOString());
});

test("the age boundary is inclusive, so a week-old call still lands unadjusted", () => {
  const exactly = new Date(RECEIVED.getTime() - MAX_QUEUE_AGE_MS);
  assert.equal(clampCalledAt(exactly, RECEIVED).adjusted, null);

  const justOver = new Date(RECEIVED.getTime() - MAX_QUEUE_AGE_MS - 1000);
  assert.equal(clampCalledAt(justOver, RECEIVED).adjusted, "too-old");
});

test("clamping never drops the call — every path yields a usable calledAt", () => {
  for (const claimed of [
    new Date(RECEIVED.getTime() + 10 * DAY), // absurd future
    new Date(RECEIVED.getTime() - 400 * DAY), // absurd past
    RECEIVED,
  ]) {
    const r = clampCalledAt(claimed, RECEIVED);
    assert.ok(r.calledAt instanceof Date && !Number.isNaN(r.calledAt.getTime()));
    // and always inside the possible window
    assert.ok(r.calledAt.getTime() <= RECEIVED.getTime() + CLOCK_SKEW_TOLERANCE_MS);
    assert.ok(r.calledAt.getTime() >= RECEIVED.getTime() - MAX_QUEUE_AGE_MS);
  }
});

test("sync lag is never negative", () => {
  // A future claim clamped to arrival must read as 0 late, not as a negative duration.
  assert.equal(syncLagMs(new Date(RECEIVED.getTime() + HOUR), RECEIVED), 0);
});

test("a flaky-connection recovery is not badged as offline work", () => {
  assert.equal(syncLagLabel(30_000), null, "under a minute is not worth a badge");
  assert.equal(syncLagLabel(5 * MIN), "synced 5m late");
  assert.equal(syncLagLabel(3 * HOUR), "synced 3h late");
  assert.equal(syncLagLabel(2 * DAY), "synced 2d late");
});

test("an entry that can never land is eventually given up on", () => {
  // Otherwise one permanently-rejected row (deleted lead, retired enum value) blocks the
  // queue behind it forever.
  assert.equal(isExhausted({ clientKey: "k", leadId: "l", outcome: "SPOKE", notes: "", recordedAt: "", attempts: 0 }), false);
  assert.equal(isExhausted({ clientKey: "k", leadId: "l", outcome: "SPOKE", notes: "", recordedAt: "", attempts: MAX_SYNC_ATTEMPTS }), true);
});
