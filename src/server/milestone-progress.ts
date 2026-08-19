"use server";

import { revalidatePath } from "next/cache";
import type { MilestoneProgressStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { defaultMilestoneLadder, programDays, programDayNumber, milestoneHealth, overdueCount } from "@/lib/milestones";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Milestone progress (ER v2 Track I).
 *
 * `Enrollment.currentMilestone` and the append-only `MilestoneLog` are UNTOUCHED - the log is
 * the audit trail and nothing here weakens it. What this adds is a per-milestone row with a
 * `targetDay`, so "is Priya on track for day 45" is answerable without replaying the log.
 */

/**
 * Seed the ladder for a level, from the programme length.
 *
 * The ladder is expressed as FRACTIONS of the programme in `lib/milestones.ts`, so 90-day
 * Guided and 120-day Elite share one definition instead of two lists that drift. LIFETIME
 * (Solo) seeds NOTHING: a milestone with no deadline is not a milestone, and day-0 rows would
 * put every Solo student permanently on the at-risk radar.
 */
export async function seedMilestoneLadder(
  levelCode: string,
  duration: "DAYS_90" | "DAYS_120" | "LIFETIME",
): Promise<ActionResult & { created?: number }> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;

  const ladder = defaultMilestoneLadder(programDays(duration));
  if (ladder.length === 0) {
    return { ok: false, error: "A lifetime programme has no deadlines, so it has no milestone ladder" };
  }

  let created = 0;
  for (const m of ladder) {
    // upsert keyed on (levelCode, key) - re-seeding is idempotent and never duplicates a rung.
    const before = await prisma.programMilestone.findUnique({
      where: { levelCode_key: { levelCode, key: m.key } },
      select: { id: true },
    });
    await prisma.programMilestone.upsert({
      where: { levelCode_key: { levelCode, key: m.key } },
      create: { levelCode, key: m.key, name: m.name, targetDay: m.targetDay, orderIndex: m.orderIndex },
      update: { name: m.name, targetDay: m.targetDay, orderIndex: m.orderIndex },
    });
    if (!before) created++;
  }

  await logActivity(session, {
    action: "milestone.seed",
    section: "students",
    entityType: "ProgramMilestone",
    entityId: levelCode,
    summary: `Seeded the ${ladder.length}-step milestone ladder for ${levelCode}`,
    meta: { levelCode, created },
  });

  revalidatePath("/students");
  return { ok: true, created };
}

/**
 * Materialise an enrollment's progress rows against its level's ladder.
 *
 * MATERIALISED, not computed: a derived "milestones not yet hit" set has no memory of what
 * was outstanding WHEN, so it cannot answer "was this student behind in April". Called on
 * enrolment and again whenever the ladder changes; idempotent by the (enrollment, milestone)
 * unique key, so re-running never resets progress already recorded.
 */
export async function materialiseMilestones(enrollmentId: string): Promise<number> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { programLevel: true },
  });
  if (!enrollment) return 0;

  const ladder = await prisma.programMilestone.findMany({
    where: { levelCode: enrollment.programLevel, active: true },
    select: { id: true },
  });
  if (ladder.length === 0) return 0;

  const existing = await prisma.milestoneProgress.findMany({
    where: { enrollmentId },
    select: { milestoneId: true },
  });
  const have = new Set(existing.map((p) => p.milestoneId));
  const missing = ladder.filter((m) => !have.has(m.id));
  if (missing.length === 0) return 0;

  await prisma.milestoneProgress.createMany({
    data: missing.map((m) => ({ enrollmentId, milestoneId: m.id })),
    skipDuplicates: true,
  });
  return missing.length;
}

export async function setMilestoneProgress(
  progressId: string,
  status: MilestoneProgressStatus,
  note?: string,
): Promise<ActionResult> {
  const session = await requireSection("students");

  const row = await prisma.milestoneProgress.findUnique({
    where: { id: progressId },
    select: {
      status: true,
      enrollmentId: true,
      milestone: { select: { name: true } },
      enrollment: { select: { student: { select: { fullName: true } } } },
    },
  });
  if (!row) return { ok: false, error: "Milestone not found" };

  await prisma.milestoneProgress.update({
    where: { id: progressId },
    data: {
      status,
      // Stamped only on the transition INTO achieved, and never cleared by a later edit of
      // the note - when it was hit is a fact, not a field.
      achievedAt: status === "ACHIEVED" ? new Date() : null,
      note: note?.trim() || null,
    },
  });

  await logActivity(session, {
    action: "milestone.progress",
    section: "students",
    entityType: "MilestoneProgress",
    entityId: progressId,
    summary: `${row.enrollment.student.fullName}: ${row.milestone.name} → ${status.toLowerCase().replace("_", " ")}`,
    meta: { from: row.status, to: status },
  });

  revalidatePath("/students");
  revalidatePath("/my-journey");
  return { ok: true };
}

export type EnrollmentMilestoneView = {
  progressId: string;
  name: string;
  targetDay: number;
  status: MilestoneProgressStatus;
  achievedAt: Date | null;
  health: ReturnType<typeof milestoneHealth>;
};

/** One enrollment's ladder with health, plus the day it is on. */
export async function enrollmentMilestones(enrollmentId: string): Promise<{
  currentDay: number | null;
  items: EnrollmentMilestoneView[];
  overdue: number;
}> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      enrollmentDate: true,
      milestoneProgress: {
        select: {
          id: true, status: true, achievedAt: true,
          milestone: { select: { name: true, targetDay: true, orderIndex: true } },
        },
      },
    },
  });
  if (!enrollment) return { currentDay: null, items: [], overdue: 0 };

  const currentDay = programDayNumber(enrollment.enrollmentDate, new Date());
  const items = enrollment.milestoneProgress
    .sort((a, b) => a.milestone.orderIndex - b.milestone.orderIndex)
    .map((p) => ({
      progressId: p.id,
      name: p.milestone.name,
      targetDay: p.milestone.targetDay,
      status: p.status,
      achievedAt: p.achievedAt,
      health: milestoneHealth(p.status, p.milestone.targetDay, currentDay),
    }));

  return {
    currentDay,
    items,
    overdue: overdueCount(
      enrollment.milestoneProgress.map((p) => ({ status: p.status, targetDay: p.milestone.targetDay })),
      currentDay,
    ),
  };
}

/** The ladder as configured, for the admin panel. */
export async function listProgramMilestones(levelCode?: string) {
  const where: Prisma.ProgramMilestoneWhereInput = levelCode ? { levelCode } : {};
  return prisma.programMilestone.findMany({
    where,
    orderBy: [{ levelCode: "asc" }, { orderIndex: "asc" }],
    include: { _count: { select: { progress: true } } },
  });
}
