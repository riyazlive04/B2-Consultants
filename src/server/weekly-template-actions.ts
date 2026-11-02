"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * THE QUESTION SETS - creating them, and editing the questions in them.
 *
 * ── Why editing a live question mints a new version ──────────────────────────────────
 * An answer pins the exact `questionId` it was given to. If "How many applications?" were
 * rewritten in place to "How many applications did you SEND?", every answer ever given
 * would silently re-read against wording nobody was shown - and a chart drawn six months
 * from now would be comparing two different questions as though they were one. So an edit
 * to a question that has already been answered deactivates it and creates version n+1
 * beside it; an edit to one nobody has answered yet is just an edit.
 *
 * ── Why nothing is ever deleted ──────────────────────────────────────────────────────
 * Removing a question means removing the answers under it, which is a student's own words.
 * "Remove" deactivates: it stops being asked, and every week it WAS asked in still reads
 * correctly. A question nobody ever answered is the one case that is genuinely deleted,
 * because there is nothing to preserve.
 *
 * ADMIN only, like every other Console write: these decide what every cohort is asked.
 */

const KINDS = ["NUMBER", "SCALE", "SINGLE_SELECT", "MULTI_SELECT", "YES_NO", "TEXT", "LONG_TEXT"] as const;
const METRICS = [
  "APPLICATIONS", "INTERVIEWS", "NETWORKING", "LINKEDIN_POSTS", "LEARNING_HOURS", "BLOCKERS", "OTHER",
] as const;

function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

async function requireAdminSession() {
  const session = await requireSession();
  if (session.role !== "ADMIN") return null;
  return session;
}

function revalidateTemplates() {
  revalidatePath("/console");
  revalidatePath("/weekly-reports");
}

const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Give the question set a name").max(120),
  description: z.string().trim().max(500).optional(),
  line: z.enum(["B2", "GERMAN_NOTE"]),
  /** Empty means it serves every level on its line. */
  levelCode: z.string().trim().optional(),
  active: z.enum(["yes", "no"]).default("yes"),
});

export async function saveWeeklyTemplate(input: unknown): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return { ok: false, error: "Only the founder can change the question sets." };
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const levelCode = v.levelCode?.trim() || null;
  if (levelCode) {
    const level = await prisma.level.findUnique({ where: { code: levelCode }, select: { code: true } });
    if (!level) return { ok: false, error: "That level does not exist." };
  }

  const data = {
    name: v.name,
    description: v.description?.trim() || null,
    line: v.line as never,
    levelCode,
    active: v.active === "yes",
  };

  if (v.id) {
    const existing = await prisma.weeklyReportTemplate.findUnique({
      where: { id: v.id },
      select: { id: true, name: true },
    });
    if (!existing) return { ok: false, error: "That question set no longer exists." };
    await prisma.weeklyReportTemplate.update({ where: { id: v.id }, data });
    await logActivity(session, {
      action: "weekly.template.update",
      section: "console",
      entityType: "WeeklyReportTemplate",
      entityId: v.id,
      summary: `Updated the question set "${v.name}"`,
    });
  } else {
    const created = await prisma.weeklyReportTemplate.create({
      data: { ...data, createdById: session.user.id },
      select: { id: true },
    });
    await logActivity(session, {
      action: "weekly.template.create",
      section: "console",
      entityType: "WeeklyReportTemplate",
      entityId: created.id,
      summary: `Created the question set "${v.name}"`,
    });
  }

  revalidateTemplates();
  return { ok: true };
}

const optionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  /** The bucket's floor, for a choice that stands for a number ("3-5 hours" -> 3). */
  numeric: z.number().int().min(0).max(10_000).nullable().optional(),
});

const questionSchema = z
  .object({
    templateId: z.string().min(1),
    /** Present when editing; absent when adding. */
    id: z.string().optional(),
    key: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, "Use lower-case letters, numbers and underscores"),
    kind: z.enum(KINDS),
    metric: z.enum(METRICS).default("OTHER"),
    label: z.string().trim().min(3, "Write the question out").max(300),
    helpText: z.string().trim().max(300).optional(),
    required: z.enum(["yes", "no"]).default("yes"),
    orderIndex: z.number().int().min(0).max(200).default(0),
    options: z.array(optionSchema).max(30).default([]),
    allowOther: z.enum(["yes", "no"]).default("no"),
    min: z.number().int().min(0).max(10_000).nullable().optional(),
    max: z.number().int().min(0).max(10_000).nullable().optional(),
    targetNumeric: z.number().int().min(0).max(10_000).nullable().optional(),
  })
  .refine((q) => !["SINGLE_SELECT", "MULTI_SELECT"].includes(q.kind) || q.options.length > 0, {
    message: "A choice question needs at least one option",
    path: ["options"],
  })
  .refine((q) => q.min == null || q.max == null || q.min <= q.max, {
    message: "The smallest answer cannot be larger than the largest",
    path: ["max"],
  });

export async function saveWeeklyQuestion(input: unknown): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return { ok: false, error: "Only the founder can change the question sets." };
  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const template = await prisma.weeklyReportTemplate.findUnique({
    where: { id: v.templateId },
    select: { id: true, name: true },
  });
  if (!template) return { ok: false, error: "That question set no longer exists." };

  const fields = {
    kind: v.kind as never,
    metric: v.metric as never,
    label: v.label,
    helpText: v.helpText?.trim() || null,
    required: v.required === "yes",
    orderIndex: v.orderIndex,
    options: (v.options.length > 0 ? v.options : null) as never,
    allowOther: v.allowOther === "yes",
    min: v.min ?? null,
    max: v.max ?? null,
    targetNumeric: v.targetNumeric ?? null,
  };

  if (!v.id) {
    const clash = await prisma.weeklyReportQuestion.findFirst({
      where: { templateId: v.templateId, key: v.key, active: true },
      select: { id: true },
    });
    if (clash) return { ok: false, error: `This set already asks "${v.key}".` };

    await prisma.weeklyReportQuestion.create({
      data: { templateId: v.templateId, key: v.key, version: 1, active: true, ...fields },
    });
    await logActivity(session, {
      action: "weekly.question.create",
      section: "console",
      entityType: "WeeklyReportTemplate",
      entityId: v.templateId,
      summary: `Added "${v.label}" to ${template.name}`,
    });
    revalidateTemplates();
    return { ok: true };
  }

  const existing = await prisma.weeklyReportQuestion.findUnique({
    where: { id: v.id },
    select: { id: true, key: true, version: true, templateId: true, _count: { select: { answers: true } } },
  });
  if (!existing) return { ok: false, error: "That question no longer exists." };

  if (existing._count.answers === 0) {
    // Nobody has answered it, so there is nothing to preserve - edit in place.
    await prisma.weeklyReportQuestion.update({ where: { id: v.id }, data: { key: v.key, ...fields } });
  } else {
    /**
     * Already answered. Retire this version and add the next one beside it, in one
     * transaction so a reader can never see both active or neither.
     */
    await prisma.$transaction([
      prisma.weeklyReportQuestion.update({ where: { id: v.id }, data: { active: false } }),
      prisma.weeklyReportQuestion.create({
        data: {
          templateId: existing.templateId,
          key: v.key,
          version: existing.version + 1,
          active: true,
          ...fields,
        },
      }),
    ]);
  }

  await logActivity(session, {
    action: "weekly.question.update",
    section: "console",
    entityType: "WeeklyReportTemplate",
    entityId: existing.templateId,
    summary:
      existing._count.answers === 0
        ? `Edited "${v.label}" in ${template.name}`
        : `Reworded "${v.label}" in ${template.name} (new version - the old answers keep the old wording)`,
    meta: { answered: existing._count.answers },
  });

  revalidateTemplates();
  return { ok: true };
}

const removeSchema = z.object({ id: z.string().min(1) });

/** Stop asking a question. Deletes it outright only when nobody ever answered it. */
export async function removeWeeklyQuestion(input: unknown): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return { ok: false, error: "Only the founder can change the question sets." };
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const q = await prisma.weeklyReportQuestion.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true, label: true, templateId: true,
      template: { select: { name: true } },
      _count: { select: { answers: true } },
    },
  });
  if (!q) return { ok: false, error: "That question no longer exists." };

  if (q._count.answers === 0) {
    await prisma.weeklyReportQuestion.delete({ where: { id: q.id } });
  } else {
    await prisma.weeklyReportQuestion.update({ where: { id: q.id }, data: { active: false } });
  }

  await logActivity(session, {
    action: "weekly.question.remove",
    section: "console",
    entityType: "WeeklyReportTemplate",
    entityId: q.templateId,
    summary:
      q._count.answers === 0
        ? `Removed "${q.label}" from ${q.template.name}`
        : `Stopped asking "${q.label}" in ${q.template.name} (${q._count.answers} answer(s) kept)`,
  });

  revalidateTemplates();
  return { ok: true };
}
