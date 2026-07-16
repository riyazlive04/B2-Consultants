"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import type { ActionResult } from "./finance-actions";

/**
 * Structured EMI schedule (spec Module G). Turns a PendingPayment (the single-figure
 * receivable) into per-instalment rows: 1 level = 2 EMIs, 3 levels = 6, each with its
 * own amount / due date / paid date / status. Finance-only (Admin). Money is BigInt
 * paise/cents; the split is exact — the last instalment absorbs the rounding remainder.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const generateSchema = z.object({
  count: z.coerce.number().int().min(1, "At least one instalment").max(24),
  firstDueDate: z.string().min(10, "First due date is required"),
  intervalDays: z.coerce.number().int().min(1).max(180).optional(),
});

export async function generateInstalmentPlan(pendingPaymentId: string, form: FormData): Promise<ActionResult> {
  await requireSection("finance");
  const parsed = generateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { count, firstDueDate } = parsed.data;
  const intervalDays = parsed.data.intervalDays ?? 30;

  const pp = await prisma.pendingPayment.findUnique({
    where: { id: pendingPaymentId },
    select: {
      id: true,
      totalFeeInrMinor: true,
      totalFeeEurMinor: true,
      fxRateUsed: true,
      instalments: { select: { id: true }, take: 1 },
    },
  });
  if (!pp) return { ok: false, error: "Receivable not found" };
  if (pp.instalments.length) return { ok: false, error: "A schedule already exists — clear it before regenerating" };

  const n = BigInt(count);
  const baseInr = pp.totalFeeInrMinor / n;
  const baseEur = pp.totalFeeEurMinor / n;
  const remInr = pp.totalFeeInrMinor - baseInr * n; // remainder onto the last instalment
  const remEur = pp.totalFeeEurMinor - baseEur * n;
  const start = parseDateInput(firstDueDate);

  const rows = Array.from({ length: count }, (_, i) => {
    const due = new Date(start);
    due.setUTCDate(start.getUTCDate() + i * intervalDays);
    const last = i === count - 1;
    return {
      pendingPaymentId,
      seq: i + 1,
      amountInrMinor: baseInr + (last ? remInr : 0n),
      amountEurMinor: baseEur + (last ? remEur : 0n),
      fxRateUsed: pp.fxRateUsed,
      dueDate: due,
    };
  });

  await prisma.$transaction([
    prisma.instalment.createMany({ data: rows }),
    // Keep the receivable's headline "next due" in step with instalment #1.
    prisma.pendingPayment.update({ where: { id: pendingPaymentId }, data: { nextDueDate: start } }),
  ]);
  revalidatePath("/finance");
  return { ok: true };
}

const statusSchema = z.enum(["DUE", "PAID", "OVERDUE"]);

export async function setInstalmentStatus(id: string, status: string): Promise<ActionResult> {
  await requireSection("finance");
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Invalid status" };

  const inst = await prisma.instalment.findUnique({
    where: { id },
    select: { pendingPaymentId: true },
  });
  if (!inst) return { ok: false, error: "Instalment not found" };

  await prisma.instalment.update({
    where: { id },
    data: { status: parsed.data, paidDate: parsed.data === "PAID" ? new Date() : null },
  });

  // Advance the receivable's headline next-due to the earliest still-unpaid instalment.
  const nextDue = await prisma.instalment.findFirst({
    where: { pendingPaymentId: inst.pendingPaymentId, status: { not: "PAID" } },
    orderBy: { dueDate: "asc" },
    select: { dueDate: true },
  });
  await prisma.pendingPayment.update({
    where: { id: inst.pendingPaymentId },
    data: { nextDueDate: nextDue?.dueDate ?? null },
  });

  revalidatePath("/finance");
  return { ok: true };
}

export async function clearInstalmentPlan(pendingPaymentId: string): Promise<ActionResult> {
  await requireSection("finance");
  await prisma.instalment.deleteMany({ where: { pendingPaymentId } });
  revalidatePath("/finance");
  return { ok: true };
}
