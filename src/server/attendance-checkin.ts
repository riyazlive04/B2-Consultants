import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { remainingMs } from "@/lib/attendance-window";
import { getAttendanceConfig } from "./founder-config";
import { SESSION_ON } from "@/lib/session-status";

/**
 * "ATTENDANCE IS OPEN" - the student's half of the window.
 *
 * ── Why this is its own read and not a field on the classroom ───────────────────────────
 * `getMyClassroom` loads every class, every task, every recording and every resource for every
 * cohort a student belongs to, and it is cached for the request. This question is asked on a
 * different clock: it is true for fifteen minutes a week and false the rest of the time, it
 * has to be re-read when a student presses the button, and it belongs on the DASHBOARD, which
 * is a different page from the classroom. Folding it into the big read would mean refreshing
 * all of that to re-answer one boolean.
 *
 * The query is also deliberately narrow for a reason that is not cosmetic: it runs on every
 * student page load, the answer is almost always "nothing", and `attendanceClosesAt` is
 * indexed so that the common case is an index probe rather than a walk over every class the
 * cohort has ever held.
 *
 * ── The privacy line ───────────────────────────────────────────────────────────────────
 * Keyed on `User.id`, like every other student read. Nothing here exposes another student:
 * not who has checked in, not how many have, not the roster. A student learns about their own
 * row and nothing else - "4 of 8 have arrived" is a fact for the person teaching.
 */

export type OpenCheckIn = {
  sessionId: string;
  batchId: string;
  batchName: string;
  title: string;
  framework: string | null;
  startsAt: string;
  joinUrl: string | null;
  /** Milliseconds left when this was read; the card ticks down from it and then hides itself. */
  remainingMs: number;
  closesAt: string;
  /** This student's existing mark, if any - what makes the card read "checked in". */
  myStatus: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | null;
  /** True once they have pressed the button; the card then shows the time, not the button. */
  checkedIn: boolean;
  checkedInAt: string | null;
  /**
   * The tutor has already decided this one by hand. The card says so rather than offering a
   * button that the server would refuse - a student overruling their tutor's register from
   * their phone is the one thing self check-in must not become.
   */
  markedByTutor: boolean;
};

export const getMyOpenCheckIns = cache(async (userId: string): Promise<OpenCheckIn[]> => {
  const config = await getAttendanceConfig();
  if (!config.selfCheckInEnabled) return [];

  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!student) return [];

  const now = new Date();
  const sessions = await prisma.classSession.findMany({
    where: {
      delivery: "LIVE",
      // Called-off classes accept no check-in (issue C3). `cancelBatchSession` already moves
      // `attendanceClosesAt` back to now, so this is belt-and-braces - but the two must agree,
      // and the one that is a RULE rather than a side effect belongs in the `where`.
      ...SESSION_ON,
      // The index does the work: a window that has not closed yet. `opensAt` is not tested
      // here for the same reason `windowState` does not test it - opening is immediate.
      attendanceClosesAt: { gte: now },
      attendanceOpensAt: { not: null },
      batch: {
        status: "ACTIVE",
        // Both seating routes - a German Note learner has a BatchMember row and no enrollment.
        OR: [
          { members: { some: { studentId: student.id } } },
          { enrollments: { some: { studentId: student.id, status: "ACTIVE" } } },
        ],
      },
    },
    orderBy: { attendanceClosesAt: "asc" },
    // A student is in one or two cohorts; this cap exists only so a data accident cannot
    // produce a page of a hundred cards.
    take: 5,
    select: {
      id: true,
      title: true,
      framework: true,
      startsAt: true,
      joinUrl: true,
      batchId: true,
      attendanceOpensAt: true,
      attendanceClosesAt: true,
      batch: { select: { name: true } },
      attendance: {
        where: { studentId: student.id },
        select: { status: true, source: true, checkedInAt: true },
      },
    },
  });

  return sessions.map((s) => {
    const mine = s.attendance[0] ?? null;
    return {
      sessionId: s.id,
      batchId: s.batchId,
      batchName: s.batch.name,
      title: s.title,
      framework: s.framework,
      startsAt: s.startsAt.toISOString(),
      joinUrl: s.joinUrl,
      remainingMs: remainingMs({ opensAt: s.attendanceOpensAt, closesAt: s.attendanceClosesAt }, now),
      closesAt: s.attendanceClosesAt!.toISOString(),
      myStatus: (mine?.status as OpenCheckIn["myStatus"]) ?? null,
      checkedIn: mine?.source === "SELF",
      checkedInAt: mine?.checkedInAt?.toISOString() ?? null,
      markedByTutor: mine !== null && mine.source === "TUTOR",
    };
  });
});
