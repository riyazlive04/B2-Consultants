"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { suggestBatchesToOpen, DEFAULT_MIN_TO_OPEN, type PoolJoiner } from "@/lib/pending-pool";
import { logActivity } from "./activity-log";
import { isKnownLevel } from "./levels";
import type { ActionResult } from "./finance-actions";

/**
 * The pending pool (spec Part 2 §2.2). A joiner sits here between paying and being seated,
 * which is exactly the gap the founders' manual process loses people in: a workshop with one
 * joiner opens no batch, and that person currently exists only in somebody's memory.
 *
 * Admin-only, same as the rest of batch management.
 */

const PREFERENCES = ["WEEKDAY", "WEEKEND", "EITHER"] as const;

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const joinerSchema = z.object({
  studentId: z.string().trim().min(1, "Pick a student"),
  level: z.string().trim().min(1, "Pick a level (A1–B2)"), // validated vs the live catalogue in the action
  preference: z.enum(PREFERENCES).optional(),
  preferredTime: z.string().trim().max(120).optional(),
  workshopId: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** Park a student in the pool for a level. */
export async function addPendingJoiner(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = joinerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (!(await isKnownLevel(parsed.data.level, ["GERMAN_LEVEL"]))) return { ok: false, error: "Pick a German level (A1–B2)" };
  const d = parsed.data;

  const student = await prisma.student.findUnique({
    where: { id: d.studentId },
    select: { fullName: true },
  });
  if (!student) return { ok: false, error: "Student not found" };

  try {
    const joiner = await prisma.gnPendingJoiner.create({
      data: {
        studentId: d.studentId,
        level: d.level,
        preference: d.preference ?? "EITHER",
        preferredTime: d.preferredTime || null,
        workshopId: d.workshopId || null,
        notes: d.notes || null,
      },
    });
    await logActivity(session, {
      action: "gn.pool.add",
      section: "german-note",
      entityType: "GnPendingJoiner",
      entityId: joiner.id,
      summary: `Held ${student.fullName} in the pending pool for ${d.level}`,
      meta: { level: d.level, preference: joiner.preference, workshopId: d.workshopId ?? null },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: `${student.fullName} is already waiting for ${d.level}` };
    }
    throw e;
  }
  revalidatePath("/german-note/manage");
  return { ok: true };
}

/**
 * Seat a waiting joiner into a batch.
 *
 * Re-checks the cap here rather than trusting the suggestion the admin clicked: the batch may
 * have filled between the page rendering and the click. Same row-lock reasoning as
 * german-note-actions.claimSeat — a count without a lock is a race, not a cap.
 */
export async function seatPendingJoiner(joinerId: string, batchId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM gn_batch WHERE id = ${batchId} FOR UPDATE`;
    const batch = await tx.gnBatch.findUnique({
      where: { id: batchId },
      select: { name: true, level: true, targetStrength: true },
    });
    if (!batch) return { ok: false as const, error: "Batch not found" };

    const joiner = await tx.gnPendingJoiner.findUnique({
      where: { id: joinerId },
      select: { studentId: true, level: true, assignedBatchId: true, student: { select: { fullName: true } } },
    });
    if (!joiner) return { ok: false as const, error: "Joiner not found" };
    if (joiner.assignedBatchId) return { ok: false as const, error: "Already seated" };
    if (joiner.level !== batch.level) {
      return { ok: false as const, error: `Level mismatch: ${joiner.student.fullName} is waiting for ${joiner.level}, not ${batch.level}` };
    }

    const filled = await tx.gnBatchMember.count({ where: { batchId } });
    if (filled >= batch.targetStrength) {
      return { ok: false as const, error: `"${batch.name}" is full (${filled}/${batch.targetStrength}) — open another batch.` };
    }

    // Membership + pool exit commit together: a seated student must never still read as waiting.
    await tx.gnBatchMember.create({ data: { batchId, studentId: joiner.studentId } });
    await tx.gnPendingJoiner.update({
      where: { id: joinerId },
      data: { assignedBatchId: batchId, assignedAt: new Date() },
    });
    return { ok: true as const, name: joiner.student.fullName, batchName: batch.name };
  });

  if (!result.ok) return result;
  await logActivity(session, {
    action: "gn.pool.seat",
    section: "german-note",
    entityType: "GnPendingJoiner",
    entityId: joinerId,
    summary: `Seated ${result.name} from the pending pool into "${result.batchName}"`,
    meta: { batchId },
  });
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

/** Drop someone out of the pool (refund, withdrawal, mistake). */
export async function removePendingJoiner(joinerId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const joiner = await prisma.gnPendingJoiner.findUnique({
    where: { id: joinerId },
    select: { level: true, student: { select: { fullName: true } } },
  });
  if (!joiner) return { ok: false, error: "Joiner not found" };
  await prisma.gnPendingJoiner.delete({ where: { id: joinerId } });
  await logActivity(session, {
    action: "gn.pool.remove",
    section: "german-note",
    entityType: "GnPendingJoiner",
    entityId: joinerId,
    summary: `Removed ${joiner.student.fullName} from the ${joiner.level} pending pool`,
    meta: { level: joiner.level },
  });
  revalidatePath("/german-note/manage");
  return { ok: true };
}

/**
 * What should we open next? Reads the live pool and applies the pure rule.
 * Returns every group, openable or not — "3 waiting, still below the floor" is exactly the
 * fact the founders currently hold in their heads.
 */
export async function getPoolSuggestions(minToOpen: number = DEFAULT_MIN_TO_OPEN) {
  await requireAdmin();
  const waiting = await prisma.gnPendingJoiner.findMany({
    where: { assignedBatchId: null },
    select: { id: true, level: true, preference: true },
  });
  const pool: PoolJoiner[] = waiting.map((w) => ({
    id: w.id,
    level: w.level,
    preference: w.preference,
  }));
  return suggestBatchesToOpen(pool, minToOpen);
}
