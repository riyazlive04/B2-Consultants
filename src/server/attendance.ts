import "server-only";
import { prisma } from "@/lib/prisma";
import { belongsOnRegister, SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import {
  summarise,
  signalFor,
  signalReason,
  noShowRate,
  attendedHeadcount,
  type AttendanceMark,
  type AttendanceStatus,
  type AttendanceSignal,
} from "@/lib/attendance";
import {
  remainingMs,
  windowEnd,
  windowState,
  type WindowState,
} from "@/lib/attendance-window";
import { getAttendanceConfig } from "./founder-config";

/**
 * Attendance - the reads and writes.
 *
 * All of the judgement lives in lib/attendance.ts (pure, unit-tested). This file only fetches,
 * materialises and persists, which is the same division as tutor-fees.ts ↔ lib/tutor-fee.ts.
 */

export type AttendanceSheetRow = {
  studentId: string;
  studentName: string;
  studentCode: string | null;
  /** Null when this student has no row yet - i.e. the register hasn't been taken. */
  status: AttendanceStatus | null;
  note: string | null;
  markedByName: string | null;
  markedAt: string | null;
  /** Did the student tick themselves in, or did a tutor mark them? */
  source: AttendanceSourceValue;
  /** When they pressed "I'm here" - shown beside the row, so arrivals are legible. */
  checkedInAt: string | null;
  /** Set once a coach has pressed "Ask why" on this absence. Null = nobody has asked. */
  reasonAskedAt: string | null;
  /** The student's own words, once they answer. Null while unanswered - itself a signal. */
  reason: string | null;
  reasonAt: string | null;
};

export type AttendanceSheet = {
  sessionId: string;
  sessionTitle: string;
  batchId: string;
  startsAt: string;
  rows: AttendanceSheetRow[];
  /** True once every roster member has a mark. */
  complete: boolean;
  markedCount: number;
  attendedCount: number;
  noShowRate: number | null;
  /** The self check-in window, so the sheet can open, close and count it. */
  window: SessionWindowView;
};

/** Mirrors Prisma's `AttendanceSource`, kept as a string union for the client boundary. */
export type AttendanceSourceValue = "TUTOR" | "SELF";

export type SessionWindowView = {
  state: WindowState;
  opensAt: string | null;
  closesAt: string | null;
  /** Milliseconds left at the moment this was read - the client counts down from it. */
  remainingMs: number;
  graceMins: number;
  /** How many of the marks on this session came from a student pressing the button. */
  checkedInCount: number;
  publishedAt: string | null;
  publishedByName: string | null;
  openedByName: string | null;
};

/**
 * The register for one session: every roster member, with their mark if it exists.
 *
 * The ROSTER is the source of who should be listed, and existing marks are layered on top. That
 * ordering matters: a student seated into the batch after the register was first opened must
 * appear (unmarked) rather than being invisible because they have no row yet.
 */
export async function getAttendanceSheet(sessionId: string): Promise<AttendanceSheet | null> {
  const session = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      batchId: true,
      attendanceOpensAt: true,
      attendanceClosesAt: true,
      attendanceGraceMins: true,
      attendancePublishedAt: true,
      attendanceOpenedBy: { select: { name: true, email: true } },
      attendancePublishedBy: { select: { name: true, email: true } },
      batch: {
        select: {
          members: {
            select: { student: { select: { id: true, fullName: true, code: true } } },
          },
          enrollments: {
            // `status` comes along so a departed student can be kept off FUTURE registers
            // without being erased from the ones they were marked on. See below.
            select: { status: true, student: { select: { id: true, fullName: true, code: true } } },
          },
        },
      },
      attendance: {
        select: {
          studentId: true,
          status: true,
          note: true,
          markedAt: true,
          source: true,
          checkedInAt: true,
          reasonAskedAt: true,
          reason: true,
          reasonAt: true,
          markedBy: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!session) return null;

  const config = await getAttendanceConfig();

  // A batch can be populated through EITHER seam - German Note seats arrive as BatchMember,
  // B2 coaching seats as Enrollment.batchId (see the Batch model's note). Both are "on the
  // roster", so both are expected in the room; deduped because nothing forbids being in both.
  const roster = new Map<string, { id: string; fullName: string; code: string | null }>();
  for (const m of session.batch.members) roster.set(m.student.id, m.student);

  const marks = new Map(session.attendance.map((a) => [a.studentId, a]));

  /**
   * A STUDENT WHO LEFT COMES OFF THE REGISTER - but only the ones they were never marked on.
   *
   * Both halves matter. Before this, a dropped enrolment stayed on every future register, so a
   * coach was asked each Saturday to mark a student who had stopped coming, and the register
   * could never read "complete". Filtering them out of the query instead would have been the
   * opposite mistake: a student who dropped in week six ATTENDED weeks one to five, and their
   * marks would have vanished from those sheets along with the `markedCount` and the
   * "complete" flag computed from them - rewriting the history of a class that was taught.
   *
   * So the test is `belongsOnRegister(status, hasMark)`: keep anyone already marked here, drop
   * the departed who are not. One rule, in lib/enrollment-lifecycle.ts, shared with the cohort
   * attendance table below.
   */
  for (const e of session.batch.enrollments) {
    if (!belongsOnRegister(e.status, marks.has(e.student.id))) continue;
    roster.set(e.student.id, e.student);
  }

  const rows: AttendanceSheetRow[] = [...roster.values()]
    .map((s) => {
      const mark = marks.get(s.id);
      return {
        studentId: s.id,
        studentName: s.fullName,
        studentCode: s.code,
        status: (mark?.status as AttendanceStatus | undefined) ?? null,
        note: mark?.note ?? null,
        markedByName: mark?.markedBy?.name ?? mark?.markedBy?.email ?? null,
        markedAt: mark?.markedAt.toISOString() ?? null,
        source: (mark?.source as AttendanceSourceValue | undefined) ?? "TUTOR",
        checkedInAt: mark?.checkedInAt?.toISOString() ?? null,
        reasonAskedAt: mark?.reasonAskedAt?.toISOString() ?? null,
        reason: mark?.reason ?? null,
        reasonAt: mark?.reasonAt?.toISOString() ?? null,
      };
    })
    /**
     * ARRIVALS FIRST while the window is open, alphabetical once it is not.
     *
     * A tutor watching a live register is watching a list GROW, and the useful thing is the
     * newest arrival at the top - "who just joined". Alphabetical order scatters each new
     * check-in to a random row, which on a screen that refreshes every few seconds reads as
     * nothing happening. Afterwards the question changes to "find this student and fix their
     * row", and for that a name is the key.
     */
    .sort((a, b) => {
      if (session.attendanceClosesAt && Date.now() <= session.attendanceClosesAt.getTime()) {
        if (a.checkedInAt && b.checkedInAt) return b.checkedInAt.localeCompare(a.checkedInAt);
        if (a.checkedInAt) return -1;
        if (b.checkedInAt) return 1;
      }
      return a.studentName.localeCompare(b.studentName);
    });

  const marked = rows.filter((r) => r.status !== null);
  const statuses = marked.map((r) => r.status!) as AttendanceStatus[];

  return {
    sessionId: session.id,
    sessionTitle: session.title,
    batchId: session.batchId,
    startsAt: session.startsAt.toISOString(),
    rows,
    complete: rows.length > 0 && marked.length === rows.length,
    markedCount: marked.length,
    attendedCount: attendedHeadcount(statuses),
    noShowRate: noShowRate(statuses),
    window: {
      state: windowState(
        { opensAt: session.attendanceOpensAt, closesAt: session.attendanceClosesAt },
        new Date(),
      ),
      opensAt: session.attendanceOpensAt?.toISOString() ?? null,
      closesAt: session.attendanceClosesAt?.toISOString() ?? null,
      remainingMs: remainingMs(
        { opensAt: session.attendanceOpensAt, closesAt: session.attendanceClosesAt },
        new Date(),
      ),
      graceMins: session.attendanceGraceMins ?? config.checkInLateAfterMins,
      checkedInCount: rows.filter((r) => r.source === "SELF").length,
      publishedAt: session.attendancePublishedAt?.toISOString() ?? null,
      publishedByName:
        session.attendancePublishedBy?.name ?? session.attendancePublishedBy?.email ?? null,
      openedByName: session.attendanceOpenedBy?.name ?? session.attendanceOpenedBy?.email ?? null,
    },
  };
}

/**
 * Opens the register for self check-in.
 *
 * The grace is SNAPSHOTTED onto the session rather than read at judgement time. A cohort
 * judged against a ten-minute grace in October must not be silently re-judged when somebody
 * widens the setting in December - the same reasoning as `framework` on ClassSession.
 *
 * Re-opening an already-open window EXTENDS it from now, which is what a tutor pressing the
 * button again plainly means ("give them another ten minutes"). It does not reset who has
 * already checked in; those rows stand.
 */
export async function openCheckInWindow(
  sessionId: string,
  args: { minutes: number; graceMins: number; openedById: string },
): Promise<{ closesAt: Date }> {
  const now = new Date();
  const closesAt = windowEnd(now, args.minutes);
  await prisma.classSession.update({
    where: { id: sessionId },
    data: {
      attendanceOpensAt: now,
      attendanceClosesAt: closesAt,
      attendanceGraceMins: Math.max(0, Math.round(args.graceMins)),
      attendanceOpenedById: args.openedById,
    },
  });
  return { closesAt };
}

/**
 * Shuts the register now.
 *
 * `closesAt = now` rather than nulling the pair, so the record still says a window existed and
 * when it ended. Nulling would make a closed window indistinguishable from one that was never
 * opened, and those are different things to tell a student who missed it.
 */
export async function closeCheckInWindow(sessionId: string): Promise<void> {
  await prisma.classSession.update({
    where: { id: sessionId },
    data: { attendanceClosesAt: new Date() },
  });
}

/** Shows the finished register to the cohort, or takes it back out of their view. */
export async function setAttendancePublished(
  sessionId: string,
  published: boolean,
  byId: string | null,
): Promise<void> {
  await prisma.classSession.update({
    where: { id: sessionId },
    data: published
      ? { attendancePublishedAt: new Date(), attendancePublishedById: byId }
      : { attendancePublishedAt: null, attendancePublishedById: null },
  });
}

/**
 * Persists a set of marks for one session.
 *
 * Upsert per student on the `(sessionId, studentId)` unique key, so this is idempotent: a
 * double-submit, a retry, or a tutor correcting one row all converge on the same register. A
 * null status DELETES the row rather than storing an "unmarked" value - "we never took the
 * register" and "we took it and they were absent" must stay distinguishable, and only the
 * absence of a row can say the first.
 */
export async function saveAttendance(
  sessionId: string,
  marks: { studentId: string; status: AttendanceStatus | null; note?: string | null }[],
  markedById: string | null,
): Promise<{ saved: number; cleared: number }> {
  const toClear = marks.filter((m) => m.status === null).map((m) => m.studentId);
  const toSave = marks.filter((m) => m.status !== null);

  /**
   * WHOSE WORD IS THIS ROW? Read the existing marks so the save can tell the difference
   * between a tutor CONFIRMING a self check-in and a tutor OVERRULING one.
   *
   * Leaving `source` alone would let a row still claim the student said they were present
   * after a tutor changed it to absent. Setting it to TUTOR unconditionally is worse: saving
   * a sheet without touching a single row would relabel every check-in as the tutor's own
   * work, and the student's "you checked in at 10:31" confirmation would vanish from their
   * dashboard until the register was published. So the flip happens only where the verdict
   * actually changed. Eight rows per batch - the extra read is free.
   */
  const existing = await prisma.sessionAttendance.findMany({
    where: { sessionId, studentId: { in: toSave.map((m) => m.studentId) } },
    select: { studentId: true, status: true },
  });
  const before = new Map(existing.map((e) => [e.studentId, e.status as AttendanceStatus]));

  // One transaction: a half-saved register is worse than an unsaved one, because it looks done.
  await prisma.$transaction([
    ...(toClear.length
      ? [prisma.sessionAttendance.deleteMany({ where: { sessionId, studentId: { in: toClear } } })]
      : []),
    ...toSave.map((m) => {
      const changed = before.get(m.studentId) !== m.status;
      return prisma.sessionAttendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: m.studentId } },
        create: {
          sessionId,
          studentId: m.studentId,
          status: m.status!,
          note: m.note?.trim() || null,
          markedById,
          source: "TUTOR",
        },
        update: {
          status: m.status!,
          note: m.note?.trim() || null,
          markedById,
          markedAt: new Date(),
          // `checkedInAt` is deliberately NOT cleared - when the student arrived is evidence,
          // and it stays true whatever the tutor later decides the mark should be.
          ...(changed ? { source: "TUTOR" as const } : {}),
        },
      });
    }),
  ]);

  return { saved: toSave.length, cleared: toClear.length };
}

/**
 * The one-press finish: everyone still unmarked becomes `status`.
 *
 * THE WHOLE POINT OF THE WINDOW is that the register is mostly full by the time the tutor
 * looks at it, so what is left is a residue of two or three names. Asking the tutor to set
 * each of those by hand reintroduces exactly the chore the window removed.
 *
 * Only UNMARKED students are touched - `skipDuplicates`-style, by querying who already has a
 * row. A student the tutor deliberately excused ten seconds earlier must not be flattened to
 * absent by the convenience button.
 */
export async function fillUnmarked(
  sessionId: string,
  status: AttendanceStatus,
  markedById: string | null,
): Promise<{ filled: number }> {
  const sheet = await getAttendanceSheet(sessionId);
  if (!sheet) return { filled: 0 };
  const unmarked = sheet.rows.filter((r) => r.status === null);
  if (unmarked.length === 0) return { filled: 0 };

  await prisma.sessionAttendance.createMany({
    data: unmarked.map((r) => ({
      sessionId,
      studentId: r.studentId,
      status,
      markedById,
      source: "TUTOR" as const,
    })),
    // Belt and braces against a double-press racing itself; the unique key is the real guard.
    skipDuplicates: true,
  });

  return { filled: unmarked.length };
}

export type StudentAttendanceView = {
  studentId: string;
  studentName: string;
  attended: number;
  counted: number;
  ratePct: number | null;
  consecutiveMissed: number;
  signal: AttendanceSignal;
  reason: string;
};

/**
 * Per-student attendance across a batch - the drop-risk read.
 *
 * Scoped to ONE batch on purpose. A student repeating A1 after a strong A2 would otherwise have
 * the two averaged into a single number that describes neither, and it is the current cohort
 * that a tutor can actually act on.
 */
export async function getBatchAttendance(batchId: string): Promise<StudentAttendanceView[]> {
  const config = await getAttendanceConfig();

  const [sessions, batch] = await Promise.all([
    prisma.classSession.findMany({
      where: { batchId },
      select: {
        id: true,
        startsAt: true,
        attendance: { select: { studentId: true, status: true } },
      },
    }),
    prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        members: { select: { student: { select: { id: true, fullName: true } } } },
        enrollments: { select: { status: true, student: { select: { id: true, fullName: true } } } },
      },
    }),
  ]);
  if (!batch) return [];

  const byStudent = new Map<string, AttendanceMark[]>();
  for (const s of sessions) {
    for (const a of s.attendance) {
      const list = byStudent.get(a.studentId) ?? [];
      list.push({ sessionId: s.id, startsAt: s.startsAt, status: a.status as AttendanceStatus });
      byStudent.set(a.studentId, list);
    }
  }

  /**
   * The same roster rule as the register, built AFTER the marks so it can ask the same question.
   *
   * A student who left keeps their row here when they have attendance history - their 60% over
   * the five weeks they were present is a fact, and it is the one the coach reviews when asked
   * why the cohort lost them. A student who left having never been marked has nothing to show,
   * and listing them would put a permanent UNKNOWN row at the top of a table sorted worst-first.
   */
  const roster = new Map<string, string>();
  for (const m of batch.members) roster.set(m.student.id, m.student.fullName);
  for (const e of batch.enrollments) {
    if (!belongsOnRegister(e.status, byStudent.has(e.student.id))) continue;
    roster.set(e.student.id, e.student.fullName);
  }

  return [...roster.entries()]
    .map(([studentId, studentName]) => {
      const summary = summarise(byStudent.get(studentId) ?? []);
      return {
        studentId,
        studentName,
        attended: summary.attended,
        counted: summary.counted,
        ratePct: summary.rate === null ? null : Math.round(summary.rate * 100),
        consecutiveMissed: summary.consecutiveMissed,
        signal: signalFor(summary, config),
        reason: signalReason(summary, config),
      };
    })
    .sort((a, b) => {
      // Worst first - this list exists to be acted on from the top, not browsed alphabetically.
      const rank = { RED: 0, AMBER: 1, UNKNOWN: 2, GREEN: 3 } as const;
      const d = rank[a.signal] - rank[b.signal];
      return d !== 0 ? d : a.studentName.localeCompare(b.studentName);
    });
}

/**
 * How many of a batch's roster actually turned up, averaged over its marked sessions.
 *
 * Held BESIDE `TutorFee.headcount` (which is roster size) rather than replacing it. The two
 * being different is the fact the founders need in order to decide whether the fee basis should
 * change - that is a pricing decision and theirs, not a side effect of recording attendance.
 */
export async function getBatchAttendanceSummary(batchId: string): Promise<{
  markedSessions: number;
  totalSessions: number;
  averageAttended: number | null;
  rosterSize: number;
}> {
  const [sessions, counts] = await Promise.all([
    prisma.classSession.findMany({
      where: { batchId },
      select: { id: true, attendance: { select: { status: true } } },
    }),
    prisma.batch.findUnique({
      where: { id: batchId },
      // Seated only, for the same reason as the board's `rosterSize`: this number is compared
      // against registers that no longer list a student who has left.
      select: {
        _count: { select: { members: true, enrollments: { where: { status: { in: [...SEATED_STATUSES] } } } } },
      },
    }),
  ]);

  const marked = sessions.filter((s) => s.attendance.length > 0);
  const averageAttended = marked.length
    ? marked.reduce((a, s) => a + attendedHeadcount(s.attendance.map((x) => x.status as AttendanceStatus)), 0) /
      marked.length
    : null;

  return {
    markedSessions: marked.length,
    totalSessions: sessions.length,
    averageAttended: averageAttended === null ? null : Math.round(averageAttended * 10) / 10,
    rosterSize: (counts?._count.members ?? 0) + (counts?._count.enrollments ?? 0),
  };
}
