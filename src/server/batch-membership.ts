import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import {
  levelFitsBatchLine,
  mergeBatchSeats,
  seatCount,
  seatMechanism,
  type BatchSeat,
  type SeatCandidate,
  type SeatCounts,
} from "@/lib/batch";
import { levelKinds } from "./levels";

/**
 * WHO IS IN THIS COHORT - the one answer, whichever table holds it (P1).
 *
 * ── The structural problem ──────────────────────────────────────────────────────────────
 * `Batch` has two parallel membership mechanisms and nothing in the schema says which applies:
 *
 *   · B2 coaching seats through `Enrollment.batchId` - a nullable column, `onDelete: SetNull`
 *   · German Note seats through the `BatchMember` join table - hard delete
 *
 * `Batch.line` decides, by convention only. The cost, as the inventory put it, is that every
 * feature touching "who is in this batch" has to be written twice - and when it is, the two
 * copies drift. That is not hypothetical: two capacity checks disagreed about the same cohort
 * for months, one counting members and the other counting members plus seated enrolments, so a
 * full German Note cohort would quietly admit a ninth person.
 *
 * ── What this module is, and what it is not ─────────────────────────────────────────────
 * It is the READ seam: one shape, one query, both mechanisms merged, so a new feature asking
 * "who is in this cohort" gets the right answer without having to know the fork exists. The
 * matching WRITE seam is `batch-seats.ts`, which dispatches to the existing tested action for
 * the mechanism - deliberately a dispatcher rather than a third writer.
 *
 * It is NOT the end of the fork. The two tables remain, with different delete semantics, and
 * collapsing them is a migration: `docs/refactor/migrations/` holds the proposal. Until that is
 * approved and applied, this is the seam that stops the fork spreading any further - and
 * `batch-membership.test.ts` fails if a new module queries `batchMember` outside it.
 *
 * ── Why the shape is lossy on purpose ──────────────────────────────────────────────────
 * A `BatchMember` row carries no programme level, no enrolment status and no coach, because
 * German Note has none of those things - a learner sits a course, they do not buy a coaching
 * tier. So those three fields are nullable here rather than invented. A caller that genuinely
 * needs an enrolment reads `enrollmentId` and goes and gets it; a caller that only needs to
 * know who is in the room is not forced to care which door they came through.
 */

/**
 * The Prisma selection both halves need, in one place.
 *
 * Exported because `batch-detail.ts` folds membership into a much larger single-query read of
 * the cohort - timetable, resources, attendance - and splitting that into two round trips to use
 * this module would cost a query on a page the founders open all day, for no gain. So it shares
 * the SELECT and the merge rather than the fetch. That is the compromise that keeps one rule
 * without making the page slower.
 */
export const BATCH_MEMBERSHIP_SELECT = {
  members: {
    select: { student: { select: { id: true, fullName: true, code: true } } },
    orderBy: { addedAt: "asc" },
  },
  enrollments: {
    select: {
      id: true,
      programLevel: true,
      status: true,
      student: { select: { id: true, fullName: true, code: true } },
      coach: { select: { name: true } },
      assignedCoach: true,
    },
    orderBy: { enrollmentDate: "asc" },
  },
} satisfies Prisma.BatchSelect;

/**
 * One cohort's roster, for a caller that holds nothing but the id.
 *
 * Note what is NOT filtered: the enrolment side selects every enrolment on the batch, including
 * someone who has left. That is right for a roster - "who has been in this cohort" is the
 * question a register and a history ask - and it is why capacity is counted by `seatsOf` below
 * rather than by `roster.length`. Confusing the two is the bug that made a cohort of ten read
 * ten-of-ten after two students dropped, refusing the replacements already sold to.
 */
export async function batchRoster(batchId: string): Promise<BatchSeat[]> {
  const b = await prisma.batch.findUnique({
    where: { id: batchId },
    select: BATCH_MEMBERSHIP_SELECT,
  });
  return b ? mergeBatchSeats(b) : [];
}

/**
 * How many seats are TAKEN in each of these cohorts - the capacity question, not the roster one.
 *
 * Counts members plus enrolments whose status still occupies a seat (`SEATED_STATUSES`), summed
 * by the one rule in `lib/batch.ts`. One `findMany` for any number of cohorts, because the
 * caller is usually a board drawing a list.
 */
export async function seatCountsFor(batchIds: string[]): Promise<Map<string, number>> {
  if (batchIds.length === 0) return new Map();
  const rows = await prisma.batch.findMany({
    where: { id: { in: batchIds } },
    select: {
      id: true,
      _count: {
        select: {
          members: true,
          enrollments: { where: { status: { in: [...SEATED_STATUSES] } } },
        },
      },
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      seatCount({ members: r._count.members, seatedEnrollments: r._count.enrollments }),
    ]),
  );
}

/** The seat counts of one cohort, in the shape the pure rules take. */
export function countsFromRelation(c: { members: number; enrollments: number }): SeatCounts {
  return { members: c.members, seatedEnrollments: c.enrollments };
}

/**
 * Who is available to seat in this cohort.
 *
 * B2: enrolments not already in a cohort, whose programme fits this line. An ENROLMENT is the
 * unit rather than a student because one student may hold several - and it is `Enrollment.batchId`
 * that is the seat.
 *
 * German Note: students who are not already members of THIS batch. A GN learner may legitimately
 * sit in more than one cohort over time (A1, then A2), so the filter is per-batch rather than
 * global; the `@@unique([batchId, studentId])` index is what makes that safe.
 */
export async function listSeatCandidates(batchId: string): Promise<SeatCandidate[]> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { line: true, level: true },
  });
  if (!batch) return [];

  if (seatMechanism(batch.line) === "MEMBER") {
    const existing = await prisma.batchMember.findMany({
      where: { batchId },
      select: { studentId: true },
    });
    const students = await prisma.student.findMany({
      where: { id: { notIn: existing.map((m) => m.studentId) } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, code: true },
      // A roster picker is not a browser for the whole student table; its search box narrows it.
      take: 500,
    });
    return students.map((s) => ({
      id: s.id,
      studentId: s.id,
      name: s.fullName,
      code: s.code,
      programLevel: null,
      mechanism: "MEMBER" as const,
    }));
  }

  /*
    The level/line filter is the COURTESY, not the guard - `seatEnrollment` re-applies
    `levelFitsBatchLine` server-side regardless. Offering a Guided client for an A1 cohort would
    only produce an error the operator cannot act on.

    A level missing from the active catalogue is KEPT rather than dropped: `lineForLevelKind` is
    deliberately null for OTHER, meaning "do not enforce", and silently hiding a real enrolment
    because its level was retired would be worse than offering one the action might refuse.
  */
  const kinds = await levelKinds();
  const rows = await prisma.enrollment.findMany({
    where: { batchId: null, status: { in: [...SEATED_STATUSES] } },
    orderBy: [{ student: { fullName: "asc" } }],
    select: {
      id: true,
      programLevel: true,
      student: { select: { id: true, fullName: true, code: true } },
    },
    take: 500,
  });

  return rows
    .filter((e) => {
      const kind = kinds.get(e.programLevel);
      return kind === undefined || levelFitsBatchLine(kind, batch.line);
    })
    .map((e) => ({
      id: e.id,
      studentId: e.student.id,
      name: e.student.fullName,
      code: e.student.code,
      programLevel: e.programLevel,
      mechanism: "ENROLLMENT" as const,
    }));
}

/**
 * Re-exported so a caller needs one import, not three. The SHAPE and the MERGE are pure and live
 * in `lib/batch.ts` (they are tested there); this module adds the queries around them.
 */
export { seatMechanism, mergeBatchSeats };
export type { BatchSeat, BatchMembershipRows } from "@/lib/batch";
