"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { getAttendanceSheet, saveAttendance, type AttendanceSheet } from "./attendance";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Marking the register.
 *
 * Guarded exactly like every other German Note write: Admin, or the TUTOR assigned to this
 * batch. The check is re-run here rather than trusted from the UI - a hidden button is never
 * the fence.
 */

const markSchema = z.object({
  sessionId: z.string().min(1),
  marks: z
    .array(
      z.object({
        studentId: z.string().min(1),
        // null CLEARS the mark. "Never took the register" and "took it and they were absent"
        // are different facts, and only the absence of a row can express the first.
        status: z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]).nullable(),
        note: z.string().max(500).nullish(),
      }),
    )
    // A batch targets ~8 students; 200 is a runaway guard, not a real ceiling.
    .max(200),
});

/** Admin, or the tutor who runs this batch. */
async function canMark(
  session: { role: string; user: { id: string } },
  batchId: string,
): Promise<boolean> {
  if (session.role === "ADMIN") return true;
  if (session.role !== "TUTOR") return false;
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  return batch?.tutorId === session.user.id;
}

export async function markAttendance(input: unknown): Promise<ActionResult> {
  const session = await requireSection("german-note");
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const classSession = await prisma.classSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { id: true, title: true, batchId: true, startsAt: true },
  });
  if (!classSession) return { ok: false, error: "Session not found" };
  if (!(await canMark(session, classSession.batchId))) return { ok: false, error: "Not allowed" };

  // Marking a class that hasn't happened yet is almost certainly a misclick on the wrong row -
  // and a register full of absences for a future date would quietly turn every student red.
  // A small grace window lets a tutor mark during the session rather than only after it.
  if (classSession.startsAt.getTime() > Date.now() + 60 * 60 * 1000) {
    return { ok: false, error: "That class hasn't started yet." };
  }

  const result = await saveAttendance(parsed.data.sessionId, parsed.data.marks, session.user.id);

  await logActivity(session, {
    action: "gn.attendance.mark",
    section: "german-note",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Marked attendance for "${classSession.title}" (${result.saved} student${result.saved === 1 ? "" : "s"})`,
    meta: { batchId: classSession.batchId, saved: result.saved, cleared: result.cleared },
  });

  revalidatePath(`/german-note/${classSession.batchId}`);
  revalidatePath("/german-note");
  return { ok: true };
}

/**
 * Loads a register for the client sheet.
 *
 * A server ACTION rather than props on the page: a batch's calendar can hold dozens of sessions
 * and only one register is ever open at a time. Shipping every roster for every session on page
 * load would be the bulk of the payload for something almost none of it is used.
 */
export async function loadAttendanceSheet(
  sessionId: string,
): Promise<{ ok: true; sheet: AttendanceSheet } | { ok: false; error: string }> {
  const session = await requireSection("german-note");
  const sheet = await getAttendanceSheet(sessionId);
  if (!sheet) return { ok: false, error: "Session not found" };
  if (!(await canMark(session, sheet.batchId))) return { ok: false, error: "Not allowed" };
  return { ok: true, sheet };
}
