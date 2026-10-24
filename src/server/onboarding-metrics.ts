import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { occupiesSeat, SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import { batchReadiness, type BatchReadiness } from "@/lib/batch";
import {
  JOURNEY_STEPS,
  daysInStep,
  deriveJourney,
  isInFlight,
  needsCompleting,
  type Journey,
  type JourneyInput,
  type JourneyStep,
} from "@/lib/journey-state";

/**
 * THE ONBOARDING BOARD - everyone between "stranger" and "in class", on one screen.
 *
 * The journey the business runs on had no screen. Its two halves lived apart - `Lead.stage` for
 * the sales side, `Student` + `Enrollment` + a seat for delivery - with nothing joining them, so
 * nothing could say where a person had got to and nothing could list the ones stuck in between.
 * Doing it by hand meant about fifteen screens across six nav groups.
 *
 * `lib/journey-state.ts` holds the rule. This file is only the reads that feed it.
 *
 * ── Round trips, not wall-clock ─────────────────────────────────────────────────────────
 * The live database is Supabase in Singapore at roughly 200ms a round trip, so what decides
 * whether this screen is usable is the NUMBER of queries, never how fast they are locally. An
 * obvious implementation - fetch the leads, then per lead fetch their agreement, their student,
 * their enrolment, their batch - is an N+1 that would take half a minute on a few hundred people.
 *
 * So it is a fixed FIVE queries whatever the row count:
 *
 *   1. leads, with their latest agreement, their students and those students' enrolments nested
 *   2. students with no lead at all - walk-ins, and German Note learners
 *   3. every active batch, with its seat counts
 *   4. sessions grouped by batch - the total
 *   5. sessions grouped by batch - the ones already started
 *
 * (4) and (5) are two groupBys rather than two filtered counts on (3) because Prisma cannot take
 * the same relation twice in one `_count` with different filters. Upcoming is total minus started.
 */

/** One person on the board. */
export type OnboardingRow = {
  /** Lead id when there is one, otherwise the student id. Stable per person. */
  key: string;
  name: string;
  leadId: string | null;
  studentId: string | null;
  studentCode: string | null;
  journey: Journey;
  /** Where the row should link - the person hub that exists for them. */
  href: string;
  /**
   * LAST ACTIVITY, and deliberately not "days in this step".
   *
   * The honest figure available without another query. `Lead.updatedAt` moves on any edit, not
   * only on a stage change, so calling it time-in-step would be a number that looks precise and
   * is not. `LeadStageHistory` holds the real per-step dates and would cost a sixth query plus a
   * groupBy; if the board ever needs true time-in-step, that is where it comes from.
   *
   * It is also the figure the app already reasons about elsewhere - the notification feed's
   * "stalled in the pipeline" is "no movement in 10+ days" - so the Stuck tab matches something
   * the founders have already been reading.
   */
  lastActivityAt: Date;
  daysSinceActivity: number | null;
};

export type OnboardingBoard = {
  inFlight: OnboardingRow[];
  needsCompleting: OnboardingRow[];
  stuck: OnboardingRow[];
  doneThisMonth: OnboardingRow[];
  /** In-flight counts per step, for the board's grouping headers. */
  byStep: { step: JourneyStep; rows: OnboardingRow[] }[];
  /** True when the cap below was hit, so the screen can say so rather than quietly truncating. */
  truncated: boolean;
  stuckAfterDays: number;
};

/**
 * How many people the board will consider.
 *
 * A cap rather than pagination because this is a WORKING board, not an archive: the question it
 * answers is "who needs something from me", and an answer that needed four pages would not be
 * read. Ordered by most recent activity, so the cap drops the coldest rows first - and the screen
 * says when it has been hit instead of pretending the list is complete.
 */
const ROW_CAP = 500;

/** No movement in this many days and a person is stuck. Matches the notification feed's rule. */
const STUCK_AFTER_DAYS = 10;

/** The subset of a batch the journey needs: is it ready, and has it started teaching. */
type BatchFacts = { readiness: BatchReadiness; started: boolean };

/**
 * ONE PERSON'S JOURNEY, for the rail on their own record.
 *
 * A separate read from the board rather than a filter over it, because the two have opposite
 * shapes: the board needs a little about several hundred people, and this needs everything about
 * one. Reusing the board here would have fetched five hundred rows to render a strip.
 *
 * Takes whichever id the calling page holds - `/contacts/:id` has a lead, `/students/:id` has a
 * student, and either may lack the other. Returns null when neither resolves, so the page can
 * render without the rail instead of failing.
 *
 * Four queries, fixed.
 */
export const getPersonJourney = cache(
  async (ref: { leadId?: string | null; studentId?: string | null }): Promise<{
    journey: Journey;
    ids: { leadId: string | null; studentId: string | null; agreementId: string | null; batchId: string | null };
    name: string;
  } | null> => {
    const now = new Date();

    const [lead, student] = await Promise.all([
      ref.leadId
        ? prisma.lead.findUnique({
            where: { id: ref.leadId },
            select: {
              id: true,
              name: true,
              stage: true,
              _count: { select: { callLogs: true, bookings: true, outcomes: true } },
              agreements: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
              students: { select: { id: true }, take: 1 },
            },
          })
        : Promise.resolve(null),
      ref.studentId
        ? prisma.student.findUnique({
            where: { id: ref.studentId },
            select: {
              id: true,
              fullName: true,
              userId: true,
              leadId: true,
              _count: { select: { incomes: true, pendingPayments: true } },
              enrollments: { select: { programLevel: true, status: true, batchId: true } },
              gnMemberships: { select: { batchId: true }, take: 1 },
              agreements: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    /*
      The pages hold one id each, and the journey needs both halves. A contact record whose lead
      has already been converted must show the delivery steps, and a student record must show the
      sales ones - otherwise the rail would be a different length depending on which door you came
      through, which is exactly the "two pages, one person" problem it exists to close.
    */
    const resolvedStudentId = student?.id ?? lead?.students[0]?.id ?? null;
    const filledStudent =
      student ??
      (resolvedStudentId
        ? await prisma.student.findUnique({
            where: { id: resolvedStudentId },
            select: {
              id: true,
              fullName: true,
              userId: true,
              leadId: true,
              _count: { select: { incomes: true, pendingPayments: true } },
              enrollments: { select: { programLevel: true, status: true, batchId: true } },
              gnMemberships: { select: { batchId: true }, take: 1 },
              agreements: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
            },
          })
        : null);

    const filledLead =
      lead ??
      (filledStudent?.leadId
        ? await prisma.lead.findUnique({
            where: { id: filledStudent.leadId },
            select: {
              id: true,
              name: true,
              stage: true,
              _count: { select: { callLogs: true, bookings: true, outcomes: true } },
              agreements: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
              students: { select: { id: true }, take: 1 },
            },
          })
        : null);

    if (!filledLead && !filledStudent) return null;

    const live = filledStudent?.enrollments.filter((e) => occupiesSeat(e.status)) ?? [];
    const seated = live.find((e) => e.batchId) ?? null;
    const chosen = seated ?? live[0] ?? filledStudent?.enrollments[0] ?? null;
    const batchId = seated?.batchId ?? filledStudent?.gnMemberships[0]?.batchId ?? null;

    let facts: BatchFacts | null = null;
    if (batchId) {
      const [b, total, started] = await Promise.all([
        prisma.batch.findUnique({
          where: { id: batchId },
          select: {
            line: true,
            status: true,
            curriculumTemplateId: true,
            tutorId: true,
            startDate: true,
            endDate: true,
            _count: {
              select: {
                members: true,
                enrollments: { where: { status: { in: [...SEATED_STATUSES] } } },
              },
            },
          },
        }),
        prisma.classSession.count({ where: { batchId } }),
        prisma.classSession.count({ where: { batchId, startsAt: { lte: now } } }),
      ]);
      if (b) {
        facts = {
          readiness: batchReadiness(
            {
              status: b.status,
              line: b.line,
              curriculumTemplateId: b.curriculumTemplateId,
              tutorId: b.tutorId,
              startDate: b.startDate,
              endDate: b.endDate,
              seats: { members: b._count.members, seatedEnrollments: b._count.enrollments },
              sessionCount: total,
              upcomingSessionCount: total - started,
            },
            now,
          ),
          started: started > 0,
        };
      }
    }

    // The agreement is read from whichever record carries one - the lead's and the student's are
    // the same document once `enrolFromAgreement` has linked it, and before that only the lead has it.
    const agreement = filledStudent?.agreements[0] ?? filledLead?.agreements[0] ?? null;

    const input: JourneyInput = {
      leadStage: filledLead?.stage ?? null,
      hasContact: (filledLead?._count.callLogs ?? 0) > 0,
      hasBooking: (filledLead?._count.bookings ?? 0) > 0,
      hasDiscoveryOutcome: (filledLead?._count.outcomes ?? 0) > 0,
      agreementStatus: agreement?.status ?? null,
      hasStudent: filledStudent !== null,
      hasEnrolment: (filledStudent?.enrollments.length ?? 0) > 0,
      programLevel: chosen?.programLevel ?? null,
      payment: {
        received: (filledStudent?._count.incomes ?? 0) > 0,
        planned: (filledStudent?._count.pendingPayments ?? 0) > 0,
      },
      seat: { batchId, readiness: facts?.readiness ?? null },
      hasPortalLogin: Boolean(filledStudent?.userId),
      firstClassStarted: Boolean(batchId && facts?.started),
    };

    return {
      journey: deriveJourney(input),
      ids: {
        leadId: filledLead?.id ?? null,
        studentId: filledStudent?.id ?? null,
        agreementId: agreement?.id ?? null,
        batchId,
      },
      name: filledStudent?.fullName ?? filledLead?.name ?? "This person",
    };
  },
);

export const getOnboardingBoard = cache(async (): Promise<OnboardingBoard> => {
  const now = new Date();

  const [leads, orphanStudents, batches, sessionTotals, sessionsStarted] = await Promise.all([
    prisma.lead.findMany({
      /*
        Archived leads are out: the board is live work. Everything else is in, including LOST -
        `deriveJourney` decides that, and a stage filter here would also have dropped the real
        rows where a lead that reads NO_SHOW from an earlier attempt later signed and enrolled.
      */
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: ROW_CAP,
      select: {
        id: true,
        name: true,
        stage: true,
        updatedAt: true,
        _count: { select: { callLogs: true, bookings: true, outcomes: true } },
        // The agreement that represents them NOW - newest first, same choice the agreement
        // picker makes. An older voided one must not decide the journey.
        agreements: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
        students: {
          select: {
            id: true,
            code: true,
            userId: true,
            _count: { select: { incomes: true, pendingPayments: true } },
            enrollments: {
              select: { id: true, programLevel: true, status: true, batchId: true },
            },
          },
        },
      },
    }),

    /*
      People who were never a lead. A German Note learner added from the Members screen, and
      anyone the income form minted while recording a payment, have no Lead row at all - and the
      second of those is precisely the half-built record this board exists to surface, so
      excluding them would have left the Needs-completing tab missing its headline case.
    */
    prisma.student.findMany({
      where: { leadId: null },
      orderBy: { updatedAt: "desc" },
      take: ROW_CAP,
      select: {
        id: true,
        fullName: true,
        code: true,
        userId: true,
        updatedAt: true,
        _count: { select: { incomes: true, pendingPayments: true } },
        enrollments: { select: { id: true, programLevel: true, status: true, batchId: true } },
        gnMemberships: { select: { batchId: true } },
        agreements: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    }),

    prisma.batch.findMany({
      select: {
        id: true,
        line: true,
        status: true,
        curriculumTemplateId: true,
        tutorId: true,
        startDate: true,
        endDate: true,
        _count: {
          select: {
            members: true,
            enrollments: { where: { status: { in: [...SEATED_STATUSES] } } },
          },
        },
      },
    }),

    prisma.classSession.groupBy({ by: ["batchId"], _count: { _all: true } }),
    prisma.classSession.groupBy({
      by: ["batchId"],
      where: { startsAt: { lte: now } },
      _count: { _all: true },
    }),
  ]);

  const totalByBatch = new Map(sessionTotals.map((r) => [r.batchId, r._count._all]));
  const startedByBatch = new Map(sessionsStarted.map((r) => [r.batchId, r._count._all]));

  const batchFacts = new Map<string, BatchFacts>(
    batches.map((b) => {
      const total = totalByBatch.get(b.id) ?? 0;
      const started = startedByBatch.get(b.id) ?? 0;
      return [
        b.id,
        {
          readiness: batchReadiness(
            {
              status: b.status,
              line: b.line,
              curriculumTemplateId: b.curriculumTemplateId,
              tutorId: b.tutorId,
              startDate: b.startDate,
              endDate: b.endDate,
              seats: { members: b._count.members, seatedEnrollments: b._count.enrollments },
              sessionCount: total,
              upcomingSessionCount: total - started,
            },
            now,
          ),
          started: started > 0,
        },
      ];
    }),
  );

  /**
   * One person's facts, from whichever records they have.
   *
   * The seat is read across BOTH mechanisms - `Enrollment.batchId` for a coaching client, a
   * `BatchMember` row for a German Note learner - because "are they in a cohort" is one question
   * however the database happens to record it. Taking only the first would have reported every GN
   * learner as unseated.
   */
  const toInput = (p: {
    stage: string | null;
    contacts: number;
    bookings: number;
    outcomes: number;
    agreementStatus: string | null;
    student: {
      userId: string | null;
      incomes: number;
      pendings: number;
      enrollments: { programLevel: string; status: string; batchId: string | null }[];
      memberBatchIds: string[];
    } | null;
  }): JourneyInput => {
    const s = p.student;
    // The enrolment that best represents them: a seated one if there is one, else any live one.
    const live = s?.enrollments.filter((e) => occupiesSeat(e.status)) ?? [];
    const seated = live.find((e) => e.batchId) ?? null;
    const chosen = seated ?? live[0] ?? s?.enrollments[0] ?? null;
    const batchId = seated?.batchId ?? s?.memberBatchIds[0] ?? null;
    const facts = batchId ? batchFacts.get(batchId) ?? null : null;

    return {
      leadStage: p.stage,
      hasContact: p.contacts > 0,
      hasBooking: p.bookings > 0,
      hasDiscoveryOutcome: p.outcomes > 0,
      agreementStatus: p.agreementStatus,
      hasStudent: s !== null,
      hasEnrolment: (s?.enrollments.length ?? 0) > 0,
      programLevel: chosen?.programLevel ?? null,
      payment: { received: (s?.incomes ?? 0) > 0, planned: (s?.pendings ?? 0) > 0 },
      seat: { batchId, readiness: facts?.readiness ?? null },
      hasPortalLogin: Boolean(s?.userId),
      firstClassStarted: Boolean(batchId && facts?.started),
    };
  };

  const rows: OnboardingRow[] = [];

  for (const l of leads) {
    // A lead with two student records is a data problem the duplicates report owns; for the
    // journey, the first is the one to read rather than refusing to show the row at all.
    const st = l.students[0] ?? null;
    const input = toInput({
      stage: l.stage,
      contacts: l._count.callLogs,
      bookings: l._count.bookings,
      outcomes: l._count.outcomes,
      agreementStatus: l.agreements[0]?.status ?? null,
      student: st
        ? {
            userId: st.userId,
            incomes: st._count.incomes,
            pendings: st._count.pendingPayments,
            enrollments: st.enrollments,
            memberBatchIds: [],
          }
        : null,
    });
    rows.push({
      key: l.id,
      name: l.name,
      leadId: l.id,
      studentId: st?.id ?? null,
      studentCode: st?.code ?? null,
      journey: deriveJourney(input),
      // The student record is the richer hub once it exists; before that, the contact record.
      href: st ? `/students/${st.id}` : `/contacts/${l.id}`,
      lastActivityAt: l.updatedAt,
      daysSinceActivity: daysInStep(l.updatedAt, now),
    });
  }

  for (const s of orphanStudents) {
    const input = toInput({
      stage: null,
      contacts: 0,
      bookings: 0,
      outcomes: 0,
      agreementStatus: s.agreements[0]?.status ?? null,
      student: {
        userId: s.userId,
        incomes: s._count.incomes,
        pendings: s._count.pendingPayments,
        enrollments: s.enrollments,
        memberBatchIds: s.gnMemberships.map((m) => m.batchId),
      },
    });
    rows.push({
      key: s.id,
      name: s.fullName,
      leadId: null,
      studentId: s.id,
      studentCode: s.code,
      journey: deriveJourney(input),
      href: `/students/${s.id}`,
      lastActivityAt: s.updatedAt,
      daysSinceActivity: daysInStep(s.updatedAt, now),
    });
  }

  const inFlight = rows.filter((r) => isInFlight(r.journey));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  return {
    inFlight,
    needsCompleting: rows.filter((r) => needsCompleting(r.journey)),
    /*
      Stuck is a subset of in-flight, never its own population: somebody finished is not stuck,
      and somebody lost is not stuck either - they are decided.
    */
    stuck: inFlight.filter(
      (r) => r.daysSinceActivity !== null && r.daysSinceActivity >= STUCK_AFTER_DAYS,
    ),
    doneThisMonth: rows.filter((r) => r.journey.complete && r.lastActivityAt >= monthStart),
    byStep: JOURNEY_STEPS.map((step) => ({
      step,
      rows: inFlight.filter((r) => r.journey.state === step),
    })).filter((g) => g.rows.length > 0),
    truncated: leads.length === ROW_CAP || orphanStudents.length === ROW_CAP,
    stuckAfterDays: STUCK_AFTER_DAYS,
  };
});
