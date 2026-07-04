"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { majorStringToMinor } from "@/lib/format";
import type { ActionResult } from "./finance-actions";

/** Cash Health (PRD3 §4) - Admin-only. */

const moneyInput = z.string().trim().regex(/^\d{0,12}(\.\d{0,2})?$/, "Enter a plain amount");

const cashSchema = z.object({
  date: z.string().min(10),
  bankBalance: moneyInput,
  personalSavings: moneyInput.optional().or(z.literal("")),
  notes: z.string().trim().optional(),
});

export async function saveCashPosition(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = cashSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!d.bankBalance) return { ok: false, error: "Bank balance is required" };

  const date = parseDateInput(d.date);
  await prisma.cashPosition.upsert({
    where: { date },
    update: {
      bankBalanceInrMinor: majorStringToMinor(d.bankBalance),
      personalSavingsInrMinor: d.personalSavings?.trim() ? majorStringToMinor(d.personalSavings) : null,
      notes: d.notes || null,
    },
    create: {
      date,
      bankBalanceInrMinor: majorStringToMinor(d.bankBalance),
      personalSavingsInrMinor: d.personalSavings?.trim() ? majorStringToMinor(d.personalSavings) : null,
      notes: d.notes || null,
    },
  });
  revalidatePath("/cash");
  revalidatePath("/", "layout"); // top-bar runway badge
  return { ok: true };
}

const payableSchema = z.object({
  name: z.string().trim().min(1, "Payable name is required"),
  category: z.enum([
    "MARKETING", "TOOLS_SOFTWARE", "TEAM_SALARIES", "CONTENT_CREATION",
    "EVENTS_OFFLINE", "OPERATIONS", "COGS_DIRECT_DELIVERY", "OTHER",
  ]),
  amountInr: moneyInput,
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"]),
  nextDueDate: z.string().optional(),
  isCogs: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
});

export async function savePayable(id: string | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = payableSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!d.amountInr) return { ok: false, error: "Amount is required" };

  const data = {
    name: d.name,
    category: d.category,
    amountInrMinor: majorStringToMinor(d.amountInr),
    frequency: d.frequency,
    nextDueDate: d.nextDueDate?.trim() ? parseDateInput(d.nextDueDate) : null,
    isCogs: d.isCogs === "on",
    status: d.status,
  };
  if (id) await prisma.payable.update({ where: { id }, data });
  else await prisma.payable.create({ data });
  revalidatePath("/cash");
  return { ok: true };
}

export async function deletePayable(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.payable.delete({ where: { id } });
  revalidatePath("/cash");
  return { ok: true };
}

/** Admin override for the revenue growth-rate assumption in "months to ₹8L" (PRD3 §4.4). */
export async function setGrowthOverride(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const raw = String(form.get("growthPct") ?? "").trim();
  if (raw === "") {
    await prisma.appSetting.deleteMany({ where: { key: "runwayGrowthRatePct" } });
  } else {
    const v = parseFloat(raw);
    if (Number.isNaN(v) || v < -50 || v > 200) return { ok: false, error: "Growth % must be between -50 and 200" };
    await prisma.appSetting.upsert({
      where: { key: "runwayGrowthRatePct" },
      update: { value: v },
      create: { key: "runwayGrowthRatePct", value: v },
    });
  }
  revalidatePath("/cash");
  return { ok: true };
}
