/**
 * Activity log — presentation rules and the IST clock.
 *
 * Everything here is pure and takes its instant explicitly, so no fake timers and no DB —
 * same approach as automation-quiet-hours.test.ts.
 *
 * The timestamp cases carry the weight. The founder's question is literally "what did Asma
 * do at 3pm", so a rendering that silently drifts by 5.5 hours answers it wrongly while
 * looking perfectly plausible — the failure mode this feature most needs to not have.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  activityDate,
  activityDayKey,
  activityGroup,
  activityKind,
  activityLabel,
  activityRelative,
  activityStamp,
  activityTime,
  activityVerb,
} from "../activity-actions";

describe("activityVerb / activityKind", () => {
  test("takes the trailing segment as the verb", () => {
    assert.equal(activityVerb("call.log"), "log");
    assert.equal(activityVerb("finance.income.create"), "create");
    assert.equal(activityVerb("solo"), "solo");
  });

  test("maps verbs to a tone", () => {
    assert.equal(activityKind("lead.create"), "create");
    assert.equal(activityKind("lead.update"), "update");
    assert.equal(activityKind("lead.delete"), "delete");
    assert.equal(activityKind("message.send"), "send");
    assert.equal(activityKind("user.suspend"), "auth");
  });

  test("an unknown verb is 'other', never a crash — a new action must ship without touching this file", () => {
    assert.equal(activityKind("widget.frobnicate"), "other");
    assert.equal(activityKind(""), "other");
  });
});

describe("activityLabel", () => {
  test("prefers the curated override", () => {
    assert.equal(activityLabel("call.log"), "Call logged");
    assert.equal(activityLabel("finance.income.create"), "Income recorded");
  });

  test("falls back to a humanised verb for anything uncurated", () => {
    assert.equal(activityLabel("widget.frobnicate"), "Widget frobnicate");
    assert.equal(activityLabel("gn.batch.create"), "Gn batch create");
  });

  test("splits camelCase inside a segment", () => {
    assert.equal(activityLabel("dailyLog.submit"), "Daily log submit");
  });

  test("groups by the leading segment", () => {
    assert.equal(activityGroup("finance.income.create"), "finance");
    assert.equal(activityGroup("call.log"), "call");
  });
});

describe("IST rendering", () => {
  // 2026-07-17T09:34:09Z === 3:04:09 PM IST the same day (+05:30).
  const at = new Date("2026-07-17T09:34:09Z");

  test("renders the IST wall clock, not UTC", () => {
    assert.equal(activityTime(at), "3:04:09 PM");
    assert.equal(activityDate(at), "Fri, 17 Jul 2026");
  });

  test("stamp is unambiguous — date, time to the second, and the zone", () => {
    assert.equal(activityStamp(at), "Fri, 17 Jul 2026 · 3:04:09 PM IST");
  });

  test("an instant late on an IST day still buckets to that IST day", () => {
    // 18:29Z is 23:59 IST on the 17th — the same IST day, despite being 'today' in UTC too.
    assert.equal(activityDayKey(new Date("2026-07-17T18:29:00Z")), "2026-07-17");
  });

  test("THE 5.5h TRAP: 20:00Z is already the NEXT IST day (01:30 IST)", () => {
    // A naive UTC bucket would file this under the 17th and the founder would look for
    // Asma's 1:30am action on the wrong day. This is the graveyard-shift case.
    assert.equal(activityDayKey(new Date("2026-07-17T20:00:00Z")), "2026-07-18");
    assert.equal(activityDate(new Date("2026-07-17T20:00:00Z")), "Sat, 18 Jul 2026");
  });

  test("an instant just before IST midnight stays on the earlier day", () => {
    // 18:29:59Z = 23:59:59 IST on the 17th; one second later is the 18th.
    assert.equal(activityDayKey(new Date("2026-07-17T18:29:59Z")), "2026-07-17");
    assert.equal(activityDayKey(new Date("2026-07-17T18:30:00Z")), "2026-07-18");
  });
});

describe("activityRelative", () => {
  const now = new Date("2026-07-17T12:00:00Z");

  test("recent seconds read as 'just now'", () => {
    assert.equal(activityRelative(new Date("2026-07-17T11:59:30Z"), now), "just now");
  });

  test("minutes, hours and days", () => {
    assert.equal(activityRelative(new Date("2026-07-17T11:48:00Z"), now), "12m ago");
    assert.equal(activityRelative(new Date("2026-07-17T09:00:00Z"), now), "3h ago");
    assert.equal(activityRelative(new Date("2026-07-14T12:00:00Z"), now), "3d ago");
  });

  test("beyond a month it falls back to the absolute date", () => {
    assert.equal(activityRelative(new Date("2026-05-01T12:00:00Z"), now), "Fri, 01 May 2026");
  });

  test("clock skew never renders a future action as 'in 3 minutes'", () => {
    // The `at` is server-stamped and `now` is read on whichever machine renders, so a
    // slightly-ahead timestamp is possible and must degrade quietly.
    assert.equal(activityRelative(new Date("2026-07-17T12:03:00Z"), now), "just now");
  });
});
