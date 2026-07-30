"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { normalizeLevelCode } from "@/lib/levels";
import type { QuestionOption } from "@/lib/qualification";
import { logActivity } from "./activity-log";
import { QUALIFICATION_CACHE_TAG } from "./qualification";
import type { ActionResult } from "./finance-actions";

/**
 * Qualification catalogue writes (ER v2 Track D).
 *
 * Guarded by `qualification.manage` rather than `pipeline.configure`: editing these questions
 * changes the BANT verdict that decides WHO GETS CALLED, and someone who may reassign leads
 * should not thereby be able to silently re-tune what "qualified" means for everyone.
 *
 * ── The versioning rule (decision D5) ───────────────────────────────────────────
 * A question that has been ANSWERED is frozen. Editing its wording, options, dimension or
 * weight creates version N+1 and retires the old one; the answers keep pointing at the
 * version they were actually given against. Without this, re-tuning the form would rewrite
 * the recorded reason we called someone months after the call.
 *
 * The database enforces it too (`qualification_question_version_guard`), so this is defence
 * in depth — but the action is where the NEW VERSION gets created, which the trigger can't do.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const optionSchema = z.object({
  value: z.string().trim().min(1),
  label: z.string().trim().min(1),
  score: z.coerce.number().min(0).max(5),
});

const questionSchema = z.object({
  key: z.string().trim().min(1, "A key is required").max(64),
  text: z.string().trim().min(1, "The question text is required").max(500),
  helpText: z.string().trim().max(500).optional(),
  kind: z.enum(["TEXT", "LONG_TEXT", "SELECT", "MULTI_SELECT", "BOOLEAN", "NUMBER"]),
  dimension: z.enum(["BUDGET", "AUTHORITY", "NEED", "TIMELINE", "NONE"]),
  weight: z.coerce.number().min(0).max(5).default(1),
  required: z.coerce.boolean().default(false),
  /** JSON array of {value,label,score}; ignored for free-text kinds. */
  options: z.string().trim().optional(),
});

const SCORED_KINDS = ["SELECT", "MULTI_SELECT", "BOOLEAN"];

function parseOptions(raw: string | undefined): { ok: true; value: QuestionOption[] } | { ok: false; error: string } {
  if (!raw || !raw.trim()) return { ok: true, value: [] };
  try {
    const parsed = z.array(optionSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const values = parsed.data.map((o) => o.value);
    if (new Set(values).size !== values.length) return { ok: false, error: "Two options share the same value" };
    return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, error: "Options must be valid JSON" };
  }
}

export async function createQualificationQuestion(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("qualification.manage");
  if (!allowed) return denied;

  const parsed = questionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  // The key is the join to answers and (during the dual-write phase) to the BookingRequest
  // column of the same name, so it follows the same normalisation as a level code.
  const key = normalizeLevelCode(d.key).toLowerCase();
  if (!key) return { ok: false, error: "That key has no usable characters" };

  const opts = parseOptions(d.options);
  if (!opts.ok) return { ok: false, error: opts.error };
  if (d.dimension !== "NONE" && !SCORED_KINDS.includes(d.kind)) {
    return { ok: false, error: "A scored question needs a fixed option list — free text cannot be scored" };
  }
  if (d.dimension !== "NONE" && opts.value.length === 0) {
    return { ok: false, error: "A scored question needs at least one option" };
  }

  const existing = await prisma.qualificationQuestion.findFirst({ where: { key }, select: { id: true } });
  if (existing) return { ok: false, error: `A question with the key "${key}" already exists — edit it instead` };

  const last = await prisma.qualificationQuestion.aggregate({ _max: { orderIndex: true } });

  const q = await prisma.qualificationQuestion.create({
    data: {
      key,
      version: 1,
      text: d.text,
      helpText: d.helpText || null,
      kind: d.kind,
      options: opts.value.length ? (opts.value as never) : undefined,
      dimension: d.dimension,
      weight: d.weight,
      required: d.required,
      orderIndex: (last._max.orderIndex ?? -1) + 1,
    },
  });

  await logActivity(session, {
    action: "qualification.create",
    section: "bookings",
    entityType: "QualificationQuestion",
    entityId: q.id,
    summary: `Added the qualification question "${d.text}"`,
    meta: { key, dimension: d.dimension },
  });

  revalidateTag(QUALIFICATION_CACHE_TAG);
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Edit a question.
 *
 * If it has NO answers, the row is edited in place — nothing depends on its old wording.
 * If it HAS answers, a new version is created and the old one retired. The caller does not
 * choose: which path is taken is a property of the data, not a preference, and offering it as
 * an option would eventually let someone pick the wrong one.
 */
export async function updateQualificationQuestion(questionId: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("qualification.manage");
  if (!allowed) return denied;

  const parsed = questionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const opts = parseOptions(d.options);
  if (!opts.ok) return { ok: false, error: opts.error };
  if (d.dimension !== "NONE" && opts.value.length === 0) {
    return { ok: false, error: "A scored question needs at least one option" };
  }

  const current = await prisma.qualificationQuestion.findUnique({
    where: { id: questionId },
    include: { _count: { select: { answers: true } } },
  });
  if (!current) return { ok: false, error: "Question not found" };

  const fields = {
    text: d.text,
    helpText: d.helpText || null,
    kind: d.kind,
    options: opts.value.length ? (opts.value as never) : undefined,
    dimension: d.dimension,
    weight: d.weight,
    required: d.required,
  };

  let versioned = false;
  if (current._count.answers > 0) {
    // Frozen. New version, old one retired — the answers keep citing what they were given
    // against. Done in one transaction so the catalogue is never momentarily missing the key.
    await prisma.$transaction(async (tx) => {
      await tx.qualificationQuestion.update({ where: { id: questionId }, data: { active: false } });
      await tx.qualificationQuestion.create({
        data: {
          key: current.key,
          version: current.version + 1,
          orderIndex: current.orderIndex,
          active: true,
          ...fields,
        },
      });
    });
    versioned = true;
  } else {
    await prisma.qualificationQuestion.update({ where: { id: questionId }, data: fields });
  }

  await logActivity(session, {
    action: "qualification.update",
    section: "bookings",
    entityType: "QualificationQuestion",
    entityId: questionId,
    summary: versioned
      ? `Revised "${current.key}" to version ${current.version + 1} (${current._count.answers} answers kept on v${current.version})`
      : `Edited the qualification question "${current.key}"`,
    meta: { versioned, answers: current._count.answers },
  });

  revalidateTag(QUALIFICATION_CACHE_TAG);
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Retire (or restore) a question. Never a delete: answers cite it, and the FK is RESTRICT.
 * The wording IS the evidence for a verdict that was already acted on.
 */
export async function setQualificationQuestionActive(questionId: string, active: boolean): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("qualification.manage");
  if (!allowed) return denied;

  const q = await prisma.qualificationQuestion.findUnique({ where: { id: questionId }, select: { key: true, text: true } });
  if (!q) return { ok: false, error: "Question not found" };

  await prisma.qualificationQuestion.update({ where: { id: questionId }, data: { active } });
  await logActivity(session, {
    action: active ? "qualification.restore" : "qualification.retire",
    section: "bookings",
    entityType: "QualificationQuestion",
    entityId: questionId,
    summary: `${active ? "Restored" : "Retired"} the qualification question "${q.text}"`,
    meta: { key: q.key },
  });

  revalidateTag(QUALIFICATION_CACHE_TAG);
  revalidatePath("/console");
  return { ok: true };
}

/** Reorder the form. Ids in the new display order. */
export async function reorderQualificationQuestions(ids: string[]): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("qualification.manage");
  if (!allowed) return denied;
  if (ids.length === 0) return { ok: false, error: "Nothing to reorder" };

  await prisma.$transaction(
    ids.map((id, i) => prisma.qualificationQuestion.update({ where: { id }, data: { orderIndex: i } })),
  );
  await logActivity(session, {
    action: "qualification.reorder",
    section: "bookings",
    entityType: "QualificationQuestion",
    entityId: ids[0],
    summary: `Reordered the ${ids.length} qualification questions`,
    meta: { count: ids.length },
  });

  revalidateTag(QUALIFICATION_CACHE_TAG);
  revalidatePath("/console");
  return { ok: true };
}
