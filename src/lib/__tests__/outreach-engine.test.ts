/**
 * Outreach SOP — timing, branch and data-integrity tests.
 *
 * Maps to the QA checklist's Steps 2–5. The engine is pure, so every SLA boundary is tested by
 * passing `now` explicitly — no fake timers, no DB, no flake. Each timing case is checked at
 * boundary−1min / boundary / boundary+1min, which is what the checklist asks for ("test the
 * boundary condition, not just 'roughly'").
 *
 * Run: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  planJourney,
  reactionState,
  isActionable,
  nextPhase,
  normalizeEmail,
  emailsMatch,
  type JourneyState,
  type StepState,
} from "../outreach-engine";
import {
  DEFAULT_SLA,
  qualifiedFromBant,
  qualifiedContinues,
  renderOutreachTemplate,
  unresolvedVars,
  stepBody,
  coerceOutreachConfig,
  OUTREACH_STEPS,
} from "../outreach-sop";
import type { OutreachStep } from "@prisma/client";

const MIN = 60_000;
const HR = 3_600_000;

/** A fixed clock. Chosen mid-year so any accidental DST arithmetic shows up. */
const T0 = new Date("2026-07-15T06:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function base(over: Partial<JourneyState> = {}): JourneyState {
  return {
    phase: "OPT_IN",
    optInAt: T0,
    contactedAt: null,
    discoAt: null,
    sssAt: null,
    booked: false,
    qualified: null,
    whatsappConfirmed: false,
    salesCallConfirmed: false,
    highlyQualified: null,
    steps: {},
    ...over,
  };
}

function step(over: Partial<StepState> = {}): StepState {
  return { status: "SENT", dueAt: T0, actedAt: T0, outcome: null, ...over };
}

/** Add a SENT step acted at `when`. */
function done(state: JourneyState, s: OutreachStep, when: Date, outcome: string | null = null): JourneyState {
  return { ...state, steps: { ...state.steps, [s]: step({ status: "SENT", dueAt: when, actedAt: when, outcome }) } };
}

function planned(state: JourneyState, now: Date, s: OutreachStep) {
  return planJourney(state, now, DEFAULT_SLA).materialise.find((m) => m.step === s);
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2 — Reaction time SLA (checklist §B)
// ═══════════════════════════════════════════════════════════════════

describe("Step 2 — 5-minute reaction SLA", () => {
  test("contacted at 4min → FAST branch (Step 3 path)", () => {
    const s = base({ contactedAt: at(4 * MIN) });
    assert.equal(reactionState(s, at(4 * MIN), DEFAULT_SLA).branch, "FAST");
  });

  test("contacted at exactly 5min → FAST (the SOP says 'within 5 minutes', inclusive)", () => {
    const s = base({ contactedAt: at(5 * MIN) });
    const r = reactionState(s, at(5 * MIN), DEFAULT_SLA);
    assert.equal(r.branch, "FAST");
    assert.equal(r.breached, false);
  });

  test("contacted at 5min+1s → SLOW branch (Step 10 path)", () => {
    const s = base({ contactedAt: at(5 * MIN + 1000) });
    const r = reactionState(s, at(5 * MIN + 1000), DEFAULT_SLA);
    assert.equal(r.branch, "SLOW");
    assert.equal(r.breached, true);
  });

  test("uncontacted and inside the window → PENDING, branch still undecided", () => {
    assert.equal(reactionState(base(), at(3 * MIN), DEFAULT_SLA).branch, "PENDING");
  });

  test("uncontacted past the window → SLOW", () => {
    assert.equal(reactionState(base(), at(8 * MIN), DEFAULT_SLA).branch, "SLOW");
  });

  test("'approaching' fires in the last quarter, not before", () => {
    assert.equal(reactionState(base(), at(3 * MIN), DEFAULT_SLA).approaching, false);
    assert.equal(reactionState(base(), at(4 * MIN), DEFAULT_SLA).approaching, true);
  });

  test("'approaching' stops once contacted — the clock has stopped", () => {
    const s = base({ contactedAt: at(4 * MIN) });
    assert.equal(reactionState(s, at(4 * MIN), DEFAULT_SLA).approaching, false);
  });

  test("SLA window is configurable, not hardcoded (checklist §S)", () => {
    const sla = { ...DEFAULT_SLA, reactionMinutes: 10 };
    const s = base({ contactedAt: at(8 * MIN) });
    assert.equal(reactionState(s, at(8 * MIN), DEFAULT_SLA).branch, "SLOW");
    assert.equal(reactionState(s, at(8 * MIN), sla).branch, "FAST");
  });
});

describe("Step 2 — branch routing", () => {
  test("FAST/PENDING branch materialises the Step 3 intro", () => {
    assert.ok(planned(base(), at(1 * MIN), "INTRO_WHATSAPP"));
  });

  test("SLOW branch SKIPS the intro entirely and goes straight to the Step 10 check", () => {
    const now = at(8 * MIN);
    const plan = planJourney(base(), now, DEFAULT_SLA);
    assert.equal(plan.materialise.find((m) => m.step === "INTRO_WHATSAPP"), undefined);
    assert.ok(plan.materialise.find((m) => m.step === "CHECK_1"), "late contact must jump to the booking check");
  });

  /**
   * Regression: the branch is decided once. An intro that has already gone out is proof the FAST
   * path was taken, so the ladder must stay on it even if `contactedAt` was never stamped and the
   * 5-minute window has since elapsed. Re-deriving the branch from the clock here would re-anchor
   * Check 1 to "now" and silently move a deadline that was already set.
   */
  test("an already-sent intro keeps the journey on the Step 3 path past the 5-min window", () => {
    const s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", at(1 * MIN));
    const now = at(45 * MIN); // well past the window, contactedAt still null
    assert.equal(reactionState(s, now, DEFAULT_SLA).branch, "SLOW", "the raw SLA reading is SLOW…");
    // …but the ladder must not act on that: Check 1 stays anchored to the intro, not to `now`.
    assert.equal(planned(s, now, "CHECK_1")!.dueAt.getTime(), at(1 * MIN + 2 * HR).getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEPS 5/7/9 — the booking-chase ladder (checklist §E, §G, §I)
// ═══════════════════════════════════════════════════════════════════

describe("Step 5 — Check 1 fires exactly 2h after Step 3/4", () => {
  const s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", at(1 * MIN));
  const due = planned(s, at(2 * MIN), "CHECK_1")!.dueAt;

  test("due at intro + 2h", () => {
    assert.equal(due.getTime(), at(1 * MIN + 2 * HR).getTime());
  });

  test("not actionable at boundary − 1min", () => {
    assert.equal(isActionable(step({ status: "DUE", dueAt: due }), new Date(due.getTime() - MIN)), false);
  });

  test("actionable at exactly the boundary", () => {
    assert.equal(isActionable(step({ status: "DUE", dueAt: due }), due), true);
  });

  test("actionable at boundary + 1min", () => {
    assert.equal(isActionable(step({ status: "DUE", dueAt: due }), new Date(due.getTime() + MIN)), true);
  });

  test("anchors on the LATER of Step 3 and Step 4", () => {
    const withCall = done(s, "FIRST_CALL", at(30 * MIN));
    assert.equal(planned(withCall, at(31 * MIN), "CHECK_1")!.dueAt.getTime(), at(30 * MIN + 2 * HR).getTime());
  });
});

describe("Step 7 — Check 2 fires exactly 1h after Step 6", () => {
  let s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
  s = done(s, "CHECK_1", at(2 * HR));
  s = done(s, "FOLLOWUP_WHATSAPP", at(2 * HR));

  test("due at follow-up + 1h", () => {
    assert.equal(planned(s, at(2 * HR), "CHECK_2")!.dueAt.getTime(), at(3 * HR).getTime());
  });

  test("Step 6 only materialises after Check 1 has actually run", () => {
    const noCheck = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
    assert.equal(planned(noCheck, at(1 * HR), "FOLLOWUP_WHATSAPP"), undefined);
  });
});

describe("Step 9 — Final check fires exactly 2h after Step 8", () => {
  let s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
  s = done(s, "CHECK_1", at(2 * HR));
  s = done(s, "FOLLOWUP_WHATSAPP", at(2 * HR));
  s = done(s, "CHECK_2", at(3 * HR));
  s = done(s, "FOLLOWUP_CALL", at(3 * HR), "YES");

  test("due at Step 8 + 2h", () => {
    assert.equal(planned(s, at(3 * HR), "FINAL_CHECK")!.dueAt.getTime(), at(5 * HR).getTime());
  });

  test("Step 8 'NO' ends the cycle — no final check is scheduled (checklist §H)", () => {
    let no = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
    no = done(no, "CHECK_1", at(2 * HR));
    no = done(no, "FOLLOWUP_WHATSAPP", at(2 * HR));
    no = done(no, "CHECK_2", at(3 * HR));
    no = done(no, "FOLLOWUP_CALL", at(3 * HR), "NO");
    assert.equal(planned(no, at(4 * HR), "FINAL_CHECK"), undefined);
    assert.equal(nextPhase(no, at(4 * HR), DEFAULT_SLA), "IGNORED");
  });

  test("final check run + still not booked → IGNORED, never deleted (checklist §I)", () => {
    const ignored = done(s, "FINAL_CHECK", at(5 * HR));
    assert.equal(nextPhase(ignored, at(5 * HR), DEFAULT_SLA), "IGNORED");
  });
});

describe("Booking check — booked at any of the 3 checkpoints diverts to Step 11", () => {
  for (const [name, checks] of [
    ["check 1", ["CHECK_1"]],
    ["check 2", ["CHECK_1", "FOLLOWUP_WHATSAPP", "CHECK_2"]],
    ["final check", ["CHECK_1", "FOLLOWUP_WHATSAPP", "CHECK_2", "FOLLOWUP_CALL", "FINAL_CHECK"]],
  ] as const) {
    test(`booked at ${name} → BANT qualification, chase stops`, () => {
      let s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
      for (const c of checks) s = done(s, c as OutreachStep, at(1 * HR));
      s = { ...s, booked: true };
      const plan = planJourney(s, at(2 * HR), DEFAULT_SLA);
      assert.ok(plan.materialise.find((m) => m.step === "BANT_QUALIFICATION"));
      assert.equal(plan.phase, "QUALIFICATION");
      // The chase must not keep running once they've booked.
      assert.equal(plan.materialise.find((m) => m.step === "FOLLOWUP_WHATSAPP"), undefined);
    });
  }

  test("a DUE chase reminder is superseded the moment they book", () => {
    let s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
    s = { ...s, booked: true, steps: { ...s.steps, FOLLOWUP_WHATSAPP: step({ status: "DUE", dueAt: at(2 * HR) }) } };
    assert.ok(planJourney(s, at(2 * HR), DEFAULT_SLA).supersede.includes("FOLLOWUP_WHATSAPP"));
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEP 11 — BANT → Qualified (checklist §K)
// ═══════════════════════════════════════════════════════════════════

describe("Step 11 — Qualified derives from BANT", () => {
  test("avg > 3 → YES", () => assert.equal(qualifiedFromBant(3.1), "YES"));
  test("avg exactly 3 → MAYBE (the boundary belongs to 'cannot judge')", () =>
    assert.equal(qualifiedFromBant(3), "MAYBE"));
  test("avg exactly 2 → MAYBE", () => assert.equal(qualifiedFromBant(2), "MAYBE"));
  test("avg just under 2 → NO", () => assert.equal(qualifiedFromBant(1.99), "NO"));
  test("no score → no verdict (never guess)", () => {
    assert.equal(qualifiedFromBant(null), null);
    assert.equal(qualifiedFromBant(undefined), null);
    assert.equal(qualifiedFromBant(NaN), null);
  });
  test("the SOP's worked example: 2.3 → MAYBE ('Hemalatha C got 2.3 and resulted in Maybe')", () => {
    assert.equal(qualifiedFromBant(2.3), "MAYBE");
  });
  test("YES and MAYBE continue to Step 13; NO does not", () => {
    assert.equal(qualifiedContinues("YES"), true);
    assert.equal(qualifiedContinues("MAYBE"), true);
    assert.equal(qualifiedContinues("NO"), false);
    assert.equal(qualifiedContinues(null), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEPS 13–16 — the Disco ladder (checklist §M, §N)
// ═══════════════════════════════════════════════════════════════════

function qualifiedState(q: "YES" | "MAYBE" | "NO", discoAt: Date): JourneyState {
  let s = base({ phase: "QUALIFICATION", booked: true, qualified: q, discoAt });
  s = done(s, "BANT_QUALIFICATION", T0);
  s = done(s, "KEY_METRICS_TRANSFER", T0);
  return s;
}

describe("Step 13 — Disco welcome", () => {
  const discoAt = at(100 * HR);

  test("sent immediately on YES, not delayed (checklist §M)", () => {
    const p = planned(qualifiedState("YES", discoAt), T0, "DISCO_WELCOME");
    assert.ok(p);
    assert.equal(p.dueAt.getTime(), T0.getTime());
  });

  test("sent immediately on MAYBE too", () => {
    assert.ok(planned(qualifiedState("MAYBE", discoAt), T0, "DISCO_WELCOME"));
  });

  test("NOT sent on NO — routed straight to cancellation, skipping Disco welcome (checklist §O)", () => {
    const plan = planJourney(qualifiedState("NO", discoAt), T0, DEFAULT_SLA);
    assert.equal(plan.materialise.find((m) => m.step === "DISCO_WELCOME"), undefined);
    assert.ok(plan.materialise.find((m) => m.step === "DISCO_CANCEL"));
  });

  test("not sent before Key Metrics transfer is done (Step 12 gates Step 13)", () => {
    const s = { ...qualifiedState("YES", discoAt), steps: {} };
    assert.equal(planned(s, T0, "DISCO_WELCOME"), undefined);
  });
});

describe("Steps 14/15/16 — confirmation ladder fires at discrete offsets", () => {
  const discoAt = at(100 * HR);
  const ladder = (steps: OutreachStep[]) => {
    let s = qualifiedState("YES", discoAt);
    s = done(s, "DISCO_WELCOME", T0);
    for (const x of steps) s = done(s, x, T0);
    return s;
  };

  for (const [label, stepKey, hours, prereq] of [
    ["Step 14", "DISCO_CONFIRM_1", 36, []],
    ["Step 15", "DISCO_CONFIRM_2", 24, ["DISCO_CONFIRM_1"]],
    ["Step 16 cancel", "DISCO_CANCEL_MSG", 12, ["DISCO_CONFIRM_1", "DISCO_CONFIRM_2", "DISCO_CONFIRM_CALL_1", "DISCO_CONFIRM_CALL_2"]],
  ] as const) {
    describe(`${label} — T−${hours}h`, () => {
      const s = ladder(prereq as unknown as OutreachStep[]);
      const due = planned(s, T0, stepKey as OutreachStep)!.dueAt;

      test(`due exactly ${hours}h before the call`, () => {
        assert.equal(due.getTime(), discoAt.getTime() - hours * HR);
      });
      test("not actionable 1min early", () => {
        assert.equal(isActionable(step({ status: "DUE", dueAt: due }), new Date(due.getTime() - MIN)), false);
      });
      test("actionable at the boundary", () => {
        assert.equal(isActionable(step({ status: "DUE", dueAt: due }), due), true);
      });
      test("actionable 1min late", () => {
        assert.equal(isActionable(step({ status: "DUE", dueAt: due }), new Date(due.getTime() + MIN)), true);
      });
    });
  }

  test("Step 15 does NOT fire if Step 14 was never sent", () => {
    assert.equal(planned(ladder([]), T0, "DISCO_CONFIRM_2"), undefined);
  });

  test("Step 15 does NOT fire once confirmed (checklist §N: 'verify this doesn't also fire if already confirmed')", () => {
    const confirmed = { ...ladder(["DISCO_CONFIRM_1"]), whatsappConfirmed: true };
    assert.equal(planned(confirmed, T0, "DISCO_CONFIRM_2"), undefined);
  });

  test("confirming supersedes every DUE reminder in the ladder", () => {
    const s: JourneyState = {
      ...ladder(["DISCO_CONFIRM_1"]),
      whatsappConfirmed: true,
      steps: {
        ...ladder(["DISCO_CONFIRM_1"]).steps,
        DISCO_CONFIRM_2: step({ status: "DUE", dueAt: at(80 * HR) }),
        DISCO_CANCEL_MSG: step({ status: "DUE", dueAt: at(88 * HR) }),
      },
    };
    const sup = planJourney(s, at(80 * HR), DEFAULT_SLA).supersede;
    assert.ok(sup.includes("DISCO_CONFIRM_2"));
    assert.ok(sup.includes("DISCO_CANCEL_MSG"));
  });

  test("cancellation requires BOTH call attempts logged (checklist §N)", () => {
    assert.equal(planned(ladder(["DISCO_CONFIRM_1", "DISCO_CONFIRM_2"]), T0, "DISCO_CANCEL_MSG"), undefined);
    assert.equal(
      planned(ladder(["DISCO_CONFIRM_1", "DISCO_CONFIRM_2", "DISCO_CONFIRM_CALL_1"]), T0, "DISCO_CANCEL_MSG"),
      undefined,
      "one call is not enough — the SOP requires two",
    );
    assert.ok(
      planned(
        ladder(["DISCO_CONFIRM_1", "DISCO_CONFIRM_2", "DISCO_CONFIRM_CALL_1", "DISCO_CONFIRM_CALL_2"]),
        T0,
        "DISCO_CANCEL_MSG",
      ),
    );
  });

  test("no ladder at all without a known appointment time", () => {
    let s = qualifiedState("YES", null as unknown as Date);
    s = done(s, "DISCO_WELCOME", T0);
    assert.equal(planned({ ...s, discoAt: null }, T0, "DISCO_CONFIRM_1"), undefined);
  });

  test("offsets are configurable (checklist §S)", () => {
    const sla = { ...DEFAULT_SLA, discoConfirm1LeadHours: 48 };
    const p = planJourney(ladder([]), T0, sla).materialise.find((m) => m.step === "DISCO_CONFIRM_1")!;
    assert.equal(p.dueAt.getTime(), discoAt.getTime() - 48 * HR);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEP 18 — handoff (checklist §P)
// ═══════════════════════════════════════════════════════════════════

describe("Step 18 — Highly Qualified gate", () => {
  const sssAt = at(100 * HR);

  test("HQ = NO → process terminates, no SSS messages ever fire", () => {
    const s = base({ phase: "HANDOFF", booked: true, qualified: "YES", highlyQualified: false, sssAt });
    const plan = planJourney(s, T0, DEFAULT_SLA);
    assert.equal(plan.phase, "CLOSED_NOT_HQ");
    for (const m of plan.materialise) {
      assert.ok(!m.step.startsWith("SSS_"), `no SSS step may fire when HQ=NO, got ${m.step}`);
    }
  });

  test("HQ = YES → SSS ladder opens", () => {
    const s = base({ phase: "HANDOFF", booked: true, qualified: "YES", highlyQualified: true, sssAt });
    const plan = planJourney(s, T0, DEFAULT_SLA);
    assert.equal(plan.phase, "SSS_CONFIRMATION");
    assert.ok(plan.materialise.find((m) => m.step === "SSS_CONFIRM_1"));
  });

  test("HQ undecided → nothing fires yet", () => {
    const s = base({ phase: "HANDOFF", booked: true, qualified: "YES", highlyQualified: null, sssAt });
    assert.equal(planned(s, T0, "SSS_CONFIRM_1"), undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEPS 19–21 — the SSS ladder (checklist §Q)
// ═══════════════════════════════════════════════════════════════════

describe("Steps 19/20/21 — SSS ladder fires at 24h/12h/10h", () => {
  const sssAt = at(100 * HR);
  const ladder = (steps: OutreachStep[]) => {
    let s = base({ phase: "SSS_CONFIRMATION", booked: true, qualified: "YES", highlyQualified: true, sssAt });
    for (const x of steps) s = done(s, x, T0);
    return s;
  };

  for (const [label, stepKey, hours, prereq] of [
    ["Step 19", "SSS_CONFIRM_1", 24, []],
    ["Step 20", "SSS_CONFIRM_2", 12, ["SSS_CONFIRM_1"]],
    ["Step 21", "SSS_CANCEL_MSG", 10, ["SSS_CONFIRM_1", "SSS_CONFIRM_2"]],
  ] as const) {
    describe(`${label} — T−${hours}h`, () => {
      const due = planned(ladder(prereq as unknown as OutreachStep[]), T0, stepKey as OutreachStep)!.dueAt;

      test(`due exactly ${hours}h before the SSS`, () => {
        assert.equal(due.getTime(), sssAt.getTime() - hours * HR);
      });
      test("not actionable 1min early", () => {
        assert.equal(isActionable(step({ status: "DUE", dueAt: due }), new Date(due.getTime() - MIN)), false);
      });
      test("actionable at the boundary", () => {
        assert.equal(isActionable(step({ status: "DUE", dueAt: due }), due), true);
      });
    });
  }

  test("Step 20 does not fire once Sales Call Confirmed", () => {
    const s = { ...ladder(["SSS_CONFIRM_1"]), salesCallConfirmed: true };
    assert.equal(planned(s, T0, "SSS_CONFIRM_2"), undefined);
  });

  test("Sales Call Confirmed → COMPLETED", () => {
    assert.equal(nextPhase({ ...ladder(["SSS_CONFIRM_1"]), salesCallConfirmed: true }, T0, DEFAULT_SLA), "COMPLETED");
  });

  test("SSS ladder mirrors Disco but uses its OWN offsets — no copy-paste bug (checklist §Q)", () => {
    // Disco confirm 2 is T−24h; SSS confirm 2 is T−12h. If someone copy-pasted the Disco ladder,
    // this is the assertion that catches it.
    const sssDue = planned(ladder(["SSS_CONFIRM_1"]), T0, "SSS_CONFIRM_2")!.dueAt;
    assert.equal(sssDue.getTime(), sssAt.getTime() - 12 * HR);
    assert.notEqual(sssDue.getTime(), sssAt.getTime() - 24 * HR);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotency — no double-fire (checklist §C, §F)
// ═══════════════════════════════════════════════════════════════════

describe("Idempotency", () => {
  test("re-planning never re-materialises an existing step", () => {
    const s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
    const first = planJourney(s, at(3 * HR), DEFAULT_SLA);
    // Fold every materialised step into the state, as the DB shell would.
    let next = s;
    for (const m of first.materialise) {
      next = { ...next, steps: { ...next.steps, [m.step]: step({ status: "DUE", dueAt: m.dueAt, actedAt: null }) } };
    }
    assert.deepEqual(planJourney(next, at(3 * HR), DEFAULT_SLA).materialise, [], "second run must be a no-op");
  });

  test("planning is pure — same inputs, same output, repeatedly", () => {
    const s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
    const a = planJourney(s, at(3 * HR), DEFAULT_SLA);
    const b = planJourney(s, at(3 * HR), DEFAULT_SLA);
    assert.deepEqual(a, b);
  });

  test("terminal journeys materialise nothing further", () => {
    for (const phase of ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] as const) {
      const plan = planJourney(base({ phase, booked: true, qualified: "YES" }), at(200 * HR), DEFAULT_SLA);
      assert.deepEqual(plan.materialise, [], `${phase} must be terminal`);
      assert.equal(plan.phase, phase);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEP 10 — email cross-check (checklist §J)
// ═══════════════════════════════════════════════════════════════════

describe("Step 10 — email matching", () => {
  test("exact match", () => assert.ok(emailsMatch("a@b.com", "a@b.com")));
  test("case difference must still match (false-negative guard)", () =>
    assert.ok(emailsMatch("Ameen@B2.DE", "ameen@b2.de")));
  test("trailing/leading whitespace must still match", () => assert.ok(emailsMatch("  a@b.com ", "a@b.com")));
  test("near-duplicate must NOT match", () => assert.equal(emailsMatch("ab@b.com", "a.b@b.com"), false));
  test("plus-addressing is NOT folded — different mailbox, false positive is worse", () =>
    assert.equal(emailsMatch("a+tag@b.com", "a@b.com"), false));
  test("empty/null never matches — an absent email is not an identity", () => {
    assert.equal(emailsMatch(null, null), false);
    assert.equal(emailsMatch("", ""), false);
    assert.equal(emailsMatch("a@b.com", null), false);
  });
  test("normalizeEmail returns null for blank", () => {
    assert.equal(normalizeEmail("   "), null);
    assert.equal(normalizeEmail(null), null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEP 5 (test prompt) — templates (checklist §S)
// ═══════════════════════════════════════════════════════════════════

describe("Templates", () => {
  test("every WHATSAPP step has a body", () => {
    for (const d of OUTREACH_STEPS.filter((x) => x.channel === "WHATSAPP")) {
      assert.ok(d.body && d.body.length > 0, `${d.step} must carry the SOP text`);
    }
  });

  test("intro carries both SOP links verbatim", () => {
    const b = stepBody("INTRO_WHATSAPP")!;
    assert.ok(b.includes("https://optin.b2consultants.de/apply"));
    assert.ok(b.includes("https://optin.b2consultants.de/lang"));
  });

  test("intro carries the SOP's flag emoji", () => assert.ok(stepBody("INTRO_WHATSAPP")!.includes("🇩🇪")));

  test("disco welcome carries the case-studies link", () =>
    assert.ok(stepBody("DISCO_WELCOME")!.includes("https://casestudies.b2consultants.de/casestudies")));

  test("SSS cancellation carries the SSS booking link, not the disco one", () => {
    const b = stepBody("SSS_CANCEL_MSG")!;
    assert.ok(b.includes("https://optin.b2consultants.de/sss"));
    assert.ok(!b.includes("/apply"), "must not copy-paste the disco link");
  });

  test("substitution resolves the SOP's bracketed variables", () => {
    const out = renderOutreachTemplate(stepBody("INTRO_WHATSAPP")!, {
      "[Prospect’s First Name]": "Priya",
      "[Your Name]": "Nilofer",
    });
    assert.ok(out.startsWith("Hi Priya\nNilofer here from B2 Consultants."));
    assert.deepEqual(unresolvedVars(out), []);
  });

  test("unresolved placeholders are detected — never reach the send step", () => {
    const out = renderOutreachTemplate(stepBody("DISCO_CONFIRM_1")!, { "[Prospect’s First Name]": "Priya" });
    const left = unresolvedVars(out);
    assert.ok(left.includes("[DATE]"));
    assert.ok(left.includes("[TIME]"));
    assert.ok(left.includes("<<INSERT ZOOM LINK HERE>>"));
  });

  test("a fully-rendered confirmation has nothing left over", () => {
    const out = renderOutreachTemplate(stepBody("DISCO_CONFIRM_1")!, {
      "[Prospect’s First Name]": "Priya",
      "[DATE]": "18-07-2026",
      "[TIME]": "07:00 PM",
      "<<INSERT ZOOM LINK HERE>>": "https://zoom.us/j/123",
    });
    assert.deepEqual(unresolvedVars(out), []);
  });

  test("substitution does not eat the SOP's *bold* markers", () => {
    const out = renderOutreachTemplate(stepBody("DISCO_CONFIRM_1")!, {
      "[DATE]": "18-07-2026",
      "[TIME]": "07:00 PM",
    });
    assert.ok(out.includes("*18-07-2026*"), "the asterisks around [DATE] must survive");
    assert.ok(out.includes("*YES*"), "the literal *YES* instruction must survive");
  });

  test("SSS confirm 1 keeps the video-attachment placeholder", () =>
    assert.ok(stepBody("SSS_CONFIRM_1")!.includes("<< ATTACH VIDEO TO THIS MESSAGE>>")));
});

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

describe("Config", () => {
  test("engine is OFF by default — nothing sends until an admin says so", () => {
    assert.equal(coerceOutreachConfig({}).enabled, false);
  });

  test("every step is manual by default", () => {
    assert.deepEqual(coerceOutreachConfig({}).autoSend, {});
  });

  test("garbage SLA values fall back to the SOP defaults rather than firing forever", () => {
    const c = coerceOutreachConfig({ sla: { check1Hours: 0, discoConfirm1LeadHours: -5, check2Hours: "x" } });
    assert.equal(c.sla.check1Hours, 2);
    assert.equal(c.sla.discoConfirm1LeadHours, 36);
    assert.equal(c.sla.check2Hours, 1);
  });

  test("valid overrides survive", () => {
    assert.equal(coerceOutreachConfig({ sla: { reactionMinutes: 10 } }).sla.reactionMinutes, 10);
    assert.equal(coerceOutreachConfig({ enabled: true }).enabled, true);
  });
});
