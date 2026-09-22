/**
 * Outreach SOP - timing, branch and data-integrity tests.
 *
 * Maps to the QA checklist's Steps 2–5. The engine is pure, so every SLA boundary is tested by
 * passing `now` explicitly - no fake timers, no DB, no flake. Each timing case is checked at
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
  sopOwnsCallReminders,
  AUTO_COMPLETED,
  KEY_METRICS_AUTO_NOTE,
  type JourneyState,
  type StepState,
} from "../outreach-engine";
import {
  callTimeNotice,
  dueReminderRung,
  mayRetryAutoSend,
  namedCallTime,
  type NoticeRow,
} from "../call-notice";
import { findLiveBookingForPerson } from "../booking-identity";
import { formatDateTimeInZone } from "../format";
import {
  DEFAULT_SLA,
  qualifiedFromBant,
  qualifiedContinues,
  renderOutreachTemplate,
  unresolvedVars,
  stepBody,
  coerceOutreachConfig,
  DEFAULT_OUTREACH_CONFIG,
  INSTANT_INTRO_SOURCES,
  isInstantIntroSource,
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
    discoNoShow: false,
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
// STEP 2 - Reaction time SLA (checklist §B)
// ═══════════════════════════════════════════════════════════════════

describe("Step 2 - 5-minute reaction SLA", () => {
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

  test("'approaching' stops once contacted - the clock has stopped", () => {
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

describe("Step 2 - branch routing", () => {
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
    // …but the ladder must not act on that. Check 1 is anchored on OPT-IN, so it is a fixed
    // deadline that `now` cannot move - which is the property this test exists to protect.
    assert.equal(planned(s, now, "CHECK_1")!.dueAt.getTime(), at(2 * HR).getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEPS 5/7/9 - the booking-chase ladder (checklist §E, §G, §I)
// ═══════════════════════════════════════════════════════════════════

describe("Step 5 - Check 1 fires exactly 2h after OPT-IN", () => {
  const s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", at(1 * MIN));
  const due = planned(s, at(2 * MIN), "CHECK_1")!.dueAt;

  test("due at opt-in + 2h", () => {
    assert.equal(due.getTime(), at(2 * HR).getTime());
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

  /**
   * This used to assert the opposite - that Check 1 anchored on the LATER of Step 3 and Step 4.
   * The founder's flow counts every window from opt-in, so a first call at any hour must not
   * push the deadline out. Same test subject, inverted expectation, deliberately.
   */
  test("a late first call does NOT push Check 1 out", () => {
    const withCall = done(s, "FIRST_CALL", at(30 * MIN));
    assert.equal(planned(withCall, at(31 * MIN), "CHECK_1")!.dueAt.getTime(), at(2 * HR).getTime());
  });
});

describe("Step 7 - Check 2 fires exactly 1h after Step 6", () => {
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

describe("Step 9 - Final check fires exactly 2h after Step 8", () => {
  let s = done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", T0);
  s = done(s, "CHECK_1", at(2 * HR));
  s = done(s, "FOLLOWUP_WHATSAPP", at(2 * HR));
  s = done(s, "CHECK_2", at(3 * HR));
  s = done(s, "FOLLOWUP_CALL", at(3 * HR), "YES");

  test("due at Step 8 + 2h", () => {
    assert.equal(planned(s, at(3 * HR), "FINAL_CHECK")!.dueAt.getTime(), at(5 * HR).getTime());
  });

  test("Step 8 'NO' ends the cycle - no final check is scheduled (checklist §H)", () => {
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

describe("Booking check - booked at any of the 3 checkpoints diverts to Step 11", () => {
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
// STEP 11 - BANT → Qualified (checklist §K)
// ═══════════════════════════════════════════════════════════════════

describe("Step 11 - Qualified derives from BANT", () => {
  // BANT runs 0-4 (was 0-5 until 22/09/2026; every threshold was multiplied by 0.8).
  test("avg > 2.4 → YES", () => assert.equal(qualifiedFromBant(2.5), "YES"));
  test("avg exactly 2.4 → MAYBE (the boundary belongs to 'cannot judge')", () =>
    assert.equal(qualifiedFromBant(2.4), "MAYBE"));
  test("avg exactly 1.6 → MAYBE", () => assert.equal(qualifiedFromBant(1.6), "MAYBE"));
  test("avg just under 1.6 → NO", () => assert.equal(qualifiedFromBant(1.59), "NO"));
  test("no score → no verdict (never guess)", () => {
    assert.equal(qualifiedFromBant(null), null);
    assert.equal(qualifiedFromBant(undefined), null);
    assert.equal(qualifiedFromBant(NaN), null);
  });
  test("the SOP's worked example: 2.3/5 = 1.8/4 → MAYBE ('Hemalatha C got 2.3 and resulted in Maybe')", () => {
    assert.equal(qualifiedFromBant(1.8), "MAYBE");
  });
  test("YES and MAYBE continue to Step 13; NO does not", () => {
    assert.equal(qualifiedContinues("YES"), true);
    assert.equal(qualifiedContinues("MAYBE"), true);
    assert.equal(qualifiedContinues("NO"), false);
    assert.equal(qualifiedContinues(null), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEPS 13–16 - the Disco ladder (checklist §M, §N)
// ═══════════════════════════════════════════════════════════════════

function qualifiedState(q: "YES" | "MAYBE" | "NO", discoAt: Date): JourneyState {
  let s = base({ phase: "QUALIFICATION", booked: true, qualified: q, discoAt });
  s = done(s, "BANT_QUALIFICATION", T0);
  s = done(s, "KEY_METRICS_TRANSFER", T0);
  return s;
}

describe("Step 13 - Disco welcome", () => {
  const discoAt = at(100 * HR);

  /**
   * Checklist §M says "sent immediately on qualification". That is still what a zero delay does,
   * and the SOP default is preserved by that assertion. The founder's own cadence adds a short
   * `postBookingDelayMinutes` so the reply does not land in the same second as the form, which
   * the second assertion pins.
   */
  test("sent immediately on YES when the delay is zero (checklist §M)", () => {
    const sla = { ...DEFAULT_SLA, postBookingDelayMinutes: 0 };
    const p = planJourney(qualifiedState("YES", discoAt), T0, sla).materialise.find((m) => m.step === "DISCO_WELCOME");
    assert.ok(p);
    assert.equal(p.dueAt.getTime(), T0.getTime());
  });

  test("otherwise it waits exactly the configured after-booking delay", () => {
    const sla = { ...DEFAULT_SLA, postBookingDelayMinutes: 5 };
    const p = planJourney(qualifiedState("YES", discoAt), T0, sla).materialise.find((m) => m.step === "DISCO_WELCOME");
    assert.equal(p!.dueAt.getTime(), at(5 * MIN).getTime());
  });

  test("sent immediately on MAYBE too", () => {
    assert.ok(planned(qualifiedState("MAYBE", discoAt), T0, "DISCO_WELCOME"));
  });

  /**
   * Checklist §O - NO skips the welcome entirely. That half is unchanged.
   *
   * What changed: the cancellation no longer fires in the same pass. The founder's flow tells the
   * prospect first, on both channels, and only then releases the slot - so DISCO_CANCEL now waits
   * for that notice rather than appearing immediately. Finding an empty calendar with no message
   * is the outcome this ordering prevents.
   */
  test("NOT sent on NO - the not-qualified notice goes out instead (checklist §O)", () => {
    const plan = planJourney(qualifiedState("NO", discoAt), T0, DEFAULT_SLA);
    assert.equal(plan.materialise.find((m) => m.step === "DISCO_WELCOME"), undefined);
    assert.ok(plan.materialise.find((m) => m.step === "DISCO_REJECT_MSG"));
    assert.ok(plan.materialise.find((m) => m.step === "DISCO_REJECT_EMAIL"));
    assert.equal(
      plan.materialise.find((m) => m.step === "DISCO_CANCEL"),
      undefined,
      "the slot is not released until the prospect has been told",
    );
  });

  test("on NO, the cancellation follows once the notice has gone out", () => {
    const told = done(qualifiedState("NO", discoAt), "DISCO_REJECT_EMAIL", at(5 * MIN));
    const plan = planJourney(told, at(5 * MIN), DEFAULT_SLA);
    assert.ok(plan.materialise.find((m) => m.step === "DISCO_CANCEL"));
  });

  test("not sent before Key Metrics transfer is done (Step 12 gates Step 13)", () => {
    const s = { ...qualifiedState("YES", discoAt), steps: {} };
    assert.equal(planned(s, T0, "DISCO_WELCOME"), undefined);
  });
});

describe("Steps 14/15/16 - confirmation ladder fires at discrete offsets", () => {
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
    describe(`${label} - T−${hours}h`, () => {
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

  /**
   * OUT-01. A confirmation can land long BEFORE the ladder opens - on the Bookings page the
   * moment the call is booked, or as a WhatsApp YES answering the welcome message. The engine's
   * only record of it is `whatsappConfirmed`, so the contract every one of those channels now
   * writes through is this: with the flag set, Step 14 is never raised in the first place.
   */
  test("Step 14 is never raised for a call that was already confirmed (OUT-01)", () => {
    const confirmed = { ...ladder([]), whatsappConfirmed: true };
    assert.equal(planned(confirmed, T0, "DISCO_CONFIRM_1"), undefined);
    assert.equal(planned(confirmed, T0, "DISCO_CONFIRM_2"), undefined);
    assert.equal(
      planJourney(confirmed, T0, DEFAULT_SLA).phase,
      "AWAITING_DISCO",
      "a confirmed prospect is waiting for their call, not still being chased for an answer",
    );
  });

  test("cancellation requires BOTH call attempts logged (checklist §N)", () => {
    assert.equal(planned(ladder(["DISCO_CONFIRM_1", "DISCO_CONFIRM_2"]), T0, "DISCO_CANCEL_MSG"), undefined);
    assert.equal(
      planned(ladder(["DISCO_CONFIRM_1", "DISCO_CONFIRM_2", "DISCO_CONFIRM_CALL_1"]), T0, "DISCO_CANCEL_MSG"),
      undefined,
      "one call is not enough - the SOP requires two",
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
// STEP 18 - handoff (checklist §P)
// ═══════════════════════════════════════════════════════════════════

describe("Step 18 - Highly Qualified gate", () => {
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

  /**
   * DSC-01. The desk's "Ready - route to Level 3" now writes the verdict onto the journey, and it
   * may arrive before a time has been agreed - the closer books that on the SSS calendar. The
   * verdict alone must move the journey into SSS_CONFIRMATION (which is what puts the prospect on
   * the "Needs an SSS time" list) while sending nothing: every SSS message names a date, and there
   * is no date yet.
   */
  test("HQ = YES with no SSS time yet → journey waits in SSS_CONFIRMATION, no message is raised", () => {
    const s = base({ phase: "AWAITING_DISCO", booked: true, qualified: "YES", highlyQualified: true, sssAt: null });
    const plan = planJourney(s, T0, DEFAULT_SLA);
    assert.equal(plan.phase, "SSS_CONFIRMATION");
    for (const m of plan.materialise) {
      assert.ok(!m.step.startsWith("SSS_"), `no SSS step may fire without an SSS time, got ${m.step}`);
    }
  });

  test("HQ = YES with a time → the ladder opens on the same verdict", () => {
    const s = base({ phase: "AWAITING_DISCO", booked: true, qualified: "YES", highlyQualified: true, sssAt });
    assert.ok(planned(s, T0, "SSS_CONFIRM_1"), "Step 19 is armed as soon as the SSS time is known");
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEPS 19–21 - the SSS ladder (checklist §Q)
// ═══════════════════════════════════════════════════════════════════

describe("Steps 19-21 - SSS ladder fires at 24h/12h/6h/3h/2h", () => {
  const sssAt = at(100 * HR);
  const ladder = (steps: OutreachStep[]) => {
    let s = base({ phase: "SSS_CONFIRMATION", booked: true, qualified: "YES", highlyQualified: true, sssAt });
    for (const x of steps) s = done(s, x, T0);
    return s;
  };

  for (const [label, stepKey, hours, prereq] of [
    // The Level 2 flowchart adds a 6h message and a 3h call between the 12h reminder and the
    // cancellation, so the cancellation moved from 10h (which was BEFORE both of them) to 2h.
    ["Step 19", "SSS_CONFIRM_1", 24, []],
    ["Step 20", "SSS_CONFIRM_2", 12, ["SSS_CONFIRM_1"]],
    ["Step 20b", "SSS_CONFIRM_3", 6, ["SSS_CONFIRM_1", "SSS_CONFIRM_2"]],
    ["Step 20c", "SSS_CONFIRM_CALL", 3, ["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CONFIRM_3"]],
    ["Step 21", "SSS_CANCEL_MSG", 2, ["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CONFIRM_3", "SSS_CONFIRM_CALL"]],
  ] as const) {
    describe(`${label} - T−${hours}h`, () => {
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

  /**
   * DSC-03. The SOP's right-hand column ends "Confirmed? No → CANCEL the SSS call → End", and the
   * engine raised SSS_CANCEL for that. Nothing executed it, so the journey sat in SSS_CONFIRMATION
   * for ever with the slot still held. These two cases pin the "End" half: once the cancellation
   * has run the journey is terminal, and a terminal journey is handed no further work.
   */
  test("Step 22 - once SSS_CANCEL has run the journey is CANCELLED, not still in SSS_CONFIRMATION", () => {
    const cancelled = done(ladder(["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CONFIRM_3", "SSS_CONFIRM_CALL", "SSS_CANCEL_MSG"]), "SSS_CANCEL", T0);
    assert.equal(nextPhase(cancelled, T0, DEFAULT_SLA), "CANCELLED");
    assert.equal(planJourney(cancelled, T0, DEFAULT_SLA).phase, "CANCELLED");
  });

  test("a cancelled SSS raises nothing further and sweeps up what was still DUE", () => {
    const base_ = ladder(["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CONFIRM_3", "SSS_CONFIRM_CALL", "SSS_CANCEL_MSG"]);
    const cancelled: JourneyState = {
      ...done(base_, "SSS_CANCEL", T0),
      steps: {
        ...done(base_, "SSS_CANCEL", T0).steps,
        // A reminder the specialist never worked, left behind by the ladder.
        SSS_CONFIRM_3: step({ status: "DUE", dueAt: at(94 * HR) }),
      },
    };
    const plan = planJourney(cancelled, T0, DEFAULT_SLA);
    assert.deepEqual(plan.materialise, [], "a cancelled SSS is handed no new work");
    assert.ok(plan.supersede.includes("SSS_CONFIRM_3"), "and nothing is left DUE in the queue");
  });

  test("SSS ladder mirrors Disco but uses its OWN offsets - no copy-paste bug (checklist §Q)", () => {
    // Disco confirm 2 is T−24h; SSS confirm 2 is T−12h. If someone copy-pasted the Disco ladder,
    // this is the assertion that catches it.
    const sssDue = planned(ladder(["SSS_CONFIRM_1"]), T0, "SSS_CONFIRM_2")!.dueAt;
    assert.equal(sssDue.getTime(), sssAt.getTime() - 12 * HR);
    assert.notEqual(sssDue.getTime(), sssAt.getTime() - 24 * HR);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotency - no double-fire (checklist §C, §F)
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

  test("planning is pure - same inputs, same output, repeatedly", () => {
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
// STEP 10 - email cross-check (checklist §J)
// ═══════════════════════════════════════════════════════════════════

describe("Step 10 - email matching", () => {
  test("exact match", () => assert.ok(emailsMatch("a@b.com", "a@b.com")));
  test("case difference must still match (false-negative guard)", () =>
    assert.ok(emailsMatch("Ameen@B2.DE", "ameen@b2.de")));
  test("trailing/leading whitespace must still match", () => assert.ok(emailsMatch("  a@b.com ", "a@b.com")));
  test("near-duplicate must NOT match", () => assert.equal(emailsMatch("ab@b.com", "a.b@b.com"), false));
  test("plus-addressing is NOT folded - different mailbox, false positive is worse", () =>
    assert.equal(emailsMatch("a+tag@b.com", "a@b.com"), false));
  test("empty/null never matches - an absent email is not an identity", () => {
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
// STEP 5 (test prompt) - templates (checklist §S)
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
    // Both names on ONE line with static text between them. The SOP originally had them on
    // consecutive lines, which becomes two adjacent {{…}} parameters at submission - a shape Meta
    // rejects outright. Changed with founder sign-off on 2026-08-03; see TPL_INTRO.
    assert.ok(out.startsWith("Hi Priya, this is Nilofer from B2 Consultants."));
    assert.deepEqual(unresolvedVars(out), []);
  });

  test("the intro offers a call rather than promising one", () => {
    // Once this message auto-sends at opt-in, "I'll give you a quick call now" is a promise the
    // system does not keep - under firstCallMode "after_check" a caller only rings if the
    // prospect does NOT book. The offer stays; the assertion of an imminent call does not.
    const body = stepBody("INTRO_WHATSAPP")!;
    assert.ok(!body.includes("quick call now"), "must not promise an immediate call");
    assert.ok(body.includes("reply here and one of our team will call you"));
    // Everything between the first and last line is untouched SOP text.
    assert.ok(body.includes("book a 20 min *FREE* Personalized Discovery Call"));
    assert.ok(body.includes("https://optin.b2consultants.de/apply"));
  });

  test("unresolved placeholders are detected - never reach the send step", () => {
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
  test("engine is OFF by default - nothing sends until an admin says so", () => {
    assert.equal(coerceOutreachConfig({}).enabled, false);
  });

  test("every step is manual by default", () => {
    assert.deepEqual(coerceOutreachConfig({}).autoSend, {});
  });

  test("garbage SLA values fall back to the SOP defaults rather than firing forever", () => {
    const c = coerceOutreachConfig({ sla: { check1Hours: 0, discoConfirm1LeadHours: -5, check2Hours: "x" } });
    // Compared against DEFAULT_SLA rather than literals: these defaults are re-expressed when a
    // step's anchor moves, and a hardcoded copy here would fail for the wrong reason.
    assert.equal(c.sla.check1Hours, DEFAULT_SLA.check1Hours);
    assert.equal(c.sla.discoConfirm1LeadHours, DEFAULT_SLA.discoConfirm1LeadHours);
    assert.equal(c.sla.check2Hours, DEFAULT_SLA.check2Hours);
  });

  test("valid overrides survive", () => {
    assert.equal(coerceOutreachConfig({ sla: { reactionMinutes: 10 } }).sla.reactionMinutes, 10);
    assert.equal(coerceOutreachConfig({ enabled: true }).enabled, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// firstCallMode - when a human is actually spent
// ═══════════════════════════════════════════════════════════════════

/**
 * `"after_check"` exists so the intro message gets a chance to work on its own. Every prospect who
 * books off the message alone never reaches a caller at all; only those who ignored it do.
 *
 * The risk being tested is the failure that would make the mode pointless in opposite directions:
 * raising the call too early (no better than the SOP), or never raising it at all (leads rot
 * silently, which is worse than either).
 */
const AFTER = { firstCallMode: "after_check" as const };

function plan(state: JourneyState, now: Date, opts?: { firstCallMode?: "immediate" | "after_check" }) {
  return planJourney(state, now, DEFAULT_SLA, opts);
}
const hasStep = (p: ReturnType<typeof plan>, s: OutreachStep) => p.materialise.some((m) => m.step === s);

describe("firstCallMode - deferring the first call until a booking check comes back empty", () => {
  /** The intro has gone out but no check has run yet. */
  const introSent = () => done(base({ contactedAt: at(1 * MIN) }), "INTRO_WHATSAPP", at(1 * MIN));

  test("immediate (the default) still raises the call straight after the intro", () => {
    const p = plan(introSent(), at(2 * MIN));
    assert.ok(hasStep(p, "FIRST_CALL"), "the SOP as written must be unchanged by default");
  });

  test("after_check does NOT raise a call on the intro alone", () => {
    const p = plan(introSent(), at(2 * MIN), AFTER);
    assert.ok(!hasStep(p, "FIRST_CALL"), "the message has not had its window yet");
    // …but the booking check must still be scheduled, or nothing would ever raise the call.
    assert.ok(hasStep(p, "CHECK_1"), "the check is what eventually triggers the call");
  });

  test("after_check schedules the check from OPT-IN, whichever mode is in play", () => {
    const p = plan(introSent(), at(2 * MIN), AFTER);
    const check = p.materialise.find((m) => m.step === "CHECK_1")!;
    assert.equal(
      check.dueAt.getTime(),
      at(DEFAULT_SLA.check1Hours * HR).getTime(),
      "optInAt + check1Hours - the anchor does not depend on firstCallMode",
    );
  });

  test("after_check raises the call once the check reports NOT_BOOKED", () => {
    let s = introSent();
    s = done(s, "CHECK_1", at(2 * HR), "NOT_BOOKED");
    const p = plan(s, at(2 * HR), AFTER);

    assert.ok(hasStep(p, "FIRST_CALL"), "they ignored the message - now a human is worth spending");
    assert.equal(p.materialise.find((m) => m.step === "FIRST_CALL")!.dueAt.getTime(), at(2 * HR).getTime());
  });

  test("after_check holds Step 6 behind that call rather than racing it", () => {
    let s = introSent();
    s = done(s, "CHECK_1", at(2 * HR), "NOT_BOOKED");
    // Call raised but not yet made.
    assert.ok(!hasStep(plan(s, at(2 * HR), AFTER), "FOLLOWUP_WHATSAPP"), "no message while the call is outstanding");

    s = done(s, "FIRST_CALL", at(3 * HR));
    assert.ok(hasStep(plan(s, at(3 * HR), AFTER), "FOLLOWUP_WHATSAPP"), "after the call, the chase resumes");
  });

  test("a prospect who books is never handed to a caller", () => {
    // The check found a booking, so `booked` flips and the whole chase block is skipped. This is
    // the entire value of the mode - assert it rather than assume it.
    const s = { ...done(introSent(), "CHECK_1", at(2 * HR), "BOOKED"), booked: true };
    const p = plan(s, at(2 * HR), AFTER);
    assert.ok(!hasStep(p, "FIRST_CALL"), "they booked off the message - no call should ever be raised");
    assert.ok(!hasStep(p, "FOLLOWUP_WHATSAPP"));
  });

  test("the late-contact branch is unaffected - it never had an intro to wait on", () => {
    // Past the 5-minute window with no intro sent: the SOP skips Step 3 and checks immediately.
    // There is no message pending, so deferring the call to "after the message" is meaningless.
    const s = base({ contactedAt: null });
    const p = plan(s, at(30 * MIN), AFTER);
    assert.ok(hasStep(p, "CHECK_1"), "the SLOW branch still checks the booking right away");
    assert.ok(!hasStep(p, "INTRO_WHATSAPP"), "and still skips the intro");
  });

  test("re-planning is idempotent in after_check too", () => {
    let s = introSent();
    s = done(s, "CHECK_1", at(2 * HR), "NOT_BOOKED");
    const first = plan(s, at(2 * HR), AFTER);
    // Materialise what it asked for, then re-plan: nothing new should appear.
    for (const m of first.materialise) s = { ...s, steps: { ...s.steps, [m.step]: step({ status: "DUE", dueAt: m.dueAt, actedAt: null }) } };
    assert.deepEqual(plan(s, at(2 * HR), AFTER).materialise, [], "a second run must be a no-op");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Instant intro - the gates that decide whether a real person is messaged
// ═══════════════════════════════════════════════════════════════════

/**
 * This is the only place in the app that messages a stranger with no human in the loop, so these
 * tests are about the BLAST RADIUS, not the happy path.
 *
 * The live database holds 23,500 leads imported from Synamate and spreadsheets. If the source
 * whitelist ever inverts, or the config ever fails open, the first symptom is thousands of real
 * WhatsApp messages and a burned business number. Every assertion below is one of those doors.
 */
describe("instant intro - source whitelist", () => {
  test("only the live capture webhooks are eligible", () => {
    for (const s of ["PABBLY", "FLEXIFUNNELS", "META_LEAD_AD"]) {
      assert.ok(isInstantIntroSource(s), `${s} arrives from a real opt-in and should send`);
    }
  });

  test("imports and back-office entry can NEVER trigger a send", () => {
    // SYNAMATE and SHEET are how the 23,500 existing leads got here; MANUAL is someone typing a
    // contact in. None of them represents a person who just asked to hear from B2.
    for (const s of ["MANUAL", "SYNAMATE", "SHEET", "RAZORPAY", "FATHOM", "NATIVE_FORM"]) {
      assert.ok(!isInstantIntroSource(s), `${s} must never auto-message - it is not a live opt-in`);
    }
  });

  test("someone who already booked is not invited to book", () => {
    assert.ok(!isInstantIntroSource("BOOKING_FORM"));
  });

  test("it is a whitelist, so an unknown source is excluded by default", () => {
    // The property that makes this safe as the app grows: a source added to the enum tomorrow is
    // silently OFF until someone decides otherwise.
    assert.ok(!isInstantIntroSource("SOME_FUTURE_IMPORTER"));
    assert.ok(!isInstantIntroSource(""));
    assert.equal(INSTANT_INTRO_SOURCES.length, 3, "widening this list is a deliberate act");
  });
});

describe("instant intro - the config fails closed", () => {
  test("ships off", () => {
    assert.equal(DEFAULT_OUTREACH_CONFIG.instantIntro.enabled, false);
    assert.equal(coerceOutreachConfig({}).instantIntro.enabled, false);
    assert.equal(coerceOutreachConfig(null).instantIntro.enabled, false);
  });

  test("only a literal true arms it", () => {
    // A half-written config row, a string "yes" from a hand-edited JSON blob, a 1 - none of these
    // should start messaging people.
    for (const v of ["yes", "true", 1, {}, []]) {
      assert.equal(
        coerceOutreachConfig({ instantIntro: { enabled: v } }).instantIntro.enabled,
        false,
        `${JSON.stringify(v)} must not arm unattended sending`,
      );
    }
    assert.equal(coerceOutreachConfig({ instantIntro: { enabled: true } }).instantIntro.enabled, true);
  });

  test("a missing or nonsensical hourly cap is NOT unlimited", () => {
    // The one misreading that would turn the circuit breaker into the thing it exists to prevent.
    const fallback = DEFAULT_OUTREACH_CONFIG.instantIntro.maxPerHour;
    for (const v of [undefined, 0, -5, "abc", NaN, null]) {
      assert.equal(
        coerceOutreachConfig({ instantIntro: { enabled: true, maxPerHour: v } }).instantIntro.maxPerHour,
        fallback,
        `${JSON.stringify(v)} must fall back to the default cap, not disable it`,
      );
    }
  });

  test("a real cap survives, floored to a whole number", () => {
    assert.equal(coerceOutreachConfig({ instantIntro: { maxPerHour: 25 } }).instantIntro.maxPerHour, 25);
    assert.equal(coerceOutreachConfig({ instantIntro: { maxPerHour: 25.9 } }).instantIntro.maxPerHour, 25);
  });

  test("firstCallMode fails closed to the SOP as written", () => {
    for (const v of [undefined, "", "nonsense", "AFTER_CHECK", true]) {
      assert.equal(coerceOutreachConfig({ firstCallMode: v }).firstCallMode, "immediate");
    }
    assert.equal(coerceOutreachConfig({ firstCallMode: "after_check" }).firstCallMode, "after_check");
  });
});

// ═══════════════════════════════════════════════════════════════════
// OUT-09 - Step 12 completes itself; nothing stale fires for a call that is over
// ═══════════════════════════════════════════════════════════════════

/** Steps that put a message in front of the prospect. */
function isMessageStep(s: OutreachStep): boolean {
  return OUTREACH_STEPS.some((d) => d.step === s && (d.channel === "WHATSAPP" || d.channel === "EMAIL"));
}

describe("Step 12 (Key Metrics transfer) auto-completes", () => {
  const discoAt = at(100 * HR);
  const qualifiedNoStep12 = (q: "YES" | "MAYBE" | "NO" = "YES") =>
    done(base({ phase: "QUALIFICATION", booked: true, qualified: q, discoAt }), "BANT_QUALIFICATION", T0);
  const withDueStep12 = (s: JourneyState): JourneyState => ({
    ...s,
    steps: { ...s.steps, KEY_METRICS_TRANSFER: step({ status: "DUE", dueAt: T0, actedAt: null }) },
  });

  test("a freshly qualified booking materialises Step 12 AND completes it in the same pass", () => {
    const p = planJourney(qualifiedNoStep12(), at(1 * MIN), DEFAULT_SLA);
    assert.ok(p.materialise.find((m) => m.step === "KEY_METRICS_TRANSFER"), "the row still exists, as the audit trail");
    const c = p.complete.find((x) => x.step === "KEY_METRICS_TRANSFER");
    assert.ok(c, "and the engine closes it itself");
    assert.equal(c.outcome, AUTO_COMPLETED);
    assert.equal(c.note, KEY_METRICS_AUTO_NOTE);
  });

  test("a journey already stuck on a DUE Step 12 is released on its next tick", () => {
    const p = planJourney(withDueStep12(qualifiedNoStep12()), at(3 * 24 * HR), DEFAULT_SLA);
    assert.ok(p.complete.some((x) => x.step === "KEY_METRICS_TRANSFER"));
    assert.equal(p.materialise.find((m) => m.step === "KEY_METRICS_TRANSFER"), undefined, "never a second row");
  });

  test("a Step 12 a human already Skipped or ticked is left exactly as they left it", () => {
    for (const status of ["SKIPPED", "SENT"] as const) {
      const s: JourneyState = {
        ...qualifiedNoStep12(),
        steps: { ...qualifiedNoStep12().steps, KEY_METRICS_TRANSFER: step({ status }) },
      };
      assert.deepEqual(planJourney(s, at(1 * MIN), DEFAULT_SLA).complete, [], `${status} is not rewritten`);
    }
  });

  test("Step 12 is not raised or completed before Step 11 has been acted", () => {
    const s = base({ phase: "QUALIFICATION", booked: true, qualified: null, discoAt });
    const p = planJourney(s, at(1 * MIN), DEFAULT_SLA);
    assert.deepEqual(p.complete, []);
    assert.equal(p.materialise.find((m) => m.step === "KEY_METRICS_TRANSFER"), undefined);
  });

  test("the phase reaches DISCO_CONFIRMATION without anyone touching Step 12", () => {
    assert.equal(nextPhase(withDueStep12(qualifiedNoStep12("MAYBE")), at(1 * MIN), DEFAULT_SLA), "DISCO_CONFIRMATION");
    // Qualified = NO still waits in QUALIFICATION for the release, exactly as before.
    assert.equal(nextPhase(qualifiedNoStep12("NO"), at(1 * MIN), DEFAULT_SLA), "QUALIFICATION");
  });

  test("a terminal journey completes nothing", () => {
    const s: JourneyState = { ...withDueStep12(qualifiedNoStep12()), phase: "CANCELLED" };
    assert.deepEqual(planJourney(s, at(1 * MIN), DEFAULT_SLA).complete, []);
  });

  /**
   * The production case (17-22/09/2026): welcome sent, Step 12 stuck DUE, a Step 14 still DUE
   * whose due time was set for the ORIGINAL Monday slot, and the call itself pulled forward to
   * Friday and now over. Releasing Step 12 must not send her anything.
   */
  test("releasing a stuck Step 12 after the call has passed plans no message and kills the stale rung", () => {
    const friday = at(60 * HR);
    let s = done(base({ phase: "QUALIFICATION", booked: true, qualified: "YES", discoAt: friday }), "BANT_QUALIFICATION", T0);
    s = done(s, "DISCO_WELCOME", at(5 * MIN));
    s = done(s, "DISCO_WELCOME_EMAIL", at(5 * MIN));
    s = {
      ...withDueStep12(s),
      steps: {
        ...withDueStep12(s).steps,
        // T-36h of the old Monday slot, i.e. AFTER the Friday call.
        DISCO_CONFIRM_1: step({ status: "DUE", dueAt: at(80 * HR), actedAt: null }),
      },
    };
    const p = planJourney(s, at(120 * HR), DEFAULT_SLA);
    assert.ok(p.complete.some((x) => x.step === "KEY_METRICS_TRANSFER"), "Step 12 is released");
    assert.deepEqual(p.materialise.filter((m) => isMessageStep(m.step)), [], "nothing is planned for a call that is over");
    assert.ok(p.supersede.includes("DISCO_CONFIRM_1"), "the stale Step 14 can no longer be sent by anyone");
  });
});

describe("pre-call rungs are superseded once the call time passes", () => {
  const discoAt = at(100 * HR);
  const withDue = (st: OutreachStep): JourneyState => {
    let s = done(base({ phase: "DISCO_CONFIRMATION", booked: true, qualified: "YES", discoAt }), "BANT_QUALIFICATION", T0);
    s = done(s, "KEY_METRICS_TRANSFER", T0);
    s = done(s, "DISCO_WELCOME", T0);
    s = done(s, "DISCO_CONFIRM_1", at(64 * HR));
    return { ...s, steps: { ...s.steps, [st]: step({ status: "DUE", dueAt: at(76 * HR), actedAt: null }) } };
  };

  test("still live one minute before the call", () => {
    const p = planJourney(withDue("DISCO_CONFIRM_2"), new Date(discoAt.getTime() - MIN), DEFAULT_SLA);
    assert.ok(!p.supersede.includes("DISCO_CONFIRM_2"));
  });

  test("superseded at the call time and after", () => {
    for (const now of [discoAt, new Date(discoAt.getTime() + MIN), at(200 * HR)]) {
      assert.ok(planJourney(withDue("DISCO_CONFIRM_2"), now, DEFAULT_SLA).supersede.includes("DISCO_CONFIRM_2"));
    }
  });

  test("the release itself goes too - releasing a past call is the post-call sweep's decision", () => {
    assert.ok(planJourney(withDue("DISCO_CANCEL"), at(101 * HR), DEFAULT_SLA).supersede.includes("DISCO_CANCEL"));
  });

  test("the Level 2 no-show chase is NOT touched - it only exists after the call", () => {
    const s: JourneyState = { ...withDue("DISCO_NOSHOW_CALL_1"), discoNoShow: true };
    assert.ok(!planJourney(s, at(101 * HR), DEFAULT_SLA).supersede.includes("DISCO_NOSHOW_CALL_1"));
  });
});

// ═══════════════════════════════════════════════════════════════════
// Step 6 is never due before opt-in + Check 1's window
// ═══════════════════════════════════════════════════════════════════

describe("Step 6 never goes out before opt-in + check1Hours (2h by default)", () => {
  const introAt = at(1 * MIN);
  const chased = () => done(done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", introAt), "FIRST_CALL", at(4 * MIN), "YES");
  const skipped = (s: JourneyState, st: OutreachStep, when: Date): JourneyState => ({
    ...s,
    steps: { ...s.steps, [st]: step({ status: "SKIPPED", dueAt: at(2 * HR), actedAt: when }) },
  });
  const due = (p: ReturnType<typeof planJourney>, st: OutreachStep) => p.materialise.find((m) => m.step === st)!.dueAt.getTime();

  test("Check 1 skipped five minutes after the intro: Step 6 still waits for opt-in + 2h", () => {
    const p = planJourney(skipped(chased(), "CHECK_1", at(6 * MIN)), at(6 * MIN), DEFAULT_SLA);
    assert.equal(due(p, "FOLLOWUP_WHATSAPP"), at(2 * HR).getTime());
    assert.equal(due(p, "FOLLOWUP_EMAIL"), at(2 * HR).getTime(), "the email twin is held to the same floor");
    const wa = new Date(due(p, "FOLLOWUP_WHATSAPP"));
    assert.equal(isActionable(step({ status: "DUE", dueAt: wa }), at(2 * HR - MIN)), false, "not a minute early");
    assert.equal(isActionable(step({ status: "DUE", dueAt: wa }), at(2 * HR)), true, "due exactly on the floor");
  });

  test("a check that ran on time keeps its own time - the floor never delays the SOP", () => {
    const s = done(chased(), "CHECK_1", at(2 * HR + 3 * MIN), "NOT_BOOKED");
    assert.equal(due(planJourney(s, at(2 * HR + 3 * MIN), DEFAULT_SLA), "FOLLOWUP_WHATSAPP"), at(2 * HR + 3 * MIN).getTime());
  });

  test("the floor follows the configured window, not a hard-coded 2h", () => {
    const p = planJourney(skipped(chased(), "CHECK_1", at(6 * MIN)), at(6 * MIN), { ...DEFAULT_SLA, check1Hours: 3 });
    assert.equal(due(p, "FOLLOWUP_WHATSAPP"), at(3 * HR).getTime());
  });

  test("after_check mode: an early-skipped check cannot pull Step 6 forward either", () => {
    const s = skipped(done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", introAt), "CHECK_1", at(6 * MIN));
    const p = planJourney(s, at(6 * MIN), DEFAULT_SLA, { firstCallMode: "after_check" });
    assert.equal(due(p, "FOLLOWUP_WHATSAPP"), at(2 * HR).getTime());
  });

  test("after_check mode: a call logged minutes after an early check does not release Step 6 early", () => {
    let s = done(done(base({ phase: "BOOKING_CHASE" }), "INTRO_WHATSAPP", introAt), "CHECK_1", at(6 * MIN), "NOT_BOOKED");
    s = done(s, "FIRST_CALL", at(8 * MIN), "YES");
    const p = planJourney(s, at(8 * MIN), DEFAULT_SLA, { firstCallMode: "after_check" });
    assert.equal(due(p, "FOLLOWUP_WHATSAPP"), at(2 * HR).getTime());
  });

  test("the late-contact branch: the immediate booking check no longer drags Step 6 to minute 30", () => {
    const s = done(base({ phase: "BOOKING_CHASE" }), "CHECK_1", at(30 * MIN), "NOT_BOOKED");
    assert.equal(due(planJourney(s, at(30 * MIN), DEFAULT_SLA), "FOLLOWUP_WHATSAPP"), at(2 * HR).getTime());
  });

  test("Step 7b is floored on Check 2's window the same way", () => {
    let s = done(chased(), "CHECK_1", at(2 * HR), "NOT_BOOKED");
    s = done(s, "FOLLOWUP_WHATSAPP", at(2 * HR));
    s = skipped(s, "CHECK_2", at(2 * HR + 5 * MIN));
    const p = planJourney(s, at(2 * HR + 5 * MIN), DEFAULT_SLA);
    assert.equal(due(p, "FOLLOWUP_WHATSAPP_2"), at(DEFAULT_SLA.check2Hours * HR).getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════
// One reminder system per call
// ═══════════════════════════════════════════════════════════════════

describe("sopOwnsCallReminders - when the booking pre-call reminder stands down", () => {
  const armed = { enabled: true, maxAgeDays: 30, autoSend: { DISCO_CONFIRM_1: true } };
  const live = { phase: "DISCO_CONFIRMATION" as const, optInAt: T0, qualified: "YES" as const };
  const now = at(24 * HR);

  test("a live, qualified journey whose confirmations auto-send owns the reminders", () => {
    assert.equal(sopOwnsCallReminders(live, armed, now), true);
    assert.equal(sopOwnsCallReminders({ ...live, qualified: "MAYBE" }, armed, now), true);
    assert.equal(sopOwnsCallReminders(live, { ...armed, autoSend: { DISCO_CONFIRM_2: true } }, now), true);
  });

  test("a confirmed journey keeps ownership - the ladder stopping is the SOP's decision", () => {
    assert.equal(sopOwnsCallReminders({ ...live, phase: "AWAITING_DISCO" }, armed, now), true);
  });

  test("Qualified = NO owns it regardless: the call is being released", () => {
    assert.equal(sopOwnsCallReminders({ ...live, qualified: "NO", phase: "QUALIFICATION" }, { ...armed, autoSend: {} }, now), true);
  });

  test("the booking reminder keeps working wherever the SOP will not remind", () => {
    assert.equal(sopOwnsCallReminders(null, armed, now), false, "no journey at all");
    assert.equal(sopOwnsCallReminders(live, { ...armed, enabled: false }, now), false, "engine off");
    assert.equal(sopOwnsCallReminders({ ...live, phase: "CANCELLED" }, armed, now), false, "journey over");
    assert.equal(sopOwnsCallReminders({ ...live, qualified: null, phase: "QUALIFICATION" }, armed, now), false, "no verdict yet");
    assert.equal(sopOwnsCallReminders(live, { ...armed, autoSend: {} }, now), false, "confirmations are manual only");
    assert.equal(sopOwnsCallReminders(live, armed, at(31 * 24 * HR)), false, "outside the engine's scan window");
  });
});

describe("dueReminderRung - one reminder per rung, never a retry", () => {
  const slot = at(48 * HR);
  const lead = [24, 2];
  const t = (hoursBefore: number) => new Date(slot.getTime() - hoursBefore * HR);

  test("nothing before the widest rung opens, the rung itself exactly when it does", () => {
    assert.equal(dueReminderRung(slot, lead, new Date(t(24).getTime() - MIN), []), null);
    assert.equal(dueReminderRung(slot, lead, t(24), []), 24);
  });

  test("a rung that was attempted - even FAILED - is not retried on later runs", () => {
    const failedAt = new Date(t(24).getTime() + 15 * MIN);
    for (const h of [23, 16, 8, 3]) {
      assert.equal(dueReminderRung(slot, lead, t(h), [failedAt]), null, `no retry at T-${h}h`);
    }
  });

  test("the next rung fires at its own offset, not min(leadHours) after the previous one", () => {
    const first = t(24);
    assert.equal(dueReminderRung(slot, lead, t(22), [first]), null, "the old cadence re-sent here, at T-22h");
    assert.equal(dueReminderRung(slot, lead, t(2), [first]), 2);
    assert.equal(dueReminderRung(slot, lead, t(1), [first, t(2)]), null, "and only once");
  });

  test("booked inside a rung: the booking confirmation covers it", () => {
    const confirmation = t(20);
    assert.equal(dueReminderRung(slot, lead, t(19.75), [confirmation]), null);
    assert.equal(dueReminderRung(slot, lead, t(2), [confirmation]), 2);
  });

  test("never more reminders in total than configured offsets (bookings reminded under the old cadence)", () => {
    // Old cadence: T-24h and T-22h already went out. The T-2h rung must not add a third.
    assert.equal(dueReminderRung(slot, lead, t(2), [t(24), t(22)], 2), null);
    assert.equal(dueReminderRung(slot, lead, t(2), [t(24)], 1), 2);
  });

  test("no reminder once the call has started, and nonsense offsets are ignored", () => {
    assert.equal(dueReminderRung(slot, lead, slot, []), null);
    assert.equal(dueReminderRung(slot, [0, Number.NaN, -3], t(1), []), null);
  });

  test("a reminder already sent to the same number for a twin booking closes the rung", () => {
    // Two live bookings on one phone (17/09/2026) each ran their own clock; the caller passes the
    // number's reminders as attempts, so the second booking stays quiet.
    const twinReminder = new Date(t(24).getTime() + 5 * MIN);
    assert.equal(dueReminderRung(slot, lead, new Date(t(24).getTime() + 20 * MIN), [twinReminder]), null);
  });
});

describe("mayRetryAutoSend - a refused SOP send is not hammered", () => {
  test("first attempt, and one retry after a blip", () => {
    assert.equal(mayRetryAutoSend([]), true);
    assert.equal(mayRetryAutoSend([{ error: "WATI 502" }]), true);
  });
  test("two failures and the step is left for a human", () => {
    assert.equal(mayRetryAutoSend([{ error: "WATI 502" }, { error: "timeout" }]), false);
  });
  test("Meta's marketing cap is never retried automatically", () => {
    const cap = "Message undeliverable as Meta has restricted it for higher quality messaging";
    assert.equal(mayRetryAutoSend([{ error: cap }]), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// The no-show sweep only writes off someone who was told the time
// ═══════════════════════════════════════════════════════════════════

describe("callTimeNotice - was the CURRENT call time delivered?", () => {
  const friday = new Date("2026-09-18T13:15:00.000Z"); // 6:45 pm IST
  const monday = new Date("2026-09-21T12:30:00.000Z"); // 6:00 pm IST
  const label = formatDateTimeInZone(friday, "Asia/Kolkata");
  const old = formatDateTimeInZone(monday, "Asia/Kolkata");
  const split = (l: string) => ({ date: l.slice(0, l.lastIndexOf(", ")), time: l.slice(l.lastIndexOf(", ") + 2) });
  const row = (kind: NoticeRow["kind"], status: NoticeRow["status"], vars: Record<string, string> | null, h: number): NoticeRow => ({
    kind,
    status,
    params: vars ? { template: "t", vars } : null,
    createdAt: at(h * HR),
  });

  test("the SOP's date + time rejoin to exactly the formatter's label", () => {
    assert.equal(namedCallTime({ vars: split(label) }), label);
    assert.equal(namedCallTime({ vars: { slot_time: label } }), label);
    assert.equal(namedCallTime(null), null);
  });

  test("the production case: told the OLD time, the reschedule and every reminder FAILED -> not told", () => {
    const rows = [
      row("BOOKING_CONFIRMATION", "READ", { slot_time: old }, 0),
      row("SOP_DISCO_WELCOME", "DELIVERED", split(old), 1),
      row("BOOKING_RESCHEDULED", "FAILED", { slot_time: label }, 2),
      row("BOOKING_REMINDER", "FAILED", { slot_time: label }, 3),
      row("BOOKING_REMINDER", "FAILED", { slot_time: label }, 11),
    ];
    assert.deepEqual(callTimeNotice(rows, label), { told: false, reason: "never-told" });
  });

  test("delivered once, but the latest word about this time bounced -> a human looks first", () => {
    const rows = [
      row("BOOKING_RESCHEDULED", "DELIVERED", { slot_time: label }, 2),
      row("BOOKING_REMINDER", "FAILED", { slot_time: label }, 11),
    ];
    assert.deepEqual(callTimeNotice(rows, label), { told: false, reason: "last-notice-undelivered" });
  });

  test("the latest message naming this time was delivered -> told, the sweep may proceed", () => {
    const rows = [row("BOOKING_REMINDER", "FAILED", { slot_time: label }, 3), row("SOP_DISCO_CONFIRM_2", "SENT", split(label), 5)];
    assert.deepEqual(callTimeNotice(rows, label), { told: true });
  });

  test("QUEUED and SKIPPED are not deliveries; rows with no params never count", () => {
    assert.equal(callTimeNotice([row("BOOKING_CONFIRMATION", "QUEUED", { slot_time: label }, 0)], label).told, false);
    assert.equal(callTimeNotice([row("BOOKING_CONFIRMATION", "SKIPPED", { slot_time: label }, 0)], label).told, false);
    assert.equal(callTimeNotice([row("BOOKING_CONFIRMATION", "READ", null, 0)], label).told, false);
    assert.equal(callTimeNotice([], label).told, false);
  });

  test("a kind that does not name the call time is ignored", () => {
    assert.equal(callTimeNotice([row("SOP_FOLLOWUP", "READ", { slot_time: label }, 0)], label).told, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// One live discovery booking per person
// ═══════════════════════════════════════════════════════════════════

describe("findLiveBookingForPerson", () => {
  /**
   * A stand-in for libphonenumber, whose metadata bundle does not load under this runner: digits
   * only, a leading 0 or a bare 10-digit number read as Indian. Enough to prove the MATCHING rule;
   * the real normaliser is what the server passes in.
   */
  const norm = (raw: string | null): string | null => {
    const d = (raw ?? "").replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
    if (d.length === 10) return `91${d}`;
    return d;
  };
  const find = (person: Parameters<typeof findLiveBookingForPerson>[1]) => findLiveBookingForPerson(live, person, norm);
  const live = [
    { id: "a", phone: "+91 72049 11304", whatsapp: null, email: "ameen@example.com" },
    { id: "b", phone: "+49 1512 3456789", whatsapp: "+91 98765 43210", email: "other@example.com" },
  ];

  test("the same number in another format is the same person", () => {
    assert.equal(find({ phone: "917204911304", email: "new@example.com" })?.id, "a");
    assert.equal(find({ phone: "07204911304", email: "new@example.com" })?.id, "a");
  });

  test("a WhatsApp number on either side counts", () => {
    assert.equal(find({ phone: "+91 98765 43210", email: "x@example.com" })?.id, "b");
    assert.equal(
      find({ phone: "+44 20 7946 0958", whatsapp: "+91 72049 11304", email: "x@example.com" })?.id,
      "a",
    );
  });

  test("the same email, whatever its case or spacing, is the same person", () => {
    assert.equal(find({ phone: "+44 20 7946 0958", email: "  AMEEN@example.com " })?.id, "a");
  });

  test("a different person books freely", () => {
    assert.equal(find({ phone: "+44 20 7946 0958", email: "someone@example.com" }), null);
    assert.equal(findLiveBookingForPerson([], { phone: "917204911304", email: "ameen@example.com" }, norm), null);
  });
});
