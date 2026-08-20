"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { normalizeLevelCode } from "@/lib/levels";
import type { QuestionOption } from "@/lib/qualification";
import { logActivity } from "./activity-log";
import { QUALIFICATION_CACHE_TAG, shadowAgreement } from "./qualification";
import { getQualificationConfig, writeQualificationConfig } from "./founder-config";
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
 * in depth - but the action is where the NEW VERSION gets created, which the trigger can't do.
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
  /**
   * Comma- or newline-separated field names an external form may use for this question.
   * Free text rather than a picker: the founder is transcribing whatever the landing page
   * builder called the field, and we cannot offer a list of names we have never seen.
   */
  inboundKeys: z.string().trim().max(1000).optional(),
  /** `optionValue: alias, alias` per line - the answer texts the external form sends. */
  answerAliases: z.string().trim().max(4000).optional(),
});

/** Split a comma/newline separated list into clean, de-duplicated, bounded entries. */
function splitList(raw: string, max: number): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const k = part.trim().slice(0, 200);
    if (k) seen.add(k);
    if (seen.size >= max) break;
  }
  return [...seen];
}

function parseInboundKeys(raw: string | undefined): string[] {
  return raw ? splitList(raw, 25) : [];
}

/** Prisma's Json column wants `undefined` (leave alone) or a value - never a bare `{}` we built. */
function aliasesFor(raw: string | undefined, options: QuestionOption[]) {
  const parsed = parseAnswerAliases(raw, new Set(options.map((o) => o.value)));
  return Object.keys(parsed).length ? (parsed as never) : Prisma.JsonNull;
}

/**
 * Parse the alias editor's `optionValue: alias, alias` lines.
 *
 * A line-based mini-format rather than JSON on purpose: this is the field a non-technical
 * founder edits most often - every time the landing page's wording changes - and a stray comma
 * in a JSON blob rejects the whole save. Here a malformed line is simply skipped, and options
 * that were never mentioned keep the aliases they already had (the caller merges).
 */
function parseAnswerAliases(
  raw: string | undefined,
  validValues: Set<string>,
): Record<string, string[]> {
  if (!raw) return {};
  const out: Record<string, string[]> = {};
  for (const line of raw.split("\n").slice(0, 60)) {
    const at = line.indexOf(":");
    if (at < 1) continue;
    const value = line.slice(0, at).trim();
    // Silently drop aliases for options that no longer exist rather than storing orphans that
    // would never match anything and would confuse the next person reading the config.
    if (!validValues.has(value)) continue;
    const aliases = splitList(line.slice(at + 1), 25);
    if (aliases.length) out[value] = aliases;
  }
  return out;
}

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
    return { ok: false, error: "A scored question needs a fixed option list - free text cannot be scored" };
  }
  if (d.dimension !== "NONE" && opts.value.length === 0) {
    return { ok: false, error: "A scored question needs at least one option" };
  }

  const existing = await prisma.qualificationQuestion.findFirst({ where: { key }, select: { id: true } });
  if (existing) return { ok: false, error: `A question with the key "${key}" already exists - edit it instead` };

  const last = await prisma.qualificationQuestion.aggregate({ _max: { orderIndex: true } });

  const q = await prisma.qualificationQuestion.create({
    data: {
      key,
      version: 1,
      text: d.text,
      helpText: d.helpText || null,
      kind: d.kind,
      options: opts.value.length ? (opts.value as never) : undefined,
      inboundKeys: parseInboundKeys(d.inboundKeys),
      answerAliases: aliasesFor(d.answerAliases, opts.value),
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
 * If it has NO answers, the row is edited in place - nothing depends on its old wording.
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
    inboundKeys: parseInboundKeys(d.inboundKeys),
    answerAliases: aliasesFor(d.answerAliases, opts.value),
    dimension: d.dimension,
    weight: d.weight,
    required: d.required,
  };

  /**
   * Does this edit change the EVIDENCE, or only how an external form's wording is recognised?
   *
   * Only the former earns a new version. Adding "Right away" as an alias for the option that
   * already meant `immediately` does not change what this prospect was asked or what their
   * answer scored - it fixes a parsing rule that was wrong from the day the landing page was
   * reworded. Versioning that would spawn a new question every time marketing edits a label,
   * and would leave a trail of retired versions that differ from each other in nothing a
   * reader could see.
   *
   * The field list mirrors `forbid_answered_question_edit()` exactly: those are the columns the
   * database itself refuses to mutate once answered, so anything outside it is by definition
   * safe to update in place.
   */
  const evidenceChanged =
    current.text !== fields.text ||
    current.kind !== fields.kind ||
    current.dimension !== fields.dimension ||
    current.weight !== fields.weight ||
    JSON.stringify(current.options ?? null) !== JSON.stringify(opts.value.length ? opts.value : null);

  let versioned = false;
  if (current._count.answers > 0 && evidenceChanged) {
    // Frozen. New version, old one retired - the answers keep citing what they were given
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
      : evidenceChanged
        ? `Edited the qualification question "${current.key}"`
        : `Updated how "${current.key}" is read from inbound forms`,
    meta: { versioned, evidenceChanged, answers: current._count.answers },
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

/**
 * Choose which scorer decides the BANT verdict.
 *
 * Switching TO the catalogue is gated on the replay agreeing on every historical booking. The
 * gate is re-checked HERE and not merely rendered in the UI: the panel's banner is a view of a
 * cached number, and the decision this flips - who gets called, who gets a rejection email - is
 * not one to take on a stale read. Switching BACK is never gated; undoing a change must not
 * depend on the thing you are undoing being healthy.
 */
export async function setQualificationScorer(scorer: "shipped" | "catalogue"): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("qualification.manage");
  if (!allowed) return denied;

  const before = await getQualificationConfig();
  if (before.scorer === scorer) return { ok: true };

  if (scorer === "catalogue") {
    const gate = await shadowAgreement();
    if (!gate.readyToFlip) {
      return {
        ok: false,
        error:
          gate.scored === 0
            ? "No submissions have been scored yet, so there is nothing to prove the catalogue matches. Take a booking first."
            : `The catalogue disagrees with the current scorer on ${gate.disagreements} of ${gate.scored} bookings. Re-seed it before switching.`,
      };
    }
  }

  await writeQualificationConfig({ ...before, scorer });
  await logActivity(session, {
    action: "qualification.scorer.set",
    section: "bookings",
    entityType: "AppSetting",
    entityId: "qualificationConfig",
    summary:
      scorer === "catalogue"
        ? "Switched BANT scoring to the editable question catalogue"
        : "Switched BANT scoring back to the shipped tables",
    meta: { from: before.scorer, to: scorer },
  });

  revalidateTag(QUALIFICATION_CACHE_TAG);
  revalidatePath("/console");
  revalidatePath("/book");
  return { ok: true };
}
