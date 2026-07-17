/**
 * Daily Log derivation — the layer that turns stored integers into a readable, graded entry.
 *
 * Everything under test is pure and takes `today`/`targets` explicitly, so no DB and no fake
 * timers — same approach as automation-quiet-hours.test.ts.
 *
 * The grading fork (target set vs. fall back to the person's own recent average) is the part
 * that's easy to get wrong, so it gets the most cases.
 *
 * Run: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildLogEntries,
  describeLog,
  deriveStatus,
  looksLikeBlocker,
  median,
  metricsFor,
  type DailyTargets,
  type RawLog,
} from "../daily-log";

const TARGETS: DailyTargets = {
  DISCOVERY_SPECIALIST: 5,
  APPOINTMENT_SETTER: 3,
  DELIVERY_COACH: 4,
};
const NO_TARGETS: DailyTargets = {
  DISCOVERY_SPECIALIST: 0,
  APPOINTMENT_SETTER: 0,
  DELIVERY_COACH: 0,
};

/** A UTC-midnight day, the @db.Date encoding of an IST day. */
const day = (d: number) => new Date(Date.UTC(2026, 6, d));
const TODAY = day(17);

function rawLog(over: Partial<RawLog> & { id: string; date: Date; values: Record<string, number> }): RawLog {
  return {
    userId: "u1",
    userName: "Asma",
    createdAt: new Date(Date.UTC(2026, 6, 17, 12, 42)), // 6:12 PM IST
    variant: "DISCOVERY_SPECIALIST",
    notes: null,
    correctionNote: null,
    autoCapturedKeys: null,
    ...over,
  };
}

describe("median", () => {
  test("empty list is 0", () => assert.equal(median([]), 0));
  test("odd length takes the middle", () => assert.equal(median([5, 1, 3]), 3));
  test("even length averages the two middles", () => assert.equal(median([1, 2, 3, 4]), 2.5));
});

describe("describeLog", () => {
  test("reads as a sentence, not a row of numbers", () => {
    assert.equal(
      describeLog("DISCOVERY_SPECIALIST", { discoveryCallsCompleted: 6, highlyQualifiedCalls: 3, proposalsSent: 2 }),
      "6 discovery calls, 3 highly qualified, and 2 proposals sent.",
    );
  });
  test("singularises a count of one", () => {
    assert.equal(
      describeLog("DISCOVERY_SPECIALIST", { discoveryCallsCompleted: 1, proposalsSent: 1 }),
      "1 discovery call, and 1 proposal sent.",
    );
  });
  test("a coach's day describes sessions, not calls", () => {
    assert.match(describeLog("DELIVERY_COACH", { sessionsDelivered: 4 }), /^4 sessions delivered\.$/);
  });
  test("an empty day still says something", () => {
    assert.equal(describeLog("DISCOVERY_SPECIALIST", {}), "Logged the day — no numbers recorded.");
  });
});

describe("deriveStatus — against a founder target", () => {
  const at = (v: number) =>
    deriveStatus({ variant: "DISCOVERY_SPECIALIST", values: { discoveryCallsCompleted: v }, baseline: 0, target: 5 });

  test("meeting the target is On target", () => {
    const s = at(5);
    assert.equal(s.key, "ontarget");
    assert.equal(s.tone, "good");
    assert.match(s.context, /Met your daily target of 5 calls/);
  });
  test("comfortably over is a Standout day", () => {
    const s = at(7); // 1.4x
    assert.equal(s.key, "standout");
    assert.equal(s.tone, "good");
    assert.match(s.context, /40% above/);
  });
  test("a little under is Below par, amber", () => {
    const s = at(3); // 0.6x
    assert.equal(s.key, "belowpar");
    assert.equal(s.tone, "warn");
  });
  test("well under is Below par, red", () => {
    const s = at(2); // 0.4x
    assert.equal(s.key, "belowpar");
    assert.equal(s.tone, "bad");
  });
  test("a zero day is Quiet and asks the question", () => {
    const s = at(0);
    assert.equal(s.key, "quiet");
    assert.match(s.context, /blocker day/);
  });
  test("just inside the on-target band (0.85x) still counts", () => {
    assert.equal(at(4.25 as number).key, "ontarget");
  });
});

describe("deriveStatus — falling back to the person's own average", () => {
  test("with no target, it grades against the baseline and says so", () => {
    const s = deriveStatus({
      variant: "DISCOVERY_SPECIALIST",
      values: { discoveryCallsCompleted: 8 },
      baseline: 4,
      target: 0,
    });
    assert.equal(s.key, "standout");
    assert.match(s.context, /recent average of 4 calls/);
  });

  test("no target and no history yet: recorded, not judged", () => {
    const s = deriveStatus({
      variant: "DISCOVERY_SPECIALIST",
      values: { discoveryCallsCompleted: 3 },
      baseline: 0,
      target: 0,
    });
    assert.equal(s.key, "logged");
    assert.match(s.context, /baseline is building/);
  });

  test("a target always wins over the baseline", () => {
    const s = deriveStatus({
      variant: "DISCOVERY_SPECIALIST",
      values: { discoveryCallsCompleted: 5 },
      baseline: 20, // would be a terrible day by baseline
      target: 5,
    });
    assert.equal(s.key, "ontarget");
    assert.match(s.context, /daily target/);
  });
});

describe("metricsFor", () => {
  const metrics = metricsFor(
    "DISCOVERY_SPECIALIST",
    { discoveryCallsCompleted: 4, noShows: 1, proposalsSent: 0 },
    ["discoveryCallsCompleted"],
  );

  test("the headline metric leads the row", () => {
    assert.equal(metrics[0].key, "discoveryCallsCompleted");
    assert.equal(metrics[0].primary, true);
  });
  test("a count of one is singular", () => {
    assert.equal(metrics.find((m) => m.key === "noShows")!.unit, "no-show");
  });
  test("many is plural", () => {
    assert.equal(metrics[0].unit, "calls");
  });
  test("auto-captured fields are flagged, hand-typed ones are not", () => {
    assert.equal(metrics[0].auto, true);
    assert.equal(metrics.find((m) => m.key === "noShows")!.auto, false);
  });
  test("a recorded zero is kept, an unrecorded field is dropped", () => {
    assert.ok(metrics.some((m) => m.key === "proposalsSent" && m.value === 0));
    assert.ok(!metrics.some((m) => m.key === "highlyQualifiedCalls"));
  });
});

describe("looksLikeBlocker", () => {
  test("a real blocker is flagged", () => {
    assert.equal(looksLikeBlocker("CRM was down 1-4pm, couldn't pull the list"), true);
  });
  test("a plain note is not", () => {
    assert.equal(looksLikeBlocker("Good energy today, felt sharp on the calls"), false);
  });
  test("no note is not a blocker", () => assert.equal(looksLikeBlocker(null), false));
});

describe("buildLogEntries", () => {
  // desc order, as the callers guarantee
  const logs: RawLog[] = [
    rawLog({ id: "a", date: day(17), values: { discoveryCallsCompleted: 9 }, autoCapturedKeys: ["discoveryCallsCompleted"] }),
    rawLog({ id: "b", date: day(16), values: { discoveryCallsCompleted: 4 }, notes: "CRM outage blocked the queue" }),
    rawLog({ id: "c", date: day(10), values: { discoveryCallsCompleted: 4 }, correctionNote: "Actually 4 — one double-logged" }),
    rawLog({ id: "d", date: day(1), values: { discoveryCallsCompleted: 4 } }),
  ];
  const entries = buildLogEntries(logs, NO_TARGETS, TODAY, true);

  test("every row becomes an entry", () => assert.equal(entries.length, 4));

  test("relative days are measured from today", () => {
    assert.deepEqual(entries.map((e) => e.relDays), [0, 1, 7, 16]);
  });

  test("entries land on the right relative-date rail", () => {
    assert.deepEqual(entries.map((e) => e.bucketLabel), ["Today", "Yesterday", "Last week", "July 2026"]);
  });

  test("today is graded against the run-up before it, not including itself", () => {
    // prior days are all 4 → baseline 4; 9 is >1.3x that
    assert.equal(entries[0].status.key, "standout");
    assert.match(entries[0].status.context, /recent average of 4 calls/);
  });

  test("the oldest entry has no history behind it, so it is merely logged", () => {
    assert.equal(entries[3].status.key, "logged");
  });

  test("auto-captured keys survive the round trip", () => {
    assert.deepEqual(entries[0].autoKeys, ["discoveryCallsCompleted"]);
    assert.equal(entries[0].metrics[0].auto, true);
    assert.deepEqual(entries[1].autoKeys, []);
  });

  test("a blocker note is detected; a correction is carried through", () => {
    assert.equal(entries[1].hasBlockers, true);
    assert.equal(entries[2].correctionNote, "Actually 4 — one double-logged");
  });

  test("who/when are rendered for the team feed", () => {
    assert.equal(entries[0].person?.name, "Asma");
    assert.equal(entries[0].person?.initials, "A");
    assert.equal(entries[0].person?.role, "Discovery Specialist");
    assert.equal(entries[0].submittedTimeLabel, "6:12 PM"); // IST, not UTC
    assert.equal(entries[0].dateLabel, "Fri 17 Jul");
  });

  test("the personal view carries no person", () => {
    assert.equal(buildLogEntries(logs, NO_TARGETS, TODAY, false)[0].person, null);
  });

  test("search text is a lower-cased haystack of everything on the card", () => {
    assert.ok(entries[1].searchText.includes("crm outage"));
    assert.ok(entries[1].searchText.includes("asma"));
  });

  test("each person is graded against their own history, not the team's", () => {
    const mixed: RawLog[] = [
      rawLog({ id: "x1", userId: "u1", userName: "Asma", date: day(17), values: { discoveryCallsCompleted: 8 } }),
      rawLog({ id: "y1", userId: "u2", userName: "Nilofer", date: day(17), values: { discoveryCallsCompleted: 8 } }),
      rawLog({ id: "x2", userId: "u1", userName: "Asma", date: day(16), values: { discoveryCallsCompleted: 2 } }),
      rawLog({ id: "y2", userId: "u2", userName: "Nilofer", date: day(16), values: { discoveryCallsCompleted: 8 } }),
    ];
    const out = buildLogEntries(mixed, NO_TARGETS, TODAY, true);
    // Asma jumped 2 → 8 (standout); Nilofer held steady at 8 (on target)
    assert.equal(out.find((e) => e.id === "x1")!.status.key, "standout");
    assert.equal(out.find((e) => e.id === "y1")!.status.key, "ontarget");
  });
});
