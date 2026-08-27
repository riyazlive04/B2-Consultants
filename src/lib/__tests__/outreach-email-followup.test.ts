/**
 * Step 6b - the booking chase by email.
 *
 * The email follow-up rides the SAME trigger as the WhatsApp one (Check 1 came back "not
 * booked"), so these tests pin what is easy to get wrong: that it never fires before the check
 * has run, and that its send time cannot move any deadline.
 *
 * Also covers fractional SLA windows, because "check back in 15 minutes" is stored as 0.25 hours
 * and the whole ladder does its arithmetic in hours - and the opt-in anchor for Check 2, which
 * is what makes a settings box reading "120 min" actually mean 120 minutes since the prospect
 * opted in, rather than 120 minutes after whenever the chase happened to go out.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planJourney, type JourneyState, type StepState } from "../outreach-engine";
import { DEFAULT_SLA, OUTREACH_STEPS } from "../outreach-sop";
import type { OutreachStep } from "@prisma/client";

const MIN = 60_000;
const HR = 3_600_000;
const T0 = new Date("2026-07-15T06:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function base(over: Partial<JourneyState> = {}): JourneyState {
  return {
    phase: "BOOKING_CHASE",
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

function done(state: JourneyState, s: OutreachStep, when: Date, outcome: string | null = null): JourneyState {
  return { ...state, steps: { ...state.steps, [s]: step({ status: "SENT", dueAt: when, actedAt: when, outcome }) } };
}

const planned = (state: JourneyState, now: Date, s: OutreachStep, sla = DEFAULT_SLA) =>
  planJourney(state, now, sla).materialise.find((m) => m.step === s);

describe("Step 6b - email follow-up", () => {
  test("is defined on the EMAIL channel with a subject", () => {
    const def = OUTREACH_STEPS.find((s) => s.step === "FOLLOWUP_EMAIL");
    assert.ok(def, "FOLLOWUP_EMAIL must exist in the ladder");
    assert.equal(def.channel, "EMAIL");
    assert.ok(def.body, "an email step needs a body");
    assert.ok(def.subject, "an email step needs a subject or it cannot be sent");
  });

  test("does NOT fire before Check 1 has run", () => {
    const s = done(base(), "INTRO_WHATSAPP", T0);
    assert.equal(planned(s, at(1 * HR), "FOLLOWUP_EMAIL"), undefined);
  });

  test("fires on the same trigger as the WhatsApp follow-up, once Check 1 has run", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(2 * HR));
    const wa = planned(s, at(2 * HR), "FOLLOWUP_WHATSAPP");
    const em = planned(s, at(2 * HR), "FOLLOWUP_EMAIL");
    assert.ok(wa, "WhatsApp follow-up should still be planned");
    assert.ok(em, "email follow-up should be planned alongside it");
    assert.equal(em.dueAt.getTime(), wa.dueAt.getTime(), "both chase the prospect at the same moment");
  });

  test("never fires once the prospect has booked", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(2 * HR));
    s = { ...s, booked: true };
    assert.equal(planned(s, at(2 * HR), "FOLLOWUP_EMAIL"), undefined);
  });

  // The regression this guards: Check 2 is measured from OPT-IN, so neither follow-up's send
  // time may move it. Before the anchor moved it rode on the WhatsApp step, which meant a late
  // cron tick silently shifted the founder's deadline.
  test("neither follow-up's send time moves Check 2 - it is measured from opt-in", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(2 * HR));
    s = done(s, "FOLLOWUP_WHATSAPP", at(2 * HR));
    s = done(s, "FOLLOWUP_EMAIL", at(5 * HR)); // deliberately much later
    assert.equal(
      planned(s, at(5 * HR), "CHECK_2")!.dueAt.getTime(),
      at(DEFAULT_SLA.check2Hours * HR).getTime(),
      "Check 2 is opt-in + check2Hours, whenever the chase happened to go out",
    );
  });

  test("an email follow-up alone does not schedule Check 2", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(2 * HR));
    s = done(s, "FOLLOWUP_EMAIL", at(2 * HR));
    assert.equal(planned(s, at(2 * HR), "CHECK_2"), undefined);
  });
});

describe("fractional SLA windows", () => {
  // The founder's live settings: check back 15 minutes after the intro, then again at the
  // 2-hour mark. 0.25h and 2h are what the settings screen writes when it saves "15" and "120".
  const sla = { ...DEFAULT_SLA, check1Hours: 0.25, check2Hours: 2 };

  test("Check 1 at 0.25h lands exactly 15 minutes after the intro", () => {
    const s = done(base(), "INTRO_WHATSAPP", T0);
    assert.equal(planned(s, T0, "CHECK_1", sla)!.dueAt.getTime(), at(15 * MIN).getTime());
  });

  test("Check 2 at 120 minutes lands exactly 2h after OPT-IN", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(15 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(15 * MIN));
    assert.equal(planned(s, at(15 * MIN), "CHECK_2", sla)!.dueAt.getTime(), at(2 * HR).getTime());
  });

  // The retrofit case that skewed the first live test: Step 6 ran an hour late, and under the
  // old anchor that dragged Check 2 an hour late with it. Opt-in anchoring holds the deadline.
  test("a late follow-up does not drag Check 2 with it", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(76 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(76 * MIN));
    assert.equal(planned(s, at(76 * MIN), "CHECK_2", sla)!.dueAt.getTime(), at(2 * HR).getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════
// The founder's full opt-in flow (25/08/2026): 5min → 120min → 180min → 300min
// ═══════════════════════════════════════════════════════════════════

describe("the founder's booking-chase cadence", () => {
  const sla = {
    ...DEFAULT_SLA,
    check1Hours: 5 / 60, // 5 minutes
    check2Hours: 2,
    check3Hours: 3,
    finalCheckHours: 5,
  };

  test("every check is measured from opt-in, so the four windows form one timeline", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    assert.equal(planned(s, T0, "CHECK_1", sla)!.dueAt.getTime(), at(5 * MIN).getTime());

    s = done(s, "CHECK_1", at(5 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(5 * MIN));
    assert.equal(planned(s, at(5 * MIN), "CHECK_2", sla)!.dueAt.getTime(), at(2 * HR).getTime());

    s = done(s, "CHECK_2", at(2 * HR));
    s = done(s, "FOLLOWUP_WHATSAPP_2", at(2 * HR));
    assert.equal(planned(s, at(2 * HR), "CHECK_3", sla)!.dueAt.getTime(), at(3 * HR).getTime());

    s = done(s, "CHECK_3", at(3 * HR));
    s = done(s, "FOLLOWUP_CALL", at(3 * HR), "YES");
    assert.equal(planned(s, at(3 * HR), "FINAL_CHECK", sla)!.dueAt.getTime(), at(5 * HR).getTime());
  });

  test("the second WhatsApp chase waits for Check 2, not Check 1", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(5 * MIN));
    assert.equal(planned(s, at(5 * MIN), "FOLLOWUP_WHATSAPP_2", sla), undefined);
  });

  test("the telecaller is not raised until the SECOND message has also failed", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(5 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(5 * MIN));
    s = done(s, "CHECK_2", at(2 * HR));
    // Check 2 has run but the second chase has not been sent - no call yet.
    assert.equal(planned(s, at(2 * HR), "FOLLOWUP_CALL", sla), undefined);
  });
});

describe("qualification outcome after a booking", () => {
  const sla = { ...DEFAULT_SLA, postBookingDelayMinutes: 5 };

  // `discoAt` is REQUIRED, not decoration: the ladder is gated on the call still being ahead of
  // us, and every message it sends names the date. A booking with no slot has no date to name.
  function booked(q: "YES" | "NO") {
    let s = base({ booked: true, qualified: q, discoAt: at(48 * HR) });
    s = done(s, "BANT_QUALIFICATION", T0);
    s = done(s, "KEY_METRICS_TRANSFER", T0);
    return s;
  }

  test("qualified: welcome goes out on BOTH channels, 5 minutes after", () => {
    const s = booked("YES");
    for (const step of ["DISCO_WELCOME", "DISCO_WELCOME_EMAIL"] as const) {
      assert.equal(planned(s, T0, step, sla)!.dueAt.getTime(), at(5 * MIN).getTime(), step);
    }
  });

  test("not qualified: the notice goes out on both channels and NO welcome is sent", () => {
    const s = booked("NO");
    assert.ok(planned(s, T0, "DISCO_REJECT_MSG", sla));
    assert.ok(planned(s, T0, "DISCO_REJECT_EMAIL", sla));
    assert.equal(planned(s, T0, "DISCO_WELCOME", sla), undefined);
  });

  // The ordering that matters: nobody should find an empty calendar before being told why.
  test("not qualified: the call is NOT released until the prospect has been told", () => {
    const s = booked("NO");
    assert.equal(planned(s, T0, "DISCO_CANCEL", sla), undefined, "cancel must wait for the notice");

    const told = done(s, "DISCO_REJECT_EMAIL", at(5 * MIN));
    assert.ok(planned(told, at(5 * MIN), "DISCO_CANCEL", sla), "once told, the slot is released");
  });

  // WhatsApp cannot send this without an approved template, so requiring BOTH channels would
  // strand the cancellation forever.
  test("either channel alone is enough to release the call", () => {
    const viaWhatsApp = done(booked("NO"), "DISCO_REJECT_MSG", at(5 * MIN));
    assert.ok(planned(viaWhatsApp, at(5 * MIN), "DISCO_CANCEL", sla));
  });

  test("a zero after-booking delay sends immediately, as the SOP specifies", () => {
    const s = booked("YES");
    const immediate = { ...sla, postBookingDelayMinutes: 0 };
    assert.equal(planned(s, T0, "DISCO_WELCOME", immediate)!.dueAt.getTime(), T0.getTime());
  });
});

describe("the write-off deadline cannot be stranded by an upstream stall", () => {
  const sla = { ...DEFAULT_SLA, check1Hours: 5 / 60, check2Hours: 2, check3Hours: 3, finalCheckHours: 5 };

  // The real incident: SOP_FOLLOWUP_2 had no approved WhatsApp template, so the second chase
  // could never send, and under the old chain that switched off the 300-minute rule entirely.
  test("a message stuck DUE forever does not stop the final check", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(5 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(5 * MIN));
    s = done(s, "CHECK_2", at(2 * HR));
    // FOLLOWUP_WHATSAPP_2 materialised but never sent - no acted timestamp.
    s = { ...s, steps: { ...s.steps, FOLLOWUP_WHATSAPP_2: step({ status: "DUE", dueAt: at(2 * HR), actedAt: null }) } };

    assert.equal(planned(s, at(2 * HR), "CHECK_3", sla), undefined, "the chain itself is unchanged");
    assert.equal(
      planned(s, at(2 * HR), "FINAL_CHECK", sla)!.dueAt.getTime(),
      at(5 * HR).getTime(),
      "but the deadline still exists, measured from opt-in",
    );
  });

  test("an explicit NO at the follow-up call still ends the cycle with no final check", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "FOLLOWUP_CALL", at(3 * HR), "NO");
    assert.equal(planned(s, at(3 * HR), "FINAL_CHECK", sla), undefined);
  });

  test("a booked prospect never gets a final check", () => {
    const s = { ...done(base(), "INTRO_WHATSAPP", T0), booked: true };
    assert.equal(planned(s, at(5 * HR), "FINAL_CHECK", sla), undefined);
  });
});

describe("the disco ladder never fires for a call that has already happened", () => {
  const sla = { ...DEFAULT_SLA, postBookingDelayMinutes: 5 };

  function bookedAt(discoAt: Date, q: "YES" | "NO" = "YES") {
    let s = base({ phase: "QUALIFICATION", booked: true, qualified: q, discoAt });
    s = done(s, "BANT_QUALIFICATION", T0);
    return s;
  }

  /**
   * The 27/08/2026 near-miss. Closing Step 11's row retroactively started this ladder for two
   * prospects whose calls had passed two days earlier - "your Discovery Call is confirmed for
   * [DATE]" was five minutes from being sent about an appointment that had already been written
   * off as a no-show.
   */
  test("a welcome is NOT planned when the call time is in the past", () => {
    const s = bookedAt(at(-2 * HR));
    assert.equal(planned(s, T0, "DISCO_WELCOME", sla), undefined);
    assert.equal(planned(s, T0, "DISCO_WELCOME_EMAIL", sla), undefined);
  });

  test("no confirmation reminder is planned for a past call either", () => {
    const s = bookedAt(at(-2 * HR));
    assert.equal(planned(s, T0, "DISCO_CONFIRM_1", sla), undefined);
  });

  test("the not-qualified notice is also suppressed once the call has passed", () => {
    const s = bookedAt(at(-2 * HR), "NO");
    assert.equal(planned(s, T0, "DISCO_REJECT_MSG", sla), undefined);
    assert.equal(planned(s, T0, "DISCO_REJECT_EMAIL", sla), undefined);
  });

  test("but an UPCOMING call still gets the full ladder", () => {
    const s = bookedAt(at(48 * HR));
    assert.ok(planned(s, T0, "DISCO_WELCOME", sla), "a future call must still be welcomed");
    assert.ok(planned(s, T0, "DISCO_CONFIRM_1", sla));
  });
});

describe("a journey that ends in this pass is handed no new work", () => {
  const sla = { ...DEFAULT_SLA, check1Hours: 5 / 60, check2Hours: 2, check3Hours: 3, finalCheckHours: 5 };

  /**
   * The 27/08/2026 orphan. The final check wrote a prospect off and the SAME plan handed her a
   * FOLLOWUP_CALL. `pendingReminders` only sees steps already DUE, so the new one survived - and
   * the engine's scan skips terminal phases, so nothing ever came back for it. A telecaller was
   * left holding a call for a lead the system had closed.
   */
  test("the final check does not also raise a telecaller call", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(5 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(5 * MIN));
    s = done(s, "CHECK_2", at(2 * HR));
    s = done(s, "FOLLOWUP_WHATSAPP_2", at(2 * HR));
    s = done(s, "CHECK_3", at(3 * HR), "NOT_BOOKED");
    s = done(s, "FINAL_CHECK", at(5 * HR), "NOT_BOOKED");

    const plan = planJourney(s, at(5 * HR), sla);
    assert.equal(plan.phase, "IGNORED", "the final check ends the journey");
    assert.deepEqual(plan.materialise, [], "nothing new may be planned for a closed journey");
  });

  test("steps left DUE when the journey ends are superseded, not orphaned", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = { ...s, steps: { ...s.steps, FIRST_CALL: step({ status: "DUE", dueAt: T0, actedAt: null }) } };
    s = done(s, "CHECK_1", at(5 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(5 * MIN));
    s = done(s, "CHECK_2", at(2 * HR));
    s = done(s, "FOLLOWUP_WHATSAPP_2", at(2 * HR));
    s = done(s, "CHECK_3", at(3 * HR), "NOT_BOOKED");
    s = done(s, "FINAL_CHECK", at(5 * HR), "NOT_BOOKED");

    const plan = planJourney(s, at(5 * HR), sla);
    assert.ok(plan.supersede.includes("FIRST_CALL"), "an unworked call must not outlive the journey");
  });
});
