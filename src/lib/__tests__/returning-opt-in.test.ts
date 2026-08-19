import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeadStage, OutreachPhase } from "@prisma/client";
import {
  DORMANT_PHASES,
  REOPENABLE_STAGES,
  planReturningOptIn,
  type ReturningLeadState,
} from "../returning-opt-in";

/** A lead that is live and owned - the "nothing to do" baseline. */
function state(over: Partial<ReturningLeadState> = {}): ReturningLeadState {
  return {
    stage: "NEW_LEAD",
    assignedToId: "user_1",
    deletedAt: null,
    journey: { phase: "BOOKING_CHASE", bookingId: null },
    ...over,
  };
}

describe("planReturningOptIn - the case this was built for", () => {
  it("re-opens the exact shape that went missing: LOST, unassigned, no journey", () => {
    // Mohamed: imported from Synamate in June, marked LOST, never assigned, no journey. Opted in
    // three times in fifteen minutes and appeared nowhere.
    const plan = planReturningOptIn(state({ stage: "LOST", assignedToId: null, journey: null }));
    assert.deepEqual(plan, {
      restore: false,
      reopenStage: true,
      needsOwner: true,
      restartJourney: true,
      reopened: true,
    });
  });

  it("is idempotent - the second opt-in a minute later changes nothing more", () => {
    // After the first re-open the lead is NEW_LEAD, owned, and on a fresh OPT_IN journey.
    const plan = planReturningOptIn(
      state({ stage: "NEW_LEAD", assignedToId: "user_1", journey: { phase: "OPT_IN", bookingId: null } }),
    );
    assert.equal(plan.reopened, false);
  });
});

describe("planReturningOptIn - an archived lead who comes back", () => {
  it("restores an archived lead and gives it the full fresh start", () => {
    // 19/08/2026: a card deleted from the board archived the lead; the same person re-submitted
    // ninety seconds later, was deduped onto the archived row, received the intro WhatsApp, and
    // was invisible on every board and desk. A new submission is the person, not the webhook.
    const plan = planReturningOptIn(
      state({ stage: "LOST", assignedToId: null, journey: null, deletedAt: new Date() }),
    );
    assert.deepEqual(plan, {
      restore: true,
      reopenStage: true,
      needsOwner: true,
      restartJourney: true,
      reopened: true,
    });
  });

  it("restores even when the archived lead was already NEW_LEAD and owned - but writes no stage row", () => {
    const plan = planReturningOptIn(state({ deletedAt: new Date() }));
    assert.equal(plan.restore, true);
    assert.equal(plan.reopenStage, false);
    assert.equal(plan.needsOwner, false);
    assert.equal(plan.restartJourney, true);
    assert.equal(plan.reopened, true);
  });

  it("restores an archived lead that had booked before - they are live again, whatever comes next", () => {
    const plan = planReturningOptIn(
      state({ stage: "LOST", deletedAt: new Date(), journey: { phase: "IGNORED", bookingId: "bk_1" } }),
    );
    assert.equal(plan.restore, true);
    assert.equal(plan.reopened, true);
  });
});

describe("planReturningOptIn - what it must not disturb", () => {

  it("leaves a lead that already booked alone, even when it looks dormant", () => {
    // bookingId set is the strongest signal there is: they are past the queue.
    const plan = planReturningOptIn(
      state({ stage: "LOST", assignedToId: null, journey: { phase: "IGNORED", bookingId: "bk_1" } }),
    );
    assert.equal(plan.reopened, false);
  });

  it("does not reset a live SLA - a mid-chase journey keeps its own clock", () => {
    const plan = planReturningOptIn(state({ journey: { phase: "BOOKING_CHASE", bookingId: null } }));
    assert.equal(plan.restartJourney, false);
  });

  it("does not restart a COMPLETED journey - that outreach succeeded", () => {
    const plan = planReturningOptIn(state({ journey: { phase: "COMPLETED", bookingId: null } }));
    assert.equal(plan.restartJourney, false);
  });

  it("never steals a lead that already has an owner", () => {
    const plan = planReturningOptIn(state({ stage: "LOST", assignedToId: "user_2" }));
    assert.equal(plan.needsOwner, false);
    assert.equal(plan.reopenStage, true, "the stage still re-opens - only the owner is preserved");
  });

  it("does not drag a customer back into the dial queue", () => {
    for (const stage of ["WON", "DEPOSIT_PAID"] as LeadStage[]) {
      const plan = planReturningOptIn(state({ stage }));
      assert.equal(plan.reopenStage, false, `${stage} must not re-open`);
    }
  });

  it("does not yank a lead out from under a caller working it", () => {
    for (const stage of ["DISCO_BOOKED", "PROPOSAL_SENT", "SSS_BOOKED"] as LeadStage[]) {
      assert.equal(planReturningOptIn(state({ stage })).reopenStage, false, `${stage} must not re-open`);
    }
  });
});

describe("planReturningOptIn - the three triggers are independent", () => {
  it("an unassigned but otherwise live lead gets an owner and nothing else", () => {
    const plan = planReturningOptIn(state({ assignedToId: null }));
    assert.deepEqual(plan, { restore: false, reopenStage: false, needsOwner: true, restartJourney: false, reopened: true });
  });

  it("a journeyless live lead gets a journey and nothing else", () => {
    const plan = planReturningOptIn(state({ journey: null }));
    assert.deepEqual(plan, { restore: false, reopenStage: false, needsOwner: false, restartJourney: true, reopened: true });
  });

  it("every dormant phase restarts the clock", () => {
    for (const phase of DORMANT_PHASES) {
      assert.equal(
        planReturningOptIn(state({ journey: { phase, bookingId: null } })).restartJourney,
        true,
        `${phase} should restart`,
      );
    }
  });

  it("no live phase restarts the clock", () => {
    const live: OutreachPhase[] = [
      "OPT_IN", "BOOKING_CHASE", "QUALIFICATION", "DISCO_CONFIRMATION",
      "AWAITING_DISCO", "HANDOFF", "SSS_CONFIRMATION", "COMPLETED",
    ];
    for (const phase of live) {
      assert.equal(
        planReturningOptIn(state({ journey: { phase, bookingId: null } })).restartJourney,
        false,
        `${phase} should not restart`,
      );
    }
  });
});

describe("the constants stay honest", () => {
  it("LOST is the only re-openable stage", () => {
    assert.deepEqual([...REOPENABLE_STAGES], ["LOST"]);
  });

  it("COMPLETED is never treated as dormant", () => {
    assert.equal(DORMANT_PHASES.includes("COMPLETED"), false);
  });
});
