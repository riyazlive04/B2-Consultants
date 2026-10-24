"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { istToday, parseDateInput } from "@/lib/dates";
import { formatDate, formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { optionalRule } from "@/lib/field-rules";
import { instalmentDueDates, instalmentExtraFor, splitInstalments } from "@/lib/instalment-plan";
import { logActivity, diffFields } from "./activity-log";
import { getInstalmentPlanConfig } from "./founder-config";
import { syncInstalmentIncome } from "./finance-autopost";
import type { ActionResult } from "./finance-actions";
import { restatePlanFromInstalments } from "./plan-restate";

/**
 * Structured EMI schedule (spec Module G). Turns a PendingPayment (the single-figure
 * receivable) into per-instalment rows: 1 level = 2 EMIs, 3 levels = 6, each with its
 * own amount / due date / paid date / status. Finance-only (Admin). Money is BigInt
 * paise/cents; the split is exact - the last instalment absorbs the rounding remainder.
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
  if (pp.instalments.length) return { ok: false, error: "A schedule already exists - clear it before regenerating" };

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
  /**
   * ── A plan has to be for something (issue 8) ──────────────────────────────────
   * A receivable with a fee of 0 generated a schedule anyway, built entirely out of the
   * Console's plan surcharge: six instalments billing the student ₹100 each for the privilege
   * of paying nothing in instalments. The fee is checked rather than the total for exactly that
   * reason - the surcharge is not what is being collected.
   */
  if (pp.totalFeeInrMinor <= BigInt(0) && pp.totalFeeEurMinor <= BigInt(0)) {
    return {
      ok: false,
      error: "This receivable has no fee on it yet. Set the total fee first, then split it into instalments.",
    };
  }
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
    summary: `Generated a ${count}-instalment plan for ${pp.studentName} - ${formatInrMinor(total.inr)}${extraNote} from ${formatDate(start)}, every ${intervalDays} days`,
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
 * What an N-instalment plan would cost and how it would split - read by the EMI modal so the
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
      amountEurMinor: true,
      fxRateUsed: true,
      pendingPayment: {
        select: { studentName: true, studentId: true, programLevel: true },
      },
    },
  });
  if (!inst) return { ok: false, error: "Instalment not found" };

  const paidDate = parsed.data === "PAID" ? istToday() : null;
  await prisma.instalment.update({
    where: { id },
    data: { status: parsed.data, paidDate },
  });

  /**
   * ── Marking an instalment paid now moves the MONEY too ──────────────────────────
   * It used to move only the ladder: the status changed, "next due" advanced, and the balance
   * stayed exactly where it was - because the balance is computed from Income rows and nothing
   * wrote one. The receivable then insisted the student still owed money its own schedule said
   * they had paid.
   *
   * The mirror is keyed on the instalment, so un-marking it voids the entry and removes the row.
   * Best-effort by design (see syncInstalmentIncome): the status the operator just set is never
   * rolled back over a posting hiccup.
   */
  await syncInstalmentIncome(
    session.user.id,
    parsed.data === "PAID"
      ? {
          id,
          amountInrMinor: inst.amountInrMinor,
          amountEurMinor: inst.amountEurMinor,
          fxRateUsed: inst.fxRateUsed,
          paidDate: paidDate ?? istToday(),
          programLevel: inst.pendingPayment.programLevel,
          studentName: inst.pendingPayment.studentName,
          studentId: inst.pendingPayment.studentId,
          pendingPaymentId: inst.pendingPaymentId,
        }
      : null,
    id,
  );

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
  revalidatePath("/cash");
  return { ok: true };
}

const money = optionalRule("money");

const editSchema = z.object({
  amountInr: money,
  amountEur: money,
  dueDate: z.string().min(10, "A due date is required"),
});

/**
 * EDIT ONE UNPAID INSTALMENT - its amount and its due date.
 *
 * ── Why this had to exist ─────────────────────────────────────────────────────────
 * A schedule was effectively immutable. The modal let you change each row's STATUS and nothing
 * else, so the only way to restructure a plan a student had renegotiated - "I can pay ₹5,000 a
 * month, not ₹8,000" - was "Clear schedule" and generate a fresh equal split. That deletes every
 * row INCLUDING the paid ones, which is the plan's payment history, and an equal split is
 * precisely what a renegotiated plan is not. In practice the schedule was therefore left wrong,
 * and the dunning ladder reads the schedule: it chased the old figure on the old date.
 *
 * ── Why only the unpaid ones ──────────────────────────────────────────────────────
 * A PAID instalment has an Income row behind it (seq 1 is the payment that agreed the plan;
 * later ones are mirrored by `syncInstalmentIncome`). Letting its amount be edited here would
 * leave the schedule claiming one figure and the money ledger another, with no trace of which
 * was meant. Paid rows stay frozen; a mistake in one is corrected where the money is - on the
 * income row itself.
 *
 * ── What moves with it ────────────────────────────────────────────────────────────
 * The plan's TOTAL is re-stated so `toCollect` (totalFee + planExtra, which is what the balance
 * is measured from) equals the sum of its instalments. Without that, raising an instalment would
 * change what is chased and not what is owed - two numbers on the same screen disagreeing, which
 * is the bug this whole section keeps producing. The surcharge is left alone: it is a snapshot of
 * what the plan cost, not part of the schedule.
 *
 * `nextDueDate` follows the earliest instalment still unpaid, exactly as marking one paid does.
 */
export async function updateInstalment(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("finance");
  const parsed = editSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const inst = await prisma.instalment.findUnique({
    where: { id },
    select: {
      id: true,
      seq: true,
      status: true,
      dueDate: true,
      amountInrMinor: true,
      amountEurMinor: true,
      pendingPaymentId: true,
      pendingPayment: {
        select: {
          studentName: true,
          planExtraInrMinor: true,
          planExtraEurMinor: true,
        },
      },
    },
  });
  if (!inst) return { ok: false, error: "Instalment not found" };
  if (inst.status === "PAID") {
    return {
      ok: false,
      error:
        "This instalment is already paid - its amount is the payment that was recorded. Mark it unpaid first, or correct the income entry.",
    };
  }

  const amountInrMinor = d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0);
  const amountEurMinor = d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0);
  // An instalment for nothing is not an instalment: it would be chased, reported and reconciled
  // as a real row while asking for no money. Removing it is what "Clear schedule" is for.
  if (amountInrMinor <= BigInt(0) && amountEurMinor <= BigInt(0)) {
    return { ok: false, error: "Enter an amount greater than 0 for this instalment" };
  }
  const dueDate = parseDateInput(d.dueDate);

  await prisma.$transaction(async (tx) => {
    await tx.instalment.update({
      where: { id },
      data: { amountInrMinor, amountEurMinor, dueDate },
    });

    /**
     * The headline follows the rows, through the one rule that editing the income which agreed
     * the plan now goes through as well - see server/plan-restate. Two copies of this arithmetic
     * would eventually disagree about which of them was right.
     */
    await restatePlanFromInstalments(tx, inst.pendingPaymentId);
  });

  const diff = diffFields(
    {
      amountInrMinor: inst.amountInrMinor.toString(),
      amountEurMinor: inst.amountEurMinor.toString(),
      dueDate: inst.dueDate.toISOString().slice(0, 10),
    },
    {
      amountInrMinor: amountInrMinor.toString(),
      amountEurMinor: amountEurMinor.toString(),
      dueDate: dueDate.toISOString().slice(0, 10),
    },
  );
  if (diff.changed.length) {
    const shown = [
      amountInrMinor > BigInt(0) ? formatInrMinor(amountInrMinor) : "",
      amountEurMinor > BigInt(0) ? formatEurMinor(amountEurMinor) : "",
    ]
      .filter(Boolean)
      .join(" + ");
    await logActivity(session, {
      action: "finance.instalment.update",
      section: "finance",
      entityType: "Instalment",
      entityId: id,
      summary: `Changed instalment #${inst.seq} for ${inst.pendingPayment.studentName} to ${shown} due ${formatDate(dueDate)}`,
      meta: { ...diff, seq: inst.seq },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/cash");
  return { ok: true };
}

export async function clearInstalmentPlan(pendingPaymentId: string): Promise<ActionResult> {
  const session = await requireSection("finance");
  const pp = await prisma.pendingPayment.findUnique({
    where: { id: pendingPaymentId },
    select: { studentName: true },
  });
  /**
   * The instalments that were marked paid each left an auto-posted Income row behind them
   * (syncInstalmentIncome). Deleting the schedule without reversing those would strand them:
   * keyed on an instalment id that no longer exists, there would be no way left to undo them,
   * and the plan's collected figure would stay inflated by money whose record had been deleted.
   *
   * Read first, reverse, then delete - so a failure part-way leaves instalments to try again
   * from rather than incomes with nothing pointing at them.
   */
  const paidRows = await prisma.instalment.findMany({
    where: { pendingPaymentId, status: "PAID" },
    select: { id: true },
  });
  for (const row of paidRows) await syncInstalmentIncome(session.user.id, null, row.id);

  const { count } = await prisma.instalment.deleteMany({ where: { pendingPaymentId } });

  // deleteMany reports success on an empty schedule - only log a plan that actually existed.
  if (count && pp) {
    await logActivity(session, {
      action: "finance.instalmentPlan.delete",
      section: "finance",
      entityType: "PendingPayment",
      entityId: pendingPaymentId,
      summary: `Cleared the ${count}-instalment plan for ${pp.studentName}`,
      meta: { count, autoPostedIncomesReversed: paidRows.length },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/cash");
  return { ok: true };
}
