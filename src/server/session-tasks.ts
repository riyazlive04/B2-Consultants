"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SessionTaskType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Session coursework (ER v2 Track B).
 *
 * DELIBERATELY NOT `ContactTask`. That model is the CRM to-do on a *Lead* ("call Priya back
 * Thursday"); this is what a *student* was assigned in class. Collapsing them would put a
 * sales follow-up in someone's homework list and a homework item on the sales board.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const taskSchema = z.object({
  type: z.enum(["WATCH_VIDEO", "APPLY_JOB", "HOMEWORK", "OTHER"]),
  title: z.string().trim().min(1, "A title is required").max(200),
  description: z.string().trim().max(4000).optional(),
  dueAt: z.string().trim().optional(),
  recordingId: z.string().trim().optional(),
});

/**
 * Assign a task, fanning out one completion row per student currently in the batch.
 *
 * The fan-out is MATERIALISED rather than derived. A computed "who hasn't done it" set is
 * correct today and useless tomorrow: it has no memory of what was outstanding WHEN, so a
 * student returning from two weeks away cannot be shown what they missed. `seatStudentTasks`
 * below backfills anyone who joins later, which is the other half of the same guarantee.
 */
export async function createSessionTask(sessionId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("german-note");
  const parsed = taskSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  if (d.type === "WATCH_VIDEO" && !d.recordingId) {
    return { ok: false, error: "Pick the recording this task is about" };
  }

  const classSession = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      title: true,
      batchId: true,
      batch: {
        select: {
          name: true,
          members: { select: { studentId: true } },
          enrollments: { select: { studentId: true } },
        },
      },
    },
  });
  if (!classSession) return { ok: false, error: "Session not found" };

  const last = await prisma.sessionTask.findFirst({
    where: { sessionId },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });

  // Both seating routes, de-duplicated: a student could in principle appear via a BatchMember
  // row AND an Enrollment, and two completion rows for one person would double every count.
  const studentIds = [
    ...new Set([
      ...classSession.batch.members.map((m) => m.studentId),
      ...classSession.batch.enrollments.map((e) => e.studentId),
    ]),
  ];

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.sessionTask.create({
      data: {
        sessionId,
        type: d.type as SessionTaskType,
        title: d.title,
        description: d.description || null,
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
        recordingId: d.recordingId || null,
        orderIndex: (last?.orderIndex ?? -1) + 1,
        createdById: session.user.id,
      },
    });
    if (studentIds.length > 0) {
      await tx.sessionTaskCompletion.createMany({
        data: studentIds.map((studentId) => ({ taskId: created.id, studentId })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  await logActivity(session, {
    action: "session.task.create",
    section: "german-note",
    entityType: "SessionTask",
    entityId: task.id,
    summary: `Assigned "${d.title}" to ${studentIds.length} student${studentIds.length === 1 ? "" : "s"} in ${classSession.batch.name}`,
    meta: { sessionId, type: d.type, fannedOutTo: studentIds.length },
  });

  revalidatePath("/german-note");
  return { ok: true };
}

/**
 * Backfill a newly-seated student's outstanding coursework.
 *
 * Called from the seat actions. Without it, someone who joins in week three sees an empty
 * task list and looks fully up to date — the exact opposite of the truth.
 */
export async function seatStudentTasks(batchId: string, studentId: string): Promise<number> {
  const tasks = await prisma.sessionTask.findMany({
    where: { session: { batchId } },
    select: { id: true },
  });
  if (tasks.length === 0) return 0;

  const result = await prisma.sessionTaskCompletion.createMany({
    data: tasks.map((t) => ({ taskId: t.id, studentId })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Mark a task done (or not).
 *
 * `autoCompleted` stays false here: this path is a human ticking a box. The watch-progress
 * path sets it true, and keeping them distinguishable is what lets a coach tell "they said
 * they watched it" from "the player says they watched it".
 */
export async function completeSessionTask(
  completionId: string,
  done: boolean,
  note?: string,
): Promise<ActionResult> {
  const session = await requireSection("german-note");

  const row = await prisma.sessionTaskCompletion.findUnique({
    where: { id: completionId },
    select: {
      studentId: true,
      task: { select: { title: true } },
      student: { select: { fullName: true } },
    },
  });
  if (!row) return { ok: false, error: "Task not found" };

  await prisma.sessionTaskCompletion.update({
    where: { id: completionId },
    data: {
      status: done ? "YES" : "PENDING",
      completedAt: done ? new Date() : null,
      autoCompleted: false,
      note: note?.trim() || null,
    },
  });

  // Write-through to the tracker's headline fields so every existing read path — the student
  // tracker, the at-risk radar — keeps working with no change. These two columns were the
  // placeholder this table replaces; they stay correct rather than becoming stale.
  await prisma.enrollment.updateMany({
    where: { studentId: row.studentId, status: "ACTIVE" },
    data: { lastTaskAssigned: row.task.title, lastTaskCompleted: done ? "YES" : "PENDING" },
  });

  await logActivity(session, {
    action: "session.task.complete",
    section: "german-note",
    entityType: "SessionTaskCompletion",
    entityId: completionId,
    summary: `${row.student.fullName} marked "${row.task.title}" ${done ? "done" : "not done"}`,
    meta: { done },
  });

  revalidatePath("/german-note");
  revalidatePath("/my-journey");
  return { ok: true };
}

/** A student's outstanding coursework across every batch they are in. */
export async function studentTasks(studentId: string) {
  const rows = await prisma.sessionTaskCompletion.findMany({
    where: { studentId },
    select: {
      id: true, status: true, completedAt: true, autoCompleted: true,
      task: {
        select: {
          title: true, description: true, type: true, dueAt: true, recordingId: true,
          session: { select: { title: true, startsAt: true, batch: { select: { name: true } } } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    completedAt: r.completedAt,
    autoCompleted: r.autoCompleted,
    title: r.task.title,
    description: r.task.description,
    type: r.task.type,
    dueAt: r.task.dueAt,
    recordingId: r.task.recordingId,
    sessionTitle: r.task.session.title,
    sessionAt: r.task.session.startsAt,
    batchName: r.task.session.batch.name,
  }));
}
