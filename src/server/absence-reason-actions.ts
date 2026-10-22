"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * THE STUDENT'S ANSWER to "why did you miss this?".
 *
 * In its own file rather than beside the coach's `askAbsenceReason`, because the two have
 * opposite fences and mixing them is how one ends up with the other's. Every export in
 * `attendance-actions.ts` is guarded by `canManageDelivery` - the person running the cohort.
 * This one is guarded by being the student in question, and nothing else.
 *
 * ── Only answerable when asked ─────────────────────────────────────────────────────────
 * `reasonAskedAt` must already be set. There is no UI that offers a student an unprompted
 * reason box, and this is the matching server rule: without it the field would quietly become
 * the always-on form the founders specifically did not want, reachable by anyone who could
 * post to this action.
 *
 * ── Answerable once ────────────────────────────────────────────────────────────────────
 * A reason a student can rewrite after their coach has read it, and possibly excused them on
 * the strength of it, is not evidence of anything. Changing it is a conversation, not a form
 * resubmission.
 */

const schema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().trim().min(2, "Tell your coach what happened").max(500),
});

export async function submitAbsenceReason(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, fullName: true },
  });
  if (!student) return { ok: false, error: "Your login isn't linked to a student record yet." };

  const mark = await prisma.sessionAttendance.findUnique({
    where: {
      sessionId_studentId: { sessionId: parsed.data.sessionId, studentId: student.id },
    },
    select: {
      id: true,
      reason: true,
      reasonAskedAt: true,
      session: { select: { id: true, title: true, batchId: true } },
    },
  });
  // One wording for "no such class", "not your class" and "nobody asked you" - a student
  // posting ids should not be able to map the timetable from the error messages.
  if (!mark || !mark.reasonAskedAt) return { ok: false, error: "Nothing to answer here." };
  if (mark.reason) return { ok: false, error: "You have already answered this one." };

  await prisma.sessionAttendance.update({
    where: { id: mark.id },
    data: { reason: parsed.data.reason, reasonAt: new Date() },
  });

  await logActivity(session, {
    action: "attendance.reason.answer",
    section: "attendance",
    entityType: "ClassSession",
    entityId: mark.session.id,
    // The reason itself is NOT put in the summary. It goes in `meta`, where the founder-only
    // activity log can show it - a student's explanation for missing a class may be medical or
    // personal, and an activity feed line is the wrong place for it to turn up in passing.
    summary: `${student.fullName} explained missing "${mark.session.title}"`,
    meta: { batchId: mark.session.batchId, reason: parsed.data.reason },
  });

  revalidatePath("/dashboard");
  revalidatePath("/classroom");
  revalidatePath("/attendance");
  revalidatePath(`/batches/${mark.session.batchId}`);
  return { ok: true };
}
