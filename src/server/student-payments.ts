import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { aggInrMinor } from "@/lib/money";
import { istToday } from "@/lib/dates";
import { studentIdForUser } from "@/server/student-lookup";

/**
 * A student's OWN payment plan and receipts (rebuild spec §10), for the signed-in student portal.
 *
 * WHY THIS EXISTS ALONGSIDE `student-portal.ts` RATHER THAN INSIDE IT. That module states a
 * deliberate privacy rule — "NO money (fees, payments, LTV), NO internal notes, NO manual signal"
 * — and that rule is still right for everything it covers. What changed is a founder ruling that
 * §10's narrower case is different in kind: a student seeing THEIR OWN instalments, balance and
 * receipts is not the same as a student seeing what the business made from them.
 *
 * So the line moves, precisely, and the distinction stays visible in the code:
 *
 *   still hidden   LTV, margin, commissions, what anyone else paid, internal notes, G/A/R signal
 *   now shown      their own instalment schedule, what they have paid, what is outstanding,
 *                  their next due date, and the receipts behind those payments
 *
 * Every query is scoped through `Student.userId` — the session's own id — so there is no id for a
 * caller to tamper with.
 *
 * Amounts are returned in INR minor units at each record's own stored rate (`aggInrMinor`), which
 * is how the rest of the app totals money; nothing is re-converted at today's rate.
 */

export type StudentInstalment = {
  readonly seq: number;
  readonly amountInrMinor: number;
  readonly dueDate: string;
  readonly paidDate: string | null;
  readonly status: string;
  readonly overdue: boolean;
};

export type StudentReceipt = {
  readonly id: string;
  readonly date: string;
  readonly amountInrMinor: number;
};

export type StudentPaymentPlan = {
  readonly programLevel: string;
  readonly totalFeeInrMinor: number;
  readonly paidInrMinor: number;
  readonly outstandingInrMinor: number;
  readonly nextDueDate: string | null;
  readonly nextDueAmountInrMinor: number | null;
  readonly instalments: StudentInstalment[];
};

export type StudentPayments = {
  readonly plans: StudentPaymentPlan[];
  readonly receipts: StudentReceipt[];
  readonly hasAny: boolean;
};

const EMPTY: StudentPayments = { plans: [], receipts: [], hasAny: false };

export const getMyPayments = cache(async (userId: string): Promise<StudentPayments> => {
  const studentId = await studentIdForUser(userId);
  if (!studentId) return EMPTY;

  const [plans, incomes] = await Promise.all([
    prisma.pendingPayment.findMany({
      where: { ...ACTIVE, studentId },
      select: {
        programLevel: true,
        totalFeeInrMinor: true,
        totalFeeEurMinor: true,
        fxRateUsed: true,
        nextDueDate: true,
        instalments: {
          orderBy: { seq: "asc" },
          select: {
            seq: true,
            amountInrMinor: true,
            amountEurMinor: true,
            fxRateUsed: true,
            dueDate: true,
            paidDate: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Receipts: money actually received FROM this student. Nothing about margin or what the
    // business kept — just "you paid this, on this date".
    prisma.income.findMany({
      where: { ...ACTIVE, studentId },
      select: { id: true, date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      orderBy: { date: "desc" },
    }),
  ]);

  // Compared against `@db.Date` columns, so today must be the IST business day as a day boundary,
  // not a raw UTC instant — else an instalment flips overdue during the 00:00–05:30 IST window.
  const todayKey = istToday().toISOString().slice(0, 10);

  const mapped: StudentPaymentPlan[] = plans.map((p) => {
    const instalments: StudentInstalment[] = p.instalments.map((i) => {
      const dueKey = i.dueDate.toISOString().slice(0, 10);
      return {
        seq: i.seq,
        amountInrMinor: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
        dueDate: dueKey,
        paidDate: i.paidDate?.toISOString().slice(0, 10) ?? null,
        status: String(i.status),
        overdue: String(i.status) !== "PAID" && dueKey < todayKey,
      };
    });

    const total = Number(aggInrMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed));
    const paid = instalments.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amountInrMinor, 0);
    // The next thing they owe — the earliest unpaid instalment, which is more use than the
    // plan-level `nextDueDate` because it carries the amount too.
    const nextUnpaid = instalments.find((i) => i.status !== "PAID");

    return {
      programLevel: p.programLevel,
      totalFeeInrMinor: total,
      paidInrMinor: paid,
      // Never show a negative balance: an overpayment is a conversation, not a credit line.
      outstandingInrMinor: Math.max(0, total - paid),
      nextDueDate: nextUnpaid?.dueDate ?? p.nextDueDate?.toISOString().slice(0, 10) ?? null,
      nextDueAmountInrMinor: nextUnpaid?.amountInrMinor ?? null,
      instalments,
    };
  });

  const receipts: StudentReceipt[] = incomes.map((i) => ({
    id: i.id,
    date: i.date.toISOString().slice(0, 10),
    amountInrMinor: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
  }));

  return { plans: mapped, receipts, hasAny: mapped.length > 0 || receipts.length > 0 };
});
