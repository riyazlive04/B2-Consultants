import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { toDateInputValue } from "@/lib/dates";
import { METRIC_BY_KEY, type LeaderboardMetricKey } from "@/lib/leaderboard";

/**
 * The self-reported sprint log - reads for both sides of it.
 *
 * `getMySprintLog` is the student's own list, so they can see what they claimed and withdraw a
 * mistake. `getCoachSprintFeed` is the correction surface the founders' "score at once, coach
 * can correct" depends on: without somewhere a coach actually SEES new entries, "can correct"
 * would be a permission nobody exercises, and immediate scoring would be scoring on trust
 * alone.
 */

/** `SprintLogKind` → the leaderboard metric it scores, so one label serves both screens. */
export const LOG_KIND_METRIC: Record<string, LeaderboardMetricKey> = {
  HR_CONNECTION: "hr_connection",
  HR_INTERVIEW: "hr_interview",
  APPLICATION_REVIEWED: "application_reviewed",
  WIN: "win",
};

export function logKindLabel(kind: string): string {
  const key = LOG_KIND_METRIC[kind];
  return key ? METRIC_BY_KEY[key].label : kind;
}

export type SprintLogRow = {
  id: string;
  kind: string;
  kindLabel: string;
  quantity: number;
  occurredOnYmd: string;
  company: string | null;
  note: string | null;
  source: "STUDENT" | "COACH";
  /** Points this entry is currently worth - so a student can see what a withdrawal costs. */
  pointsEach: number;
  loggedByName: string | null;
  /** The student may only withdraw their OWN entries, never a coach's correction. */
  canWithdraw: boolean;
};

export const getMySprintLog = cache(async (userId: string): Promise<SprintLogRow[]> => {
  const enrollment = await prisma.enrollment.findFirst({
    where: { student: { userId }, status: "ACTIVE" },
    select: { id: true },
    orderBy: { enrollmentDate: "desc" },
  });
  if (!enrollment) return [];

  const rows = await prisma.sprintLogEntry.findMany({
    where: { enrollmentId: enrollment.id, ...ACTIVE },
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true, kind: true, quantity: true, occurredOn: true, company: true, note: true,
      source: true, loggedBy: { select: { name: true, email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    kindLabel: logKindLabel(r.kind),
    quantity: r.quantity,
    occurredOnYmd: toDateInputValue(r.occurredOn),
    company: r.company,
    note: r.note,
    source: r.source as "STUDENT" | "COACH",
    pointsEach: METRIC_BY_KEY[LOG_KIND_METRIC[r.kind]]?.defaultPoints ?? 0,
    loggedByName: r.loggedBy?.name ?? r.loggedBy?.email ?? null,
    canWithdraw: r.source === "STUDENT",
  }));
});

export type CoachFeedRow = SprintLogRow & {
  studentId: string;
  studentName: string;
  studentCode: string | null;
  enrollmentId: string;
};

/**
 * Recent self-reported entries across a cohort, newest first.
 *
 * Scoped to one batch, and `batchId` null returns nothing rather than everything - a feed of
 * every student in the business is not a correction surface, it is a wall nobody reads.
 *
 * ── Why it shows CAUGHT entries too, not just suspicious ones ──────────────────────────
 * There is no way to tell a suspicious entry from a true one by looking at the row; that is
 * exactly why a human is reading it. Filtering to "unusual" ones would be the app pretending
 * to a judgement it cannot make, and would quietly hide the modest over-claim - nine
 * connections instead of two - which is the realistic failure, not a wild one.
 */
export const getCoachSprintFeed = cache(async (batchId: string | null): Promise<CoachFeedRow[]> => {
  if (!batchId) return [];

  const rows = await prisma.sprintLogEntry.findMany({
    where: { enrollment: { batchId, status: "ACTIVE" }, ...ACTIVE },
    orderBy: [{ createdAt: "desc" }],
    take: 60,
    select: {
      id: true, kind: true, quantity: true, occurredOn: true, company: true, note: true,
      source: true, enrollmentId: true,
      loggedBy: { select: { name: true, email: true } },
      enrollment: { select: { student: { select: { id: true, fullName: true, code: true } } } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    kindLabel: logKindLabel(r.kind),
    quantity: r.quantity,
    occurredOnYmd: toDateInputValue(r.occurredOn),
    company: r.company,
    note: r.note,
    source: r.source as "STUDENT" | "COACH",
    pointsEach: METRIC_BY_KEY[LOG_KIND_METRIC[r.kind]]?.defaultPoints ?? 0,
    loggedByName: r.loggedBy?.name ?? r.loggedBy?.email ?? null,
    canWithdraw: false,
    studentId: r.enrollment.student.id,
    studentName: r.enrollment.student.fullName,
    studentCode: r.enrollment.student.code,
    enrollmentId: r.enrollmentId,
  }));
});
