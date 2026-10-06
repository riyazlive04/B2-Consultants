import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  classifyTick,
  collectDelivery,
  coerceDeliveryState,
  deadTickThreshold,
  degradedVerdict,
  describeDelivery,
  emptyDeliveryState,
  emptyTally,
  foldDelivery,
  mergeTallies,
  RE_ALERT_COOLDOWN_MS,
  tallyLateFailures,
  tallySend,
  type DeliveryStateJson,
  type DeliveryTally,
} from "../delivery-health";

/**
 * What these tests pin down is the asymmetry that makes this feature safe to arm: a channel that
 * is genuinely dead must surface in ~10 minutes, and Meta's per-recipient marketing cap must NEVER
 * surface as an outage however many prospects it hits. Those two requirements pull in opposite
 * directions, and getting the balance wrong in either direction is what kept the October 2026
 * incident invisible (too quiet) or would make the new alert unreadable (too loud).
 *
 * Every error string below is copied verbatim from the code or from a live production row.
 */

const META_CAP =
  "Message undeliverable as Meta has restricted it for higher quality messaging - retry again in a few days";
const ALLOWLIST = "OUTBOUND_ALLOWLIST is set, and this whatsapp recipient is not on it - skipped, not sent";
const T0 = "2026-10-03T00:00:00.000Z";
const at = (msFromT0: number) => new Date(Date.parse(T0) + msFromT0).toISOString();
const MIN = 60_000;

function failing(n: number, error: string): DeliveryTally {
  const t = emptyTally();
  for (let i = 0; i < n; i++) tallySend(t, { sent: false, failed: true, error });
  return t;
}

// ───────────────────────────────── classifyFailure ─────────────────────────────────

test("classifyFailure: Meta's cap is a recipient failure, never systemic", () => {
  assert.equal(classifyFailure(META_CAP), "recipient");
  assert.equal(classifyFailure("restricted it for higher quality messaging"), "recipient");
});

test("classifyFailure: the local allowlist block is suppressed, not a failure", () => {
  assert.equal(classifyFailure(ALLOWLIST), "suppressed");
});

test("classifyFailure: credentials, timeouts and provider 5xx are systemic", () => {
  assert.equal(classifyFailure("WATI request timed out"), "systemic");
  assert.equal(classifyFailure("HTTP 503"), "systemic");
  assert.equal(classifyFailure("Invalid authorization header"), "systemic");
  assert.equal(classifyFailure("connect ECONNREFUSED 127.0.0.1:9"), "systemic");
  // Resend's send-only-key rejection - the one that blocked diagnosis in October.
  assert.equal(classifyFailure("This API key is restricted to only send emails"), "systemic");
});

test("classifyFailure: an unflipped switch is config, which never escalates", () => {
  assert.equal(classifyFailure('No WATI template configured for "Stage · WhatsApp Sent"'), "config");
  assert.equal(classifyFailure('Template "b2_sop_intro" is REJECTED in WATI'), "config");
  assert.equal(
    classifyFailure('Template "b2_sop_intro" expects {{sender}}, which "SOP 3" cannot supply.'),
    "config",
  );
  assert.equal(
    classifyFailure('Template "b2_sss_rescheduled" needs {{slot_time}}, and this contact has no value for it.'),
    "config",
  );
});

/**
 * Every string in this block was read out of the live `whatsapp_message.error` /
 * `message.error` columns on 3 Oct 2026, with its real frequency. Two of them were misclassified
 * by the first cut of `classifyFailure`, and both would have paged somebody: WATI's "typos or
 * blank text" is a param-list typo fixed in Settings, and Resend's unverified-sender rejection
 * says "not authorized", which does not contain "unauthorized".
 */
test("classifyFailure: the real production strings, with their live counts", () => {
  // 33 rows - the October incident.
  assert.equal(classifyFailure(META_CAP), "recipient");
  // 3 rows - a param-list defect, NOT an outage.
  assert.equal(classifyFailure("Check your template, it cannot have typos or blank text"), "config");
  // 58 rows - every historical email failure on live. A genuine outage.
  assert.equal(
    classifyFailure("This API key is not authorized to send emails from sirahagents.com"),
    "systemic",
  );
  // SKIPPED rows never reach the tally, but classify them anyway so a future caller is safe.
  assert.equal(classifyFailure('No WATI template configured for "Stage · WhatsApp Sent"'), "config");
  assert.equal(
    classifyFailure('Template "b2_sop_intro" expects {{sender}}, which "SOP 3 · WhatsApp intro" cannot supply. Fix the variable list in WhatsApp → Settings.'),
    "config",
  );
  assert.equal(
    classifyFailure('Template "b2_sss_rescheduled" needs {{slot_time}}, and this contact has no value for it - they have no live booked call.'),
    "config",
  );
});

test("classifyFailure: a config-only outage is visible but never escalates", () => {
  // 10 consecutive ticks of nothing but template typos must NOT declare the channel dead.
  let state = null as Parameters<typeof foldDelivery>[0];
  for (let i = 0; i < 15; i++) {
    const r = foldDelivery(state, failing(4, "Check your template, it cannot have typos or blank text"), at(i * MIN), "whatsapp");
    state = r.next;
    assert.equal(r.channelDead, false, `tick ${i}`);
    assert.equal(r.crossedDead, false, `tick ${i}`);
  }
});

test("classifyFailure: an empty or unrecognised error is unknown", () => {
  assert.equal(classifyFailure(null), "unknown");
  assert.equal(classifyFailure("   "), "unknown");
  assert.equal(classifyFailure("something nobody has seen before"), "unknown");
});

// ───────────────────────────────── classifyTick ─────────────────────────────────

test("classifyTick: nothing attempted is idle, not a failure", () => {
  assert.equal(classifyTick(emptyTally()), "idle");
});

test("classifyTick: an all-allowlist tick is idle - a dev machine must not look like an outage", () => {
  assert.equal(classifyTick(failing(12, ALLOWLIST)), "idle");
});

test("classifyTick: ACCEPTANCE - 40 Meta-cap failures and zero sends is degraded, never dead", () => {
  const t = failing(40, META_CAP);
  assert.equal(classifyTick(t), "degraded");
  // And it must not be able to reach dead through the streak either, at any length.
  let state: DeliveryStateJson | null = null;
  for (let i = 0; i < 30; i++) {
    const r = foldDelivery(state, failing(40, META_CAP), at(i * MIN), "whatsapp");
    state = r.next;
    assert.equal(r.crossedDead, false, `tick ${i} must not alert`);
    assert.equal(r.channelDead, false, `tick ${i} must not be dead`);
  }
});

test("classifyTick: one success caps the verdict at degraded, however many failed", () => {
  const t = failing(50, "HTTP 503");
  tallySend(t, { sent: true, failed: false });
  assert.equal(classifyTick(t), "degraded");
});

test("classifyTick: all sends succeeding is healthy", () => {
  const t = emptyTally();
  tallySend(t, { sent: true, failed: false });
  assert.equal(classifyTick(t), "healthy");
});

test("classifyTick: zero sent with a systemic failure is a dead candidate", () => {
  assert.equal(classifyTick(failing(3, "Invalid authorization header")), "dead-candidate");
});

test("classifyTick: zero sent with only config failures stays degraded - not-armed owns those", () => {
  assert.equal(classifyTick(failing(17, 'No WATI template configured for "Stage · New lead"')), "degraded");
});

test("classifyTick: an unknown-cause total failure still escalates", () => {
  assert.equal(classifyTick(failing(4, "something nobody has seen before")), "dead-candidate");
});

test("classifyTick: late (async) failures count even when the tick attempted nothing", () => {
  const t = emptyTally();
  tallyLateFailures(t, 6, "Invalid authorization header");
  assert.equal(classifyTick(t), "dead-candidate");
  // ...but a late Meta cap still must not escalate.
  const cap = emptyTally();
  tallyLateFailures(cap, 6, META_CAP);
  assert.equal(classifyTick(cap), "degraded");
});

// ───────────────────────────────── tally plumbing ─────────────────────────────────

test("tallySend: a send that reached nobody and failed nothing is not counted at all", () => {
  const t = emptyTally();
  tallySend(t, { sent: false, failed: false });
  assert.equal(t.attempted, 0);
});

test("tallySend: firstError is the first one and is capped", () => {
  const t = emptyTally();
  tallySend(t, { sent: false, failed: true, error: "first" });
  tallySend(t, { sent: false, failed: true, error: "second" });
  assert.equal(t.firstError, "first");
  const long = emptyTally();
  tallySend(long, { sent: false, failed: true, error: "x".repeat(900) });
  assert.equal(long.firstError?.length, 300);
});

test("mergeTallies: sums counts and keeps the first error", () => {
  const a = failing(2, "HTTP 503");
  const b = failing(3, META_CAP);
  const m = mergeTallies(a, b, null, undefined);
  assert.equal(m.attempted, 5);
  assert.equal(m.failed, 5);
  assert.equal(m.byClass.systemic, 2);
  assert.equal(m.byClass.recipient, 3);
  assert.equal(m.firstError, "HTTP 503");
});

// ───────────────────────────────── collectDelivery ─────────────────────────────────

test("collectDelivery: finds the tally in the real /api/cron/whatsapp payload shape", () => {
  const payload = { run: { reminders: 3, delivery: failing(2, "HTTP 503") }, bookings: { error: "x" } };
  const got = collectDelivery(payload);
  assert.equal(got?.failed, 2);
  assert.equal(got?.byClass.systemic, 2);
});

test("collectDelivery: merges several tallies in the /api/cron/outreach payload shape", () => {
  const payload = {
    sop: { delivery: failing(2, "HTTP 503") },
    callbackChase: { delivery: failing(1, META_CAP) },
    stageMessages: { skipped: 4 },
  };
  const got = collectDelivery(payload);
  assert.equal(got?.attempted, 3);
  assert.equal(got?.byClass.systemic, 2);
  assert.equal(got?.byClass.recipient, 1);
});

test("collectDelivery: a payload with no tally yields null, so nothing is inferred", () => {
  assert.equal(collectDelivery({ ok: true, purged: 3 }), null);
  assert.equal(collectDelivery(null), null);
  assert.equal(collectDelivery("a string"), null);
});

test("collectDelivery: a self-referencing payload terminates", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  cyclic.delivery = failing(1, "HTTP 503");
  assert.equal(collectDelivery(cyclic)?.failed, 1);
});

test("collectDelivery: respects the depth guard", () => {
  // Depth 4 is past the limit, so this one is deliberately NOT found.
  assert.equal(collectDelivery({ a: { b: { c: { d: failing(1, "HTTP 503") } } } }), null);
});

test("collectDelivery: a tally missing byClass after a JSON round trip is normalised", () => {
  const raw = JSON.parse(JSON.stringify({ delivery: { attempted: 2, sent: 0, failed: 2 } }));
  const got = collectDelivery(raw);
  assert.equal(got?.failed, 2);
  assert.equal(got?.byClass.unknown, 0);
  assert.equal(got?.byClass.systemic, 0);
});

// ───────────────────────────────── foldDelivery ─────────────────────────────────

test("foldDelivery: reaches dead at exactly the threshold, and alerts once", () => {
  const job = "whatsapp";
  const threshold = deadTickThreshold(job);
  assert.equal(threshold, 10);

  let state: DeliveryStateJson | null = null;
  for (let i = 1; i < threshold; i++) {
    const r = foldDelivery(state, failing(3, "Invalid authorization header"), at(i * MIN), job);
    state = r.next;
    assert.equal(r.channelDead, false, `tick ${i} should not be dead yet`);
    assert.equal(r.crossedDead, false, `tick ${i} should not alert`);
  }
  const hit = foldDelivery(state, failing(3, "Invalid authorization header"), at(threshold * MIN), job);
  state = hit.next;
  assert.equal(hit.channelDead, true);
  assert.equal(hit.crossedDead, true, "the threshold tick alerts");

  // Still dead, but silent until the cooldown elapses.
  const after = foldDelivery(state, failing(3, "Invalid authorization header"), at((threshold + 1) * MIN), job);
  assert.equal(after.channelDead, true);
  assert.equal(after.crossedDead, false, "no second alert inside the cooldown");
});

test("foldDelivery: the cooldown re-states a still-dead channel at 6h, not before", () => {
  const job = "alerts"; // threshold 3, quicker to drive
  let state: DeliveryStateJson | null = null;
  for (let i = 1; i <= 3; i++) state = foldDelivery(state, failing(2, "HTTP 503"), at(i * MIN), job).next;
  assert.ok(state?.alertedAt, "alerted on reaching dead");

  // The cooldown runs from the moment we alerted, not from the start of the outage.
  const alertedMs = Date.parse(state!.alertedAt!) - Date.parse(T0);

  const justShy = foldDelivery(state, failing(2, "HTTP 503"), at(alertedMs + RE_ALERT_COOLDOWN_MS - MIN), job);
  assert.equal(justShy.crossedDead, false, "one minute short of 6h is still silent");

  const due = foldDelivery(state, failing(2, "HTTP 503"), at(alertedMs + RE_ALERT_COOLDOWN_MS), job);
  assert.equal(due.crossedDead, true, "at 6h exactly it re-states");
});

test("foldDelivery: one successful send resets the streak and reports recovery", () => {
  const job = "alerts";
  let state: DeliveryStateJson | null = null;
  for (let i = 1; i <= 3; i++) state = foldDelivery(state, failing(2, "HTTP 503"), at(i * MIN), job).next;
  assert.equal(state?.deadSince !== null, true);

  const ok = emptyTally();
  tallySend(ok, { sent: true, failed: false });
  const r = foldDelivery(state, ok, at(10 * MIN), job);
  assert.equal(r.channelDead, false);
  assert.equal(r.recovered, true, "closes the loop so nobody has to guess");
  assert.equal(r.next?.deadTicks, 0);
  assert.equal(r.next?.deadSince, null);
  assert.equal(r.next?.alertedAt, null);
});

test("foldDelivery: recovery is not reported when we never alerted", () => {
  const ok = emptyTally();
  tallySend(ok, { sent: true, failed: false });
  const r = foldDelivery(emptyDeliveryState(T0), ok, at(MIN), "whatsapp");
  assert.equal(r.recovered, false);
});

test("foldDelivery: a tick with no tally leaves state alone but keeps a dead channel dead", () => {
  const job = "alerts";
  let state: DeliveryStateJson | null = null;
  for (let i = 1; i <= 3; i++) state = foldDelivery(state, failing(2, "HTTP 503"), at(i * MIN), job).next;
  const r = foldDelivery(state, null, at(20 * MIN), job);
  assert.equal(r.channelDead, true, "silence must not resurrect it");
  assert.equal(r.next, state);
});

test("foldDelivery: a once-a-day engine reaches dead by the 24h window, with no streak", () => {
  const job = "daily";
  // One failing send per hourly tick: never enough consecutive ticks for `daily`'s threshold of 2
  // to be the cause here, so drive it with single failures separated by idle ticks.
  let state: DeliveryStateJson | null = null;
  const idle = emptyTally();
  for (let i = 0; i < 5; i++) {
    state = foldDelivery(state, failing(1, "HTTP 500"), at(i * 3 * 60 * MIN), job).next;
    state = foldDelivery(state, idle, at((i * 3 + 1) * 60 * MIN), job).next;
  }
  const r = foldDelivery(state, emptyTally(), at(16 * 60 * MIN), job);
  assert.equal(r.channelDead, true, "5 real attempts, zero sent, over 2h old");
});

test("foldDelivery: the window path excludes recipient failures, so a capped week is not an outage", () => {
  const job = "whatsapp";
  let state: DeliveryStateJson | null = null;
  for (let i = 0; i < 20; i++) {
    const r = foldDelivery(state, failing(5, META_CAP), at(i * 30 * MIN), job);
    state = r.next;
    assert.equal(r.channelDead, false, `tick ${i}`);
  }
});

test("foldDelivery: the 24h window rolls rather than accumulating forever", () => {
  const job = "whatsapp";
  const first = foldDelivery(null, failing(2, "HTTP 503"), T0, job);
  const later = foldDelivery(first.next, failing(1, "HTTP 503"), at(25 * 60 * MIN), job);
  assert.equal(later.next?.window.attempted, 1, "the old window was dropped");
});

// ───────────────────────────────── state coercion ─────────────────────────────────

test("coerceDeliveryState: an absent or junk row upgrades silently", () => {
  assert.equal(coerceDeliveryState(undefined, T0), null);
  assert.equal(coerceDeliveryState("nonsense", T0), null);
  const got = coerceDeliveryState({ deadTicks: -4, lastClass: "bogus", window: {} }, T0);
  assert.equal(got?.deadTicks, 0);
  assert.equal(got?.lastClass, null);
  assert.equal(got?.window.since, T0);
});

test("coerceDeliveryState: survives a JSON round trip of real state", () => {
  const r = foldDelivery(null, failing(2, META_CAP), T0, "whatsapp");
  const round = coerceDeliveryState(JSON.parse(JSON.stringify(r.next)), T0);
  assert.deepEqual(round, r.next);
});

// ───────────────────────────────── the degraded gate ─────────────────────────────────

/**
 * This gate is what stops the Console card becoming wallpaper. The first version of this feature
 * called a channel degraded on ANY failure in 24h, which meant one stale phone number out of
 * hundreds of sends pinned a warning up for a full day.
 */
test("degradedVerdict: a couple of bad numbers out of hundreds is normal operations", () => {
  assert.equal(degradedVerdict({ attempted: 400, failed: 2 }, T0, Date.parse(T0)), false);
  // Below the rate floor even though the count is well past the minimum.
  assert.equal(degradedVerdict({ attempted: 400, failed: 20 }, T0, Date.parse(T0)), false);
});

test("degradedVerdict: a material share of failures is degraded", () => {
  assert.equal(degradedVerdict({ attempted: 196, failed: 38 }, T0, Date.parse(T0)), true);
});

test("degradedVerdict: a resolved wobble ages out after 6h", () => {
  const w = { attempted: 61, failed: 60 };
  assert.equal(degradedVerdict(w, T0, Date.parse(T0) + 5 * 60 * 60_000), true);
  assert.equal(degradedVerdict(w, T0, Date.parse(T0) + 7 * 60 * 60_000), false);
});

test("degradedVerdict: never degraded without a recorded failure time", () => {
  assert.equal(degradedVerdict({ attempted: 50, failed: 50 }, null, Date.parse(T0)), false);
});

test("foldDelivery: records when something last failed, for that recency gate", () => {
  const r = foldDelivery(null, failing(3, "HTTP 503"), T0, "whatsapp");
  assert.equal(r.next?.lastFailureAt, T0);
  // A clean tick does not move it - the gate asks "when did it last BREAK".
  const ok = emptyTally();
  tallySend(ok, { sent: true, failed: false });
  const after = foldDelivery(r.next, ok, at(MIN), "whatsapp");
  assert.equal(after.next?.lastFailureAt, T0);
  assert.equal(after.next?.lastSentAt, at(MIN));
});

// ───────────────────────────────── copy ─────────────────────────────────

test("describeDelivery: the dead copy names the consequence and where to look", () => {
  const got = describeDelivery({
    job: "whatsapp",
    channel: "whatsapp",
    state: "dead",
    deadSinceMs: 3 * 60 * MIN + 20 * MIN,
    attempted: 412,
    sent: 0,
    failed: 412,
    recipientFailed: 0,
    lastError: "Invalid authorization header",
  });
  assert.match(got!.title, /WhatsApp \(WATI\) has sent nothing for 3 h 20 m/);
  assert.match(got!.body, /412 messages attempted and every one failed/);
  assert.match(got!.body, /Invalid authorization header/);
  assert.match(got!.body, /Console → System/);
});

test("describeDelivery: the degraded copy offers no fix, because there isn't one", () => {
  const got = describeDelivery({
    job: "whatsapp",
    channel: "whatsapp",
    state: "degraded",
    deadSinceMs: null,
    attempted: 196,
    sent: 158,
    failed: 38,
    recipientFailed: 31,
    lastError: META_CAP,
  });
  assert.match(got!.title, /refusing some messages/);
  assert.match(got!.body, /38 of 196 sends failed/);
  assert.match(got!.body, /per-recipient cap on 31 of them/);
  assert.doesNotMatch(got!.body, /Console → System/);
});

test("describeDelivery: a healthy or idle channel says nothing at all", () => {
  const base = {
    job: "whatsapp" as const,
    channel: "whatsapp" as const,
    deadSinceMs: null,
    attempted: 10,
    sent: 10,
    failed: 0,
    recipientFailed: 0,
    lastError: null,
  };
  assert.equal(describeDelivery({ ...base, state: "healthy" }), null);
  assert.equal(describeDelivery({ ...base, state: "idle" }), null);
});
