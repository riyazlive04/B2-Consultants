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
