import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { type CapabilityOverrides } from "@/lib/capabilities";
import { mayManageAnyBatch } from "./batch-access";
import type { AppRole } from "@/lib/sections";
import { istToday, toDateInputValue } from "@/lib/dates";
import type { SessionDeliveryValue } from "@/lib/curriculum";

/**
 * THE TEACHING DESK - one screen for everyone who stands in front of a batch.
 *
 * ── Why coaches and tutors share it ─────────────────────────────────────────────────────
 * A B2 coach runs a cohort through a four-week curriculum; a German Note tutor runs a level
 * through forty classes. Different programmes, but the DAY is the same shape: what am I
 * teaching next, who is in the room, take the register, post the recording, set the coursework.
 * Two screens for that would be the same code twice with `line` swapped - and the tutor already
 * had half of it (German Note) while the coach had none of it at all.
 *
 * ── What "mine" means ───────────────────────────────────────────────────────────────────
 * Two different claims, deliberately kept apart:
 *   · BATCHES I LEAD - `Batch.tutorId`. The register, the recording and the coursework hang off
 *     these, because teaching a class is what earns the right to mark it.
 *   · STUDENTS I COACH - `Enrollment.coachId`. A coach's own caseload, which may include people
 *     in a cohort somebody else teaches (a 1-to-1 Elite client has no batch at all).
 * An ADMIN or HEAD leads nothing and coaches nobody, so for them both lists would be empty -
 * they get the supervisor's view instead: every active cohort.
 */

export type DeskSessionView = {
  id: string;
  batchId: string;
  batchName: string;
  batchLine: "B2" | "GERMAN_NOTE";
  title: string;
  framework: string | null;
  delivery: SessionDeliveryValue;
  dateYmd: string;
  timeHm: string | null;
  startsAt: string;
  durationMins: number | null;
  joinUrl: string | null;
  isPast: boolean;
  rosterSize: number;
  markedCount: number;
  taskCount: number;
  hasRecording: boolean;
  /**
   * May THIS viewer mark this register / post this recording?
   *
   * Per session rather than one flag for the whole desk, because a supervisor's desk mixes
   * cohorts they may act on with cohorts they may only read. The page used to decide this
   * once for every row, so a Head coach was shown "Take the register" on batches `canMark`
   * would refuse - a button whose only outcome is an error message.
   */
  canMark: boolean;
};

export type DeskBatchView = {
  id: string;
  line: "B2" | "GERMAN_NOTE";
  name: string;
  code: string | null;
  level: string;
  filled: number;
  targetStrength: number;
  startDate: string | null;
  sprintStartDate: string | null;
  curriculumName: string | null;
  sessionCount: number;
  /** Past live sessions whose register has never been opened - the desk's main to-do. */
  registersOutstanding: number;
  /** Past live sessions with no recording posted - agreement §3.3. */
  recordingsOutstanding: number;
  nextSessionAt: string | null;
  /** Where this cohort is run from: the coaching timetable or the German Note classroom. */
  href: string;
  /** False for a supervisor looking at somebody else's cohort. */
  iLead: boolean;
  /**
   * Who leads it. Only worth reading on a cohort that is not yours - which is most of them on
   * a desk that now shows every classroom, where "whose class is this" is the question a pill
   * saying "not yours" leaves unanswered.
   */
  leadName: string | null;
};

export type DeskStudentView = {
  studentId: string;
  enrollmentId: string;
  name: string;
  code: string | null;
  programLevel: string;
  status: string;
  currentMilestone: string;
  signalColour: string | null;
  batchName: string | null;
  /** The sprint week whose check-in window has opened and is still PENDING. */
  sprintWeekDue: { id: string; weekIndex: number; weekEnd: string; target: string | null } | null;
  attendancePct: number | null;
  tasksPending: number;
};

export type CoachingDesk = {
  role: AppRole;
  /** True when this person leads nothing and coaches nobody - i.e. they are supervising. */
  supervising: boolean;
  /**
   * True when this desk is showing EVERY active cohort rather than only this person's - the
   * founder's and the head coach's view, whether or not they also run a cohort themselves.
   * `iLead` on each row is what tells the two apart on screen.
   */
  seesAllBatches: boolean;
  batches: DeskBatchView[];
  /** The next seven days, plus anything in the past still needing a register. */
  upcoming: DeskSessionView[];
  needsRegister: DeskSessionView[];
  students: DeskStudentView[];
};

function istParts(d: Date): { dateYmd: string; timeHm: string } {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return { dateYmd: ist.toISOString().slice(0, 10), timeHm: ist.toISOString().slice(11, 16) };
}

export const getCoachingDesk = cache(
  async (session: {
    role: AppRole;
    user: { id: string };
    capabilities: CapabilityOverrides | null;
  }): Promise<CoachingDesk> => {
    const userId = session.user.id;
    /*
      ── WHO SEES EVERY CLASSROOM ────────────────────────────────────────────────────────
      ONE rule, from server/batch-access.ts: Admin, the head coach, or anyone holding
      `batches.manage`. This file used to carry two local copies of it, and both were wrong in
      the same direction:

        · `supervisor` was only honoured when the viewer led NOTHING and coached NOBODY. So the
          moment the founder or the head coach took a single cohort of their own, every other
          cohort disappeared from their desk - they were demoted to a coach by teaching. That
          is backwards, and it is what "we must see all the classrooms, not only my classroom"
          means.
        · the second copy, which decides whether the mark buttons are drawn, left HEAD out
          entirely - so the head coach was shown a register they are explicitly allowed to take
          (`canManageDelivery` has said so since the attendance window shipped) with no way to
          take it. The desk lied about a permission the server grants.

      The attendance board already scoped itself this way. These two screens answer the same
      question about the same people, so they now answer it with the same function.
    */
    const supervisor = mayManageAnyBatch(session);

    const [ledBatches, coachedCount] = await Promise.all([
      prisma.batch.findMany({ where: { tutorId: userId, status: "ACTIVE" }, select: { id: true } }),
      prisma.enrollment.count({ where: { coachId: userId, status: "ACTIVE" } }),
    ]);
    const leadIds = new Set(ledBatches.map((b) => b.id));

    /**
     * Whether this desk is ALSO somebody's own teaching desk - what the page's subtitle and the
     * student list below turn on. A supervisor who teaches nothing has no caseload to show, so
     * they get every active enrollment instead; one who does teach keeps their own.
     */
    const supervising = supervisor && leadIds.size === 0 && coachedCount === 0;

    const batchWhere = supervisor
      ? { status: "ACTIVE" as const }
      : {
          status: "ACTIVE" as const,
          OR: [{ tutorId: userId }, { enrollments: { some: { coachId: userId } } }],
        };

    const now = Date.now();
    const weekAhead = now + 7 * 86_400_000;

    const batches = await prisma.batch.findMany({
      where: batchWhere,
      select: {
        id: true, line: true, name: true, code: true, level: true, tutorId: true,
        targetStrength: true, startDate: true, sprintStartDate: true,
        tutor: { select: { name: true } },
        curriculumTemplate: { select: { name: true } },
        _count: { select: { members: true, enrollments: true } },
        events: {
          orderBy: { startsAt: "asc" },
          select: {
            id: true, title: true, framework: true, delivery: true, startsAt: true,
            durationMins: true, joinUrl: true, recordingId: true,
            _count: { select: { attendance: true, tasks: true } },
          },
        },
      },
      orderBy: [{ startDate: "desc" }, { name: "asc" }],
    });

    const batchViews: DeskBatchView[] = [];
    const upcoming: DeskSessionView[] = [];
    const needsRegister: DeskSessionView[] = [];

    for (const b of batches) {
      const filled = b._count.members + b._count.enrollments;
      let registersOutstanding = 0;
      let recordingsOutstanding = 0;
      let nextSessionAt: string | null = null;

      for (const e of b.events) {
        const start = e.startsAt.getTime();
        const pre = e.delivery === "PRE_RECORDED";
        const past = !pre && start + (e.durationMins ?? 90) * 60_000 < now;
        const { dateYmd, timeHm } = istParts(e.startsAt);

        if (!pre && start >= now && (nextSessionAt === null || e.startsAt.toISOString() < nextSessionAt)) {
          nextSessionAt = e.startsAt.toISOString();
        }
        if (past && e._count.attendance === 0) registersOutstanding += 1;
        if (past && !e.recordingId) recordingsOutstanding += 1;

        const view: DeskSessionView = {
          id: e.id,
          batchId: b.id,
          batchName: b.name,
          batchLine: b.line,
          title: e.title,
          framework: e.framework,
          delivery: pre ? "PRE_RECORDED" : "LIVE",
          dateYmd,
          timeHm: pre || timeHm === "00:00" ? null : timeHm,
          startsAt: e.startsAt.toISOString(),
          durationMins: e.durationMins,
          joinUrl: e.joinUrl,
          isPast: past,
          rosterSize: filled,
          markedCount: e._count.attendance,
          taskCount: e._count.tasks,
          hasRecording: e.recordingId !== null,
          // Mirrors `canMark` in attendance-actions.ts and `canManageBatch` in
          // batch-timetable-actions.ts - the three have to agree or the UI lies.
          canMark: supervisor || b.tutorId === userId,
        };

        if (!pre && start >= now && start <= weekAhead) upcoming.push(view);
        // Only a class this person can actually mark lands in the to-do list. A chore you are
        // not allowed to do is not a chore, it is a dead end.
        if (past && e._count.attendance === 0 && view.canMark) {
          needsRegister.push(view);
        }
      }

      batchViews.push({
        id: b.id,
        line: b.line,
        name: b.name,
        code: b.code,
        level: b.level,
        filled,
        targetStrength: b.targetStrength,
        startDate: b.startDate ? toDateInputValue(b.startDate) : null,
        sprintStartDate: b.sprintStartDate ? toDateInputValue(b.sprintStartDate) : null,
        curriculumName: b.curriculumTemplate?.name ?? null,
        sessionCount: b.events.length,
        registersOutstanding,
        recordingsOutstanding,
        nextSessionAt,
        href: b.line === "B2" ? `/batches/${b.id}` : `/german-note/${b.id}`,
        iLead: b.tutorId === userId,
        leadName: b.tutor?.name ?? null,
      });
    }

    upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    // Most recent first - the class you have just taught is the one you are about to mark.
    needsRegister.sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    const students = await loadStudents(userId, supervising);

    return {
      role: session.role,
      supervising,
      seesAllBatches: supervisor,
      batches: batchViews,
      upcoming,
      needsRegister,
      students,
    };
  },
);

/**
 * The coach's caseload.
 *
 * Scoped by `Enrollment.coachId`. A supervisor (who coaches nobody) gets every active coaching
 * enrollment instead, capped - this is a working list, not a report, and the Students board is
 * where the full set lives.
 */
async function loadStudents(userId: string, supervising: boolean): Promise<DeskStudentView[]> {
  const today = toDateInputValue(istToday());

  const rows = await prisma.enrollment.findMany({
    where: supervising ? { status: "ACTIVE" } : { coachId: userId, status: "ACTIVE" },
    take: supervising ? 50 : 200,
    select: {
      id: true, programLevel: true, status: true, currentMilestone: true, signalColour: true,
      student: { select: { id: true, fullName: true, code: true } },
      batch: { select: { id: true, name: true } },
      sprintWeeks: {
        where: { status: "PENDING" },
        orderBy: { weekIndex: "asc" },
        select: { id: true, weekIndex: true, weekStart: true, weekEnd: true, target: true },
      },
    },
    orderBy: [{ enrollmentDate: "desc" }],
  });

  const studentIds = rows.map((r) => r.student.id);
  const [attendance, pendingTasks] = await Promise.all([
    prisma.sessionAttendance.groupBy({
      by: ["studentId", "status"],
      where: { studentId: { in: studentIds } },
      _count: { _all: true },
    }),
    prisma.sessionTaskCompletion.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds }, status: "PENDING" },
      _count: { _all: true },
    }),
  ]);

  const attendedBy = new Map<string, { attended: number; counted: number }>();
  for (const a of attendance) {
    const cur = attendedBy.get(a.studentId) ?? { attended: 0, counted: 0 };
    // EXCUSED is out of the denominator entirely - the same rule as `isCounted` in
    // lib/attendance.ts, which is what the student's own percentage is computed from.
    if (a.status === "EXCUSED") {
      attendedBy.set(a.studentId, cur);
      continue;
    }
    cur.counted += a._count._all;
    if (a.status === "PRESENT" || a.status === "LATE") cur.attended += a._count._all;
    attendedBy.set(a.studentId, cur);
  }
  const pendingBy = new Map(pendingTasks.map((p) => [p.studentId, p._count._all]));

  const mapped = rows.map((r) => {
    const att = attendedBy.get(r.student.id);
    // Only a week whose window has OPENED is due. A target set for next month is not a chore.
    const due = r.sprintWeeks.find((w) => toDateInputValue(w.weekStart) <= today) ?? null;
    return {
      studentId: r.student.id,
      enrollmentId: r.id,
      name: r.student.fullName,
      code: r.student.code,
      programLevel: r.programLevel,
      status: r.status as string,
      currentMilestone: r.currentMilestone as string,
      signalColour: r.signalColour as string | null,
      batchName: r.batch?.name ?? null,
      sprintWeekDue: due
        ? { id: due.id, weekIndex: due.weekIndex, weekEnd: toDateInputValue(due.weekEnd), target: due.target }
        : null,
      attendancePct: att && att.counted > 0 ? Math.round((att.attended / att.counted) * 100) : null,
      tasksPending: pendingBy.get(r.student.id) ?? 0,
    };
  });

  /**
   * Worst first, and sorted HERE rather than in the query.
   *
   * `orderBy: { signalColour: "asc" }` sorts a Postgres enum by its DECLARATION order, which is
   * GREEN, AMBER, RED - so "ascending" put the healthy students at the top of a list whose
   * entire purpose is to be worked from the top.
   *
   * ATTENDANCE IS IN THE RANKING, not just the signal colour. The first version of this sorted
   * on `signalColour` alone, and on a real cohort that column is almost always null - nobody
   * hand-sets a flag until something has already gone wrong. The result was a desk where the
   * student on 20% attendance sat at the BOTTOM, under five students on 100%, because the tie
   * broke alphabetically. The whole point of the list is that the top of it is where to look,
   * so the thing the app can measure for itself has to count.
   *
   * Order: a hand-set red/amber flag first (a human has said something), then the lowest
   * attendance, then an overdue sprint check-in, then name for stability.
   */
  const signalRank = { RED: 0, AMBER: 1, GREEN: 3 } as const;
  return mapped.sort((a, b) => {
    const sa = a.signalColour ? signalRank[a.signalColour as keyof typeof signalRank] ?? 2 : 2;
    const sb = b.signalColour ? signalRank[b.signalColour as keyof typeof signalRank] ?? 2 : 2;
    if (sa !== sb) return sa - sb;
    /**
     * Null attendance is "no register has been taken", which is not a 0% - it says nothing
     * about the student. It sorts BELOW anyone with a real number, so an unmarked cohort does
     * not fill the top of the list with students nobody has any evidence about.
     */
    const aa = a.attendancePct ?? 101;
    const ab = b.attendancePct ?? 101;
    if (aa !== ab) return aa - ab;
    const da = a.sprintWeekDue ? 0 : 1;
    const db = b.sprintWeekDue ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}
