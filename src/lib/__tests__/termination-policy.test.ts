import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  openLeadWhere,
  futureSlotWhere,
  futureSssWhere,
  openTaskWhere,
  openOpportunityWhere,
  ownedCompanyWhere,
  activeJourneyWhere,
  SETTLED_LEAD_STAGES,
  TERMINAL_JOURNEY_PHASES,
} from "../termination-policy";

/**
 * These predicates decide what a departing person's successor inherits — and, far more
 * dangerously, what they DON'T. Commission is derived at read time from `Lead.assignedToId`, so a
 * predicate that accidentally swept up a WON lead would silently move past earnings from the
 * person who left to the person who replaced them. Nobody would notice until payroll.
 *
 * So these tests are about the BOUNDARY, not the queries: is this row a job still to be done, or
 * a claim about the past?
 */

const USER = "user_leaver";
const NOW = new Date("2026-08-03T09:00:00.000Z");

describe("termination policy — settled work is never migrated", () => {
  test("open leads are scoped to the person and exclude settled stages", () => {
    const w = openLeadWhere(USER);
    assert.equal(w.assignedToId, USER);
    assert.deepEqual(w.stage, { notIn: ["WON", "LOST"] });
    // Archived leads are not work either.
    assert.equal(w.deletedAt, null);
  });

  test("WON and LOST are the settled set — widening it needs a deliberate edit", () => {
    // Pinned because adding a stage here changes who gets paid. If a future stage means
    // "finished", it belongs in this list and this assertion should be updated on purpose.
    assert.deepEqual([...SETTLED_LEAD_STAGES], ["WON", "LOST"]);
  });

  test("a WON lead cannot match the open-lead predicate", () => {
    // Expressed as the property that matters rather than as a query: whatever the clause looks
    // like, WON must be excluded.
    const { stage } = openLeadWhere(USER) as { stage: { notIn: string[] } };
    assert.ok(stage.notIn.includes("WON"), "a won lead's owner is who earned on it");
    assert.ok(stage.notIn.includes("LOST"));
  });
});

describe("termination policy — only future calls move", () => {
  test("discovery slots are bounded to now and later", () => {
    const w = futureSlotWhere(USER, NOW) as { assignedToId: string; startsAt: { gte: Date } };
    assert.equal(w.assignedToId, USER);
    assert.equal(w.startsAt.gte.getTime(), NOW.getTime());
    // A past slot records a call that did or did not happen — moving it rewrites whose call it
    // was, and the show-rate metrics read exactly that.
    assert.ok(!("lte" in w.startsAt), "must not reach backwards");
  });

  test("SSS slots follow the same rule on their own owner column", () => {
    const w = futureSssWhere(USER, NOW) as { ownerId: string; startsAt: { gte: Date } };
    assert.equal(w.ownerId, USER);
    assert.equal(w.startsAt.gte.getTime(), NOW.getTime());
  });
});

describe("termination policy — open means open", () => {
  test("only OPEN tasks move", () => {
    const w = openTaskWhere(USER);
    assert.equal(w.status, "OPEN");
    assert.equal(w.deletedAt, null);
  });

  test("only OPEN opportunities move — ABANDONED is settled too", () => {
    // A deal someone walked away from is a decision that already happened. Handing it on would
    // put work back on the board that the business had stopped doing.
    const w = openOpportunityWhere(USER);
    assert.equal(w.status, "OPEN");
  });

  test("company ownership moves, minus archived accounts", () => {
    const w = ownedCompanyWhere(USER);
    assert.equal(w.ownerId, USER);
    assert.equal(w.deletedAt, null);
  });
});

describe("termination policy — active journeys only", () => {
  test("terminal phases are excluded", () => {
    const w = activeJourneyWhere(USER) as { phase: { notIn: string[] }; OR: unknown[] };
    for (const phase of TERMINAL_JOURNEY_PHASES) {
      assert.ok(w.phase.notIn.includes(phase), `${phase} is finished business`);
    }
  });

  test("both journey roles are covered", () => {
    // Two separate columns — matching only one would strand half the handovers, and the person
    // left holding them has no login to notice with.
    const w = activeJourneyWhere(USER) as { OR: Record<string, string>[] };
    assert.deepEqual(w.OR, [{ respTouchpointId: USER }, { respDiscoId: USER }]);
  });
});

describe("termination policy — every predicate is scoped to one person", () => {
  test("no predicate can match another user's rows", () => {
    // The failure this guards against is a missing owner clause, which would migrate the WHOLE
    // table on the first offboarding.
    const all = [
      openLeadWhere(USER),
      futureSlotWhere(USER, NOW),
      futureSssWhere(USER, NOW),
      openTaskWhere(USER),
      openOpportunityWhere(USER),
      ownedCompanyWhere(USER),
      activeJourneyWhere(USER),
    ];
    for (const w of all) {
      const json = JSON.stringify(w);
      assert.ok(json.includes(USER), `a predicate with no owner clause would migrate everyone: ${json}`);
    }
  });
});
