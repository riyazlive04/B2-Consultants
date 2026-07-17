"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Payable } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { formatDate, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { logActivity, diffFields } from "./activity-log";
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
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = cashSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!d.bankBalance) return { ok: false, error: "Bank balance is required" };

  const date = parseDateInput(d.date);
  const row = await prisma.cashPosition.upsert({
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

  await logActivity(session, {
    action: "cash.position.record",
    section: "cash",
    entityType: "CashPosition",
    entityId: row.id,
    summary: `Recorded the cash position for ${formatDate(row.date)} — bank ${formatInrMinor(row.bankBalanceInrMinor)}`,
    meta: {
      bankBalanceInrMinor: row.bankBalanceInrMinor.toString(),
      personalSavingsInrMinor: row.personalSavingsInrMinor?.toString() ?? null,
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

/** Amount as a string: diffFields JSON-compares, and BigInt has no JSON representation. */
function payableDiffShape(row: Payable) {
  return {
    name: row.name,
    category: row.category as string,
    amountInrMinor: row.amountInrMinor.toString(),
    frequency: row.frequency as string,
    nextDueDate: row.nextDueDate,
    isCogs: row.isCogs,
    status: row.status as string,
  };
}

export async function savePayable(id: string | null, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
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
  const existing = id ? await prisma.payable.findUnique({ where: { id } }) : null;
  const row = id ? await prisma.payable.update({ where: { id }, data }) : await prisma.payable.create({ data });

  if (existing) {
    const diff = diffFields(payableDiffShape(existing), payableDiffShape(row));
    if (diff.changed.length) {
      await logActivity(session, {
        action: "cash.payable.update",
        section: "cash",
        entityType: "Payable",
        entityId: row.id,
        summary: `Edited the payable "${row.name}" — ${formatInrMinor(row.amountInrMinor)} ${row.frequency.toLowerCase().replace(/_/g, " ")}`,
        meta: diff,
      });
    }
  } else if (!id) {
    await logActivity(session, {
      action: "cash.payable.create",
      section: "cash",
      entityType: "Payable",
      entityId: row.id,
      summary: `Added the payable "${row.name}" — ${formatInrMinor(row.amountInrMinor)} ${row.frequency.toLowerCase().replace(/_/g, " ")}`,
      meta: {
        amountInrMinor: row.amountInrMinor.toString(),
        category: row.category,
        frequency: row.frequency,
        status: row.status,
      },
    });
  }

  revalidatePath("/cash");
  return { ok: true };
}

export async function deletePayable(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.payable.delete({ where: { id } });

  await logActivity(session, {
    action: "cash.payable.delete",
    section: "cash",
    entityType: "Payable",
    entityId: row.id,
    summary: `Deleted the payable "${row.name}" — ${formatInrMinor(row.amountInrMinor)} ${row.frequency.toLowerCase().replace(/_/g, " ")}`,
    meta: { amountInrMinor: row.amountInrMinor.toString(), category: row.category },
  });

  revalidatePath("/cash");
  return { ok: true };
}

/** Admin override for the revenue growth-rate assumption in "months to ₹8L" (PRD3 §4.4). */
export async function setGrowthOverride(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const raw = String(form.get("growthPct") ?? "").trim();
  let summary: string | null = null;
  if (raw === "") {
    // deleteMany on an absent key succeeds silently — only log an override that was really there.
    const { count } = await prisma.appSetting.deleteMany({ where: { key: "runwayGrowthRatePct" } });
    if (count) summary = "Cleared the revenue growth-rate override — runway is back on the measured rate";
  } else {
    const v = parseFloat(raw);
    if (Number.isNaN(v) || v < -50 || v > 200) return { ok: false, error: "Growth % must be between -50 and 200" };
    await prisma.appSetting.upsert({
      where: { key: "runwayGrowthRatePct" },
      update: { value: v },
      create: { key: "runwayGrowthRatePct", value: v },
    });
    summary = `Set the revenue growth-rate assumption to ${v}% for the runway forecast`;
  }

  if (summary) {
    await logActivity(session, {
      action: "cash.growthOverride.update",
      section: "cash",
      entityType: "AppSetting",
      entityId: "runwayGrowthRatePct",
      summary,
      meta: { growthPct: raw === "" ? null : parseFloat(raw) },
    });
  }

  revalidatePath("/cash");
  return { ok: true };
}
