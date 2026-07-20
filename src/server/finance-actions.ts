"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Expense, Income, PendingPayment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { formatDate, formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { istToday, parseDateInput } from "@/lib/dates";
import { optionalRule, rule } from "@/lib/field-rules";
import { appendAudit, LedgerError, postEntry, voidEntryForSource } from "./ledger";
import { expenseEntryDraft, incomeEntryDraft } from "./finance-posting";
import { isKnownLevel, levelIncomeAccounts } from "./levels";
import { logActivity, diffFields } from "./activity-log";
import { archiveData, restoreData } from "@/lib/soft-delete";

/** Finance is Admin-only in every direction (PRD1 §4.1). All actions re-check. */

/**
 * Every write here moves money, so every write posts to the ledger in the SAME transaction
 * as the row it records (SPEC §10.1: "the dashboards read the ledger"). If the posting
 * fails — an unbalanced draft, a locked period — the Income/Expense row rolls back with it.
 * A finance row that exists without its journal entry is the one state this app must never
 * reach, because from then on the numbers on screen stop tracing to anything.
 *
 * The ledger is append-only, so an EDIT is "void the old entry, post the restated one" and
 * a DELETE is "void the entry, keep it". History is never rewritten, only superseded.
 */

/** Turn the engine's refusals into something the founder can read, above the form they're on. */
async function withLedgerErrors(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    if (err instanceof LedgerError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Shared with the browser via lib/field-rules — an empty box means "no amount in this currency",
 *  which requireSomeAmount() below turns into the real "enter at least one" error. */
const moneyInput = optionalRule("money");

const incomeSchema = z.object({
  date: z.string().min(10),
  studentName: rule("name"),
  amountInr: moneyInput,
  amountEur: moneyInput,
  // Any level code — validated against the live Level catalogue in the action (isKnownLevel).
  programLevel: z.string().trim().min(1, "Pick a program level"),
  paymentType: z.enum(["FULL_PAYMENT", "INSTALMENT"]),
  paymentMethod: z.enum([
    "BANK_TRANSFER_INR", "BANK_TRANSFER_EUR", "PAYPAL", "RAZORPAY", "CASH", "UPI", "CREDIT_CARD", "OTHER",
  ]),
  studentId: z.string().optional(), // optional link → student LTV (CONTEXT §7)
  notes: optionalRule("text"),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

function requireSomeAmount(inr?: string, eur?: string): string | null {
  if (!inr?.trim() && !eur?.trim()) return "Enter an amount in INR, EUR, or both";
  return null;
}

/** A row may carry INR, EUR, or both — the feed reads back exactly what was entered. */
function amountDisplay(inrMinor: bigint, eurMinor: bigint): string {
  const parts: string[] = [];
  if (inrMinor > BigInt(0)) parts.push(formatInrMinor(inrMinor));
  if (eurMinor > BigInt(0)) parts.push(formatEurMinor(eurMinor));
  return parts.length ? parts.join(" + ") : formatInrMinor(BigInt(0));
}

/** Diff shape for money rows: amounts as strings, because diffFields JSON-compares and
 *  BigInt has no JSON representation — a raw minor amount would throw on the way in. */
function incomeDiffShape(row: Income) {
  return {
    date: row.date,
    studentName: row.studentName,
    amountInrMinor: row.amountInrMinor.toString(),
    amountEurMinor: row.amountEurMinor.toString(),
    programLevel: row.programLevel as string,
    paymentType: row.paymentType as string,
    paymentMethod: row.paymentMethod as string,
    studentId: row.studentId,
    notes: row.notes,
  };
}

function expenseDiffShape(row: Expense) {
  return {
    date: row.date,
    amountInrMinor: row.amountInrMinor.toString(),
    amountEurMinor: row.amountEurMinor.toString(),
    category: row.category as string,
    isCogs: row.isCogs,
    vendor: row.vendor,
    notes: row.notes,
  };
}

function pendingDiffShape(row: PendingPayment) {
  return {
    studentName: row.studentName,
    programLevel: row.programLevel as string,
    totalFeeInrMinor: row.totalFeeInrMinor.toString(),
    totalFeeEurMinor: row.totalFeeEurMinor.toString(),
    nextDueDate: row.nextDueDate,
    status: row.status as string,
    notes: row.notes,
  };
}

export async function createIncome(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = incomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists — pick another." };

  const fx = await getTodayInrPerEur();
  const incomeAccounts = await levelIncomeAccounts();
  let created: Income | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const income = await tx.income.create({
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
      const entryId = await postEntry(tx, incomeEntryDraft(income, incomeAccounts));
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "income.create",
        entityType: "Income",
        entityId: income.id,
        payload: { entryId, studentName: income.studentName, programLevel: income.programLevel },
      });
      created = income;
    });
  });
  if (!result.ok) return result;

  if (created) {
    const row: Income = created;
    await logActivity(session, {
      action: "finance.income.create",
      section: "finance",
      entityType: "Income",
      entityId: row.id,
      summary: `Recorded income of ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} from ${row.studentName} (${row.programLevel})`,
      meta: {
        amountInrMinor: row.amountInrMinor.toString(),
        amountEurMinor: row.amountEurMinor.toString(),
        programLevel: row.programLevel,
        paymentType: row.paymentType,
        paymentMethod: row.paymentMethod,
      },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/students");
  revalidatePath("/ledger");
  return { ok: true };
}

export async function updateIncome(id: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = incomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists — pick another." };

  const existing = await prisma.income.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Record not found" };

  const incomeAccounts = await levelIncomeAccounts();
  let updated: Income | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const income = await tx.income.update({
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

      // Void before posting: the ledger permits only one live entry per source row.
      const reversalId = await voidEntryForSource(tx, "INCOME", id, {
        reason: "income edited",
        actorId: session.user.id,
        on: istToday(),
      });
      const entryId = await postEntry(tx, incomeEntryDraft(income, incomeAccounts));
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "income.update",
        entityType: "Income",
        entityId: id,
        payload: { reversalId, entryId, studentName: income.studentName },
      });
      updated = income;
    });
  });
  if (!result.ok) return result;

  if (updated) {
    const row: Income = updated;
    const diff = diffFields(incomeDiffShape(existing), incomeDiffShape(row));
    if (diff.changed.length) {
      await logActivity(session, {
        action: "finance.income.update",
        section: "finance",
        entityType: "Income",
        entityId: row.id,
        summary: `Edited the ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} income from ${row.studentName}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/finance");
  revalidatePath("/students");
  revalidatePath("/ledger");
  return { ok: true };
}

/**
 * Delete = ARCHIVE (soft delete). The row moves to the Archived tab and can be restored.
 * We void the live ledger entry in the same transaction so /finance and /ledger both stop
 * counting it while archived; the reversal (append-only history) and the row itself stay.
 */
export async function deleteIncome(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  let removed: Income | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const reversalId = await voidEntryForSource(tx, "INCOME", id, {
        reason: "income archived",
        actorId: session.user.id,
        on: istToday(),
      });
      const income = await tx.income.update({ where: { id }, data: archiveData(session.user.id) });
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "income.archive",
        entityType: "Income",
        entityId: id,
        payload: { reversalId },
      });
      removed = income;
    });
  });
  if (!result.ok) return result;

  if (removed) {
    const row: Income = removed;
    await logActivity(session, {
      action: "finance.income.archive",
      section: "finance",
      entityType: "Income",
      entityId: row.id,
      summary: `Archived the ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} income from ${row.studentName} dated ${formatDate(row.date)}`,
      meta: {
        amountInrMinor: row.amountInrMinor.toString(),
        amountEurMinor: row.amountEurMinor.toString(),
        programLevel: row.programLevel,
      },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/students");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Restore an archived income and re-post the ledger entry that archiving voided. */
export async function restoreIncome(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.income.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Record not found" };
  if (!existing.deletedAt) return { ok: false, error: "This income is not archived" };

  const incomeAccounts = await levelIncomeAccounts();
  let restored: Income | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const income = await tx.income.update({ where: { id }, data: restoreData });
      const entryId = await postEntry(tx, incomeEntryDraft(income, incomeAccounts));
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "income.restore",
        entityType: "Income",
        entityId: id,
        payload: { entryId },
      });
      restored = income;
    });
  });
  if (!result.ok) return result;

  if (restored) {
    const row: Income = restored;
    await logActivity(session, {
      action: "finance.income.restore",
      section: "finance",
      entityType: "Income",
      entityId: row.id,
      summary: `Restored the ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} income from ${row.studentName}`,
    });
  }

  revalidatePath("/finance");
  revalidatePath("/students");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. The ledger entry was voided at archive. */
export async function purgeIncome(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.income.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Record not found" };
  if (!existing.deletedAt) return { ok: false, error: "Archive it first" };
  const row = await prisma.income.delete({ where: { id } });
  await logActivity(session, {
    action: "finance.income.purge",
    section: "finance",
    entityType: "Income",
    entityId: row.id,
    summary: `Permanently deleted the archived income from ${row.studentName}`,
    meta: { hard: true },
  });
  revalidatePath("/finance");
  revalidatePath("/students");
  revalidatePath("/ledger");
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
  // Which business the cost belongs to (§1.4). Optional so an older form post — or any
  // caller that predates the field — still validates and simply falls back to SHARED.
  businessLine: z.enum(["B2", "GERMAN_NOTE", "SHARED"]).optional(),
  // Free text, NOT rule("name"): a vendor is a company, and "3M"/"Zoho One" are real ones.
  vendor: rule("text").pipe(z.string().min(1, "Paid to (vendor) is required")),
  notes: optionalRule("text"),
});

export async function createExpense(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = expenseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };

  const fx = await getTodayInrPerEur();
  let created: Expense | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          date: parseDateInput(d.date),
          amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
          amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
          fxRateUsed: fx.rate,
          category: d.category,
          isCogs: d.isCogs === "on" || d.category === "COGS_DIRECT_DELIVERY",
          businessLine: d.businessLine ?? "SHARED",
          vendor: d.vendor,
          notes: d.notes || null,
          enteredById: session.user.id,
        },
      });
      const entryId = await postEntry(tx, expenseEntryDraft(expense));
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "expense.create",
        entityType: "Expense",
        entityId: expense.id,
        payload: { entryId, vendor: expense.vendor, category: expense.category, isCogs: expense.isCogs },
      });
      created = expense;
    });
  });
  if (!result.ok) return result;

  if (created) {
    const row: Expense = created;
    await logActivity(session, {
      action: "finance.expense.create",
      section: "finance",
      entityType: "Expense",
      entityId: row.id,
      summary: `Recorded an expense of ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} paid to ${row.vendor} (${row.category})`,
      meta: {
        amountInrMinor: row.amountInrMinor.toString(),
        amountEurMinor: row.amountEurMinor.toString(),
        category: row.category,
        isCogs: row.isCogs,
      },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

export async function updateExpense(id: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = expenseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.amountInr, d.amountEur);
  if (amountError) return { ok: false, error: amountError };

  const existing = await prisma.expense.findUnique({ where: { id } });
  let updated: Expense | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id },
        data: {
          date: parseDateInput(d.date),
          amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
          amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
          category: d.category,
          isCogs: d.isCogs === "on" || d.category === "COGS_DIRECT_DELIVERY",
          businessLine: d.businessLine ?? "SHARED",
          vendor: d.vendor,
          notes: d.notes || null,
        },
      });

      const reversalId = await voidEntryForSource(tx, "EXPENSE", id, {
        reason: "expense edited",
        actorId: session.user.id,
        on: istToday(),
      });
      const entryId = await postEntry(tx, expenseEntryDraft(expense));
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "expense.update",
        entityType: "Expense",
        entityId: id,
        payload: { reversalId, entryId, vendor: expense.vendor },
      });
      updated = expense;
    });
  });
  if (!result.ok) return result;

  if (existing && updated) {
    const row: Expense = updated;
    const diff = diffFields(expenseDiffShape(existing), expenseDiffShape(row));
    if (diff.changed.length) {
      await logActivity(session, {
        action: "finance.expense.update",
        section: "finance",
        entityType: "Expense",
        entityId: row.id,
        summary: `Edited the ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} expense paid to ${row.vendor}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Delete = ARCHIVE. Voids the ledger entry (kept as reversal) and soft-deletes the row. */
export async function deleteExpense(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;

  let removed: Expense | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const reversalId = await voidEntryForSource(tx, "EXPENSE", id, {
        reason: "expense archived",
        actorId: session.user.id,
        on: istToday(),
      });
      const expense = await tx.expense.update({ where: { id }, data: archiveData(session.user.id) });
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "expense.archive",
        entityType: "Expense",
        entityId: id,
        payload: { reversalId },
      });
      removed = expense;
    });
  });
  if (!result.ok) return result;

  if (removed) {
    const row: Expense = removed;
    await logActivity(session, {
      action: "finance.expense.archive",
      section: "finance",
      entityType: "Expense",
      entityId: row.id,
      summary: `Archived the ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} expense paid to ${row.vendor} dated ${formatDate(row.date)}`,
      meta: {
        amountInrMinor: row.amountInrMinor.toString(),
        amountEurMinor: row.amountEurMinor.toString(),
        category: row.category,
      },
    });
  }

  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Restore an archived expense and re-post its voided ledger entry. */
export async function restoreExpense(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.expense.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Record not found" };
  if (!existing.deletedAt) return { ok: false, error: "This expense is not archived" };

  let restored: Expense | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({ where: { id }, data: restoreData });
      const entryId = await postEntry(tx, expenseEntryDraft(expense));
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "expense.restore",
        entityType: "Expense",
        entityId: id,
        payload: { entryId },
      });
      restored = expense;
    });
  });
  if (!result.ok) return result;

  if (restored) {
    const row: Expense = restored;
    await logActivity(session, {
      action: "finance.expense.restore",
      section: "finance",
      entityType: "Expense",
      entityId: row.id,
      summary: `Restored the ${amountDisplay(row.amountInrMinor, row.amountEurMinor)} expense paid to ${row.vendor}`,
    });
  }

  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. Ledger entry already voided at archive. */
export async function purgeExpense(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.expense.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Record not found" };
  if (!existing.deletedAt) return { ok: false, error: "Archive it first" };
  const row = await prisma.expense.delete({ where: { id } });
  await logActivity(session, {
    action: "finance.expense.purge",
    section: "finance",
    entityType: "Expense",
    entityId: row.id,
    summary: `Permanently deleted the archived expense paid to ${row.vendor}`,
    meta: { hard: true },
  });
  revalidatePath("/finance");
  revalidatePath("/ledger");
  return { ok: true };
}

const pendingSchema = z.object({
  studentName: rule("name"),
  // Any level code — validated against the live Level catalogue in the action (isKnownLevel).
  programLevel: z.string().trim().min(1, "Pick a program level"),
  totalFeeInr: moneyInput,
  totalFeeEur: moneyInput,
  nextDueDate: z.string().optional(),
  status: z.enum(["ACTIVE", "PAID_IN_FULL", "OVERDUE", "DROPPED"]),
  notes: optionalRule("text"),
});

export async function createPendingPayment(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = pendingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.totalFeeInr, d.totalFeeEur);
  if (amountError) return { ok: false, error: "Enter the total fee in INR, EUR, or both" };
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists — pick another." };

  const fx = await getTodayInrPerEur();
  const row = await prisma.pendingPayment.create({
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

  await logActivity(session, {
    action: "finance.pendingPayment.create",
    section: "finance",
    entityType: "PendingPayment",
    entityId: row.id,
    summary: `Added a receivable of ${amountDisplay(row.totalFeeInrMinor, row.totalFeeEurMinor)} for ${row.studentName} (${row.programLevel})`,
    meta: {
      totalFeeInrMinor: row.totalFeeInrMinor.toString(),
      totalFeeEurMinor: row.totalFeeEurMinor.toString(),
      programLevel: row.programLevel,
      status: row.status,
    },
  });

  revalidatePath("/finance");
  return { ok: true };
}

export async function updatePendingPayment(id: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const parsed = pendingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const amountError = requireSomeAmount(d.totalFeeInr, d.totalFeeEur);
  if (amountError) return { ok: false, error: "Enter the total fee in INR, EUR, or both" };
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists — pick another." };

  const existing = await prisma.pendingPayment.findUnique({ where: { id } });
  const row = await prisma.pendingPayment.update({
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

  if (existing) {
    const diff = diffFields(pendingDiffShape(existing), pendingDiffShape(row));
    if (diff.changed.length) {
      await logActivity(session, {
        action: "finance.pendingPayment.update",
        section: "finance",
        entityType: "PendingPayment",
        entityId: row.id,
        summary: `Edited ${row.studentName}'s receivable of ${amountDisplay(row.totalFeeInrMinor, row.totalFeeEurMinor)}`,
        meta: diff,
      });
    }
  }

  revalidatePath("/finance");
  return { ok: true };
}

/** Delete = ARCHIVE. Instalments ride along (kept) and reappear if it's restored. */
export async function deletePendingPayment(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const row = await prisma.pendingPayment.update({ where: { id }, data: archiveData(session.user.id) });

  await logActivity(session, {
    action: "finance.pendingPayment.archive",
    section: "finance",
    entityType: "PendingPayment",
    entityId: row.id,
    summary: `Archived ${row.studentName}'s receivable of ${amountDisplay(row.totalFeeInrMinor, row.totalFeeEurMinor)}`,
    meta: {
      totalFeeInrMinor: row.totalFeeInrMinor.toString(),
      totalFeeEurMinor: row.totalFeeEurMinor.toString(),
      programLevel: row.programLevel,
    },
  });

  revalidatePath("/finance");
  return { ok: true };
}

/** Restore an archived receivable back to active. */
export async function restorePendingPayment(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.pendingPayment.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Record not found" };
  if (!existing.deletedAt) return { ok: false, error: "This receivable is not archived" };
  const row = await prisma.pendingPayment.update({ where: { id }, data: restoreData });

  await logActivity(session, {
    action: "finance.pendingPayment.restore",
    section: "finance",
    entityType: "PendingPayment",
    entityId: row.id,
    summary: `Restored ${row.studentName}'s receivable of ${amountDisplay(row.totalFeeInrMinor, row.totalFeeEurMinor)}`,
  });

  revalidatePath("/finance");
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. Cascades the EMI instalment schedule. */
export async function purgePendingPayment(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("finance.write");
  if (!allowed) return denied;
  const existing = await prisma.pendingPayment.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!existing) return { ok: false, error: "Record not found" };
  if (!existing.deletedAt) return { ok: false, error: "Archive it first" };
  const row = await prisma.pendingPayment.delete({ where: { id } });

  await logActivity(session, {
    action: "finance.pendingPayment.purge",
    section: "finance",
    entityType: "PendingPayment",
    entityId: row.id,
    summary: `Permanently deleted ${row.studentName}'s archived receivable`,
    meta: { hard: true },
  });

  revalidatePath("/finance");
  return { ok: true };
}
