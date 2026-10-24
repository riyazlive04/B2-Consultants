"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { GnEventType, SessionDelivery } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { GUIDED_CURRICULUM_SEED } from "@/lib/curriculum";
import { isKnownLevel } from "./levels";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Curriculum writes - authoring the programme timetable itself.
 *
 * `requireAdmin()` throughout, deliberately. The curriculum IS the service the signed agreement
 * describes (Annexure A lists these sessions by name and by delivery mode), so re-wording a row
 * or flipping one from LIVE to PRE_RECORDED changes what the business has contracted to deliver.
 * That is a founder's decision, not a delivery one - which is also why editing a template never
 * reaches back into a batch already running on it: see `batch-timetable-actions.ts`.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const templateSchema = z.object({
  line: z.enum(["B2", "GERMAN_NOTE"]).optional(),
  name: z.string().trim().min(1, "Give the curriculum a name").max(160),
  /**
   * The programme this plan is written for - `Level.code`, chosen from the catalogue.
   *
   * It was `z.string().max(40)`, i.e. anything. Live proved what that costs: of three plans, one
   * was filed under `Guided` (the catalogue says `GUIDED`) and one under `Gudied30`, a typo. A
   * plan whose code is not in the catalogue cannot be matched to a programme by any screen that
   * looks one up, and nothing in the app could say so.
   *
   * The form now offers a picker rather than a text box, and this re-checks it server-side -
   * a picker is a courtesy, not a guard.
   */
  levelCode: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  // Blank means "no sprint phase", which is a real answer - not every programme has one.
  sprintDays: z.coerce.number().int().min(0).max(730).optional(),
  /**
   * NOT `z.coerce.boolean()`. That is `Boolean(value)`, and the string "false" is truthy - so
   * a <select> posting "false" parsed as TRUE and setting a curriculum to Retired silently did
   * nothing. The form posts exactly these two strings, so read them as the words they are.
   */
  active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const itemSchema = z.object({
  weekNumber: z.coerce.number().int().min(1, "Week numbers start at 1").max(104),
  orderIndex: z.coerce.number().int().min(0).max(99).optional(),
  title: z.string().trim().min(1, "Give the session a topic").max(200),
  framework: z.string().trim().max(120).optional(),
  type: z.enum(["KICKOFF", "COACHING", "LINKEDIN", "QA", "OPEN_MARKET", "LIVE_CLASS", "OTHER"]),
  delivery: z.enum(["LIVE", "PRE_RECORDED"]),
  durationMins: z.coerce.number().int().min(0).max(1440).optional(),
  // "" from an unset <select>; -1 is never sent, the empty option is.
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  startTime: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function upsertCurriculumTemplate(
  templateId: string | null,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = templateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  /*
    A code that is not in the active catalogue is refused, rather than stored and silently
    unmatchable. Blank stays allowed: "which programme is this for" is genuinely optional, and a
    plan can be drafted before that is decided.
  */
  if (d.levelCode && !(await isKnownLevel(d.levelCode))) {
    return {
      ok: false,
      error: `"${d.levelCode}" is not a programme in the catalogue. Pick one from the list, or add it under Programs first.`,
    };
  }

  const data = {
    line: (d.line ?? "B2") as "B2" | "GERMAN_NOTE",
    name: d.name,
    levelCode: d.levelCode || null,
    description: d.description || null,
    // 0 is the founder saying "no sprint", and must not collapse to the 90-day default.
    sprintDays: d.sprintDays === undefined ? 90 : d.sprintDays === 0 ? null : d.sprintDays,
    ...(d.active === undefined ? {} : { active: d.active }),
  };

  const before = templateId
    ? await prisma.curriculumTemplate.findUnique({ where: { id: templateId } })
    : null;
  if (templateId && !before) return { ok: false, error: "Curriculum not found" };

  const template = templateId
    ? await prisma.curriculumTemplate.update({ where: { id: templateId }, data })
    : await prisma.curriculumTemplate.create({ data: { ...data, createdById: session.user.id } });

  await logActivity(session, {
    action: templateId ? "curriculum.update" : "curriculum.create",
    section: "programs",
    entityType: "CurriculumTemplate",
    entityId: template.id,
    summary: `${templateId ? "Updated" : "Created"} the curriculum "${template.name}"`,
    meta: before ? { changed: diffFields(before, template) } : {},
  });

  revalidatePath("/programs");
  return { ok: true };
}

/**
 * Delete a curriculum - only one no cohort was built from.
 *
 * `Batch.curriculumTemplateId` is SetNull, so deleting a used template would not error; it would
 * quietly disconnect every batch from the programme it is running and leave the batch page
 * unable to say what it is teaching. Retiring (`active: false`) is the normal close: the rows
 * stay readable and the template simply stops being offered on new batches.
 */
export async function deleteCurriculumTemplate(templateId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const t = await prisma.curriculumTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, _count: { select: { batches: true } } },
  });
  if (!t) return { ok: false, error: "Curriculum not found" };
  if (t._count.batches > 0) {
    return {
      ok: false,
      error: `${t._count.batches} ${t._count.batches === 1 ? "batch is" : "batches are"} running on "${t.name}" - retire it instead of deleting.`,
    };
  }

  await prisma.curriculumTemplate.delete({ where: { id: templateId } });
  await logActivity(session, {
    action: "curriculum.delete",
    section: "programs",
    entityType: "CurriculumTemplate",
    entityId: templateId,
    summary: `Deleted the unused curriculum "${t.name}"`,
    meta: {},
  });
  revalidatePath("/programs");
  return { ok: true };
}

/**
 * Copy a curriculum, rows and all.
 *
 * The founders run Guided and Elite off nearly the same timetable, and "start from last year's
 * and change two rows" is how a new intake's curriculum actually gets written. Without this the
 * alternative is retyping eight rows, which is eight chances to drift from the agreement.
 */
export async function duplicateCurriculumTemplate(templateId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const source = await prisma.curriculumTemplate.findUnique({
    where: { id: templateId },
    include: { items: { orderBy: [{ weekNumber: "asc" }, { orderIndex: "asc" }] } },
  });
  if (!source) return { ok: false, error: "Curriculum not found" };

  const copy = await prisma.curriculumTemplate.create({
    data: {
      line: source.line,
      name: `${source.name} (copy)`.slice(0, 160),
      levelCode: source.levelCode,
      description: source.description,
      sprintDays: source.sprintDays,
      createdById: session.user.id,
      items: {
        create: source.items.map((i) => ({
          weekNumber: i.weekNumber,
          orderIndex: i.orderIndex,
          title: i.title,
          framework: i.framework,
          type: i.type,
          delivery: i.delivery,
          durationMins: i.durationMins,
          dayOfWeek: i.dayOfWeek,
          startTime: i.startTime,
          notes: i.notes,
        })),
      },
    },
  });

  await logActivity(session, {
    action: "curriculum.duplicate",
    section: "programs",
    entityType: "CurriculumTemplate",
    entityId: copy.id,
    summary: `Copied the curriculum "${source.name}"`,
    meta: { sourceId: source.id, items: source.items.length },
  });
  revalidatePath("/programs");
  return { ok: true };
}

/**
 * Write the Guided programme as it stands in the signed agreement.
 *
 * Offered once, on an empty Curriculum tab. A founder should not have to retype the eight
 * sessions their own contract already lists, and typing them by hand is how the timetable and
 * Annexure A come to disagree.
 */
export async function seedGuidedCurriculum(): Promise<ActionResult> {
  const session = await requireAdmin();
  const existing = await prisma.curriculumTemplate.count();
  if (existing > 0) {
    return { ok: false, error: "There is already a curriculum here - copy it rather than seeding over the top." };
  }

  const template = await prisma.curriculumTemplate.create({
    data: {
      line: "B2",
      name: "Guided Mode - 4 weeks + 90-day sprint",
      levelCode: "GUIDED",
      description: "The Phase 1 group sessions exactly as Annexure A of the Guided agreement lists them.",
      sprintDays: 90,
      createdById: session.user.id,
      // The seed is typed against the pure planner (`type` is a plain string there, so the
      // module stays free of a Prisma import); Prisma wants its own enums.
      items: {
        create: GUIDED_CURRICULUM_SEED.map((r) => ({
          ...r,
          type: r.type as GnEventType,
          delivery: r.delivery as SessionDelivery,
        })),
      },
    },
  });

  await logActivity(session, {
    action: "curriculum.seed",
    section: "programs",
    entityType: "CurriculumTemplate",
    entityId: template.id,
    summary: "Seeded the Guided curriculum from the agreement",
    meta: { items: GUIDED_CURRICULUM_SEED.length },
  });
  revalidatePath("/programs");
  return { ok: true };
}

/**
 * Add or edit one row of the sheet.
 *
 * `orderIndex` is resolved rather than demanded: the form asks for a week and a topic, and the
 * row lands at the end of that week. `[templateId, weekNumber, orderIndex]` is UNIQUE, so
 * letting the caller pass a colliding index would surface as a database error on save.
 */
export async function upsertCurriculumItem(
  templateId: string,
  itemId: string | null,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const raw = Object.fromEntries(form);
  // An unset <select>/<input> posts "", which `z.coerce.number()` would read as 0 - a real
  // Sunday and a real midnight. Strip the blanks before they can mean something.
  for (const k of ["dayOfWeek", "durationMins", "startTime", "framework", "notes", "orderIndex"]) {
    if (typeof raw[k] === "string" && raw[k].trim() === "") delete raw[k];
  }
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  if (d.startTime && !HHMM.test(d.startTime)) {
    return { ok: false, error: "Start time must be a 24-hour clock time, like 10:30" };
  }
  if (d.delivery === "LIVE" && d.dayOfWeek === undefined) {
    return { ok: false, error: "A live session needs a day - pick one, or make it a pre-recorded video" };
  }

  const template = await prisma.curriculumTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true },
  });
  if (!template) return { ok: false, error: "Curriculum not found" };

  let orderIndex = d.orderIndex;
  if (orderIndex === undefined) {
    if (itemId) {
      orderIndex = (await prisma.curriculumItem.findUnique({ where: { id: itemId }, select: { orderIndex: true } }))?.orderIndex ?? 0;
    } else {
      const last = await prisma.curriculumItem.findFirst({
        where: { templateId, weekNumber: d.weekNumber },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });
      orderIndex = last ? last.orderIndex + 1 : 0;
    }
  }

  // Moving a row into another week can land on an index that week already uses.
  const clash = await prisma.curriculumItem.findFirst({
    where: { templateId, weekNumber: d.weekNumber, orderIndex, NOT: itemId ? { id: itemId } : undefined },
    select: { id: true },
  });
  if (clash) {
    const last = await prisma.curriculumItem.findFirst({
      where: { templateId, weekNumber: d.weekNumber },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    orderIndex = (last?.orderIndex ?? -1) + 1;
  }

  const data = {
    templateId,
    weekNumber: d.weekNumber,
    orderIndex,
    title: d.title,
    framework: d.framework || null,
    type: d.type,
    delivery: d.delivery,
    durationMins: d.durationMins ?? null,
    // A pre-recorded module has no day and no clock, whatever the form happened to carry.
    dayOfWeek: d.delivery === "PRE_RECORDED" ? null : d.dayOfWeek ?? null,
    startTime: d.delivery === "PRE_RECORDED" ? null : d.startTime || null,
    notes: d.notes || null,
  };

  const item = itemId
    ? await prisma.curriculumItem.update({ where: { id: itemId }, data })
    : await prisma.curriculumItem.create({ data });

  await logActivity(session, {
    action: itemId ? "curriculum.item.update" : "curriculum.item.create",
    section: "programs",
    entityType: "CurriculumItem",
    entityId: item.id,
    summary: `${itemId ? "Updated" : "Added"} "${item.title}" in week ${item.weekNumber} of "${template.name}"`,
    meta: { templateId },
  });

  revalidatePath("/programs");
  return { ok: true };
}

export async function deleteCurriculumItem(itemId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const item = await prisma.curriculumItem.findUnique({
    where: { id: itemId },
    select: { title: true, weekNumber: true, templateId: true, template: { select: { name: true } } },
  });
  if (!item) return { ok: false, error: "Session not found" };

  // Sessions already generated into a batch keep their own copy of every field and only lose
  // the back-reference (SetNull), so a cohort's history survives this.
  await prisma.curriculumItem.delete({ where: { id: itemId } });

  await logActivity(session, {
    action: "curriculum.item.delete",
    section: "programs",
    entityType: "CurriculumItem",
    entityId: itemId,
    summary: `Removed "${item.title}" from week ${item.weekNumber} of "${item.template.name}"`,
    meta: { templateId: item.templateId },
  });
  revalidatePath("/programs");
  return { ok: true };
}

/** Move a row up or down within its week. Swaps two `orderIndex` values in one transaction so
 *  the UNIQUE constraint never sees both rows holding the same index. */
export async function moveCurriculumItem(itemId: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin();
  const item = await prisma.curriculumItem.findUnique({
    where: { id: itemId },
    select: { id: true, templateId: true, weekNumber: true, orderIndex: true },
  });
  if (!item) return { ok: false, error: "Session not found" };

  const neighbour = await prisma.curriculumItem.findFirst({
    where: {
      templateId: item.templateId,
      weekNumber: item.weekNumber,
      orderIndex: direction === "up" ? { lt: item.orderIndex } : { gt: item.orderIndex },
    },
    orderBy: { orderIndex: direction === "up" ? "desc" : "asc" },
    select: { id: true, orderIndex: true },
  });
  if (!neighbour) return { ok: true }; // already at the end of its week

  await prisma.$transaction([
    // Park on a value no row can hold (orderIndex is >= 0) so the swap never collides.
    prisma.curriculumItem.update({ where: { id: item.id }, data: { orderIndex: -1 } }),
    prisma.curriculumItem.update({ where: { id: neighbour.id }, data: { orderIndex: item.orderIndex } }),
    prisma.curriculumItem.update({ where: { id: item.id }, data: { orderIndex: neighbour.orderIndex } }),
  ]);

  revalidatePath("/programs");
  return { ok: true };
}
