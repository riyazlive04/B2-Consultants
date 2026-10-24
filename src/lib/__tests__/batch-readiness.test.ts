import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  activationBlockers,
  batchBlockers,
  batchReadiness,
  canActivateBatch,
  capacityBand,
  describeBlockers,
  seatCount,
  seatMechanism,
  type BatchReadinessInput,
} from "../batch";

/**
 * The seat definition and the derived cohort lifecycle (docs/refactor/04-refactor-plan.md,
 * steps B2 and B3).
 *
 * Two things are being pinned here, and both are about NOT breaking live data:
 *
 *   1. `seatCount` counts both mechanisms. The bug it closes is that `claimSeat` (German Note)
 *      counted only members while `seatEnrollment` (B2) counted both, over one `targetStrength`.
 *   2. `batchReadiness` is derived, so every row that exists today must classify correctly with
 *      nothing written. The tests below use the two shapes the live database actually holds:
 *      German Note cohorts with no start date and no curriculum, and B2 cohorts built from a
 *      plan.
 */

const on = new Date("2026-10-23T12:00:00Z");

/** A complete, running B2 cohort - the shape everything else deviates from. */
const b2: BatchReadinessInput = {
  status: "ACTIVE",
  line: "B2",
  curriculumTemplateId: "tpl_1",
  tutorId: "usr_coach",
  startDate: new Date("2026-10-01"),
  endDate: null,
  seats: { members: 0, seatedEnrollments: 6 },
  sessionCount: 12,
  upcomingSessionCount: 5,
};

/** A real German Note cohort as live holds them: members, no curriculum, no dates. */
const gn: BatchReadinessInput = {
  status: "ACTIVE",
  line: "GERMAN_NOTE",
  curriculumTemplateId: null,
  tutorId: "usr_tutor",
  startDate: null,
  endDate: null,
  seats: { members: 8, seatedEnrollments: 0 },
  sessionCount: 0,
  upcomingSessionCount: 0,
};

describe("a seat is a seat, whichever row holds it", () => {
  test("counts both mechanisms", () => {
    assert.equal(seatCount({ members: 0, seatedEnrollments: 0 }), 0);
    assert.equal(seatCount({ members: 8, seatedEnrollments: 0 }), 8);
    assert.equal(seatCount({ members: 0, seatedEnrollments: 6 }), 6);
  });

  /**
   * THE BUG THIS FILE EXISTS FOR.
   *
   * A German Note cohort of target 8 holding 6 members and 2 seated enrolments is FULL. The old
   * `claimSeat` saw 6 and let a ninth person in without the over-capacity prompt, while
   * `seatEnrollment` looking at the same row saw 8 and refused. One column, two answers.
   */
  test("a mixed cohort is full when the two kinds together reach target", () => {
    const filled = seatCount({ members: 6, seatedEnrollments: 2 });
    assert.equal(filled, 8);
    assert.equal(capacityBand(filled, 8), "full");
    // What the member-only count would have said, and why it was wrong:
    assert.equal(capacityBand(6, 8), "filling");
  });

  test("over capacity is still a band, not a refusal", () => {
    assert.equal(capacityBand(seatCount({ members: 5, seatedEnrollments: 4 }), 8), "over");
  });

  test("each line declares its mechanism", () => {
    assert.equal(seatMechanism("B2"), "ENROLLMENT");
    assert.equal(seatMechanism("GERMAN_NOTE"), "MEMBER");
  });
});

describe("readiness - the live shapes must classify correctly with nothing written", () => {
  test("a complete, started B2 cohort is ACTIVE", () => {
    assert.equal(batchReadiness(b2, on), "ACTIVE");
    assert.deepEqual(batchBlockers(b2), []);
  });

  /**
   * The test that protects twenty-odd live rows. German Note cohorts have no curriculum and no
   * start date, and a readiness rule that demanded both of every line would have marked every
   * real GN cohort as a draft on the day this shipped.
   */
  test("a German Note cohort with members and a tutor is READY, not DRAFT", () => {
    assert.deepEqual(batchBlockers(gn), ["dates"]);
    assert.deepEqual(activationBlockers(gn), []);
    assert.equal(batchReadiness(gn, on), "READY");
  });

  test("archived wins over everything, however incomplete", () => {
    const bare: BatchReadinessInput = {
      ...b2,
      status: "ARCHIVED",
      curriculumTemplateId: null,
      tutorId: null,
      startDate: null,
      seats: { members: 0, seatedEnrollments: 0 },
      sessionCount: 0,
      upcomingSessionCount: 0,
    };
    assert.equal(batchReadiness(bare, on), "ARCHIVED");
  });

  test("a brand new, empty cohort is DRAFT - not ACTIVE as the column claims", () => {
    const fresh: BatchReadinessInput = {
      status: "ACTIVE",
      line: "B2",
      curriculumTemplateId: null,
      tutorId: null,
      startDate: null,
      endDate: null,
      seats: { members: 0, seatedEnrollments: 0 },
      sessionCount: 0,
      upcomingSessionCount: 0,
    };
    assert.equal(batchReadiness(fresh, on), "DRAFT");
    assert.deepEqual(batchBlockers(fresh), [
      "curriculum",
      "teacher",
      "dates",
      "timetable",
      "learners",
    ]);
  });

  test("each missing prerequisite on its own keeps it out of READY", () => {
    assert.equal(batchReadiness({ ...b2, curriculumTemplateId: null }, on), "DRAFT");
    assert.equal(batchReadiness({ ...b2, tutorId: null }, on), "DRAFT");
    assert.equal(
      batchReadiness({ ...b2, seats: { members: 0, seatedEnrollments: 0 } }, on),
      "DRAFT",
    );
  });

  test("a cohort seated only by members still counts as having learners", () => {
    const mixed = { ...b2, seats: { members: 3, seatedEnrollments: 0 } };
    assert.ok(!batchBlockers(mixed).includes("learners"));
  });

  test("complete but not yet started is READY", () => {
    const upcoming = { ...b2, startDate: new Date("2026-12-01"), upcomingSessionCount: 12 };
    assert.equal(batchReadiness(upcoming, on), "READY");
  });

  test("every class in the past is COMPLETED", () => {
    assert.equal(batchReadiness({ ...b2, upcomingSessionCount: 0 }, on), "COMPLETED");
  });

  test("COMPLETED reverses when a make-up class is added - which a stored column could not", () => {
    const done = { ...b2, upcomingSessionCount: 0 };
    assert.equal(batchReadiness(done, on), "COMPLETED");
    assert.equal(batchReadiness({ ...done, sessionCount: 13, upcomingSessionCount: 1 }, on), "ACTIVE");
  });

  test("an end date in the past is COMPLETED even with classes still listed", () => {
    const ended = { ...b2, endDate: new Date("2026-10-01"), upcomingSessionCount: 2 };
    assert.equal(batchReadiness(ended, on), "COMPLETED");
  });

  test("an empty calendar is never COMPLETED - nothing has been taught", () => {
    const noClasses = { ...b2, sessionCount: 0, upcomingSessionCount: 0 };
    assert.equal(batchReadiness(noClasses, on), "ACTIVE");
  });
});

describe("the activation gate", () => {
  test("the gate is a plan, a teacher and a learner - not dates or a built timetable", () => {
    const noDatesOrTimetable = { ...b2, startDate: null, sessionCount: 0, upcomingSessionCount: 0 };
    assert.deepEqual(batchBlockers(noDatesOrTimetable), ["dates", "timetable"]);
    assert.deepEqual(canActivateBatch(noDatesOrTimetable), { ok: true, blockers: [] });
  });

  test("refuses, and says why, when a gated prerequisite is missing", () => {
    const empty = { ...b2, curriculumTemplateId: null, seats: { members: 0, seatedEnrollments: 0 } };
    const res = canActivateBatch(empty);
    assert.equal(res.ok, false);
    assert.deepEqual(res.blockers, ["curriculum", "learners"]);
    assert.equal(describeBlockers(res.blockers), "Needs a plan to teach from and at least one learner");
  });

  test("a German Note cohort needs no plan to activate", () => {
    assert.equal(canActivateBatch(gn).ok, true);
  });

  test("the reason reads as a sentence for one, two and three blockers", () => {
    assert.equal(describeBlockers([]), "");
    assert.equal(describeBlockers(["teacher"]), "Needs someone to teach it");
    assert.equal(
      describeBlockers(["curriculum", "teacher", "learners"]),
      "Needs a plan to teach from, someone to teach it and at least one learner",
    );
  });
});
