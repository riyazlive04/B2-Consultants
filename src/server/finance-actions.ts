"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";
import { parseDateInput } from "@/lib/dates";

/** Finance is Admin-only in every direction (PRD1 §4.1). All actions re-check. */

const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{0,12}(\.\d{0,2})?$/, "Enter a plain amount like 25000 or 25000.50")
  .optional()
  .or(z.literal(""));

const incomeSchema = z.object({
  date: z.string().min(10),
  studentName: z.string().trim().min(1, "Student name is required"),
  amountInr: moneyInput,
  amountEur: moneyInput,
  programLevel: z.enum([
    "SOLO", "GUIDED", "ELITE", "GN_A1", "GN_A2", "GN_B1", "GN_B2", "GN_BUNDLE", "OTHER",
  ]),
  paymentType: z.enum(["FULL_PAYMENT", "INSTALMENT"]),
  paymentMethod: z.enum([
    "BANK_TRANSFER_INR", "BANK_TRANSFER_EUR", "PAYPAL", "RAZORPAY", "CASH", "UPI", "CREDIT_CARD", "OTHER",
  ]),
  studentId: z.string().optional(), // optional link → student LTV (CONTEXT §7)
  notes: z.string().trim().optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

function requireSomeAmount(inr?: string, eur?: string): string | null {
  if (!inr?.trim() && !eur?.trim()) return "Enter an amount in INR, EUR, or both";
  return null;
}

export async function createIncome(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = incomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };

  const fx = await getTodayInrPerEur();
  await prisma.income.create({
    data: {
      date: parseDateInput(d.date),
      studentName: d.studentName,
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
      fxRateUsed: fx.rate,
      programLevel: d.programLevel,
      paymentType: d.paymentType,
      paymentMethod: d.paymentMethod,
      studentId: d.studentId || null,
      notes: d.notes || null,
      enteredById: session.user.id,
    },
  });
  revalidatePath("/finance");
  revalidatePath("/students");
  return { ok: true };
}

export async function updateIncome(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = incomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };

  const existing = await prisma.income.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Record not found" };

  await prisma.income.update({
    where: { id },
    data: {
      date: parseDateInput(d.date),
      studentName: d.studentName,
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
      // keep the original rate: edits correct typos, they don't re-price history
      programLevel: d.programLevel,
      paymentType: d.paymentType,
      paymentMethod: d.paymentMethod,
      studentId: d.studentId || null,
      notes: d.notes || null,
      manualOverride: existing.source !== "MANUAL" ? true : existing.manualOverride,
    },
  });
  revalidatePath("/finance");
  revalidatePath("/students");
  return { ok: true };
}

export async function deleteIncome(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.income.delete({ where: { id } });
  revalidatePath("/finance");
  return { ok: true };
}

const expenseSchema = z.object({
  date: z.string().min(10),
  amountInr: moneyInput,
  amountEur: moneyInput,
  category: z.enum([
    "MARKETING", "TOOLS_SOFTWARE", "TEAM_SALARIES", "CONTENT_CREATION",
    "EVENTS_OFFLINE", "OPERATIONS", "COGS_DIRECT_DELIVERY", "OTHER",
  ]),
  isCogs: z.string().optional(), // checkbox: "on" | undefined
  vendor: z.string().trim().min(1, "Paid to (vendor) is required"),
  notes: z.string().trim().optional(),
});

export async function createExpense(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = expenseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };

  const fx = await getTodayInrPerEur();
  await prisma.expense.create({
    data: {
      date: parseDateInput(d.date),
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
      fxRateUsed: fx.rate,
      category: d.category,
      isCogs: d.isCogs === "on" || d.category === "COGS_DIRECT_DELIVERY",
      vendor: d.vendor,
      notes: d.notes || null,
      enteredById: session.user.id,
    },
  });
  revalidatePath("/finance");
  return { ok: true };
}

export async function updateExpense(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = expenseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };

  await prisma.expense.update({
    where: { id },
    data: {
      date: parseDateInput(d.date),
      amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
      amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
      category: d.category,
      isCogs: d.isCogs === "on" || d.category === "COGS_DIRECT_DELIVERY",
      vendor: d.vendor,
      notes: d.notes || null,
    },
  });
  revalidatePath("/finance");
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.expense.delete({ where: { id } });
  revalidatePath("/finance");
  return { ok: true };
}

const pendingSchema = z.object({
  studentName: z.string().trim().min(1, "Student name is required"),
  programLevel: z.enum([
    "SOLO", "GUIDED", "ELITE", "GN_A1", "GN_A2", "GN_B1", "GN_B2", "GN_BUNDLE", "OTHER",
  ]),
  totalFeeInr: moneyInput,
  totalFeeEur: moneyInput,
  nextDueDate: z.string().optional(),
  status: z.enum(["ACTIVE", "PAID_IN_FULL", "OVERDUE", "DROPPED"]),
  notes: z.string().trim().optional(),
});

export async function createPendingPayment(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = pendingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.totalFeeInr, d.totalFeeEur);
  if (amountError) return { ok: false, error: "Enter the total fee in INR, EUR, or both" };

  const fx = await getTodayInrPerEur();
  await prisma.pendingPayment.create({
    data: {
      studentName: d.studentName,
      programLevel: d.programLevel,
      totalFeeInrMinor: d.totalFeeInr?.trim() ? majorStringToMinor(d.totalFeeInr) : BigInt(0),
      totalFeeEurMinor: d.totalFeeEur?.trim() ? majorStringToMinor(d.totalFeeEur) : BigInt(0),
      fxRateUsed: fx.rate,
      nextDueDate: d.nextDueDate?.trim() ? parseDateInput(d.nextDueDate) : null,
      status: d.status,
      notes: d.notes || null,
    },
  });
  revalidatePath("/finance");
  return { ok: true };
}

export async function updatePendingPayment(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = pendingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.totalFeeInr, d.totalFeeEur);
  if (amountError) return { ok: false, error: "Enter the total fee in INR, EUR, or both" };

  await prisma.pendingPayment.update({
    where: { id },
    data: {
      studentName: d.studentName,
      programLevel: d.programLevel,
      totalFeeInrMinor: d.totalFeeInr?.trim() ? majorStringToMinor(d.totalFeeInr) : BigInt(0),
      totalFeeEurMinor: d.totalFeeEur?.trim() ? majorStringToMinor(d.totalFeeEur) : BigInt(0),
      nextDueDate: d.nextDueDate?.trim() ? parseDateInput(d.nextDueDate) : null,
      status: d.status,
      notes: d.notes || null,
    },
  });
  revalidatePath("/finance");
  return { ok: true };
}

export async function deletePendingPayment(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.pendingPayment.delete({ where: { id } });
  revalidatePath("/finance");
  return { ok: true };
}
