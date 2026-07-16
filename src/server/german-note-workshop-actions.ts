"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { majorStringToMinor } from "@/lib/format";
import { parseDateInput } from "@/lib/dates";
import type { ActionResult } from "./finance-actions";

/**
 * German Note — Workshop management (Admin-only). Workshops, their conversions
 * and their ad-sets. Every guard is re-checked here; hiding a button is never
 * the fence. Mirrors german-note-actions.ts conventions.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const PRODUCTS = ["A1", "A2", "B1", "A1_A2", "A2_B1", "A1_A2_B1"] as const;
const DAY_TYPES = ["WEEKDAY", "WEEKEND"] as const;
const CONV_STATUS = ["CONFIRMED", "ON_HOLD"] as const;
const SOURCES = ["AD", "ORGANIC"] as const;

/** Major-rupee input → paise BigInt; blank → 0. */
function money(v: string | undefined): bigint {
  return majorStringToMinor(v ?? "");
}

/** Optional money override → paise BigInt, or null when blank (use the cost model). */
function moneyOrNull(v: string | undefined): bigint | null {
  return v && v.trim() ? majorStringToMinor(v) : null;
}

/** Non-negative integer from a form field; blank/garbage → 0. */
function count(v: string | undefined): number {
  const n = parseInt((v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const optionalText = z.string().trim().max(2000).optional();

function revalidateWorkshop(workshopId?: string) {
  revalidatePath("/german-note/manage");
  if (workshopId) revalidatePath(`/german-note/workshops/${workshopId}`);
}

// ── Workshops ──────────────────────────────────────────────────

const workshopSchema = z.object({
  name: z.string().trim().min(1, "Workshop name is required").max(120),
  month: z.string().trim().min(7, "Pick the intake month"),
  notes: optionalText,
});

/** "YYYY-MM" (month input) or "YYYY-MM-DD" → first-of-month UTC date. */
function parseMonth(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const d = parseDateInput(`${m[1]}-${m[2]}-01`);
  return isNaN(d.getTime()) ? null : d;
}

export async function createWorkshop(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = workshopSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const month = parseMonth(parsed.data.month);
  if (!month) return { ok: false, error: "Invalid month" };
  await prisma.gnWorkshop.create({
    data: { name: parsed.data.name, month, notes: parsed.data.notes || null },
  });
  revalidateWorkshop();
  return { ok: true };
}

export async function updateWorkshop(workshopId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = workshopSchema
    .extend({ status: z.enum(["ACTIVE", "ARCHIVED"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const month = parseMonth(parsed.data.month);
  if (!month) return { ok: false, error: "Invalid month" };
  await prisma.gnWorkshop.update({
    where: { id: workshopId },
    data: {
      name: parsed.data.name,
      month,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
    },
  });
  revalidateWorkshop(workshopId);
  return { ok: true };
}

/** Hard delete — cascades the workshop's conversions and ad-sets. */
export async function deleteWorkshop(workshopId: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.gnWorkshop.delete({ where: { id: workshopId } });
  revalidateWorkshop();
  return { ok: true };
}

// ── Conversions ────────────────────────────────────────────────

const conversionSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(160),
  email: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  product: z.enum(PRODUCTS, { message: "Pick the level / bundle they bought" }),
  dayType: z.enum(DAY_TYPES).default("WEEKDAY"),
  status: z.enum(CONV_STATUS).default("CONFIRMED"),
  source: z.enum(SOURCES).default("AD"),
  batchA1: z.string().trim().max(40).optional(),
  timeA1: z.string().trim().max(40).optional(),
  batchA2: z.string().trim().max(40).optional(),
  timeA2: z.string().trim().max(40).optional(),
  batchB1: z.string().trim().max(40).optional(),
  timeB1: z.string().trim().max(40).optional(),
  finalPrice: z.string().optional(),
  paidAmount: z.string().optional(),
  paymentMethod: z.string().trim().max(60).optional(),
  nextDueDate: z.string().trim().optional(),
  booksCostOverride: z.string().optional(),
  tutorCostOverride: z.string().optional(),
  referral: z.string().optional(),
  notes: optionalText,
});

function conversionData(form: FormData) {
  const parsed = conversionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false as const, error: firstError(parsed.error) };
  const d = parsed.data;
  const due = d.nextDueDate && /^\d{4}-\d{2}-\d{2}$/.test(d.nextDueDate) ? parseDateInput(d.nextDueDate) : null;
  return {
    ok: true as const,
    data: {
      fullName: d.fullName,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      product: d.product,
      dayType: d.dayType,
      status: d.status,
      source: d.source,
      isFreeSeat: form.get("isFreeSeat") === "on",
      batchA1: d.batchA1 || null,
      timeA1: d.timeA1 || null,
      batchA2: d.batchA2 || null,
      timeA2: d.timeA2 || null,
      batchB1: d.batchB1 || null,
      timeB1: d.timeB1 || null,
      finalPriceInrMinor: money(d.finalPrice),
      paidAmountInrMinor: money(d.paidAmount),
      paymentMethod: d.paymentMethod || null,
      nextDueDate: due,
      booksCostOverrideInrMinor: moneyOrNull(d.booksCostOverride),
      tutorCostOverrideInrMinor: moneyOrNull(d.tutorCostOverride),
      referralInrMinor: money(d.referral),
      notes: d.notes || null,
    },
  };
}

export async function createConversion(workshopId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const workshop = await prisma.gnWorkshop.findUnique({ where: { id: workshopId }, select: { id: true } });
  if (!workshop) return { ok: false, error: "Workshop not found" };
  const res = conversionData(form);
  if (!res.ok) return { ok: false, error: res.error };
  await prisma.gnWorkshopConversion.create({ data: { workshopId, ...res.data } });
  revalidateWorkshop(workshopId);
  return { ok: true };
}

export async function updateConversion(conversionId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.gnWorkshopConversion.findUnique({
    where: { id: conversionId },
    select: { workshopId: true },
  });
  if (!existing) return { ok: false, error: "Conversion not found" };
  const res = conversionData(form);
  if (!res.ok) return { ok: false, error: res.error };
  await prisma.gnWorkshopConversion.update({ where: { id: conversionId }, data: res.data });
  revalidateWorkshop(existing.workshopId);
  return { ok: true };
}

export async function deleteConversion(conversionId: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.gnWorkshopConversion.findUnique({
    where: { id: conversionId },
    select: { workshopId: true },
  });
  if (!existing) return { ok: false, error: "Conversion not found" };
  await prisma.gnWorkshopConversion.delete({ where: { id: conversionId } });
  revalidateWorkshop(existing.workshopId);
  return { ok: true };
}

// ── Ad-sets ────────────────────────────────────────────────────

const adSetSchema = z.object({
  label: z.string().trim().max(60).optional(),
  adSpend: z.string().optional(),
  reach: z.string().optional(),
  linkClicks: z.string().optional(),
  attended: z.string().optional(),
  conversions: z.string().optional(),
});

function adSetData(form: FormData) {
  const parsed = adSetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false as const, error: firstError(parsed.error) };
  const d = parsed.data;
  return {
    ok: true as const,
    data: {
      label: d.label || null,
      adSpendInrMinor: money(d.adSpend),
      reach: count(d.reach),
      linkClicks: count(d.linkClicks),
      attended: count(d.attended),
      conversions: count(d.conversions),
    },
  };
}

export async function createAdSet(workshopId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const workshop = await prisma.gnWorkshop.findUnique({ where: { id: workshopId }, select: { id: true } });
  if (!workshop) return { ok: false, error: "Workshop not found" };
  const res = adSetData(form);
  if (!res.ok) return { ok: false, error: res.error };
  const last = await prisma.gnWorkshopAdSet.findFirst({
    where: { workshopId },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });
  await prisma.gnWorkshopAdSet.create({
    data: { workshopId, orderIndex: (last?.orderIndex ?? -1) + 1, ...res.data },
  });
  revalidateWorkshop(workshopId);
  return { ok: true };
}

export async function updateAdSet(adSetId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.gnWorkshopAdSet.findUnique({
    where: { id: adSetId },
    select: { workshopId: true },
  });
  if (!existing) return { ok: false, error: "Ad-set not found" };
  const res = adSetData(form);
  if (!res.ok) return { ok: false, error: res.error };
  await prisma.gnWorkshopAdSet.update({ where: { id: adSetId }, data: res.data });
  revalidateWorkshop(existing.workshopId);
  return { ok: true };
}

export async function deleteAdSet(adSetId: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.gnWorkshopAdSet.findUnique({
    where: { id: adSetId },
    select: { workshopId: true },
  });
  if (!existing) return { ok: false, error: "Ad-set not found" };
  await prisma.gnWorkshopAdSet.delete({ where: { id: adSetId } });
  revalidateWorkshop(existing.workshopId);
  return { ok: true };
}
