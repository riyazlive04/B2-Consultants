import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/dates";
import { addDaysYmd, type SessionDeliveryValue } from "@/lib/curriculum";
import { isAttended, isCounted, type AttendanceStatus } from "@/lib/attendance";
import { isCheckInOpen, studentMaySeeMark } from "@/lib/attendance-window";
import { accessLabel, daysLeft, isRecordingAvailable } from "@/lib/recording-access";
import { studentResources, type ResourceView } from "./resources";
import { getAttendanceConfig } from "./founder-config";
import { sessionIsOn, type SessionStatusValue } from "@/lib/session-status";

/**
 * THE STUDENT'S CLASSROOM - what is on, when, and what do I owe.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────────────────
 * A student's portal was `/my-journey`: milestones, badges, agreement, payments. Every one of
 * those is a REFLECTION - how far have I come. Nothing on it answered the question a student
 * actually opens the app for on a Saturday morning, which is "where is the link". The classes,
 * the join links, the recordings and the coursework all existed in the database and were visible
 * only to staff: `/german-note/[batchId]` is gated to ADMIN, HEAD and TUTOR, and the B2 coaching
 * cohort had no screen at all. So a Guided student had no way to see their own timetable.
 *
 * ── The privacy line, enforced here rather than in the UI ───────────────────────────────
 * Same rule as `student-portal.ts`: this returns ONLY this student's own facts. No other
 * student's attendance, no roster, no internal notes, no signal, no money. The roster is
 * reduced to a count, because "7 others in your batch" is useful and a list of names is not
 * theirs to have.
 */

export type ClassroomSessionView = {
  id: string;
  weekNumber: number | null;
  title: string;
  framework: string | null;
  delivery: SessionDeliveryValue;
  dateYmd: string;
  timeHm: string | null;
  startsAt: string;
  durationMins: number | null;
  joinUrl: string | null;
  notes: string | null;
  isPast: boolean;
  /** Within the live window: an hour before the start until the duration runs out. */
  isLive: boolean;
  recordingTitle: string | null;
  /**
   * Null once the access window has closed, even though the recording still exists.
   *
   * WITHHELD AT THIS BOUNDARY, deliberately, rather than in the component. Prisma cannot filter
   * a to-one relation by date, so the row is read and then the URLs are simply not put on the
   * view - which means they never reach the serialised payload the browser receives. The same
   * rule as `visibleToStudents` on resources: a link a student may not open must not be in
   * their page, not merely hidden by CSS.
   */
  recordingEmbedUrl: string | null;
  recordingUrl: string | null;
  /** True when a recording exists but this student's window for it has passed. */
  recordingExpired: boolean;
  /** "3 days left to watch" / "No time limit" / null when there is no recording. */
  recordingAccessLabel: string | null;
  /** Whole days left, or null for no limit / no recording. Drives the "last chance" nudge. */
  recordingDaysLeft: number | null;
  /**
   * This student's own mark, or null.
   *
   * Null now carries TWO meanings and the flag below separates them: the register was never
   * taken, or it was taken and the coach has not shown it yet. Neither is an absence, and
   * conflating either with one is how a student comes to believe they missed a class they
   * attended.
   */
  myAttendance: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | null;
  /** A mark exists but the coach has not released this register to the cohort yet. */
  attendancePending: boolean;
  /**
   * CANCELLED or POSTPONED, when the class has been called off (issue C3).
   *
   * The row deliberately STAYS on the student's timetable, struck through and labelled, rather
   * than being filtered out. A class that silently disappears from a timetable a student was
   * told about is worse than no notice at all: they turn up, or they assume they misread the
   * week, and in neither case do they learn what happened. "Cancelled - tutor unwell" is the
   * whole point.
   */
  status: SessionStatusValue;
  /** Why, in the coach's words. Shown verbatim under the class. */
  cancelReason: string | null;
  /** The check-in window is open right now - the classroom shows the same button as the dashboard. */
  checkInOpen: boolean;
  /** Material for THIS class: the curriculum's, then anything posted for this session. */
  resources: ResourceView[];
  tasks: {
    completionId: string;
    title: string;
    description: string | null;
    type: string;
    dueAt: string | null;
    status: "YES" | "NO" | "PENDING";
    autoCompleted: boolean;
  }[];
};

export type ClassroomBatchView = {
  id: string;
  line: "B2" | "GERMAN_NOTE";
  name: string;
  code: string | null;
  level: string;
  coachName: string | null;
  classmates: number;
  /** Null for a cohort with no curriculum - German Note, and any B2 batch not yet built. */
  curriculumName: string | null;
  sprintStartYmd: string | null;
  sprintEndYmd: string | null;
  sessions: ClassroomSessionView[];
  /** The cohort shelf - true for every class, so it is listed once rather than on all eight. */
  resources: ResourceView[];
  /** Live sessions already past, and how many of those this student was marked at. */
  attended: number;
  counted: number;
  tasksDone: number;
  tasksTotal: number;
};

export type StudentClassroom = {
  studentId: string;
  fullName: string;
  batches: ClassroomBatchView[];
  /** The soonest session, across every batch, that has not finished yet. */
  next: { batch: ClassroomBatchView; session: ClassroomSessionView } | null;
};

function istParts(d: Date): { dateYmd: string; timeHm: string } {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return { dateYmd: ist.toISOString().slice(0, 10), timeHm: ist.toISOString().slice(11, 16) };
}

/**
 * Everything the signed-in student may see about their own classes.
 *
 * Keyed on `User.id` rather than a student id taken from the request - the caller cannot ask
 * for somebody else's classroom because there is nowhere to put the question.
 */
export const getMyClassroom = cache(async (userId: string): Promise<StudentClassroom | null> => {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      fullName: true,
      // Both routes into a cohort: German Note seats through BatchMember, B2 through Enrollment.
      gnMemberships: { select: { batchId: true } },
      enrollments: { select: { batchId: true } },
    },
  });
  if (!student) return null;

  const batchIds = [
    ...new Set([
      ...student.gnMemberships.map((m) => m.batchId),
      ...student.enrollments.map((e) => e.batchId).filter((id): id is string => id !== null),
    ]),
  ];
  if (batchIds.length === 0) {
    return { studentId: student.id, fullName: student.fullName, batches: [], next: null };
  }

  const batches = await prisma.batch.findMany({
    where: { id: { in: batchIds } },
    select: {
      id: true, line: true, name: true, code: true, level: true, sprintStartDate: true,
      tutor: { select: { name: true } },
      curriculumTemplate: { select: { name: true, sprintDays: true } },
      _count: { select: { members: true, enrollments: true } },
      events: {
        orderBy: [{ startsAt: "asc" }, { orderIndex: "asc" }],
        select: {
          id: true, weekNumber: true, orderIndex: true, title: true, framework: true,
          delivery: true, startsAt: true, durationMins: true, joinUrl: true, notes: true,
          recording: { select: { title: true, embedUrl: true, videoUrl: true, availableUntil: true } },
          attendanceOpensAt: true,
          attendanceClosesAt: true,
          attendancePublishedAt: true,
          status: true,
          cancelReason: true,
          // Scoped to this student - the register as a whole is not theirs to read.
          attendance: { where: { studentId: student.id }, select: { status: true, source: true } },
          tasks: {
            orderBy: { orderIndex: "asc" },
            select: {
              id: true, title: true, description: true, type: true, dueAt: true,
              completions: {
                where: { studentId: student.id },
                select: { id: true, status: true, autoCompleted: true },
              },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const now = Date.now();
  const nowDate = new Date(now);
  // One read for every batch at once. `studentResources` applies `visibleToStudents` in the
  // QUERY, so a staged exercise never reaches the browser at all.
  const resources = await studentResources(batchIds);
  const attendanceConfig = await getAttendanceConfig();

  const views: ClassroomBatchView[] = batches.map((b) => {
    let attended = 0;
    let counted = 0;
    let tasksDone = 0;
    let tasksTotal = 0;

    const sessions: ClassroomSessionView[] = b.events.map((e) => {
      const { dateYmd, timeHm } = istParts(e.startsAt);
      const pre = e.delivery === "PRE_RECORDED";
      const start = e.startsAt.getTime();
      const end = start + (e.durationMins ?? 90) * 60_000;
      const row = e.attendance[0] ?? null;
      // The tutor's or head coach's decision on how long this one stays visible. Null
      // `availableUntil` is no limit, which is what every recording had before windows existed.
      const recordingOpen = e.recording ? isRecordingAvailable(e.recording.availableUntil, nowDate) : false;

      /**
       * THE PUBLISH GATE. A mark the coach has not released is not shown, and not counted.
       *
       * Hiding it from the row while still counting it in the percentage would leak the
       * verdict anyway - a student who sees their rate drop from 100% to 83% has learned
       * exactly what the hidden mark says, and learned it in the one form they cannot
       * question. So an unpublished register is invisible on both.
       *
       * The consequence is deliberate and worth stating: while a register is unpublished, the
       * student's percentage is LOWER-BOUNDED rather than wrong - it is the truth over the
       * classes they have been told about. Their coach's copy counts everything, so the two
       * can differ for as long as a tutor sits on a register. That is the cost of the gate,
       * and it is smaller than the alternative, which is a number that silently reveals what
       * the gate exists to withhold.
       */
      const visible = studentMaySeeMark({
        publishedAt: e.attendancePublishedAt,
        mySource: (row?.source as "TUTOR" | "SELF" | undefined) ?? null,
        publishRequired: attendanceConfig.publishRequired,
      });
      const mark = visible ? row?.status ?? null : null;

      // The house rule, from lib/attendance: EXCUSED is NOT in the denominator. An excused
      // absence is the system working - the student told someone - and counting it against them
      // punishes exactly the behaviour we want. Hand-rolling the test here is how the student's
      // own percentage came to disagree with the one their coach reads.
      /**
       * A CALLED-OFF CLASS IS IN NO DENOMINATOR (issue C3).
       *
       * `sessionIsOn` rather than a raw string test, and checked here as well as in the query
       * on the coach's side, because this is the number the STUDENT reads - and the two have to
       * agree. Counting a class we cancelled would drop a student's rate for our decision,
       * which is the same mistake `isCounted` exists to stop for EXCUSED.
       */
      if (!pre && start < now && mark && sessionIsOn(e.status)) {
        if (isCounted(mark as AttendanceStatus)) counted += 1;
        if (isAttended(mark as AttendanceStatus)) attended += 1;
      }

      const tasks = e.tasks
        // A task with no completion row for this student is not theirs - it was assigned
        // before they joined and `seatStudentTasks` has not backfilled it.
        .filter((t) => t.completions.length > 0)
        .map((t) => {
          tasksTotal += 1;
          const c = t.completions[0];
          if (c.status === "YES") tasksDone += 1;
          return {
            completionId: c.id,
            title: t.title,
            description: t.description,
            type: t.type as string,
            dueAt: t.dueAt?.toISOString() ?? null,
            status: c.status as "YES" | "NO" | "PENDING",
            autoCompleted: c.autoCompleted,
          };
        });

      return {
        id: e.id,
        weekNumber: e.weekNumber,
        title: e.title,
        framework: e.framework,
        delivery: pre ? "PRE_RECORDED" : "LIVE",
        dateYmd,
        // IST midnight is how "no clock" is stored for both cases, so it reads back as no time
        // rather than as a class at midnight.
        timeHm: pre || timeHm === "00:00" ? null : timeHm,
        startsAt: e.startsAt.toISOString(),
        durationMins: e.durationMins,
        joinUrl: e.joinUrl,
        notes: e.notes,
        isPast: !pre && end < now,
        // The join button should appear BEFORE the class, not at the stroke of the hour - a
        // student who opens the app five minutes early should find the link waiting.
        isLive: !pre && now >= start - 60 * 60_000 && now <= end,
        recordingTitle: e.recording?.title ?? null,
        recordingEmbedUrl: recordingOpen ? e.recording?.embedUrl ?? null : null,
        recordingUrl: recordingOpen ? e.recording?.videoUrl ?? null : null,
        recordingExpired: e.recording !== null && !recordingOpen,
        recordingAccessLabel: e.recording ? accessLabel(e.recording.availableUntil, nowDate) : null,
        recordingDaysLeft: e.recording ? daysLeft(e.recording.availableUntil, nowDate) : null,
        myAttendance: mark as ClassroomSessionView["myAttendance"],
        attendancePending: row !== null && !visible,
        status: e.status as SessionStatusValue,
        cancelReason: e.cancelReason,
        checkInOpen: isCheckInOpen(
          { opensAt: e.attendanceOpensAt, closesAt: e.attendanceClosesAt },
          new Date(now),
        ),
        tasks,
        resources: resources.bySession.get(e.id) ?? [],
      };
    });

    const sprintStartYmd = b.sprintStartDate ? toDateInputValue(b.sprintStartDate) : null;
    const sprintDays = b.curriculumTemplate?.sprintDays ?? null;

    return {
      id: b.id,
      line: b.line,
      name: b.name,
      code: b.code,
      level: b.level,
      coachName: b.tutor?.name ?? null,
      // A count, never a list. How many people are in the room is useful; who they are is not
      // this student's to read.
      classmates: Math.max(0, b._count.members + b._count.enrollments - 1),
      curriculumName: b.curriculumTemplate?.name ?? null,
      resources: resources.byBatch.get(b.id) ?? [],
      sprintStartYmd,
      sprintEndYmd: sprintStartYmd && sprintDays ? addDaysYmd(sprintStartYmd, sprintDays) : null,
      sessions,
      attended,
      counted,
      tasksDone,
      tasksTotal,
    };
  });

  // The soonest thing still to come, across every cohort. A pre-recorded module is never "next":
  // it has no clock, so it would otherwise sit at the top of the list for the rest of the course.
  let next: StudentClassroom["next"] = null;
  for (const b of views) {
    for (const s of b.sessions) {
      // A cancelled class is never "the next thing that happens" (issue C3) - the dashboard
      // leads with this, and leading with a class that is off is the worst place to be wrong.
      if (s.delivery === "PRE_RECORDED" || s.isPast || !sessionIsOn(s.status)) continue;
      if (!next || s.startsAt < next.session.startsAt) next = { batch: b, session: s };
    }
  }

  return { studentId: student.id, fullName: student.fullName, batches: views, next };
});
