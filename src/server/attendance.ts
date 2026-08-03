import "server-only";
import { prisma } from "@/lib/prisma";
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
import { getAttendanceConfig } from "./founder-config";

/**
 * Attendance — the reads and writes.
 *
 * All of the judgement lives in lib/attendance.ts (pure, unit-tested). This file only fetches,
 * materialises and persists, which is the same division as tutor-fees.ts ↔ lib/tutor-fee.ts.
 */

export type AttendanceSheetRow = {
  studentId: string;
  studentName: string;
  studentCode: string | null;
  /** Null when this student has no row yet — i.e. the register hasn't been taken. */
  status: AttendanceStatus | null;
  note: string | null;
  markedByName: string | null;
  markedAt: string | null;
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
      batch: {
        select: {
          members: {
            select: { student: { select: { id: true, fullName: true, code: true } } },
          },
          enrollments: {
            select: { student: { select: { id: true, fullName: true, code: true } } },
          },
        },
      },
      attendance: {
        select: {
          studentId: true,
          status: true,
          note: true,
          markedAt: true,
          markedBy: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!session) return null;

  // A batch can be populated through EITHER seam — German Note seats arrive as BatchMember,
  // B2 coaching seats as Enrollment.batchId (see the Batch model's note). Both are "on the
  // roster", so both are expected in the room; deduped because nothing forbids being in both.
  const roster = new Map<string, { id: string; fullName: string; code: string | null }>();
  for (const m of session.batch.members) roster.set(m.student.id, m.student);
  for (const e of session.batch.enrollments) roster.set(e.student.id, e.student);

  const marks = new Map(session.attendance.map((a) => [a.studentId, a]));

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
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

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
  };
}

/**
 * Persists a set of marks for one session.
 *
 * Upsert per student on the `(sessionId, studentId)` unique key, so this is idempotent: a
 * double-submit, a retry, or a tutor correcting one row all converge on the same register. A
 * null status DELETES the row rather than storing an "unmarked" value — "we never took the
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

  // One transaction: a half-saved register is worse than an unsaved one, because it looks done.
  await prisma.$transaction([
    ...(toClear.length
      ? [prisma.sessionAttendance.deleteMany({ where: { sessionId, studentId: { in: toClear } } })]
      : []),
    ...toSave.map((m) =>
      prisma.sessionAttendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: m.studentId } },
        create: {
          sessionId,
          studentId: m.studentId,
          status: m.status!,
          note: m.note?.trim() || null,
          markedById,
        },
        update: {
          status: m.status!,
          note: m.note?.trim() || null,
          markedById,
          markedAt: new Date(),
        },
      }),
    ),
  ]);

  return { saved: toSave.length, cleared: toClear.length };
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
 * Per-student attendance across a batch — the drop-risk read.
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
        enrollments: { select: { student: { select: { id: true, fullName: true } } } },
      },
    }),
  ]);
  if (!batch) return [];

  const roster = new Map<string, string>();
  for (const m of batch.members) roster.set(m.student.id, m.student.fullName);
  for (const e of batch.enrollments) roster.set(e.student.id, e.student.fullName);

  const byStudent = new Map<string, AttendanceMark[]>();
  for (const s of sessions) {
    for (const a of s.attendance) {
      const list = byStudent.get(a.studentId) ?? [];
      list.push({ sessionId: s.id, startsAt: s.startsAt, status: a.status as AttendanceStatus });
      byStudent.set(a.studentId, list);
    }
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
      // Worst first — this list exists to be acted on from the top, not browsed alphabetically.
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
 * change — that is a pricing decision and theirs, not a side effect of recording attendance.
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
      select: { _count: { select: { members: true, enrollments: true } } },
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
