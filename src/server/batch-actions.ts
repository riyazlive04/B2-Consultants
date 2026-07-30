"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { BatchLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireCapability } from "@/lib/rbac";
import { levelFitsBatchLine, normalizeBatchCode, capacityBand } from "@/lib/batch";
import { getLevels } from "./levels";
import { logActivity, diffFields } from "./activity-log";
import { seatStudentTasks } from "./session-tasks";
import type { ActionResult } from "./finance-actions";

/**
 * Batch writes (ER v2 Track A).
 *
 * CREATING and ARCHIVING a batch is `requireAdmin()`. SEATING is `batches.manage`, because
 * deciding which cohort a student joins is a delivery call the Head coach plausibly makes —
 * without thereby handing them every other write on the Students board.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** The level's kind, or null if it isn't in the active catalogue. */
async function levelKindOf(code: string) {
  return (await getLevels()).find((l) => l.code === code && l.active)?.kind ?? null;
}

const batchSchema = z.object({
  line: z.enum(["B2", "GERMAN_NOTE"]),
  name: z.string().trim().min(1, "Batch name is required").max(160),
  code: z.string().trim().max(24).optional(),
  level: z.string().trim().min(1, "Pick a level"),
  tutorId: z.string().trim().optional(),
  targetStrength: z.coerce.number().int().min(0).max(500).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const asDate = (v: string | undefined) => (v && v.trim() ? new Date(v) : null);

export async function upsertBatch(batchId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = batchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const kind = await levelKindOf(d.level);
  if (!kind) return { ok: false, error: "Pick a level from the active catalogue" };
  // The guard the one-table design has to carry: without it, unifying gn_batch into batch
  // would silently allow a coaching client to be seated in an A1 German cohort.
  if (!levelFitsBatchLine(kind, d.line as BatchLine)) {
    return { ok: false, error: `A ${kind.replace("_", " ").toLowerCase()} does not belong to a ${d.line === "B2" ? "B2 Coaching" : "German Note"} batch` };
  }

  const code = d.code ? normalizeBatchCode(d.code) : "";
  if (d.code && !code) return { ok: false, error: "That batch code has no usable characters" };
  if (code) {
    const clash = await prisma.batch.findFirst({ where: { code, NOT: batchId ? { id: batchId } : undefined }, select: { name: true } });
    if (clash) return { ok: false, error: `Batch code "${code}" is already used by ${clash.name}` };
  }

  const data = {
    line: d.line as BatchLine,
    name: d.name,
    code: code || null,
    level: d.level,
    tutorId: d.tutorId || null,
    targetStrength: d.targetStrength ?? 8,
    startDate: asDate(d.startDate),
    endDate: asDate(d.endDate),
    notes: d.notes || null,
  };

  const before = batchId ? await prisma.batch.findUnique({ where: { id: batchId } }) : null;
  const batch = batchId
    ? await prisma.batch.update({ where: { id: batchId }, data })
    : await prisma.batch.create({ data });

  await logActivity(session, {
    action: batchId ? "batch.update" : "batch.create",
    section: d.line === "B2" ? "students" : "german-note",
    entityType: "Batch",
    entityId: batch.id,
    summary: `${batchId ? "Updated" : "Created"} the ${d.line === "B2" ? "coaching" : "German Note"} batch "${batch.name}"`,
    meta: before ? { changed: diffFields(before, batch) } : {},
  });

  revalidatePath("/students");
  revalidatePath("/german-note");
  return { ok: true };
}

/**
 * Seat an enrollment in a batch.
 *
 * Over-capacity is a WARNING, not a refusal (`confirmed` re-submits past it). The founders
 * overfill on purpose when a ninth person turns up and the next cohort is a month away — a
 * hard block would send them back to a spreadsheet, which is the failure this whole track
 * exists to end.
 */
export async function seatEnrollment(
  enrollmentId: string,
  batchId: string,
  confirmed = false,
): Promise<ActionResult> {
  const session = await requireCapability("batches.manage");

  const [enrollment, batch] = await Promise.all([
    prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, programLevel: true, batchId: true, studentId: true, student: { select: { fullName: true } } },
    }),
    prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        name: true,
        line: true,
        status: true,
        targetStrength: true,
        _count: { select: { members: true, enrollments: true } },
      },
    }),
  ]);
  if (!enrollment) return { ok: false, error: "Enrollment not found" };
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "ACTIVE") return { ok: false, error: "That batch is archived" };

  const kind = await levelKindOf(enrollment.programLevel);
  if (kind && !levelFitsBatchLine(kind, batch.line)) {
    return { ok: false, error: `${enrollment.programLevel} does not belong to a ${batch.line === "B2" ? "B2 Coaching" : "German Note"} batch` };
  }

  const filled = batch._count.members + batch._count.enrollments;
  if (!confirmed && capacityBand(filled, batch.targetStrength) === "over") {
    return { ok: false, error: `OVER_CAPACITY:${filled}:${batch.targetStrength}` };
  }

  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { batchId } });

  // Backfill the coursework this batch has already set. Without it someone who joins in week
  // three sees an empty task list and reads as fully up to date — the opposite of the truth.
  const backfilled = await seatStudentTasks(batchId, enrollment.studentId);

  await logActivity(session, {
    action: "batch.seat",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollmentId,
    summary: `Seated ${enrollment.student.fullName} in ${batch.name}`,
    meta: { batchId, fromBatchId: enrollment.batchId, tasksBackfilled: backfilled },
  });

  revalidatePath("/students");
  revalidatePath("/german-note");
  return { ok: true };
}

export async function unseatEnrollment(enrollmentId: string): Promise<ActionResult> {
  const session = await requireCapability("batches.manage");
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { batchId: true, student: { select: { fullName: true } }, batch: { select: { name: true } } },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };
  if (!enrollment.batchId) return { ok: false, error: "That enrollment is not seated in a batch" };

  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { batchId: null } });
  await logActivity(session, {
    action: "batch.unseat",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollmentId,
    summary: `Removed ${enrollment.student.fullName} from ${enrollment.batch?.name ?? "their batch"}`,
    meta: { fromBatchId: enrollment.batchId },
  });

  revalidatePath("/students");
  revalidatePath("/german-note");
  return { ok: true };
}
