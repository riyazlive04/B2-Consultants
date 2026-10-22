import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istToday, toDateInputValue } from "@/lib/dates";
import { isAttended, type AttendanceStatus } from "@/lib/attendance";
import { resolveWatchTruth } from "@/lib/video-progress";
import {
  anonLabel,
  rankRows,
  scoreStudent,
  weeksElapsed,
  type LeaderboardConfig,
  type LeaderboardMetricKey,
  type MetricCounts,
  type ScoreBreakdown,
} from "@/lib/leaderboard";
import { getLeaderboardConfig } from "./founder-config";

/**
 * THE SPRINT LEADERBOARD - the reads.
 *
 * All of the judgement lives in lib/leaderboard.ts (pure, unit-tested). This file only gathers
 * counts and hands them over, which is the same division as attendance.ts ↔ lib/attendance.ts.
 *
 * ── Eight counts, four queries ──────────────────────────────────────────────────────────
 * The board is a cohort at a time (six to ten students), and every metric is a GROUPED count
 * rather than a per-student query. The difference matters: per-student reads would be eight
 * queries times ten students on a page that a whole cohort refreshes at once.
 *
 * ── The period, and why SPRINT falls back ───────────────────────────────────────────────
 * The founders described a sprint board: the 90 or 120 days that follow the four taught weeks.
 * But a cohort still inside those taught weeks has no sprint start yet, and scoring from a date
 * that has not arrived would show every student zero - a board of noughts on the exact screen
 * meant to motivate them. So when `period` is SPRINT and the sprint has not begun, the window
 * opens at enrolment instead and the view says which it used. Nothing is hidden; the reader is
 * told what it counted.
 */

export type LeaderboardRow = {
  enrollmentId: string;
  studentId: string;
  /** The real name. Replaced with a positional pseudonym by `viewFor` when anonymised. */
  name: string;
  code: string | null;
  rank: number;
  total: number;
  breakdown: ScoreBreakdown;
  /** True for the student reading their own board. */
  isMe: boolean;
};

export type LeaderboardView = {
  config: LeaderboardConfig;
  batchId: string | null;
  batchName: string | null;
  /** Which window was actually counted, and from when. */
  period: { basis: "SPRINT" | "PROGRAMME" | "SPRINT_NOT_STARTED"; fromYmd: string; weeks: number };
  rows: LeaderboardRow[];
  /** The reader's own row, even when `topN` cut it off the list. */
  me: LeaderboardRow | null;
};

type Cohort = {
  batchId: string | null;
  batchName: string | null;
  enrollments: {
    id: string;
    studentId: string;
    studentName: string;
    studentCode: string | null;
    studentUserId: string | null;
    enrollmentDate: Date;
    sprintStartDate: Date | null;
  }[];
};

/** IST calendar day of an instant - every window boundary on this board is a day, not a moment. */
function istYmd(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

async function loadCohort(batchId: string | null, scopeAll: boolean): Promise<Cohort> {
  const where = scopeAll || !batchId ? { status: "ACTIVE" as const } : { status: "ACTIVE" as const, batchId };
  const rows = await prisma.enrollment.findMany({
    where,
    select: {
      id: true,
      studentId: true,
      enrollmentDate: true,
      student: { select: { fullName: true, code: true, userId: true } },
      batch: { select: { id: true, name: true, sprintStartDate: true } },
    },
    // A guard, not a real ceiling: a global board on a business this size is tens of rows.
    take: 300,
  });

  return {
    batchId,
    batchName: rows.find((r) => r.batch?.id === batchId)?.batch?.name ?? null,
    enrollments: rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: r.student.fullName,
      studentCode: r.student.code,
      studentUserId: r.student.userId,
      enrollmentDate: r.enrollmentDate,
      sprintStartDate: r.batch?.sprintStartDate ?? null,
    })),
  };
}

/**
 * Gathers every count for a cohort over one window.
 *
 * `from` is a day, inclusive. Each metric is counted on the day the THING happened, never the
 * day it was recorded - a student logging Friday's interview on Sunday belongs in Friday, or
 * the weekly caps are computed against the wrong week.
 */
async function gatherCounts(
  cohort: Cohort,
  from: Date,
): Promise<Map<string, MetricCounts>> {
  const enrollmentIds = cohort.enrollments.map((e) => e.id);
  const studentIds = cohort.enrollments.map((e) => e.studentId);
  const userIds = cohort.enrollments.map((e) => e.studentUserId).filter((x): x is string => !!x);
  const byEnrollment = new Map<string, MetricCounts>(enrollmentIds.map((id) => [id, {}]));
  const enrollmentOfStudent = new Map(cohort.enrollments.map((e) => [e.studentId, e.id]));
  const enrollmentOfUser = new Map(
    cohort.enrollments.filter((e) => e.studentUserId).map((e) => [e.studentUserId!, e.id]),
  );

  const bump = (enrollmentId: string | undefined, key: LeaderboardMetricKey, by = 1) => {
    if (!enrollmentId) return;
    const counts = byEnrollment.get(enrollmentId);
    if (!counts) return;
    counts[key] = (counts[key] ?? 0) + by;
  };

  const [attendance, tasks, sprintWeeks, applications, logged, watches] = await Promise.all([
    // Classes attended. PRESENT and LATE both count - late means they were in the room.
    prisma.sessionAttendance.findMany({
      where: { studentId: { in: studentIds }, session: { delivery: "LIVE", startsAt: { gte: from } } },
      select: { studentId: true, status: true },
    }),
    // Coursework the coach set, ticked off by the student.
    prisma.sessionTaskCompletion.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds }, status: "YES", completedAt: { gte: from } },
      _count: { _all: true },
    }),
    prisma.sprintWeek.groupBy({
      by: ["enrollmentId"],
      where: { enrollmentId: { in: enrollmentIds }, status: "ACHIEVED", weekEnd: { gte: from } },
      _count: { _all: true },
    }),
    // Applications, by status. `appliedAt` not `createdAt`: the day they applied is the fact.
    prisma.jobApplication.groupBy({
      by: ["enrollmentId", "status"],
      where: { enrollmentId: { in: enrollmentIds }, appliedAt: { gte: from } },
      _count: { _all: true },
    }),
    // The self-reported half. ACTIVE spread in, so a coach's correction really does remove the
    // points rather than leaving a soft-deleted row still scoring.
    prisma.sprintLogEntry.groupBy({
      by: ["enrollmentId", "kind"],
      where: { enrollmentId: { in: enrollmentIds }, occurredOn: { gte: from }, ...ACTIVE },
      _sum: { quantity: true },
    }),
    /**
     * Watched recordings - the only metric that cannot be a grouped count.
     *
     * `resolveWatchTruth` is what decides "watched", and it is not a column: a tracked 40%
     * with a self-reported tick resolves to NOT complete, which is the whole point of that
     * rule (spec §10.3). Grouping in SQL would have to pick one of the two fields and would
     * therefore score the tick, which is the behaviour the founders complained about.
     */
    userIds.length
      ? prisma.gnRecordingWatch.findMany({
          where: { userId: { in: userIds }, recording: { createdAt: { gte: from } } },
          select: { userId: true, watchedPct: true, selfReported: true },
        })
      : Promise.resolve([]),
  ]);

  for (const a of attendance) {
    if (!isAttended(a.status as AttendanceStatus)) continue;
    bump(enrollmentOfStudent.get(a.studentId), "class_attended");
  }
  for (const t of tasks) bump(enrollmentOfStudent.get(t.studentId), "task_completed", t._count._all);
  for (const w of sprintWeeks) bump(w.enrollmentId, "sprint_week_achieved", w._count._all);

  for (const app of applications) {
    // Every application counts as sent, whatever became of it afterwards.
    bump(app.enrollmentId, "application_submitted", app._count._all);
    if (app.status === "INTERVIEW") bump(app.enrollmentId, "hr_interview", app._count._all);
    if (app.status === "SELECTED") bump(app.enrollmentId, "application_selected", app._count._all);
  }

  const LOG_TO_METRIC: Record<string, LeaderboardMetricKey> = {
    HR_CONNECTION: "hr_connection",
    HR_INTERVIEW: "hr_interview",
    APPLICATION_REVIEWED: "application_reviewed",
    WIN: "win",
  };
  for (const l of logged) {
    const key = LOG_TO_METRIC[l.kind];
    if (key) bump(l.enrollmentId, key, l._sum.quantity ?? 0);
  }

  for (const w of watches) {
    const truth = resolveWatchTruth({ watchedPct: w.watchedPct, selfReported: w.selfReported });
    if (truth.complete) bump(enrollmentOfUser.get(w.userId), "recording_watched");
  }

  return byEnrollment;
}

/**
 * The board for one cohort.
 *
 * `viewerUserId` only marks the reader's own row; it never changes a score. Names are returned
 * in full here and pseudonymised at the edge by `viewFor`, so the one decision about who may
 * read a real name is made in one place rather than threaded through the arithmetic.
 */
export const getLeaderboard = cache(
  async (batchId: string | null, viewerUserId: string | null): Promise<LeaderboardView> => {
    const config = await getLeaderboardConfig();
    const cohort = await loadCohort(batchId, config.scope === "ALL");
    const todayYmd = toDateInputValue(istToday());

    /**
     * The window. One date for the whole cohort, taken from the batch's sprint start - not
     * per student, because a board whose students were each scored over a different number of
     * days is not a ranking of anything.
     */
    const sprintStart = cohort.enrollments.find((e) => e.sprintStartDate)?.sprintStartDate ?? null;
    const sprintStartYmd = sprintStart ? istYmd(sprintStart) : null;
    const sprintBegun = sprintStartYmd !== null && sprintStartYmd <= todayYmd;

    const earliestEnrolment = cohort.enrollments.reduce<string | null>((acc, e) => {
      const ymd = toDateInputValue(e.enrollmentDate);
      return acc === null || ymd < acc ? ymd : acc;
    }, null);

    const basis: LeaderboardView["period"]["basis"] =
      config.period === "PROGRAMME"
        ? "PROGRAMME"
        : sprintBegun
          ? "SPRINT"
          : "SPRINT_NOT_STARTED";

    const fromYmd =
      basis === "SPRINT" ? sprintStartYmd! : earliestEnrolment ?? todayYmd;
    const from = new Date(`${fromYmd}T00:00:00Z`);
    const weeks = weeksElapsed(fromYmd, todayYmd);

    if (cohort.enrollments.length === 0) {
      return {
        config,
        batchId,
        batchName: cohort.batchName,
        period: { basis, fromYmd, weeks },
        rows: [],
        me: null,
      };
    }

    const counts = await gatherCounts(cohort, from);

    const scored = cohort.enrollments.map((e) => {
      const breakdown = scoreStudent(counts.get(e.id) ?? {}, config, weeks);
      return {
        enrollmentId: e.id,
        studentId: e.studentId,
        name: e.studentName,
        code: e.studentCode,
        total: breakdown.total,
        breakdown,
        isMe: viewerUserId !== null && e.studentUserId === viewerUserId,
      };
    });

    const rows = rankRows(scored).map((r) => ({ ...r }));
    return {
      config,
      batchId,
      batchName: cohort.batchName,
      period: { basis, fromYmd, weeks },
      rows,
      me: rows.find((r) => r.isMe) ?? null,
    };
  },
);

/**
 * The board as a given reader may see it.
 *
 * ONE PLACE decides who gets a real name. The founders chose a named board, and that is the
 * default - but the setting exists, and when it says ANONYMISED a student must not receive
 * their classmates' names in the page payload merely hidden behind a label. So the names are
 * replaced HERE, on the server, before the view is serialised. The same rule as
 * `visibleToStudents` on resources: what a reader may not see should not be in their page.
 *
 * `topN` trims the list, and the reader's own row is kept regardless - a student outside the
 * top ten still needs to know where they stand, and a board that silently omits you is the one
 * thing worse than a board that ranks you last.
 */
export function viewFor(
  view: LeaderboardView,
  audience: "STAFF" | "STUDENT",
): LeaderboardView {
  if (audience === "STAFF") return view;
  if (view.config.visibility === "STAFF_ONLY") {
    return { ...view, rows: view.me ? [view.me] : [], me: view.me };
  }

  const anonymise = view.config.visibility === "ANONYMISED";
  const rows = view.rows.map((r, i) => ({
    ...r,
    name: r.isMe || !anonymise ? r.name : anonLabel(i),
    code: r.isMe || !anonymise ? r.code : null,
    // A classmate's per-metric breakdown is theirs. The total is the board; the working behind
    // it is not, and on a named board it would amount to publishing their application count.
    breakdown: r.isMe ? r.breakdown : { total: r.total, lines: [], capped: false },
    studentId: r.isMe ? r.studentId : "",
    enrollmentId: r.isMe ? r.enrollmentId : "",
  }));

  const trimmed = view.config.topN > 0 ? rows.slice(0, view.config.topN) : rows;
  const mine = rows.find((r) => r.isMe) ?? null;
  const withMe =
    mine && !trimmed.some((r) => r.isMe) ? [...trimmed, mine] : trimmed;

  return { ...view, rows: withMe, me: mine };
}
