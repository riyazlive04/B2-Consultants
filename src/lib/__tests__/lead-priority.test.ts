import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  priorityScore,
  byPriority,
  DEFAULT_PRIORITY_WEIGHTS,
  type PriorityWeights,
} from "../lead-priority";
import { allocateByShare, previewSplit } from "../call-distribution";
import { DEFAULT_CALL_DISTRIBUTION } from "../config-schema";

const DAY = 86_400_000;
const NOW = new Date("2026-08-03T09:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("lead priority — the shipped weights reproduce the old hardcoded formula", () => {
  /**
   * THE SAFETY PROPERTY OF THIS REFACTOR.
   *
   * Two hardcoded rankings were replaced with one configurable scorer. If the defaults don't
   * reproduce the old arithmetic exactly, every queue silently reorders on deploy and nobody can
   * tell whether that was the refactor or the founder's settings. The old pipeline formula was:
   *
   *   stageWeight + bant*10 + (highlyQualified ? 15 : 0) + (age <= 7d ? 10 : 0)
   *                − min(max(idle - 7, 0), 20)
   */
  const legacy = (i: {
    stage: number; bant: number; hq: boolean; ageDays: number; idleDays: number;
  }) => {
    let s = i.stage;
    if (i.bant > 0) s += i.bant * 10;
    if (i.hq) s += 15;
    if (i.ageDays <= 7) s += 10;
    if (i.idleDays > 7) s -= Math.min(i.idleDays - 7, 20);
    return s;
  };

  test("matches on a grid of realistic leads", () => {
    for (const stage of [0, 10, 25, 32]) {
      for (const bant of [0, 1, 2, 3, 4]) {
        for (const hq of [false, true]) {
          for (const ageDays of [0, 3, 7, 8, 30, 200]) {
            for (const idleDays of [0, 7, 8, 20, 27, 28, 400]) {
              const { score } = priorityScore(
                {
                  bantScore: bant,
                  arrivedAt: ago(ageDays),
                  lastActivityAt: ago(idleDays),
                  highlyQualified: hq,
                  stageWeight: stage,
                },
                DEFAULT_PRIORITY_WEIGHTS,
                NOW,
              );
              assert.equal(
                score,
                legacy({ stage, bant, hq, ageDays, idleDays }),
                `stage ${stage} · bant ${bant} · hq ${hq} · age ${ageDays}d · idle ${idleDays}d`,
              );
            }
          }
        }
      }
    }
  });

  test("the config default and the scorer default are the same numbers", () => {
    // Two places declare these — a drift between them would mean the Console showed one set of
    // weights while an unconfigured install ran another.
    assert.deepEqual(DEFAULT_CALL_DISTRIBUTION.priority, DEFAULT_PRIORITY_WEIGHTS);
  });
});

describe("lead priority — an unscored lead is not a zero-scored one", () => {
  test("null BANT contributes nothing, and does not out-rank a genuine 0", () => {
    const base = { arrivedAt: ago(30), lastActivityAt: ago(30) };
    const unscored = priorityScore({ ...base, bantScore: null }, DEFAULT_PRIORITY_WEIGHTS, NOW);
    const scoredZero = priorityScore({ ...base, bantScore: 0 }, DEFAULT_PRIORITY_WEIGHTS, NOW);
    // Same score — but for different reasons, and neither claims evidence it doesn't have.
    assert.equal(unscored.score, scoredZero.score);
    assert.ok(!unscored.reasons.some((r) => r.startsWith("BANT")), "must not claim a BANT reading");
  });

  test("a scored lead outranks an unscored one that arrived at the same moment", () => {
    // The whole point of showing BANT on the desk: it has to change the order.
    const at = { arrivedAt: ago(2), lastActivityAt: null };
    const strong = priorityScore({ ...at, bantScore: 4 }, DEFAULT_PRIORITY_WEIGHTS, NOW).score;
    const unknown = priorityScore({ ...at, bantScore: null }, DEFAULT_PRIORITY_WEIGHTS, NOW).score;
    assert.ok(strong > unknown, "a 4/4 lead must rise above one nobody has asked");
  });
});

describe("lead priority — the idle penalty is capped", () => {
  test("a very old lead stays beatable rather than buried", () => {
    // Uncapped, a year-old lead would score so far negative that no amount of BANT could lift it
    // back into view — which is a decision to abandon it, not to deprioritise it.
    const ancient = priorityScore(
      { bantScore: 4, arrivedAt: ago(400), lastActivityAt: ago(400) },
      DEFAULT_PRIORITY_WEIGHTS,
      NOW,
    ).score;
    const staleUnscored = priorityScore(
      { bantScore: null, arrivedAt: ago(400), lastActivityAt: ago(400) },
      DEFAULT_PRIORITY_WEIGHTS,
      NOW,
    ).score;
    assert.ok(ancient > staleUnscored, "a strong old lead still beats a weak old lead");
    assert.equal(ancient - staleUnscored, 40, "the BANT signal survives the penalty intact");
  });
});

describe("lead priority — founder weights actually change the order", () => {
  const two = (w: PriorityWeights) => {
    const fresh = priorityScore({ bantScore: 0, arrivedAt: ago(1), lastActivityAt: ago(1) }, w, NOW).score;
    const strongOld = priorityScore({ bantScore: 4, arrivedAt: ago(60), lastActivityAt: ago(60) }, w, NOW).score;
    return { fresh, strongOld };
  };

  test("turning BANT up promotes a strong old lead over a fresh empty one", () => {
    const off = two({ ...DEFAULT_PRIORITY_WEIGHTS, bantPerPoint: 0 });
    assert.ok(off.fresh > off.strongOld, "with BANT off, freshness wins");
    const on = two({ ...DEFAULT_PRIORITY_WEIGHTS, bantPerPoint: 25 });
    assert.ok(on.strongOld > on.fresh, "turning BANT up flips it — which is the point of the dial");
  });
});

describe("lead priority — sorting is stable and deterministic", () => {
  test("ties break on arrival, oldest first", () => {
    const rows = [
      { score: 10, reasons: [], arrivedAt: ago(1) },
      { score: 10, reasons: [], arrivedAt: ago(5) },
      { score: 20, reasons: [], arrivedAt: ago(9) },
    ];
    const order = [...rows].sort(byPriority).map((r) => r.arrivedAt.getTime());
    assert.deepEqual(order, [ago(9).getTime(), ago(5).getTime(), ago(1).getTime()]);
  });
});

describe("call distribution — splitting a batch by share", () => {
  const nilofer = { userId: "n", name: "Nilofer", sharePct: 70 };
  const asma = { userId: "a", name: "Asma", sharePct: 30 };

  test("the parts always sum to exactly the batch size", () => {
    // Naive per-person rounding loses or invents leads. A hand-out that quietly assigns 199 of
    // 200 is the kind of bug nobody reports and everybody half-notices.
    for (const total of [1, 2, 3, 7, 10, 13, 50, 99, 100, 137, 200]) {
      for (const members of [
        [nilofer, asma],
        [nilofer, asma, { userId: "k", name: "Karthik", sharePct: 1 }],
        [{ userId: "x", name: "X", sharePct: 1 }, { userId: "y", name: "Y", sharePct: 1 }, { userId: "z", name: "Z", sharePct: 1 }],
      ]) {
        const alloc = allocateByShare(total, members);
        assert.equal(
          alloc.reduce((s, a) => s + a.count, 0),
          total,
          `${total} across ${members.length} members must sum exactly`,
        );
      }
    }
  });

  test("70/30 of 100 is 70 and 30", () => {
    const alloc = allocateByShare(100, [nilofer, asma]);
    assert.deepEqual(
      alloc.map((a) => [a.name, a.count]),
      [["Nilofer", 70], ["Asma", 30]],
    );
  });

  test("shares that don't total 100 are treated as relative weights", () => {
    // 5 and 2 → 71/29, which is what the engine has always done. The Pipeline card used to print
    // "5% / 2%" here, which is why this is worth pinning down.
    const alloc = allocateByShare(100, [
      { userId: "n", name: "Nilofer", sharePct: 5 },
      { userId: "a", name: "Asma", sharePct: 2 },
    ]);
    assert.deepEqual(alloc.map((a) => a.count), [71, 29]);
  });

  test("an equal three-way split of 10 loses nobody", () => {
    const alloc = allocateByShare(10, [
      { userId: "x", name: "X", sharePct: 1 },
      { userId: "y", name: "Y", sharePct: 1 },
      { userId: "z", name: "Z", sharePct: 1 },
    ]);
    assert.deepEqual(alloc.map((a) => a.count), [4, 3, 3], "the leftover goes to the first, not nowhere");
  });

  test("zero-share members are excluded — that is what 'not in the rotation' means", () => {
    const alloc = allocateByShare(10, [nilofer, { userId: "z", name: "Zero", sharePct: 0 }]);
    assert.deepEqual(alloc.map((a) => a.name), ["Nilofer"]);
    assert.equal(alloc[0].count, 10);
  });

  test("nothing to split, or nobody to split among, is empty rather than an error", () => {
    assert.deepEqual(allocateByShare(0, [nilofer]), []);
    assert.deepEqual(allocateByShare(-5, [nilofer]), []);
    assert.deepEqual(allocateByShare(10, []), []);
    assert.deepEqual(allocateByShare(10, [{ userId: "z", name: "Zero", sharePct: 0 }]), []);
  });

  test("more people than leads still hands every lead to somebody", () => {
    const alloc = allocateByShare(2, [nilofer, asma, { userId: "k", name: "K", sharePct: 30 }]);
    assert.equal(alloc.reduce((s, a) => s + a.count, 0), 2);
    assert.ok(alloc.every((a) => a.count > 0), "a zero-lead line would be noise in the audit");
  });

  test("the preview uses the same maths the hand-out does", () => {
    // The founder must never be shown a split the engine would not produce.
    assert.deepEqual(previewSplit([nilofer, asma]), allocateByShare(100, [nilofer, asma]));
  });

  test("the same inputs always produce the same split", () => {
    const members = [nilofer, asma, { userId: "k", name: "K", sharePct: 30 }];
    assert.deepEqual(allocateByShare(37, members), allocateByShare(37, members));
  });
});
