"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { formatDate, formatInrMinor } from "@/lib/format";
import { instalmentDueDates, instalmentExtraFor, splitInstalments } from "@/lib/instalment-plan";
import { logActivity, diffFields } from "./activity-log";
import { getInstalmentPlanConfig } from "./founder-config";
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
  const session = await requireSection("finance");
  const parsed = generateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { count, firstDueDate } = parsed.data;
  const config = await getInstalmentPlanConfig();
  const intervalDays = parsed.data.intervalDays ?? config.defaultIntervalDays;

  const pp = await prisma.pendingPayment.findUnique({
    where: { id: pendingPaymentId },
    select: {
      id: true,
      studentName: true,
      totalFeeInrMinor: true,
      totalFeeEurMinor: true,
      fxRateUsed: true,
      instalments: { select: { id: true }, take: 1 },
    },
  });
  if (!pp) return { ok: false, error: "Receivable not found" };
  if (pp.instalments.length) return { ok: false, error: "A schedule already exists — clear it before regenerating" };

  /**
   * The surcharge is priced by plan length in the Console and SNAPSHOTTED onto the receivable
   * here. Re-pricing the table later must not move the balance on a plan the student already
   * agreed to, which is only true because the figure is stored rather than re-derived on read.
   */
  const extra = instalmentExtraFor(count, config);
  const total = {
    inr: pp.totalFeeInrMinor + extra.inr,
    eur: pp.totalFeeEurMinor + extra.eur,
  };
  const amounts = splitInstalments(total, count);
  const start = parseDateInput(firstDueDate);
  const dueDates = instalmentDueDates(start, count, intervalDays);

  const rows = amounts.map((amount, i) => ({
    pendingPaymentId,
    seq: i + 1,
    amountInrMinor: amount.inr,
    amountEurMinor: amount.eur,
    fxRateUsed: pp.fxRateUsed,
    dueDate: dueDates[i],
  }));

  await prisma.$transaction([
    prisma.instalment.createMany({ data: rows }),
    prisma.pendingPayment.update({
      where: { id: pendingPaymentId },
      data: {
        // Keep the receivable's headline "next due" in step with instalment #1.
        nextDueDate: start,
        planExtraInrMinor: extra.inr,
        planExtraEurMinor: extra.eur,
        intervalDays,
        numEmis: count,
      },
    }),
  ]);

  const extraNote = extra.inr > BigInt(0) ? ` (incl. ${formatInrMinor(extra.inr)} plan extra)` : "";
  await logActivity(session, {
    action: "finance.instalmentPlan.create",
    section: "finance",
    entityType: "PendingPayment",
    entityId: pendingPaymentId,
    summary: `Generated a ${count}-instalment plan for ${pp.studentName} — ${formatInrMinor(total.inr)}${extraNote} from ${formatDate(start)}, every ${intervalDays} days`,
    meta: {
      count,
      intervalDays,
      firstDueDate: start.toISOString(),
      totalFeeInrMinor: pp.totalFeeInrMinor.toString(),
      planExtraInrMinor: extra.inr.toString(),
      planExtraEurMinor: extra.eur.toString(),
      totalToCollectInrMinor: total.inr.toString(),
    },
  });

  revalidatePath("/finance");
  return { ok: true };
}

/**
 * What an N-instalment plan would cost and how it would split — read by the EMI modal so the
 * founder sees the surcharge and the schedule BEFORE generating. Returns minor units as strings
 * because BigInt does not cross the server/client boundary.
 */
export async function previewInstalmentPlan(count: number): Promise<{
  count: number;
  intervalDays: number;
  extraInrMinor: string;
  extraEurMinor: string;
}> {
  await requireSection("finance");
  const config = await getInstalmentPlanConfig();
  const extra = instalmentExtraFor(count, config);
  return {
    count,
    intervalDays: config.defaultIntervalDays,
    extraInrMinor: extra.inr.toString(),
    extraEurMinor: extra.eur.toString(),
  };
}

const statusSchema = z.enum(["DUE", "PAID", "OVERDUE"]);

export async function setInstalmentStatus(id: string, status: string): Promise<ActionResult> {
  const session = await requireSection("finance");
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Invalid status" };

  const inst = await prisma.instalment.findUnique({
    where: { id },
    select: {
      pendingPaymentId: true,
      seq: true,
      status: true,
      amountInrMinor: true,
      pendingPayment: { select: { studentName: true } },
    },
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

  const diff = diffFields({ status: inst.status as string }, { status: parsed.data as string });
  if (diff.changed.length) {
    await logActivity(session, {
      action: "finance.instalment.update",
      section: "finance",
      entityType: "Instalment",
      entityId: id,
      summary: `Marked instalment #${inst.seq} of ${formatInrMinor(inst.amountInrMinor)} for ${inst.pendingPayment.studentName} as ${parsed.data.toLowerCase()}`,
      meta: { ...diff, seq: inst.seq, amountInrMinor: inst.amountInrMinor.toString() },
    });
  }

  revalidatePath("/finance");
  return { ok: true };
}

export async function clearInstalmentPlan(pendingPaymentId: string): Promise<ActionResult> {
  const session = await requireSection("finance");
  const pp = await prisma.pendingPayment.findUnique({
    where: { id: pendingPaymentId },
    select: { studentName: true },
  });
  const { count } = await prisma.instalment.deleteMany({ where: { pendingPaymentId } });

  // deleteMany reports success on an empty schedule — only log a plan that actually existed.
  if (count && pp) {
    await logActivity(session, {
      action: "finance.instalmentPlan.delete",
      section: "finance",
      entityType: "PendingPayment",
      entityId: pendingPaymentId,
      summary: `Cleared the ${count}-instalment plan for ${pp.studentName}`,
      meta: { count },
    });
  }

  revalidatePath("/finance");
  return { ok: true };
}
