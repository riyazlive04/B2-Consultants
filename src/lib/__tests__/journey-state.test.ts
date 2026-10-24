import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  JOURNEY_STEPS,
  JOURNEY_STEP_COUNT,
  daysInStep,
  deriveJourney,
  isInFlight,
  journeyGaps,
  needsCompleting,
  reachedSteps,
  stepNumber,
  type JourneyInput,
} from "../journey-state";

/**
 * The onboarding journey (docs/refactor/04-refactor-plan.md, step B1).
 *
 * The cases that matter are not the happy path - they are the shapes the SIX different
 * student-creation doors actually leave behind, and the people who legitimately do not fit a
 * straight line: a German Note learner who was never a lead, somebody who paid before signing,
 * and a student the income form minted while recording a bank transfer.
 *
 * Every one of those exists in the live database today, and before this file nothing in the app
 * could name them.
 */

/** Nobody: the zero value, so each case below says only what it changes. */
const blank: JourneyInput = {
  leadStage: null,
  hasContact: false,
  hasBooking: false,
  hasDiscoveryOutcome: false,
  agreementStatus: null,
  hasStudent: false,
  hasEnrolment: false,
  programLevel: null,
  payment: { received: false, planned: false },
  seat: { batchId: null, readiness: null },
  hasPortalLogin: false,
  firstClassStarted: false,
};

/** The finished article: in class, nothing missing. */
const done: JourneyInput = {
  leadStage: "WON",
  hasContact: true,
  hasBooking: true,
  hasDiscoveryOutcome: true,
  agreementStatus: "SIGNED",
  hasStudent: true,
  hasEnrolment: true,
  programLevel: "GUIDED",
  payment: { received: true, planned: false },
  seat: { batchId: "bat_1", readiness: "ACTIVE" },
  hasPortalLogin: true,
  firstClassStarted: true,
};

describe("the rail itself", () => {
  test("ten steps, in order, each with a position", () => {
    assert.equal(JOURNEY_STEP_COUNT, 10);
    assert.equal(stepNumber("NEW"), 1);
    assert.equal(stepNumber("IN_CLASS"), 10);
    assert.deepEqual([...JOURNEY_STEPS].slice(0, 3), ["NEW", "CONTACTED", "CALL_BOOKED"]);
  });

  test("reached steps always come back in rail order, never insertion order", () => {
    // Seated and in class, but the discovery outcome was never written down.
    const r = reachedSteps({ ...done, hasDiscoveryOutcome: true });
    const positions = r.map((s) => stepNumber(s));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });
});

describe("the happy path", () => {
  test("a finished student is IN_CLASS, complete, and has nothing to do", () => {
    const j = deriveJourney(done);
    assert.equal(j.state, "IN_CLASS");
    assert.deepEqual(j.gaps, []);
    assert.equal(j.complete, true);
    assert.equal(j.progress, 1);
    assert.equal(j.next.target, "NOTHING");
    assert.equal(isInFlight(j), false);
  });

  test("each stage of the real sequence advances exactly one step", () => {
    const steps: Array<[Partial<JourneyInput>, string]> = [
      [{ leadStage: "NEW_LEAD" }, "NEW"],
      [{ leadStage: "NEW_LEAD", hasContact: true }, "CONTACTED"],
      [{ leadStage: "NEW_LEAD", hasContact: true, hasBooking: true }, "CALL_BOOKED"],
      [
        { leadStage: "NEW_LEAD", hasContact: true, hasBooking: true, hasDiscoveryOutcome: true },
        "DISCOVERY_DONE",
      ],
      [
        {
          leadStage: "WON",
          hasContact: true,
          hasBooking: true,
          hasDiscoveryOutcome: true,
        },
        "WON",
      ],
    ];
    for (const [patch, expected] of steps) {
      assert.equal(deriveJourney({ ...blank, ...patch }).state, expected, JSON.stringify(patch));
    }
  });

  test("the board's own stage is enough when the evidence rows are missing", () => {
    // A lead imported mid-pipeline has a stage and no CallLog, no booking, no outcome. The rail
    // must not claim they were never contacted.
    const j = deriveJourney({ ...blank, leadStage: "PROPOSAL_SENT" });
    assert.deepEqual(j.reached, ["NEW", "CONTACTED", "CALL_BOOKED", "DISCOVERY_DONE"]);
  });
});

describe("the shapes the six creation doors leave behind", () => {
  /**
   * DOOR 5 - the income form. Recording a bank transfer for an unknown name mints a Student with
   * no Enrollment: they have bought nothing, are in no cohort, have no level and no login. This
   * is the single case that most justifies the Needs-completing list.
   */
  test("a student minted by the income form is flagged, not called enrolled", () => {
    const j = deriveJourney({ ...blank, hasStudent: true, payment: { received: true, planned: false } });
    assert.equal(j.state, "NEW");
    assert.deepEqual(j.gaps, ["NO_ENROLMENT"]);
    assert.equal(j.next.target, "ENROL");
    assert.equal(j.next.action, "Set their programme and enrol them");
    assert.equal(needsCompleting(j), true);
  });

  /** DOORS 3 and 4 - converting a lead, and enrolling off a signed agreement. Same gap. */
  test("a converted lead with no enrolment is signed but not enrolled", () => {
    const j = deriveJourney({
      ...blank,
      leadStage: "WON",
      agreementStatus: "SIGNED",
      hasStudent: true,
    });
    assert.equal(j.state, "SIGNED");
    assert.deepEqual(j.gaps, ["NO_ENROLMENT"]);
  });

  test("enrolled but no programme level set", () => {
    const j = deriveJourney({ ...blank, hasStudent: true, hasEnrolment: true });
    // WON is reached because you do not enrol somebody who refused.
    assert.ok(j.reached.includes("WON"));
    assert.ok(!j.reached.includes("ENROLLED"), "no level means not enrolled yet");
    assert.deepEqual(j.gaps, ["NO_PROGRAMME_LEVEL", "NO_PAYMENT", "NOT_SEATED"]);
    assert.equal(j.next.target, "SET_PROGRAMME_LEVEL");
  });

  test("enrolled and paid, but never seated", () => {
    const j = deriveJourney({
      ...done,
      seat: { batchId: null, readiness: null },
      firstClassStarted: false,
      hasPortalLogin: false,
    });
    assert.equal(j.state, "ENROLLED");
    assert.deepEqual(j.gaps, ["NOT_SEATED"]);
    assert.equal(j.next.target, "SEAT_IN_COHORT");
  });

  test("seated with no portal login - they cannot see any of it", () => {
    const j = deriveJourney({ ...done, hasPortalLogin: false });
    assert.ok(j.gaps.includes("NO_PORTAL_LOGIN"));
    assert.equal(j.next.target, "CREATE_LOGIN");
    assert.equal(j.complete, false, "in class but unable to sign in is not finished");
  });

  /** The cohort problem is not the student's fault, and the rail says whose it is. */
  test("seated in a cohort that is still a draft", () => {
    const j = deriveJourney({ ...done, seat: { batchId: "bat_1", readiness: "DRAFT" } });
    assert.ok(j.gaps.includes("COHORT_NOT_READY"));
    assert.equal(j.next.target, "READY_COHORT");
    assert.equal(j.next.action, "Finish setting up their cohort");
  });
});

describe("people who do not fit a straight line", () => {
  /**
   * A German Note learner is added from the German Note Members screen as a `BatchMember`. They
   * have no Lead, no agreement and often no Enrollment - and they are genuinely in class.
   */
  test("a German Note member with no lead is seated and in class", () => {
    const j = deriveJourney({
      ...blank,
      hasStudent: true,
      seat: { batchId: "bat_gn", readiness: "ACTIVE" },
      hasPortalLogin: true,
      firstClassStarted: true,
    });
    assert.equal(j.state, "IN_CLASS");
    assert.deepEqual(j.reached, ["NEW", "SEATED", "IN_CLASS"]);
    // Still flagged for the thing that IS missing, without inventing sales steps they never had.
    assert.deepEqual(j.gaps, ["NO_ENROLMENT"]);
  });

  test("paid and seated before the agreement was ever sent - holes in the rail are allowed", () => {
    const j = deriveJourney({ ...done, agreementStatus: null });
    assert.equal(j.state, "IN_CLASS");
    assert.ok(!j.reached.includes("AGREEMENT_SENT"));
    assert.ok(!j.reached.includes("SIGNED"));
    assert.equal(j.complete, true, "a hole earlier on does not make them unfinished");
  });

  test("a payment PLAN satisfies the payment step as well as cash received", () => {
    const planned = { ...done, payment: { received: false, planned: true } };
    assert.ok(!journeyGaps(planned).includes("NO_PAYMENT"));
    const neither = { ...done, payment: { received: false, planned: false } };
    assert.ok(journeyGaps(neither).includes("NO_PAYMENT"));
  });
});

describe("exits", () => {
  test("the board's LOST and NO_SHOW are the only way to be lost", () => {
    assert.equal(deriveJourney({ ...blank, leadStage: "LOST" }).state, "LOST");
    assert.equal(deriveJourney({ ...blank, leadStage: "NO_SHOW" }).state, "LOST");
  });

  test("a declined agreement is lost", () => {
    const j = deriveJourney({ ...blank, leadStage: "WON", agreementStatus: "DECLINED" });
    assert.equal(j.state, "LOST");
    assert.equal(j.next.target, "NOTHING");
    assert.equal(isInFlight(j), false);
    assert.equal(needsCompleting(j), false, "a dead deal is not an incomplete one");
  });

  /**
   * An EXPIRED link is recoverable - void and re-issue - so it is a gap, not an exit. The
   * notification feed already words it exactly that way: "so the deal isn't lost to a dead link".
   */
  test("an expired signing link is a gap to fix, not a lost deal", () => {
    const j = deriveJourney({ ...blank, leadStage: "WON", agreementStatus: "EXPIRED" });
    assert.notEqual(j.state, "LOST");
    assert.deepEqual(j.gaps, ["AGREEMENT_EXPIRED"]);
    assert.equal(j.next.action, "Void and re-issue the agreement");
  });

  /**
   * A real row on live: a client who no-showed an early call, came back, signed and enrolled.
   * Their lead stage can still read NO_SHOW. Writing them off would be wrong and visible.
   */
  test("a stale LOST stage never overrides somebody who became a student", () => {
    const j = deriveJourney({ ...done, leadStage: "NO_SHOW" });
    assert.equal(j.state, "IN_CLASS");
  });

  test("a stalled lead is in flight, not lost - staleness is never inferred", () => {
    const j = deriveJourney({ ...blank, leadStage: "DISCO_BOOKED", hasBooking: true });
    assert.equal(j.state, "CALL_BOOKED");
    assert.equal(isInFlight(j), true);
  });
});

describe("gaps outrank progress", () => {
  /**
   * The rule that makes the rail honest. Somebody seated has got further than somebody merely
   * enrolled - but if their level was never set, "waiting for their first class" is useless
   * advice. The blocking gap is answered first.
   */
  test("a seated student with no programme level is told to set the level, not to wait", () => {
    const j = deriveJourney({ ...done, programLevel: null, firstClassStarted: false });
    assert.equal(j.state, "SEATED");
    assert.equal(j.next.target, "SET_PROGRAMME_LEVEL");
  });

  test("with no gaps, the rail suggests the next step forward", () => {
    const j = deriveJourney({
      ...blank,
      leadStage: "DISCO_COMPLETED",
      hasContact: true,
      hasBooking: true,
      hasDiscoveryOutcome: true,
    });
    assert.equal(j.state, "DISCOVERY_DONE");
    assert.equal(j.next.target, "MOVE_DEAL");
    assert.equal(j.next.step, "WON");
  });

  test("won with no agreement yet is prompted to send one - the seam that had no screen", () => {
    const j = deriveJourney({ ...blank, leadStage: "WON", hasContact: true });
    assert.equal(j.state, "WON");
    assert.equal(j.next.target, "SEND_AGREEMENT");
    assert.equal(j.next.action, "Send the agreement");
  });

  test("sent and waiting is not an action for us", () => {
    const j = deriveJourney({ ...blank, leadStage: "WON", agreementStatus: "VIEWED" });
    assert.equal(j.state, "AGREEMENT_SENT");
    assert.equal(j.next.target, "AWAIT_SIGNATURE");
  });
});

describe("board grouping", () => {
  test("in flight, needs completing and done are the three buckets", () => {
    const finished = deriveJourney(done);
    const stuck = deriveJourney({ ...done, hasPortalLogin: false });
    const lost = deriveJourney({ ...blank, leadStage: "LOST" });
    const fresh = deriveJourney({ ...blank, leadStage: "NEW_LEAD" });

    assert.deepEqual(
      [isInFlight(finished), isInFlight(stuck), isInFlight(lost), isInFlight(fresh)],
      [false, true, false, true],
    );
    assert.deepEqual(
      [needsCompleting(finished), needsCompleting(stuck), needsCompleting(lost), needsCompleting(fresh)],
      [false, true, false, false],
    );
  });

  test("nobody at all is NEW with no progress, not a crash", () => {
    const j = deriveJourney(blank);
    assert.equal(j.state, "NEW");
    assert.deepEqual(j.reached, []);
    assert.equal(j.progress, 0);
  });
});

describe("days in step", () => {
  const on = new Date("2026-10-23T12:00:00Z");

  test("counts whole days and ignores the time of day", () => {
    assert.equal(daysInStep(new Date("2026-10-20T23:00:00Z"), on), 3);
    assert.equal(daysInStep(new Date("2026-10-23T01:00:00Z"), on), 0);
  });

  test("an undatable row reports nothing rather than claiming zero", () => {
    assert.equal(daysInStep(null, on), null);
  });

  test("a future date clamps to zero instead of going negative", () => {
    assert.equal(daysInStep(new Date("2026-11-01"), on), 0);
  });
});
