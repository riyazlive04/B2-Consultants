"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { CHART_OF_ACCOUNTS } from "@/lib/chart-of-accounts";
import { normalizeLevelCode } from "@/lib/levels";
import { LEVELS_CACHE_TAG } from "./levels";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Level catalogue admin (Admin-only). The founders add/edit German levels (C1, C2, …) and bundles
 * here; coaching tiers (SOLO/GUIDED/ELITE) and OTHER are seeded `locked` — label + GL account are
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

function resolveIncomeAccount(code: string | undefined): string {
  return code && INCOME_ACCOUNT_CODES.includes(code) ? code : "4030";
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

const baseSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(80),
  kind: z.enum(["GERMAN_LEVEL", "GERMAN_BUNDLE"], { message: "Pick a level kind" }),
  incomeAccountCode: z.string().trim().optional(),
  booksCost: z.string().trim().optional(),
  tutorCost: z.string().trim().optional(),
  bundleMembers: z.string().trim().optional(),
  order: z.coerce.number().int().min(0).max(999).optional(),
});

export async function createLevel(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = baseSchema
    .extend({ code: z.string().trim().min(1, "Code is required") })
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
      incomeAccountCode: resolveIncomeAccount(d.incomeAccountCode),
      booksCostInrMinor: rupeesToPaise(d.booksCost),
      tutorCostInrMinor: rupeesToPaise(d.tutorCost),
      bundleMembers: members,
    },
  });
  await logActivity(session, {
    action: "level.create",
    section: "german-note",
    entityType: "Level",
    entityId: level.id,
    summary: `Added the level "${level.label}" (${level.code})`,
    meta: { code: level.code, kind: level.kind, incomeAccountCode: level.incomeAccountCode },
  });
  revalidatePath("/german-note/manage");
  revalidateTag(LEVELS_CACHE_TAG); // bust the cross-request level cache immediately
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

  const members = d.kind === "GERMAN_BUNDLE" ? parseMembers(d.bundleMembers) : [];
  const memberErr = await assertMembersExist(members);
  if (memberErr) return { ok: false, error: memberErr };

  // Locked rows (coaching tiers / OTHER): kind, active and bundle membership are frozen; only the
  // label and GL account can move.
  const active = before.locked ? before.active : d.active === undefined ? before.active : d.active === "true";

  const after = await prisma.level.update({
    where: { id },
    data: {
      label: d.label,
      kind: before.locked ? before.kind : d.kind,
      order: d.order ?? before.order,
      active,
      incomeAccountCode: resolveIncomeAccount(d.incomeAccountCode),
      booksCostInrMinor: rupeesToPaise(d.booksCost),
      tutorCostInrMinor: rupeesToPaise(d.tutorCost),
      bundleMembers: before.locked ? before.bundleMembers : members,
    },
  });
  await logActivity(session, {
    action: "level.update",
    section: "german-note",
    entityType: "Level",
    entityId: id,
    summary: `Updated the level "${after.label}" (${after.code})`,
    // Hand-built meta (never diffFields on this row — its BigInt cost columns would throw).
    meta: { code: after.code, kind: after.kind, active: after.active, incomeAccountCode: after.incomeAccountCode },
  });
  revalidatePath("/german-note/manage");
  revalidateTag(LEVELS_CACHE_TAG); // bust the cross-request level cache immediately
  return { ok: true };
}

/** How many live records reference a level code — the guard against deleting a level in use. */
async function levelUsageCount(code: string): Promise<number> {
  const [income, pending, leads, enrol, batches, joiners, orders] = await Promise.all([
    prisma.income.count({ where: { programLevel: code } }),
    prisma.pendingPayment.count({ where: { programLevel: code } }),
    prisma.lead.count({ where: { wonLevel: code } }),
    prisma.enrollment.count({ where: { programLevel: code } }),
    prisma.gnBatch.count({ where: { level: code } }),
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
    section: "german-note",
    entityType: "Level",
    entityId: id,
    summary: `${active ? "Reactivated" : "Deactivated"} the level "${level.label}"`,
    meta: { code: level.code, active },
  });
  revalidatePath("/german-note/manage");
  revalidateTag(LEVELS_CACHE_TAG); // bust the cross-request level cache immediately
  return { ok: true };
}

export async function deleteLevel(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const level = await prisma.level.findUnique({ where: { id } });
  if (!level) return { ok: false, error: "Level not found" };
  if (level.locked) return { ok: false, error: `"${level.label}" is a locked system level and can't be deleted` };

  const used = await levelUsageCount(level.code);
  if (used > 0) {
    return { ok: false, error: `"${level.label}" is used by ${used} record${used === 1 ? "" : "s"} — deactivate it instead of deleting.` };
  }
  const inBundle = await prisma.level.findFirst({
    where: { bundleMembers: { has: level.code } },
    select: { label: true },
  });
  if (inBundle) {
    return { ok: false, error: `"${level.label}" is a member of the bundle "${inBundle.label}" — remove it there first.` };
  }

  await prisma.level.delete({ where: { id } });
  await logActivity(session, {
    action: "level.delete",
    section: "german-note",
    entityType: "Level",
    entityId: id,
    summary: `Deleted the level "${level.label}" (${level.code})`,
    meta: { code: level.code },
  });
  revalidatePath("/german-note/manage");
  revalidateTag(LEVELS_CACHE_TAG); // bust the cross-request level cache immediately
  return { ok: true };
}
