import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { getStudentsOverview } from "@/server/students-metrics";

/**
 * The Head Coach dashboard's own numbers (rebuild spec §5) — "which students need me, and how is
 * the team performing?"
 *
 * ALMOST NONE OF THIS IS NEW. `getStudentsOverview()` already computes the counts, the 90/120
 * tracker and a rule-based at-risk radar with per-student flags; the head's home page simply never
 * showed any of it, offering a static "Students — Open board" tile instead. So this composes what
 * exists and adds only the two figures §5 names that nothing else computed: agreements awaiting a
 * signature, and sessions delivered today.
 *
 * NO FINANCIAL FIGURES. §5 is explicit, and the §3 matrix keeps Finance and Cash away from the
 * head, so nothing here reads money — not even indirectly through a revenue-bearing helper.
 */

export type AtRiskStudent = {
  readonly studentId: string;
  readonly studentName: string;
  readonly programLevel: string;
  readonly dayNumber: number;
  readonly totalDays: number;
  /** Null until a coach has set one — an unset signal is not the same as a green one. */
  readonly signalColour: string | null;
  readonly flags: string[];
};

export type HeadCoachSnapshot = {
  readonly activeStudents: number;
  readonly activeGuided: number;
  readonly activeElite: number;
  readonly activeSolo: number;
  readonly completedThisMonth: number;
  readonly droppedThisMonth: number;
  readonly avgSatisfaction: number | null;
  /** Everyone the radar flagged, worst first — the "students needing attention" list. */
  readonly atRisk: AtRiskStudent[];
  /** How many of those have never had a session logged, or none in over a fortnight. */
  readonly nonResponders: number;
  readonly agreementsAwaitingSignature: number;
  readonly sessionsDeliveredToday: number;
};

/** A flag phrased in days-since-contact is what "non-responder" means on this dashboard. */
const NON_RESPONSE = /days since last session|No session recorded yet|Check-in overdue/i;

export const getHeadCoachSnapshot = cache(async (): Promise<HeadCoachSnapshot> => {
  const today = istToday();

  const [overview, awaitingSignature, sessionsToday] = await Promise.all([
    getStudentsOverview(),
    // SENT and VIEWED are both "issued, not signed yet". DRAFT is the founder's queue, not the
    // coach's — nobody is waiting on the student for an agreement that was never sent.
    prisma.agreement.count({ where: { status: { in: ["SENT", "VIEWED"] } } }),
    prisma.dailyLog.aggregate({
      where: { date: today },
      _sum: { sessionsDelivered: true },
    }),
  ]);

  const atRisk: AtRiskStudent[] = overview.atRiskRadar.map((t) => ({
    studentId: t.studentId,
    studentName: t.studentName,
    programLevel: t.programLevel,
    dayNumber: t.dayNumber,
    totalDays: t.totalDays,
    signalColour: t.signalColour,
    flags: t.flags,
  }));

  return {
    activeStudents: overview.counts.totalActive,
    activeGuided: overview.counts.activeGuided,
    activeElite: overview.counts.activeElite,
    activeSolo: overview.counts.activeSolo,
    completedThisMonth: overview.counts.completedThisMonth,
    droppedThisMonth: overview.counts.droppedThisMonth,
    avgSatisfaction: overview.avgSatisfaction,
    atRisk,
    nonResponders: atRisk.filter((s) => s.flags.some((f) => NON_RESPONSE.test(f))).length,
    agreementsAwaitingSignature: awaitingSignature,
    sessionsDeliveredToday: sessionsToday._sum.sessionsDelivered ?? 0,
  };
});
