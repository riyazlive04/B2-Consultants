"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { ACTIVE, archiveData } from "@/lib/soft-delete";
import { istToday, toDateInputValue, parseDateInput } from "@/lib/dates";
import { canManageDelivery } from "./batch-access";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * WHAT A STUDENT LOGS ABOUT THEIR OWN SPRINT - and what a coach may do to it.
 *
 * ── Scoring is immediate; correction is the coach's ────────────────────────────────────
 * The founders chose "score at once, coach can correct". So this action writes a row that
 * counts the moment it lands, and the coach's review feed is a correction surface rather than
 * a gate. A student who did the work sees the board move; a board that only moves when a coach
 * gets round to it is a board nobody opens twice.
 *
 * That choice is only defensible because of three things here:
 *   · a weekly CAP per metric, applied in the scoring (lib/leaderboard), so a quantity box
 *     cannot be typed into first place;
 *   · a DATE that cannot be in the future and cannot predate the programme;
 *   · removal that is SOFT and LOGGED, because a coach taking points off a named person on a
 *     board their classmates can see is not a silent operation.
 */

const KINDS = ["HR_CONNECTION", "HR_INTERVIEW", "APPLICATION_REVIEWED", "WIN"] as const;

const logSchema = z.object({
  kind: z.enum(KINDS),
  quantity: z.coerce.number().int().min(1).max(500),
  occurredOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day it happened"),
  company: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * The signed-in student's own ACTIVE enrollment.
 *
 * Resolved from the session rather than taken as a parameter - there is nowhere to put a
 * request for somebody else's enrollment, which is the same shape as every other student
 * write in this app.
 */
async function myEnrollment(userId: string) {
  return prisma.enrollment.findFirst({
    where: { student: { userId }, status: "ACTIVE" },
    select: { id: true, enrollmentDate: true, student: { select: { fullName: true } } },
    orderBy: { enrollmentDate: "desc" },
  });
}

export async function logSprintEntry(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const enrollment = await myEnrollment(session.user.id);
  if (!enrollment) {
    return { ok: false, error: "Your login isn't linked to an active programme yet." };
  }

  /**
   * THE DATE IS FENCED AT BOTH ENDS.
   *
   * Not in the future, because the only reason to log tomorrow's interview is to bank points
   * against a week that has not happened - and the weekly cap is computed per elapsed week, so
   * a future date would slip past it. Not before enrolment either: backdating into a window
   * nobody was scoring is how a cap gets spread across weeks that were never in the period.
   */
  const today = toDateInputValue(istToday());
  if (d.occurredOn > today) {
    return { ok: false, error: "You can't log something that hasn't happened yet." };
  }
  const enrolledYmd = toDateInputValue(enrollment.enrollmentDate);
  if (d.occurredOn < enrolledYmd) {
    return { ok: false, error: `Pick a day on or after you started (${enrolledYmd}).` };
  }

  const entry = await prisma.sprintLogEntry.create({
    data: {
      enrollmentId: enrollment.id,
      kind: d.kind,
      quantity: d.quantity,
      occurredOn: parseDateInput(d.occurredOn),
      company: d.company || null,
      note: d.note || null,
      source: "STUDENT",
      loggedById: session.user.id,
    },
  });

  await logActivity(session, {
    action: "sprint.log.add",
    section: "leaderboard",
    entityType: "SprintLogEntry",
    entityId: entry.id,
    summary: `${enrollment.student.fullName} logged ${d.quantity} × ${d.kind.toLowerCase().replace(/_/g, " ")}`,
    meta: { enrollmentId: enrollment.id, kind: d.kind, quantity: d.quantity, occurredOn: d.occurredOn },
  });

  revalidatePath("/leaderboard");
  revalidatePath("/dashboard");
  revalidatePath("/my-journey");
  revalidatePath("/coaching");
  return { ok: true };
}

/**
 * A student withdrawing their own entry.
 *
 * Allowed only on their OWN rows and only while the entry is theirs (`source: STUDENT`): a
 * coach's correction is not something the person being corrected may undo. Soft, like every
 * other removal here.
 */
export async function withdrawSprintEntry(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z.object({ entryId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const enrollment = await myEnrollment(session.user.id);
  if (!enrollment) return { ok: false, error: "Not allowed" };

  const entry = await prisma.sprintLogEntry.findFirst({
    where: { id: parsed.data.entryId, enrollmentId: enrollment.id, source: "STUDENT", ...ACTIVE },
    select: { id: true, kind: true },
  });
  // Same wording whether it is missing or not theirs - somebody probing ids learns nothing.
  if (!entry) return { ok: false, error: "Entry not found" };

  await prisma.sprintLogEntry.update({
    where: { id: entry.id },
    data: archiveData(session.user.id),
  });

  await logActivity(session, {
    action: "sprint.log.withdraw",
    section: "leaderboard",
    entityType: "SprintLogEntry",
    entityId: entry.id,
    summary: `Withdrew their own ${entry.kind.toLowerCase().replace(/_/g, " ")} entry`,
    meta: { enrollmentId: enrollment.id, kind: entry.kind },
  });

  revalidatePath("/leaderboard");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * A COACH correcting an entry - the other half of "score at once, coach can correct".
 *
 * Fenced on the cohort, not on a role: `canManageDelivery` is the same rule that governs the
 * register and the recordings, so the person who may mark your attendance may also correct what
 * you claimed. A coach with no standing on the student's batch gets the same refusal as a
 * stranger.
 *
 * The quantity may be edited down (a student who logged 9 and meant 1) or the row removed
 * outright. Both are logged with the previous value, because this is points coming off a named
 * person on a board their cohort can see.
 */
const correctSchema = z.object({
  entryId: z.string().min(1),
  /** Omitted = remove the entry. Present = set the quantity to this. */
  quantity: z.coerce.number().int().min(1).max(500).optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function correctSprintEntry(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const entry = await prisma.sprintLogEntry.findFirst({
    where: { id: parsed.data.entryId, ...ACTIVE },
    select: {
      id: true,
      kind: true,
      quantity: true,
      enrollmentId: true,
      enrollment: {
        select: { batchId: true, student: { select: { fullName: true } } },
      },
    },
  });
  if (!entry) return { ok: false, error: "Entry not found" };

  /**
   * A 1-to-1 student has no batch at all (an Elite client with no cohort), and there is then no
   * batch to be the fence. The coach link on the enrollment is what stands in for it.
   */
  const allowed = entry.enrollment.batchId
    ? await canManageDelivery(session, entry.enrollment.batchId)
    : session.role === "ADMIN" ||
      session.role === "HEAD" ||
      (await prisma.enrollment.count({
        where: { id: entry.enrollmentId, coachId: session.user.id },
      })) > 0;
  if (!allowed) return { ok: false, error: "Not allowed" };

  const removing = parsed.data.quantity === undefined;
  await prisma.sprintLogEntry.update({
    where: { id: entry.id },
    data: removing
      ? archiveData(session.user.id)
      : { quantity: parsed.data.quantity, note: parsed.data.reason || undefined },
  });

  const kindWords = entry.kind.toLowerCase().replace(/_/g, " ");
  await logActivity(session, {
    action: removing ? "sprint.log.remove" : "sprint.log.correct",
    section: "leaderboard",
    entityType: "SprintLogEntry",
    entityId: entry.id,
    summary: removing
      ? `Removed ${entry.enrollment.student.fullName}'s ${kindWords} entry (was ${entry.quantity})`
      : `Corrected ${entry.enrollment.student.fullName}'s ${kindWords} from ${entry.quantity} to ${parsed.data.quantity}`,
    meta: {
      enrollmentId: entry.enrollmentId,
      kind: entry.kind,
      was: entry.quantity,
      now: removing ? 0 : parsed.data.quantity,
      reason: parsed.data.reason ?? null,
    },
  });

  revalidatePath("/leaderboard");
  revalidatePath("/coaching");
  revalidatePath("/dashboard");
  return { ok: true };
}
