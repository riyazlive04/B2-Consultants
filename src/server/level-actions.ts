"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { ProductInterval } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { CHART_OF_ACCOUNTS } from "@/lib/chart-of-accounts";
import { majorStringToMinor } from "@/lib/format";
import { archiveData } from "@/lib/soft-delete";
import { getTodayInrPerEur } from "@/lib/fx";
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
  // Pricing a programme here writes the `Product` row the invoice pickers and the products
  // board read, so Payments is as stale as the catalogue screens after any level edit.
  revalidatePath("/payments");
  revalidateTag(LEVELS_CACHE_TAG); // bust the cross-request level cache immediately
}

/** Which section's activity log this level edit is filed under - the one that can make it. */
const sectionForKind = (kind: string): SectionKey =>
  lineForKind(kind) === "GERMAN_NOTE" ? "german-note" : "programs";

const PRODUCT_INTERVALS = ["ONE_TIME", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

/**
 * ── WHAT A PROGRAMME COSTS, SET WHERE THE PROGRAMME IS CREATED ──────────────────────
 *
 * A price was only ever settable from Payments → Products, a screen about invoicing, so the
 * catalogue could be complete and entirely unpriced - which is what live was: nine levels, zero
 * products. Nothing downstream could quote a course, and the invoice editor's programme picker
 * (fed from `Product`) had nothing to offer at all.
 *
 * The price still LIVES on the `Product` row whose `levelCode` names this level. That is not a
 * detour: it is the row invoice lines, subscriptions and the paid-invoice → Income posting all
 * read, and `Product.levelCode` is UNIQUE, so there is exactly one price per programme however
 * it was typed. Writing a second copy onto `Level` would create two prices and no tie-breaker.
 *
 * ABSENT ≠ BLANK, as everywhere else in this file. A form that never rendered the price fields
 * leaves the product untouched; a founder who clears them is clearing the price, and that is
 * stored as zero rather than quietly ignored. An archived product is REVIVED rather than
 * duplicated - the unique index would refuse the duplicate, and "add a price" must not fail
 * because somebody once archived this programme's product.
 */
async function syncLevelPrice(
  levelCode: string,
  label: string,
  active: boolean,
  priced: { priceInr?: string; priceEur?: string; priceInterval?: string } | null,
): Promise<void> {
  const existing = await prisma.product.findUnique({ where: { levelCode } });

  // The price fields were not on the form. Keep the NAME in step - a renamed programme must not
  // keep selling under its old name on invoices - and leave the money alone.
  if (!priced) {
    if (existing && existing.name !== label) {
      await prisma.product.update({ where: { id: existing.id }, data: { name: label } });
    }
    return;
  }

  const inrMinor = priced.priceInr?.trim() ? majorStringToMinor(priced.priceInr) : 0n;
  const eurMinor = priced.priceEur?.trim() ? majorStringToMinor(priced.priceEur) : 0n;
  const interval = (PRODUCT_INTERVALS as readonly string[]).includes(priced.priceInterval ?? "")
    ? (priced.priceInterval as ProductInterval)
    : "ONE_TIME";

  // Nothing typed and nothing stored: an unpriced programme is a legitimate state (it is still
  // offerable - see `getInvoicePickers`), so do not create a ₹0 product to represent it.
  if (!existing && inrMinor === 0n && eurMinor === 0n) return;

  const fx = await getTodayInrPerEur();
  const data = {
    name: label,
    priceInrMinor: inrMinor,
    priceEurMinor: eurMinor,
    fxRateUsed: fx.rate,
    interval,
    // A deactivated level stops being sellable; it does not lose what it cost.
    active,
  };

  if (existing) {
    // Reviving an archived row is what PRICING it means - a priced programme that stayed
    // archived would be invisible to invoicing, and the unique index refuses a second row. But
    // only a real amount revives it: clearing the boxes must not resurrect what somebody retired.
    const revive = inrMinor > 0n || eurMinor > 0n;
    await prisma.product.update({
      where: { id: existing.id },
      data: { ...data, ...(revive ? { deletedAt: null, deletedById: null } : {}) },
    });
    return;
  }
  await prisma.product.create({ data: { ...data, levelCode } });
}

/** Price fields, as submitted by the catalogue panel. Absent = the form did not render them. */
function pricedFrom(form: FormData, d: { priceInr?: string; priceEur?: string; priceInterval?: string }) {
  // Either box may be ABSENT because `AmountPair` disables the mirrored one, so presence of
  // either key means "this form is setting the price".
  return form.has("priceInr") || form.has("priceEur")
    ? { priceInr: d.priceInr, priceEur: d.priceEur, priceInterval: d.priceInterval }
    : null;
}

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
  /** What it sells for - see `syncLevelPrice`. Major units, as typed; blank clears. */
  priceInr: z.string().trim().optional(),
  priceEur: z.string().trim().optional(),
  priceInterval: z.enum(PRODUCT_INTERVALS).optional(),
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
  // The price, on the same submit. A course created without one is still created.
  await syncLevelPrice(level.code, level.label, level.active, pricedFrom(form, d));
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
  // Locked rows (the coaching tiers) are priced like any other: `locked` freezes what a level
  // IS, never what it sells for - "Elite costs ₹X" is exactly the edit the founders need.
  await syncLevelPrice(after.code, after.label, after.active, pricedFrom(form, d));
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
  /**
   * A retired course must stop being offered AT ITS PRICE too. The product keeps the figure -
   * reactivating the level puts it straight back on the invoice picker - but a deactivated
   * programme that stayed sellable from Payments is the kind of gap that gets somebody invoiced
   * for a course that is no longer running.
   */
  await prisma.product.updateMany({ where: { levelCode: level.code }, data: { active } });
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
  // Its price goes with it - archived, not deleted, because a subscription may still point at
  // the product and an archived row stays resolvable (that is what `deleteProduct` does too).
  await prisma.product.updateMany({
    where: { levelCode: level.code, deletedAt: null },
    data: archiveData(session.user.id),
  });
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
