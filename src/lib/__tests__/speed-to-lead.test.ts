import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  speedToLeadReport,
  shouldAlert,
  alertSubject,
  formatAge,
  formatHitRate,
  firstCallVerdict,
  firstCallLabel,
  type SpeedToLeadLead,
} from "../speed-to-lead";

/**
 * All times are built relative to a fixed NOW so the assertions read as "12 minutes ago" rather
 * than as timestamps. IST matters to `windowFor`, so NOW is pinned to a mid-afternoon IST instant
 * (13:30 UTC = 19:00 IST) that sits inside the JD's DAY window.
 */
const NOW = new Date("2026-08-03T13:30:00.000Z");
const MIN = 60_000;

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * MIN);
}

function lead(over: Partial<SpeedToLeadLead> & { id: string }): SpeedToLeadLead {
  return {
    name: `Lead ${over.id}`,
    optInAt: minutesAgo(30),
    connectedAt: null,
    ownerId: null,
    ownerName: null,
    ...over,
  };
}

const OPTS = { thresholdMinutes: 15, lookbackMinutes: 120 };

describe("breach detection", () => {
  test("an unconnected lead past the threshold is a breach", () => {
    const r = speedToLeadReport([lead({ id: "a", optInAt: minutesAgo(20) })], NOW, OPTS);
    assert.equal(r.breaches.length, 1);
    assert.equal(r.breaches[0]!.ageMinutes, 20);
  });

  test("a lead inside the threshold is somebody's next call, not a failure", () => {
    const r = speedToLeadReport([lead({ id: "a", optInAt: minutesAgo(9) })], NOW, OPTS);
    assert.equal(r.breaches.length, 0);
    assert.equal(r.considered, 1, "it still counts towards the denominator");
  });

  test("the threshold is inclusive at its own boundary", () => {
    const atThreshold = speedToLeadReport([lead({ id: "a", optInAt: minutesAgo(15) })], NOW, OPTS);
    const under = speedToLeadReport([lead({ id: "b", optInAt: minutesAgo(14) })], NOW, OPTS);
    assert.equal(atThreshold.breaches.length, 1);
    assert.equal(under.breaches.length, 0);
  });

  test("a connected lead is never a breach, however late the connection was", () => {
    const r = speedToLeadReport(
      [lead({ id: "a", optInAt: minutesAgo(90), connectedAt: minutesAgo(1) })],
      NOW,
      OPTS,
    );
    assert.equal(r.breaches.length, 0);
  });

  test("breaches are ordered worst-first", () => {
    const r = speedToLeadReport(
      [
        lead({ id: "young", optInAt: minutesAgo(20) }),
        lead({ id: "oldest", optInAt: minutesAgo(100) }),
        lead({ id: "middle", optInAt: minutesAgo(50) }),
      ],
      NOW,
      OPTS,
    );
    assert.deepEqual(r.breaches.map((b) => b.id), ["oldest", "middle", "young"]);
    assert.equal(r.worstAgeMinutes, 100);
  });

  test("worstAgeMinutes is 0 when nothing is breaching", () => {
    assert.equal(speedToLeadReport([], NOW, OPTS).worstAgeMinutes, 0);
  });
});

describe("the standing backlog is excluded", () => {
  /**
   * THE DESIGN CONSTRAINT. Production holds ~23,435 leads that have never been contacted. If the
   * lookback did not exclude them, this alert would fire on all of them on every tick - and be
   * muted within two days, at which point it is worse than no alert because it also carries the
   * false assurance of having been set up.
   */
  test("leads older than the lookback are not breaches, however stale", () => {
    const ancient = lead({ id: "backlog", optInAt: minutesAgo(60 * 24 * 400) });
    const r = speedToLeadReport([ancient], NOW, OPTS);
    assert.equal(r.breaches.length, 0);
    assert.equal(r.considered, 0, "and it isn't in the denominator either");
  });

  test("a huge backlog cannot drown out today's genuinely late lead", () => {
    const backlog = Array.from({ length: 5000 }, (_, i) =>
      lead({ id: `old-${i}`, optInAt: minutesAgo(60 * 24 * 30) }),
    );
    const today = lead({ id: "today", optInAt: minutesAgo(40) });
    const r = speedToLeadReport([...backlog, today], NOW, OPTS);
    assert.equal(r.breaches.length, 1);
    assert.equal(r.breaches[0]!.id, "today");
  });

  test("the lookback boundary is inclusive", () => {
    const onEdge = lead({ id: "edge", optInAt: minutesAgo(120) });
    assert.equal(speedToLeadReport([onEdge], NOW, OPTS).considered, 1);
    const justOutside = lead({ id: "out", optInAt: minutesAgo(121) });
    assert.equal(speedToLeadReport([justOutside], NOW, OPTS).considered, 0);
  });
});

describe("five-minute hit rate", () => {
  test("counts only connections inside the five-minute clock", () => {
    const r = speedToLeadReport(
      [
        // Connected 3 minutes after opting in - met.
        lead({ id: "fast", optInAt: minutesAgo(30), connectedAt: minutesAgo(27) }),
        // Connected 20 minutes after opting in - connected, but not within five.
        lead({ id: "slow", optInAt: minutesAgo(60), connectedAt: minutesAgo(40) }),
      ],
      NOW,
      OPTS,
    );
    assert.equal(r.considered, 2);
    assert.equal(r.hitRate, 0.5);
  });

  test("unconnected leads drag the rate down rather than being ignored", () => {
    const r = speedToLeadReport(
      [
        lead({ id: "fast", optInAt: minutesAgo(30), connectedAt: minutesAgo(28) }),
        lead({ id: "never", optInAt: minutesAgo(30) }),
      ],
      NOW,
      OPTS,
    );
    assert.equal(r.hitRate, 0.5);
  });

  test("no leads means no rate - not a perfect score", () => {
    // 0/0 rendered as 100% would report a flawless week during a week with no leads at all.
    assert.equal(speedToLeadReport([], NOW, OPTS).hitRate, null);
    assert.equal(formatHitRate(null), "-");
  });
});

describe("by owner", () => {
  test("groups breaches by owner, worst first", () => {
    const r = speedToLeadReport(
      [
        lead({ id: "1", optInAt: minutesAgo(20), ownerId: "u1", ownerName: "Asma" }),
        lead({ id: "2", optInAt: minutesAgo(25), ownerId: "u2", ownerName: "Nilofer" }),
        lead({ id: "3", optInAt: minutesAgo(30), ownerId: "u2", ownerName: "Nilofer" }),
      ],
      NOW,
      OPTS,
    );
    assert.deepEqual(
      r.byOwner.map((o) => [o.ownerName, o.count]),
      [["Nilofer", 2], ["Asma", 1]],
    );
  });

  test("unassigned leads are a first-class row, not a silent omission", () => {
    // On this database unassigned is expected to be the LARGEST bucket. Hiding it would make
    // the alert say the team is doing fine while thousands of leads have no owner at all.
    const r = speedToLeadReport(
      [
        lead({ id: "1", optInAt: minutesAgo(20) }),
        lead({ id: "2", optInAt: minutesAgo(22) }),
        lead({ id: "3", optInAt: minutesAgo(24), ownerId: "u1", ownerName: "Asma" }),
      ],
      NOW,
      OPTS,
    );
    assert.deepEqual(
      r.byOwner.map((o) => [o.ownerName, o.count]),
      [["Unassigned", 2], ["Asma", 1]],
    );
    assert.equal(r.byOwner[0]!.ownerId, null);
  });
});

describe("alert policy", () => {
  const withBreaches = (n: number) =>
    speedToLeadReport(
      Array.from({ length: n }, (_, i) => lead({ id: `b${i}`, optInAt: minutesAgo(20 + i) })),
      NOW,
      OPTS,
    );

  test("fires at or above the minimum, not below it", () => {
    assert.equal(shouldAlert(withBreaches(2), 3), false);
    assert.equal(shouldAlert(withBreaches(3), 3), true);
    assert.equal(shouldAlert(withBreaches(9), 3), true);
  });

  test("never fires on zero breaches, even with a minimum of zero", () => {
    // A minimum of 0 would otherwise mean "alert on every tick, forever".
    assert.equal(shouldAlert(withBreaches(0), 0), false);
  });
});

describe("formatting", () => {
  test("ages read the way a person would say them", () => {
    assert.equal(formatAge(0), "0 min");
    assert.equal(formatAge(45), "45 min");
    assert.equal(formatAge(60), "1 h");
    assert.equal(formatAge(135), "2 h 15 min");
    assert.equal(formatAge(1440), "1 d");
    assert.equal(formatAge(1740), "1 d 5 h");
  });

  test("hit rates round to whole percents", () => {
    assert.equal(formatHitRate(0), "0%");
    assert.equal(formatHitRate(0.666), "67%");
    assert.equal(formatHitRate(1), "100%");
  });

  test("the subject line agrees with the report it describes", () => {
    const r = speedToLeadReport(
      [
        lead({ id: "a", optInAt: minutesAgo(20) }),
        lead({ id: "b", optInAt: minutesAgo(95) }),
      ],
      NOW,
      OPTS,
    );
    assert.equal(alertSubject(r), "2 leads waiting - oldest 1 h 35 min");
  });

  test("the subject line is singular for one lead", () => {
    const r = speedToLeadReport([lead({ id: "a", optInAt: minutesAgo(20) })], NOW, OPTS);
    assert.equal(alertSubject(r), "1 lead waiting - oldest 20 min");
  });
});

describe("firstCallVerdict - the board card's green / red rule", () => {
  const at = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * MIN);

  test("called inside five minutes is HIT, with the delta in minutes", () => {
    const v = firstCallVerdict(at(10), at(7), NOW); // opted in 10 min ago, called 3 min later
    assert.equal(v.state, "HIT");
    assert.equal(v.minutes, 3);
    assert.equal(firstCallLabel(v), "Called in 3 min");
  });

  test("exactly five minutes still counts - the target is 'within', not 'under'", () => {
    assert.equal(firstCallVerdict(at(10), at(5), NOW).state, "HIT");
  });

  test("called after five minutes is LATE, however long ago the call was", () => {
    const v = firstCallVerdict(at(60), at(48), NOW); // 12 min to the call
    assert.equal(v.state, "LATE");
    assert.equal(v.minutes, 12);
    assert.equal(firstCallLabel(v), "Called after 12 min");
  });

  test("not called and under five minutes old is DUE with a countdown", () => {
    const v = firstCallVerdict(at(2), null, NOW);
    assert.equal(v.state, "DUE");
    assert.equal(v.secondsLeft, 180);
    assert.equal(firstCallLabel(v), "Call due - 3:00 left");
  });

  test("not called and past five minutes is OVERDUE, reporting the age", () => {
    const v = firstCallVerdict(at(18), null, NOW);
    assert.equal(v.state, "OVERDUE");
    assert.equal(v.minutes, 18);
    assert.equal(v.secondsLeft, null);
    assert.equal(firstCallLabel(v), "Not called - 18 min");
  });

  test("a call stamped before the opt-in (clock skew) is a zero-minute HIT, never negative", () => {
    const v = firstCallVerdict(at(5), at(6), NOW);
    assert.equal(v.state, "HIT");
    assert.equal(v.minutes, 0);
  });
});
