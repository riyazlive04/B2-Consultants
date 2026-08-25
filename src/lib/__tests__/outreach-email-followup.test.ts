/**
 * Step 6b - the booking chase by email.
 *
 * The email follow-up rides the SAME trigger as the WhatsApp one (Check 1 came back "not
 * booked"), so these tests pin the two behaviours that are easy to get wrong: that it never
 * fires before the check has run, and that adding it did not move Check 2's anchor.
 *
 * Also covers fractional SLA windows, because "check back in 15 minutes" is stored as 0.25 hours
 * and the whole ladder does its arithmetic in hours.
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

  // The regression this guards: anchoring Check 2 on "whichever follow-up was acted on last"
  // would make the window depend on send order between two channels rather than on the process.
  test("Check 2 still anchors on the WhatsApp follow-up, not the email", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(2 * HR));
    s = done(s, "FOLLOWUP_WHATSAPP", at(2 * HR));
    s = done(s, "FOLLOWUP_EMAIL", at(5 * HR)); // deliberately much later
    assert.equal(
      planned(s, at(5 * HR), "CHECK_2")!.dueAt.getTime(),
      at(2 * HR + DEFAULT_SLA.check2Hours * HR).getTime(),
      "the email's send time must not move Check 2",
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
  // 0.25h = 15min, which is what the founder's settings screen now writes when it saves "15".
  const sla = { ...DEFAULT_SLA, check1Hours: 0.25, check2Hours: 1.75 };

  test("Check 1 at 0.25h lands exactly 15 minutes after the intro", () => {
    const s = done(base(), "INTRO_WHATSAPP", T0);
    assert.equal(planned(s, T0, "CHECK_1", sla)!.dueAt.getTime(), at(15 * MIN).getTime());
  });

  test("Check 2 at 1.75h after a 15-minute Check 1 lands 2h after opt-in", () => {
    let s = done(base(), "INTRO_WHATSAPP", T0);
    s = done(s, "CHECK_1", at(15 * MIN));
    s = done(s, "FOLLOWUP_WHATSAPP", at(15 * MIN));
    assert.equal(
      planned(s, at(15 * MIN), "CHECK_2", sla)!.dueAt.getTime(),
      at(2 * HR).getTime(),
      "15min + 1.75h is the 2-hour mark measured from opt-in",
    );
  });
});
