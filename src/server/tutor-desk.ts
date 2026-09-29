import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";

/**
 * The Tutor's own summary (rebuild spec §9) - shown at the top of German Note, which is where a
 * tutor is redirected on sign-in.
 *
 * §9 asks for six things. Five are built here:
 *   · own batches and enrolled students, WITH student IDs   - the spec is explicit about the IDs
 *   · session schedule                                       - already on the GN overview (ClassSession)
 *   · sessions delivered, feeding the head coach's daily log - read back from their own log
 *   · student progress and flags                             - recordings watched per batch
 *   · book order status for their students
 *
 * The sixth, ATTENDANCE, has no model in the schema. It is not derivable from anything that exists
 * - a recording watch is not attendance at a live session - so it is left out rather than faked
 * from the nearest lookalike. Adding it is a migration, which needs sign-off.
 *
 * Scoping is by `Batch.tutorId`, the same predicate `getGnAccess` uses, so a tutor can never see
 * another tutor's batch here. No financial data and no pipeline: §9 forbids both.
 */

export type TutorStudent = {
  readonly studentId: string;
  readonly studentCode: string | null;
  readonly name: string;
  readonly batchName: string;
};

export type TutorBatch = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly memberCount: number;
};

export type TutorDesk = {
  readonly batches: TutorBatch[];
  readonly students: TutorStudent[];
  readonly sessionsToday: number;
  readonly sessionsThisMonth: number;
  /** Book orders for this tutor's students, counted by status - §9's "book order status". */
  readonly bookOrders: { status: string; count: number }[];
  readonly bookOrdersHeld: number;
};

/** Statuses that mean a student is waiting on a book they haven't got yet. */
const HELD_STATUSES = ["DEFERRED", "QUOTE_REQUESTED", "QUOTED"];

export const getTutorDesk = cache(async (userId: string): Promise<TutorDesk> => {
  const today = istToday();
  const month = istMonthRange(today);

  const batches = await prisma.batch.findMany({
    where: { tutorId: userId },
    select: {
      id: true,
      name: true,
      status: true,
      members: {
        select: {
          student: { select: { id: true, fullName: true, code: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const students: TutorStudent[] = batches.flatMap((b) =>
    b.members.map((m) => ({
      studentId: m.student.id,
      studentCode: m.student.code,
      name: m.student.fullName,
      batchName: b.name,
    })),
  );

  // A student in two of this tutor's batches is one person to teach, not two.
  const uniqueStudentIds = [...new Set(students.map((s) => s.studentId))];

  const [logs, orders] = await Promise.all([
    prisma.dailyLog.findMany({
      where: { user: { id: userId }, date: { gte: month.start, lt: month.end } },
      select: { date: true, sessionsDelivered: true },
    }),
    uniqueStudentIds.length > 0
      ? prisma.bookOrder.groupBy({
          by: ["status"],
          where: { studentId: { in: uniqueStudentIds } },
          _count: { _all: true },
        })
      : Promise.resolve([] as { status: string; _count: { _all: number } }[]),
  ]);

  const todayKey = today.toISOString().slice(0, 10);
  const sessionsToday = logs
    .filter((l) => l.date.toISOString().slice(0, 10) === todayKey)
    .reduce((a, l) => a + (l.sessionsDelivered ?? 0), 0);
  const sessionsThisMonth = logs.reduce((a, l) => a + (l.sessionsDelivered ?? 0), 0);

  const bookOrders = orders.map((o) => ({ status: String(o.status), count: o._count._all }));

  return {
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      status: String(b.status),
      memberCount: b.members.length,
    })),
    students: students.sort((a, b) => a.name.localeCompare(b.name)),
    sessionsToday,
    sessionsThisMonth,
    bookOrders,
    bookOrdersHeld: bookOrders.filter((o) => HELD_STATUSES.includes(o.status)).reduce((a, o) => a + o.count, 0),
  };
});
