"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Expense, Income, PendingPayment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { formatDate, formatEurMinor, formatInrMinor, majorStringToMinor } from "@/lib/format";
import { istToday, parseDateInput } from "@/lib/dates";
import { blankToUndefined, intInRange, optionalRule, rule } from "@/lib/field-rules";
import { appendAudit, LedgerError, postEntry, restatedDate, voidEntryForSource } from "./ledger";
import { expenseEntryDraft, incomeEntryDraft } from "./finance-posting";
import { isKnownLevel, levelIncomeAccounts } from "./levels";
import { logActivity, diffFields } from "./activity-log";
import { ACTIVE, archiveData, restoreData } from "@/lib/soft-delete";

/** Finance is Admin-only in every direction (PRD1 §4.1). All actions re-check. */

/**
 * Every write here moves money, so every write posts to the ledger in the SAME transaction
 * as the row it records (SPEC §10.1: "the dashboards read the ledger"). If the posting
 * fails - an unbalanced draft, a locked period - the Income/Expense row rolls back with it.
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

/** Shared with the browser via lib/field-rules - an empty box means "no amount in this currency",
 *  which requireSomeAmount() below turns into the real "enter at least one" error. */
const moneyInput = optionalRule("money");

const incomeSchema = z.object({
  date: z.string().min(10),
  studentName: rule("name"),
  amountInr: moneyInput,
  amountEur: moneyInput,
  // Any level code - validated against the live Level catalogue in the action (isKnownLevel).
  programLevel: z.string().trim().min(1, "Pick a program level"),
  paymentType: z.enum(["FULL_PAYMENT", "INSTALMENT"]),
  paymentMethod: z.enum([
    "BANK_TRANSFER_INR", "BANK_TRANSFER_EUR", "PAYPAL", "RAZORPAY", "CASH", "UPI", "CREDIT_CARD", "OTHER",
  ]),
  // Instalment plan - the count is required the moment INSTALMENT is picked (enforced in
  // instalmentFields below, where paymentType is known); the extra surcharge may be zero.
  instalmentCount: blankToUndefined(intInRange(2, 36, "Number of instalments must be")),
  instalmentExtraInr: moneyInput,
  instalmentExtraEur: moneyInput,
  /** The remaining due dates, as JSON from InstalmentSchedule. See parseSchedule below. */
  instalmentSchedule: z.string().optional(),
  studentId: z.string().optional(), // optional link → student LTV (CONTEXT §7)
  notes: optionalRule("text"),
});

/** One agreed future payment: when it is due and how much of the fee it covers. */
type ScheduledInstalment = { dueDate: Date; inrMinor: bigint; eurMinor: bigint };

/**
 * The due dates typed on the income form, validated into rows we can bill against.
 *
 * Arrives as ONE JSON field rather than repeated inputs, because this action parses with
 * `Object.fromEntries(form)` - which keeps only the last value of a repeated name, so three
 * `dueDate` inputs would silently arrive as one date.
 *
 * Empty rows are dropped rather than rejected: the form always shows at least one row, so a
 * founder recording a payment against a plan that already exists submits a blank one every time.
 * A row with SOME of its answers is a different thing - a half-filled date or a date with no
 * money against it is a slip, and saying so beats billing a student for zero.
 */
function parseSchedule(
  raw: string | undefined,
  incomeDate: Date,
): { error: string } | { schedule: ScheduledInstalment[] } {
  if (!raw?.trim()) return { schedule: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "The instalment schedule could not be read - re-enter the due dates" };
  }
  if (!Array.isArray(parsed)) return { error: "The instalment schedule could not be read - re-enter the due dates" };

  const schedule: ScheduledInstalment[] = [];
  const seen = new Set<number>();
  for (const entry of parsed) {
    const row = entry as { dueDate?: unknown; amountInr?: unknown; amountEur?: unknown };
    const dueDate = typeof row.dueDate === "string" ? row.dueDate.trim() : "";
    const inr = typeof row.amountInr === "string" ? row.amountInr.trim() : "";
    const eur = typeof row.amountEur === "string" ? row.amountEur.trim() : "";
    if (!dueDate && !inr && !eur) continue; // an untouched row
    if (!dueDate) return { error: "Every instalment needs a due date" };
    if (!inr && !eur) return { error: `Enter how much is due on ${dueDate} in INR, EUR, or both` };

    const due = parseDateInput(dueDate);
    if (Number.isNaN(due.getTime())) return { error: `${dueDate} is not a date we can read` };
    // A "next due date" that has already been and gone is a typo, not a plan. The income's own
    // date is the floor rather than today, so back-dating a payment still works.
    if (due.getTime() <= incomeDate.getTime()) {
      return { error: `Instalment dates must be after the payment date - ${formatDate(due)} is not` };
    }
    if (seen.has(due.getTime())) return { error: `There are two instalments due on ${formatDate(due)}` };
    seen.add(due.getTime());

    schedule.push({
      dueDate: due,
      inrMinor: inr ? majorStringToMinor(inr) : BigInt(0),
      eurMinor: eur ? majorStringToMinor(eur) : BigInt(0),
    });
  }
  schedule.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return { schedule };
}

/**
 * The instalment answers only mean something for an INSTALMENT entry - switching a row back to
 * full payment clears them rather than leaving a stale "3 instalments" on a full payment.
 * Returns the error string instead of throwing so the caller can hand it to the form.
 */
function instalmentFields(d: z.infer<typeof incomeSchema>):
  | { error: string }
  | { instalmentCount: number | null; instalmentExtraInrMinor: bigint; instalmentExtraEurMinor: bigint } {
  if (d.paymentType !== "INSTALMENT") {
    return { instalmentCount: null, instalmentExtraInrMinor: BigInt(0), instalmentExtraEurMinor: BigInt(0) };
  }
  if (!d.instalmentCount) return { error: "Enter how many instalments the fee is split into" };
  return {
    instalmentCount: Number(d.instalmentCount),
    instalmentExtraInrMinor: d.instalmentExtraInr?.trim() ? majorStringToMinor(d.instalmentExtraInr) : BigInt(0),
    instalmentExtraEurMinor: d.instalmentExtraEur?.trim() ? majorStringToMinor(d.instalmentExtraEur) : BigInt(0),
  };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

function requireSomeAmount(inr?: string, eur?: string): string | null {
  if (!inr?.trim() && !eur?.trim()) return "Enter an amount in INR, EUR, or both";
  return null;
}

/** A row may carry INR, EUR, or both - the feed reads back exactly what was entered. */
function amountDisplay(inrMinor: bigint, eurMinor: bigint): string {
  const parts: string[] = [];
  if (inrMinor > BigInt(0)) parts.push(formatInrMinor(inrMinor));
  if (eurMinor > BigInt(0)) parts.push(formatEurMinor(eurMinor));
  return parts.length ? parts.join(" + ") : formatInrMinor(BigInt(0));
}

/** Diff shape for money rows: amounts as strings, because diffFields JSON-compares and
 *  BigInt has no JSON representation - a raw minor amount would throw on the way in. */
function incomeDiffShape(row: Income) {
  return {
    date: row.date,
    studentName: row.studentName,
    amountInrMinor: row.amountInrMinor.toString(),
    amountEurMinor: row.amountEurMinor.toString(),
    programLevel: row.programLevel as string,
    paymentType: row.paymentType as string,
    paymentMethod: row.paymentMethod as string,
    instalmentCount: row.instalmentCount,
    instalmentExtraInrMinor: row.instalmentExtraInrMinor.toString(),
    instalmentExtraEurMinor: row.instalmentExtraEurMinor.toString(),
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
  const instalment = instalmentFields(d);
  if ("error" in instalment) return { ok: false, error: instalment.error };
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists - pick another." };

  const incomeDate = parseDateInput(d.date);
  // Only an INSTALMENT entry carries a schedule; switching back to full payment discards any
  // dates left in the form rather than billing for a plan the founder just cancelled.
  const parsedSchedule = parseSchedule(
    d.paymentType === "INSTALMENT" ? d.instalmentSchedule : undefined,
    incomeDate,
  );
  if ("error" in parsedSchedule) return { ok: false, error: parsedSchedule.error };
  const schedule = parsedSchedule.schedule;

  /**
   * The count and the dates have to describe the same plan. This payment is instalment 1, so a
   * 4-instalment plan needs 3 dates after it. Caught here because the alternative is a receivable
   * that quietly bills for two instalments while the income row says four - and the figure nobody
   * checks is the one that says the student owes nothing more.
   */
  if (schedule.length > 0 && "instalmentCount" in instalment && instalment.instalmentCount) {
    const expected = instalment.instalmentCount - 1;
    if (schedule.length !== expected) {
      return {
        ok: false,
        error:
          `A ${instalment.instalmentCount}-instalment plan needs ${expected} more due date${expected === 1 ? "" : "s"} after this payment - there ${schedule.length === 1 ? "is 1" : `are ${schedule.length}`}.`,
      };
    }
  }

  /**
   * A student has ONE live receivable per level, so a second schedule for the same pair would
   * double the money we think is owed. Refused before anything is written, rather than saved and
   * quietly ignored: the income is still in the form, so clearing the dates and submitting again
   * records the payment against the plan that already exists.
   */
  if (schedule.length > 0) {
    const existing = await prisma.pendingPayment.findFirst({
      where: {
        ...ACTIVE,
        status: { in: ["ACTIVE", "OVERDUE"] },
        programLevel: d.programLevel,
        ...(d.studentId ? { studentId: d.studentId } : { studentName: d.studentName }),
      },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error:
          `${d.studentName} already has an instalment plan for this level. Clear the due dates to record just this payment, and edit the plan under Pending payments.`,
      };
    }
  }

  const fx = await getTodayInrPerEur();
  const incomeAccounts = await levelIncomeAccounts();
  let created: Income | null = null;
  const result = await withLedgerErrors(async () => {
    await prisma.$transaction(async (tx) => {
      const income = await tx.income.create({
        data: {
          date: incomeDate,
          studentName: d.studentName,
          amountInrMinor: d.amountInr?.trim() ? majorStringToMinor(d.amountInr) : BigInt(0),
          amountEurMinor: d.amountEur?.trim() ? majorStringToMinor(d.amountEur) : BigInt(0),
          fxRateUsed: fx.rate,
          programLevel: d.programLevel,
          paymentType: d.paymentType,
          paymentMethod: d.paymentMethod,
          ...instalment,
          studentId: d.studentId || null,
          notes: d.notes || null,
          enteredById: session.user.id,
        },
      });

      /**
       * The agreed plan becomes a real receivable, in the same transaction as the payment that
       * started it - so a schedule can never exist without the income that agreed it, or the
       * other way round.
       *
       * TOTAL FEE IS THE WHOLE FEE, not just what is left. `getPendingRows` computes the balance
       * as `toCollect - everything this student has paid`, so a total covering only the future
       * instalments would have this very payment subtracted from it and understate the debt by
       * exactly one instalment. Total = received now + everything still scheduled, and the balance
       * then falls by itself as each instalment is recorded as income.
       *
       * `planExtra` stays ZERO. It is the Console's per-plan-length surcharge, added ON TOP of the
       * fee, and the amounts typed here are what the student was actually asked to pay - already
       * inclusive. Charging the surcharge again would bill it twice. The income row keeps its own
       * `instalmentExtra` fields as the record of what the plan cost.
       *
       * `intervalDays` stays null too: these dates were chosen one at a time, so "every 30 days"
       * would describe a rhythm this plan does not have.
       */
      if (schedule.length > 0) {
        const scheduledInr = schedule.reduce((a, s) => a + s.inrMinor, BigInt(0));
        const scheduledEur = schedule.reduce((a, s) => a + s.eurMinor, BigInt(0));
        const plan = await tx.pendingPayment.create({
          data: {
            studentName: d.studentName,
            studentId: d.studentId || null,
            programLevel: d.programLevel,
            totalFeeInrMinor: income.amountInrMinor + scheduledInr,
            totalFeeEurMinor: income.amountEurMinor + scheduledEur,
            fxRateUsed: fx.rate,
            nextDueDate: schedule[0].dueDate,
            numEmis: schedule.length + 1,
            status: "ACTIVE",
          },
        });
        await tx.instalment.createMany({
          data: [
            // Seq 1 is the payment being recorded right now, stored PAID. The schedule then reads
            // as the whole plan rather than only its unpaid tail, which is what makes "1 of 4
            // paid" answerable from the row itself.
            {
              pendingPaymentId: plan.id,
              seq: 1,
              amountInrMinor: income.amountInrMinor,
              amountEurMinor: income.amountEurMinor,
              fxRateUsed: fx.rate,
              dueDate: incomeDate,
              paidDate: incomeDate,
              status: "PAID" as const,
            },
            ...schedule.map((s, i) => ({
              pendingPaymentId: plan.id,
              seq: i + 2,
              amountInrMinor: s.inrMinor,
              amountEurMinor: s.eurMinor,
              fxRateUsed: fx.rate,
              dueDate: s.dueDate,
              status: "DUE" as const,
            })),
          ],
        });
      }

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
        instalmentCount: row.instalmentCount,
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
  const instalment = instalmentFields(d);
  if ("error" in instalment) return { ok: false, error: instalment.error };
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists - pick another." };

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
          ...instalment,
          studentId: d.studentId || null,
          notes: d.notes || null,
          manualOverride: existing.source !== "MANUAL" ? true : existing.manualOverride,
        },
      });

      // Void before posting: the ledger permits only one live entry per source row.
      const voided = await voidEntryForSource(tx, "INCOME", id, {
        reason: "income edited",
        actorId: session.user.id,
        on: istToday(),
      });
      // `restatedDate` keeps both halves of the correction in one period - normally the record's
      // own date, but today's if the original sat in a month that has since been locked.
      const draft = incomeEntryDraft(income, incomeAccounts);
      const entryId = await postEntry(tx, { ...draft, date: restatedDate(voided, draft.date) });
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "income.update",
        entityType: "Income",
        entityId: id,
        payload: { reversalId: voided?.reversalId ?? null, entryId, studentName: income.studentName },
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
      const voided = await voidEntryForSource(tx, "INCOME", id, {
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
        payload: { reversalId: voided?.reversalId ?? null },
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

/** Permanent delete - only from the Archived tab. The ledger entry was voided at archive. */
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
  // Which business the cost belongs to (§1.4). Optional so an older form post - or any
  // caller that predates the field - still validates and simply falls back to SHARED.
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

      const voided = await voidEntryForSource(tx, "EXPENSE", id, {
        reason: "expense edited",
        actorId: session.user.id,
        on: istToday(),
      });
      const draft = expenseEntryDraft(expense);
      const entryId = await postEntry(tx, { ...draft, date: restatedDate(voided, draft.date) });
      await appendAudit(tx, {
        actorId: session.user.id,
        action: "expense.update",
        entityType: "Expense",
        entityId: id,
        payload: { reversalId: voided?.reversalId ?? null, entryId, vendor: expense.vendor },
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
      const voided = await voidEntryForSource(tx, "EXPENSE", id, {
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
        payload: { reversalId: voided?.reversalId ?? null },
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

/** Permanent delete - only from the Archived tab. Ledger entry already voided at archive. */
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
  // Any level code - validated against the live Level catalogue in the action (isKnownLevel).
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
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists - pick another." };

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
  if (!(await isKnownLevel(d.programLevel))) return { ok: false, error: "That program level no longer exists - pick another." };

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

/** Permanent delete - only from the Archived tab. Cascades the EMI instalment schedule. */
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
