"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { CHART_OF_ACCOUNTS } from "@/lib/chart-of-accounts";
import { normalizeLevelCode } from "@/lib/levels";
import { lineForKind } from "@/lib/business-line";
import type { SectionKey } from "@/lib/sections";
import { LEVELS_CACHE_TAG } from "./levels";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Level catalogue admin (Admin-only), shared by BOTH halves of the catalogue: German Note >
 * Manage > Levels edits the German levels and bundles, /programs edits the B2 coaching tiers.
 * The UI splits by business line (see `LevelsPanel`); these actions do not care which surface
 * called them, they only enforce what is true of a row.
 *
 * Coaching tiers (SOLO/GUIDED/ELITE) and OTHER are seeded `locked` - label + GL account are
 * editable but they cannot be renamed by code, re-kinded, deactivated or deleted.
 *
 * See docs/CONFIGURABLE_LEVELS_PLAN.md. `code` is an immutable natural key stored on every level
 * column, so it is set once at create and never edited.
 */

const INCOME_ACCOUNT_CODES: string[] = CHART_OF_ACCOUNTS.filter((a) => a.type === "INCOME").map((a) => a.code);

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Rupees in the form → paise in the DB (empty → null). */
const rupeesToPaise = (v: string | undefined): bigint | null => {
  if (!v || !v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 100));
};

/** bundleMembers arrives comma/space separated; normalise, de-dupe. */
function parseMembers(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[,\s]+/).map(normalizeLevelCode).filter(Boolean))];
}

/**
 * The GL account the level posts to, falling back per business line rather than always to 4030.
 * A B2 coaching tier that silently defaulted to "Income - German Note" would put B2 revenue on
 * the other line's books, and `lineForKind` is what the finance screens segment on.
 */
function resolveIncomeAccount(code: string | undefined, kind: string): string {
  if (code && INCOME_ACCOUNT_CODES.includes(code)) return code;
  return lineForKind(kind) === "GERMAN_NOTE" ? "4030" : "4090";
}

/** Every bundle member must exist as a GERMAN_LEVEL. Returns an error message, or null when OK. */
async function assertMembersExist(members: string[]): Promise<string | null> {
  if (!members.length) return null;
  const found = await prisma.level.findMany({
    where: { code: { in: members }, kind: "GERMAN_LEVEL" },
    select: { code: true },
  });
  const ok = new Set(found.map((f) => f.code));
  const missing = members.filter((m) => !ok.has(m));
  return missing.length ? `Bundle members not found as German levels: ${missing.join(", ")}` : null;
}

/**
 * Both catalogue surfaces have to re-render after any level edit. A row is only EDITABLE from
 * the side of the business it belongs to, but the German Note manage page also reads the
 * catalogue for its batch pickers, so a new coaching tier still invalidates it.
 */
function revalidateLevelSurfaces() {
  revalidatePath("/german-note/manage");
  revalidatePath("/programs");
  revalidateTag(LEVELS_CACHE_TAG); // bust the cross-request level cache immediately
}

/** Which section's activity log this level edit is filed under - the one that can make it. */
const sectionForKind = (kind: string): SectionKey =>
  lineForKind(kind) === "GERMAN_NOTE" ? "german-note" : "programs";

const LEVEL_KINDS = ["GERMAN_LEVEL", "GERMAN_BUNDLE", "COACHING_TIER", "OTHER"] as const;

const baseSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(80),
  /**
   * Optional on purpose, and only on UPDATE (create re-requires it below).
   *
   * The edit form DISABLES the kind picker for a locked row, and a disabled control submits
   * nothing - so a required `kind` rejected every attempt to edit a coaching tier with "Pick a
   * level kind", which is the one thing those rows are supposed to allow. An absent kind now
   * means "leave it as it is", which is also what `locked` already forced.
   */
  kind: z.enum(LEVEL_KINDS, { message: "Pick a level kind" }).optional(),
  incomeAccountCode: z.string().trim().optional(),
  booksCost: z.string().trim().optional(),
  tutorCost: z.string().trim().optional(),
  bundleMembers: z.string().trim().optional(),
  order: z.coerce.number().int().min(0).max(999).optional(),
});

export async function createLevel(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = baseSchema
    .extend({
      code: z.string().trim().min(1, "Code is required"),
      kind: z.enum(LEVEL_KINDS, { message: "Pick a level kind" }),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const code = normalizeLevelCode(d.code);
  if (!code) return { ok: false, error: "Enter a code using letters, digits or underscores (e.g. GN_C1)" };
  const clash = await prisma.level.findUnique({ where: { code }, select: { id: true } });
  if (clash) return { ok: false, error: `A level with code "${code}" already exists` };

  const members = d.kind === "GERMAN_BUNDLE" ? parseMembers(d.bundleMembers) : [];
  const memberErr = await assertMembersExist(members);
  if (memberErr) return { ok: false, error: memberErr };

  const level = await prisma.level.create({
    data: {
      code,
      label: d.label,
      kind: d.kind,
      order: d.order ?? 0,
      incomeAccountCode: resolveIncomeAccount(d.incomeAccountCode, d.kind),
      booksCostInrMinor: rupeesToPaise(d.booksCost),
      tutorCostInrMinor: rupeesToPaise(d.tutorCost),
      bundleMembers: members,
    },
  });
  await logActivity(session, {
    action: "level.create",
    section: sectionForKind(level.kind),
    entityType: "Level",
    entityId: level.id,
    summary: `Added the level "${level.label}" (${level.code})`,
    meta: { code: level.code, kind: level.kind, incomeAccountCode: level.incomeAccountCode },
  });
  revalidateLevelSurfaces();
  return { ok: true };
}

export async function updateLevel(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = baseSchema
    .extend({ active: z.enum(["true", "false"]).optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const before = await prisma.level.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Level not found" };

  // Locked rows (coaching tiers / OTHER): kind, active and bundle membership are frozen; only the
  // label and GL account can move. An ABSENT kind means the form did not offer the field.
  const kind = before.locked ? before.kind : (d.kind ?? before.kind);

  /**
   * A field the form never rendered is PRESERVED, not cleared.
   *
   * The B2 surface omits the books and tutor cost inputs - the schema documents both as null for
   * coaching tiers - and an absent input must not null out a value the German surface set. An
   * empty string still clears: that is a founder deliberately blanking the field.
   */
  const members =
    kind === "GERMAN_BUNDLE"
      ? d.bundleMembers === undefined
        ? before.bundleMembers
        : parseMembers(d.bundleMembers)
      : [];
  const memberErr = await assertMembersExist(members);
  if (memberErr) return { ok: false, error: memberErr };

  const active = before.locked ? before.active : d.active === undefined ? before.active : d.active === "true";

  const after = await prisma.level.update({
    where: { id },
    data: {
      label: d.label,
      kind,
      order: d.order ?? before.order,
      active,
      incomeAccountCode: resolveIncomeAccount(d.incomeAccountCode, kind),
      booksCostInrMinor: d.booksCost === undefined ? before.booksCostInrMinor : rupeesToPaise(d.booksCost),
      tutorCostInrMinor: d.tutorCost === undefined ? before.tutorCostInrMinor : rupeesToPaise(d.tutorCost),
      bundleMembers: before.locked ? before.bundleMembers : members,
    },
  });
  await logActivity(session, {
    action: "level.update",
    section: sectionForKind(after.kind),
    entityType: "Level",
    entityId: id,
    summary: `Updated the level "${after.label}" (${after.code})`,
    // Hand-built meta (never diffFields on this row - its BigInt cost columns would throw).
    meta: { code: after.code, kind: after.kind, active: after.active, incomeAccountCode: after.incomeAccountCode },
  });
  revalidateLevelSurfaces();
  return { ok: true };
}

/** How many live records reference a level code - the guard against deleting a level in use. */
async function levelUsageCount(code: string): Promise<number> {
  const [income, pending, leads, enrol, batches, joiners, orders] = await Promise.all([
    prisma.income.count({ where: { programLevel: code } }),
    prisma.pendingPayment.count({ where: { programLevel: code } }),
    prisma.lead.count({ where: { wonLevel: code } }),
    prisma.enrollment.count({ where: { programLevel: code } }),
    prisma.batch.count({ where: { level: code } }),
    prisma.gnPendingJoiner.count({ where: { level: code } }),
    prisma.bookOrder.count({ where: { level: code } }),
  ]);
  return income + pending + leads + enrol + batches + joiners + orders;
}

export async function setLevelActive(id: string, active: boolean): Promise<ActionResult> {
  const session = await requireAdmin();
  const level = await prisma.level.findUnique({ where: { id } });
  if (!level) return { ok: false, error: "Level not found" };
  if (level.locked && !active) {
    return { ok: false, error: `"${level.label}" is a locked system level and can't be deactivated` };
  }
  await prisma.level.update({ where: { id }, data: { active } });
  await logActivity(session, {
    action: "level.setActive",
    section: sectionForKind(level.kind),
    entityType: "Level",
    entityId: id,
    summary: `${active ? "Reactivated" : "Deactivated"} the level "${level.label}"`,
    meta: { code: level.code, active },
  });
  revalidateLevelSurfaces();
  return { ok: true };
}

export async function deleteLevel(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const level = await prisma.level.findUnique({ where: { id } });
  if (!level) return { ok: false, error: "Level not found" };
  if (level.locked) return { ok: false, error: `"${level.label}" is a locked system level and can't be deleted` };

  const used = await levelUsageCount(level.code);
  if (used > 0) {
    return { ok: false, error: `"${level.label}" is used by ${used} record${used === 1 ? "" : "s"} - deactivate it instead of deleting.` };
  }
  const inBundle = await prisma.level.findFirst({
    where: { bundleMembers: { has: level.code } },
    select: { label: true },
  });
  if (inBundle) {
    return { ok: false, error: `"${level.label}" is a member of the bundle "${inBundle.label}" - remove it there first.` };
  }

  await prisma.level.delete({ where: { id } });
  await logActivity(session, {
    action: "level.delete",
    section: sectionForKind(level.kind),
    entityType: "Level",
    entityId: id,
    summary: `Deleted the level "${level.label}" (${level.code})`,
    meta: { code: level.code },
  });
  revalidateLevelSurfaces();
  return { ok: true };
}
