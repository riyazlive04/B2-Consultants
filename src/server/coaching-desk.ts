import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { type CapabilityOverrides } from "@/lib/capabilities";
import { withBack } from "@/lib/back-link";
import { DISCONTINUED_STATUS, SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import { checkInState, unansweredStreak, type CheckInState } from "@/lib/sprint-check-in";
import { getStudentLifecycleConfig } from "./founder-config";
import { mayManageAnyBatch } from "./batch-access";
import type { AppRole } from "@/lib/sections";
import { istToday, toDateInputValue } from "@/lib/dates";
import type { SessionDeliveryValue } from "@/lib/curriculum";
import { sessionIsOn, type SessionStatusValue } from "@/lib/session-status";

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
  /** SCHEDULED / CANCELLED / POSTPONED (issue C3). A called-off class owes the coach nothing. */
  status: SessionStatusValue;
  /** Why it was called off, in the coach's own words. */
  cancelReason: string | null;
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
  /**
   * The sprint week that needs something, and WHOSE move it is.
   *
   * This used to be "the first PENDING week whose window has opened", which conflated the two
   * halves of PENDING: a week the student has answered and whose prose target leaves the
   * verdict to the coach, and a week the student simply has not filled in. The desk said
   * "waiting on you" for both, so a coach chasing their queue found half of it was not theirs
   * to action. `state` is the split - see lib/sprint-check-in.ts.
   */
  sprintWeekDue: {
    id: string;
    weekIndex: number;
    weekEnd: string;
    target: string | null;
    state: CheckInState;
  } | null;
  /**
   * Closed weekends left unanswered, counting back - the end of the follow-up ladder (@37:16).
   *
   * Surfaced, never acted on. Three in a row is the point at which the founders described a
   * discontinue decision (@37:54), and this is what puts that student in front of the coach
   * who holds the button two columns to the right. Nothing in the app ever presses it.
   */
  unansweredStreak: number;
  attendancePct: number | null;
  tasksPending: number;
  /**
   * May THIS viewer discontinue this student?
   *
   * Per row, like `canMark` on a session above and for the same reason: a supervisor's desk
   * lists every active enrolment, and the right to SEE a caseload is not the right to end
   * somebody else's student's programme. Admin and Head always may; a coach may when the
   * enrolment names them and the founder has left `coachMayDiscontinue` on.
   */
  canDiscontinue: boolean;
};

/**
 * Students who have stopped recently - the undo for the button beside it.
 *
 * A discontinued enrolment leaves the caseload immediately (`loadStudents` filters ACTIVE), so
 * without this list a coach who pressed the wrong row had nowhere to go: the student had
 * vanished from the only screen they can reach. Thirty days, because that is the window in
 * which a press is a mistake rather than a decision - after it, the Students board is the
 * place, with the full record in front of you.
 */
export type DeskDepartureView = {
  enrollmentId: string;
  studentId: string;
  name: string;
  code: string | null;
  programLevel: string;
  reason: string | null;
  note: string | null;
  whenYmd: string;
  byName: string | null;
  canRestore: boolean;
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
  /** Discontinued in the last 30 days, newest first - see `DeskDepartureView`. */
  recentDepartures: DeskDepartureView[];
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
        // Seated enrolments only - a student who dropped has given their seat back, and the
        // desk's "7/10 seated" is the number a coach decides whether to chase a replacement on.
        _count: { select: { members: true, enrollments: { where: { status: { in: [...SEATED_STATUSES] } } } } },
        events: {
          orderBy: { startsAt: "asc" },
          select: {
            id: true, title: true, framework: true, delivery: true, startsAt: true,
            durationMins: true, joinUrl: true, recordingId: true,
            // Issue C3: a called-off class generates no work for the coach. Selected rather
            // than filtered in the query, because the desk still LISTS it - the week should
            // read honestly - it just owes nothing.
            status: true, cancelReason: true,
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
        /**
         * A CALLED-OFF CLASS OWES THE COACH NOTHING (issue C3).
         *
         * It is not the next class, it has no register to mark and no recording to post - and
         * before the status existed, all three of those counters chased a tutor about a class
         * they had themselves cancelled, for ever. The row still appears in the list below so
         * the desk shows the week honestly; it just generates no work.
         */
        const on = sessionIsOn(e.status);

        if (on && !pre && start >= now && (nextSessionAt === null || e.startsAt.toISOString() < nextSessionAt)) {
          nextSessionAt = e.startsAt.toISOString();
        }
        if (on && past && e._count.attendance === 0) registersOutstanding += 1;
        if (on && past && !e.recordingId) recordingsOutstanding += 1;

        const view: DeskSessionView = {
          id: e.id,
          batchId: b.id,
          batchName: b.name,
          batchLine: b.line,
          status: e.status as SessionStatusValue,
          cancelReason: e.cancelReason,
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
        href: withBack(b.line === "B2" ? `/batches/${b.id}` : `/german-note/${b.id}`, "coaching"),
        iLead: b.tutorId === userId,
        leadName: b.tutor?.name ?? null,
      });
    }

    upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    // Most recent first - the class you have just taught is the one you are about to mark.
    needsRegister.sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    /**
     * The caseload and the recent departures read the SAME permission, resolved once here.
     *
     * `coachMayDiscontinue` is one founder switch, and asking for it inside both loaders would
     * mean a desk that could offer the button on a student and refuse the undo on the one
     * beside them if the config changed between two reads.
     */
    const lifecycle = await getStudentLifecycleConfig();
    const privileged = session.role === "ADMIN" || session.role === "HEAD";
    const mayEnd = (coachId: string | null) =>
      privileged || (lifecycle.coachMayDiscontinue && coachId === userId);

    const [students, recentDepartures] = await Promise.all([
      loadStudents(userId, supervising, mayEnd),
      loadRecentDepartures(userId, supervisor, mayEnd),
    ]);

    return {
      role: session.role,
      supervising,
      seesAllBatches: supervisor,
      batches: batchViews,
      upcoming,
      needsRegister,
      students,
      recentDepartures,
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
async function loadStudents(
  userId: string,
  supervising: boolean,
  mayEnd: (coachId: string | null) => boolean,
): Promise<DeskStudentView[]> {
  const today = toDateInputValue(istToday());

  const rows = await prisma.enrollment.findMany({
    where: supervising ? { status: "ACTIVE" } : { coachId: userId, status: "ACTIVE" },
    take: supervising ? 50 : 200,
    select: {
      id: true, programLevel: true, status: true, currentMilestone: true, signalColour: true,
      // `coachId` is read for the permission, never shown - see `canDiscontinue`.
      coachId: true,
      student: { select: { id: true, fullName: true, code: true } },
      batch: { select: { id: true, name: true } },
      /**
       * EVERY sprint week, not only the PENDING ones.
       *
       * The `where: { status: "PENDING" }` filter had to go, because the unanswered STREAK
       * cannot be computed from the unanswered weeks alone: what ends a streak is a week the
       * student did answer, and those rows were being filtered out before they could end it.
       * A sprint is 13 to 18 weeks, so this is a few more scalar rows per student on a query
       * that was already reading the relation.
       */
      sprintWeeks: {
        orderBy: { weekIndex: "asc" },
        select: {
          id: true, weekIndex: true, weekStart: true, weekEnd: true, target: true,
          status: true, actual: true,
        },
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

    /**
     * Shaped once, read twice. Both the week that is due and the streak are derived from the
     * same rows and the same `checkInState`, so the pill in the column and the concern flag
     * beside it can never tell the coach two different stories about one student.
     */
    const weeks = r.sprintWeeks.map((w) => ({
      id: w.id,
      weekIndex: w.weekIndex,
      target: w.target,
      status: w.status as string,
      actual: w.actual,
      weekStartYmd: toDateInputValue(w.weekStart),
      weekEndYmd: toDateInputValue(w.weekEnd),
    }));

    /**
     * The coach's own queue comes FIRST.
     *
     * A week awaiting their verdict is a chore they can finish in ten seconds; a week the
     * student has not answered is a conversation. Showing the second where the first exists
     * buries the actionable one, which is how a review queue stops being worked.
     *
     * A week whose window has not opened is never due - a target set for next month is not a
     * chore - and `checkInState` is what says so, rather than a date comparison here.
     */
    const due =
      weeks.find((w) => checkInState(w, today) === "AWAITING_COACH") ??
      weeks.find((w) => checkInState(w, today) === "OVERDUE") ??
      weeks.find((w) => checkInState(w, today) === "AWAITING_STUDENT") ??
      null;
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
        ? {
            id: due.id,
            weekIndex: due.weekIndex,
            weekEnd: due.weekEndYmd,
            target: due.target,
            state: checkInState(due, today),
          }
        : null,
      unansweredStreak: unansweredStreak(weeks, today),
      attendancePct: att && att.counted > 0 ? Math.round((att.attended / att.counted) * 100) : null,
      tasksPending: pendingBy.get(r.student.id) ?? 0,
      canDiscontinue: mayEnd(r.coachId),
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

/**
 * Who stopped recently, so the coach can undo a press.
 *
 * Scoped exactly like the caseload: your own students, or every enrolment when you supervise.
 * The reason is shown because the undo is a judgement - "put them back" reads differently next
 * to "found a job elsewhere" than next to "unresponsive - no contact".
 *
 * `statusChangedAt` is the clock, which is why there is no `discontinuedAt` column: this list,
 * the "dropped this month" tile and the student record all read the one field.
 */
async function loadRecentDepartures(
  userId: string,
  supervisor: boolean,
  mayEnd: (coachId: string | null) => boolean,
): Promise<DeskDepartureView[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.enrollment.findMany({
    where: {
      status: DISCONTINUED_STATUS,
      statusChangedAt: { gte: since },
      ...(supervisor ? {} : { coachId: userId }),
    },
    take: 20,
    orderBy: { statusChangedAt: "desc" },
    select: {
      id: true,
      programLevel: true,
      coachId: true,
      statusChangedAt: true,
      discontinueReason: true,
      discontinueNote: true,
      discontinuedBy: { select: { name: true, email: true } },
      student: { select: { id: true, fullName: true, code: true } },
    },
  });

  return rows.map((r) => ({
    enrollmentId: r.id,
    studentId: r.student.id,
    name: r.student.fullName,
    code: r.student.code,
    programLevel: r.programLevel,
    reason: r.discontinueReason,
    note: r.discontinueNote,
    whenYmd: toDateInputValue(r.statusChangedAt),
    byName: r.discontinuedBy?.name ?? r.discontinuedBy?.email ?? null,
    canRestore: mayEnd(r.coachId),
  }));
}
