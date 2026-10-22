import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istToday, toDateInputValue } from "@/lib/dates";
import { isAttended, type AttendanceStatus } from "@/lib/attendance";
import { buildWeeklyReport, type WeekInput, type WeeklyReport } from "@/lib/weekly-report";
import type { LeaderboardMetricKey, MetricCounts } from "@/lib/leaderboard";

/**
 * THE WEEKLY PROGRESS REPORT - the reads.
 *
 * All of the judgement is in lib/weekly-report.ts (pure, unit-tested). This file only gathers
 * counts and buckets them by sprint week, which is the same division as attendance.ts ↔
 * lib/attendance.ts and leaderboard.ts ↔ lib/leaderboard.ts.
 *
 * ── FIVE queries, whatever the sprint's length ──────────────────────────────────────────
 * The obvious implementation is a query per week, and on a Guided sprint that is 13 weeks times
 * five reads - sixty-five round trips to a Supabase instance in Singapore at roughly 205ms each,
 * on a page a coach opens before every call. So each fact is read ONCE over the whole sprint
 * window and bucketed into weeks in memory. The same mistake, and the same fix, as the teaching
 * desk's shell (which was running seven queries to render a greeting).
 *
 * ── Why the counts come from the same places the leaderboard reads ──────────────────────
 * Deliberately the identical tables, columns and date fields as `gatherCounts` in
 * server/leaderboard.ts: `appliedAt` not `createdAt`, `occurredOn` not `createdAt`, `ACTIVE`
 * spread into the self-reported reads so a coach's correction really removes the entry. A report
 * that counted an application on the day it was typed in, while the board counted it on the day
 * it was sent, would put the same student's same work in two different weeks.
 *
 * RECORDINGS ARE DELIBERATELY ABSENT. The board's `recording_watched` cannot be a grouped count
 * - `resolveWatchTruth` decides "watched" and it is not a column - so including it here would
 * mean a per-student read of every watch row to fill one column of a report nobody asked for it
 * on. The student's own classroom owns that number.
 */

/** IST calendar day of an instant - every bucket boundary here is a day, not a moment. */
function istYmd(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export const getWeeklyReport = cache(
  async (enrollmentId: string): Promise<WeeklyReport | null> => {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true,
        studentId: true,
        batchId: true,
        sprintWeeks: {
          orderBy: { weekIndex: "asc" },
          select: {
            id: true, weekIndex: true, weekStart: true, weekEnd: true,
            target: true, actual: true, status: true, note: true,
          },
        },
      },
    });
    if (!enrollment || enrollment.sprintWeeks.length === 0) return null;

    const weeks = enrollment.sprintWeeks.map((w) => ({
      ...w,
      weekStartYmd: toDateInputValue(w.weekStart),
      weekEndYmd: toDateInputValue(w.weekEnd),
    }));

    /**
     * The window: the first week's start to the last week's end, inclusive.
     *
     * Built from the WEEKS rather than from the enrolment's own dates, because the sprint plan
     * is what this report is a report of. A plan that was generated late, or regenerated, is
     * still the authority on which days belong to week 4.
     */
    const from = new Date(`${weeks[0].weekStartYmd}T00:00:00Z`);
    const to = new Date(`${weeks[weeks.length - 1].weekEndYmd}T23:59:59.999Z`);

    const [sessions, tasks, applications, logged] = await Promise.all([
      /**
       * Live classes in the window, each with its own register.
       *
       * `_count.attendance` is how `classesMarked` is answered - whether a register exists AT
       * ALL, by anybody, for anybody. That is the difference between "this student missed the
       * class" and "nobody marked the class", and it is why attendance in this report can be
       * null rather than 0%. The nested `attendance` is filtered to THIS student, so the rows
       * returned are only ever their own marks.
       */
      enrollment.batchId
        ? prisma.classSession.findMany({
            where: {
              batchId: enrollment.batchId,
              delivery: "LIVE",
              startsAt: { gte: from, lte: to },
            },
            select: {
              startsAt: true,
              _count: { select: { attendance: true } },
              attendance: {
                where: { studentId: enrollment.studentId },
                select: { status: true },
              },
            },
          })
        : Promise.resolve([]),
      prisma.sessionTaskCompletion.findMany({
        where: {
          studentId: enrollment.studentId,
          status: "YES",
          completedAt: { gte: from, lte: to },
        },
        select: { completedAt: true },
      }),
      // `appliedAt`, like the board: the day they applied is the fact, not the day it was typed.
      prisma.jobApplication.findMany({
        where: { enrollmentId, appliedAt: { gte: from, lte: to } },
        select: { appliedAt: true, status: true },
      }),
      // ACTIVE spread in, so a coach's correction removes the entry rather than leaving a
      // soft-deleted row still counting - again matching the board exactly.
      prisma.sprintLogEntry.findMany({
        where: { enrollmentId, occurredOn: { gte: from, lte: to }, ...ACTIVE },
        select: { occurredOn: true, kind: true, quantity: true },
      }),
    ]);

    /**
     * The bucket index: one entry per DAY of the sprint, pointing at its week.
     *
     * A map rather than a search per row. Each count below is then an O(1) lookup instead of a
     * scan over 13 to 18 weeks, and - more importantly - the rule for "which week does this day
     * belong to" is written once here rather than re-derived at each of the five call sites.
     *
     * A day outside every week falls through to `undefined` and is simply not counted. That is
     * not defensive padding: sprint weeks are generated from a plan and a regenerated plan can
     * leave a gap, in which case silently attributing an application to a neighbouring week
     * would be worse than omitting it.
     */
    const weekOfDay = new Map<string, string>();
    for (const w of weeks) {
      const end = Date.parse(`${w.weekEndYmd}T00:00:00Z`);
      for (let t = Date.parse(`${w.weekStartYmd}T00:00:00Z`); t <= end; t += 86_400_000) {
        weekOfDay.set(new Date(t).toISOString().slice(0, 10), w.id);
      }
    }

    const counts = new Map<string, MetricCounts>(weeks.map((w) => [w.id, {}]));
    const held = new Map<string, number>(weeks.map((w) => [w.id, 0]));
    const marked = new Map<string, number>(weeks.map((w) => [w.id, 0]));

    const bump = (ymd: string, key: LeaderboardMetricKey, by = 1) => {
      const weekId = weekOfDay.get(ymd);
      if (!weekId) return;
      const bucket = counts.get(weekId);
      if (!bucket) return;
      bucket[key] = (bucket[key] ?? 0) + by;
    };

    for (const s of sessions) {
      // The class belongs to the IST day it was taught, which is the day the student remembers.
      const ymd = istYmd(s.startsAt);
      const weekId = weekOfDay.get(ymd);
      if (weekId) {
        held.set(weekId, (held.get(weekId) ?? 0) + 1);
        if (s._count.attendance > 0) marked.set(weekId, (marked.get(weekId) ?? 0) + 1);
      }
      // PRESENT and LATE both count - late means they were in the room (lib/attendance.ts).
      const mine = s.attendance[0];
      if (mine && isAttended(mine.status as AttendanceStatus)) bump(ymd, "class_attended");
    }

    for (const t of tasks) {
      if (t.completedAt) bump(istYmd(t.completedAt), "task_completed");
    }

    for (const a of applications) {
      bump(istYmd(a.appliedAt), "application_submitted");
      // Same two statuses the board promotes, so the two screens agree about one application.
      if (a.status === "INTERVIEW") bump(istYmd(a.appliedAt), "hr_interview");
    }

    const LOG_TO_METRIC: Record<string, LeaderboardMetricKey> = {
      HR_CONNECTION: "hr_connection",
      HR_INTERVIEW: "hr_interview",
      APPLICATION_REVIEWED: "application_reviewed",
      WIN: "win",
    };
    for (const l of logged) {
      const key = LOG_TO_METRIC[l.kind];
      if (key) bump(istYmd(l.occurredOn), key, l.quantity ?? 0);
    }

    const input: WeekInput[] = weeks.map((w) => ({
      id: w.id,
      weekIndex: w.weekIndex,
      weekStartYmd: w.weekStartYmd,
      weekEndYmd: w.weekEndYmd,
      target: w.target,
      actual: w.actual,
      status: w.status as string,
      note: w.note,
      counts: counts.get(w.id) ?? {},
      classesHeld: held.get(w.id) ?? 0,
      classesMarked: marked.get(w.id) ?? 0,
    }));

    return buildWeeklyReport(input, toDateInputValue(istToday()));
  },
);

/**
 * Every enrolment's report for one student, keyed by enrolment id.
 *
 * A student can hold two enrolments (a repeat, or a coaching programme alongside a German
 * course) and the record renders a block per enrolment, so the page needs them all. Run in
 * parallel: they are independent reads and a student has at most two or three.
 */
export async function getWeeklyReports(
  enrollmentIds: readonly string[],
): Promise<Record<string, WeeklyReport>> {
  const reports = await Promise.all(enrollmentIds.map((id) => getWeeklyReport(id)));
  const out: Record<string, WeeklyReport> = {};
  enrollmentIds.forEach((id, i) => {
    const report = reports[i];
    if (report) out[id] = report;
  });
  return out;
}
