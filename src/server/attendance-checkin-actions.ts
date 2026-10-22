"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { isCheckInOpen, selfMarkFor } from "@/lib/attendance-window";
import { getAttendanceConfig } from "./founder-config";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * "I'M HERE" - the student marking their own attendance.
 *
 * ── Every check this has to make, and why none of them is optional ──────────────────────
 * This is the only action in the app where the person being recorded writes their own record,
 * so the fence is the whole feature. In order:
 *
 *   1. A STUDENT RECORD. The session's user id must resolve to a `Student`. Not a role check -
 *      a role says what screens you see, and what matters here is whether you are a person who
 *      can be on a register at all.
 *   2. ON THE ROSTER. Of that cohort, through either seating route. Without this, any student
 *      login could check in to any class in the business by passing its id - the id is in the
 *      page source, so this is not a theoretical hole.
 *   3. THE WINDOW IS OPEN. Re-derived from the stored timestamps with the same pure function
 *      the student's card used to decide whether to show a button. A closed window that still
 *      accepted a check-in would make the countdown a decoration.
 *   4. NO TUTOR VERDICT ALREADY. If the row says TUTOR, the tutor has decided this one and a
 *      student overruling their tutor's register from their phone is precisely what self
 *      check-in must never become.
 *
 * ── Why PRESENT is not simply assumed ──────────────────────────────────────────────────
 * `selfMarkFor` decides PRESENT or LATE from the stored grace, and the grace it uses is the
 * one SNAPSHOTTED when the window was opened, not whatever the config says now. The student
 * is judged by the rule that was in force when their class began.
 */

const schema = z.object({ sessionId: z.string().min(1) });

export async function checkInToClass(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const config = await getAttendanceConfig();
  if (!config.selfCheckInEnabled) {
    return { ok: false, error: "Self check-in is switched off." };
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, fullName: true },
  });
  if (!student) {
    return { ok: false, error: "Your login isn't linked to a student record yet." };
  }

  const classSession = await prisma.classSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: {
      id: true,
      title: true,
      batchId: true,
      startsAt: true,
      delivery: true,
      attendanceOpensAt: true,
      attendanceClosesAt: true,
      attendanceGraceMins: true,
      batch: {
        select: {
          status: true,
          members: { where: { studentId: student.id }, select: { id: true } },
          enrollments: { where: { studentId: student.id }, select: { id: true } },
        },
      },
    },
  });
  if (!classSession) return { ok: false, error: "Class not found" };
  if (classSession.delivery === "PRE_RECORDED") {
    return { ok: false, error: "There's nothing to check in to - this one is a recording." };
  }

  const onRoster =
    classSession.batch.members.length > 0 || classSession.batch.enrollments.length > 0;
  if (!onRoster || classSession.batch.status !== "ACTIVE") {
    // Same wording as a missing class on purpose: a student probing ids should not learn
    // which ones exist.
    return { ok: false, error: "Class not found" };
  }

  const now = new Date();
  const window = {
    opensAt: classSession.attendanceOpensAt,
    closesAt: classSession.attendanceClosesAt,
  };
  if (!isCheckInOpen(window, now)) {
    return {
      ok: false,
      error: "Attendance isn't open for this class - ask your coach to open it.",
    };
  }

  const existing = await prisma.sessionAttendance.findUnique({
    where: { sessionId_studentId: { sessionId: classSession.id, studentId: student.id } },
    select: { id: true, source: true, status: true },
  });
  if (existing?.source === "TUTOR") {
    return { ok: false, error: "Your coach has already marked this class." };
  }
  // Idempotent: a double tap, or a second device, lands on the same row and the same answer
  // rather than an error the student has no way to interpret.
  if (existing) return { ok: true };

  const status = selfMarkFor(
    {
      // Non-null by `isCheckInOpen` above, which returns false unless both are set.
      opensAt: classSession.attendanceOpensAt!,
      classStartsAt: classSession.startsAt,
      graceMinutes: classSession.attendanceGraceMins ?? config.checkInLateAfterMins,
    },
    now,
  );

  await prisma.sessionAttendance.create({
    data: {
      sessionId: classSession.id,
      studentId: student.id,
      status,
      source: "SELF",
      checkedInAt: now,
      // The student's own login - the honest answer to "who wrote this row".
      markedById: session.user.id,
    },
  });

  await logActivity(session, {
    action: "attendance.checkin",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `${student.fullName} checked in to "${classSession.title}" (${status.toLowerCase()})`,
    meta: { batchId: classSession.batchId, status },
  });

  revalidatePath("/dashboard");
  revalidatePath("/classroom");
  // The tutor is watching this list fill in real time; their board has to see the arrival.
  revalidatePath("/attendance");
  revalidatePath(`/batches/${classSession.batchId}`);
  return { ok: true };
}
