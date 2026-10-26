import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { aggInrMinor } from "@/lib/money";
import { istToday } from "@/lib/dates";
import { allocatePayments } from "@/lib/payment-allocation";
import type { Prisma } from "@prisma/client";
import { studentIdForUser } from "@/server/student-lookup";

/**
 * A student's OWN payment plan and receipts (rebuild spec §10), for the signed-in student portal.
 *
 * WHY THIS EXISTS ALONGSIDE `student-portal.ts` RATHER THAN INSIDE IT. That module states a
 * deliberate privacy rule - "NO money (fees, payments, LTV), NO internal notes, NO manual signal"
 * - and that rule is still right for everything it covers. What changed is a founder ruling that
 * §10's narrower case is different in kind: a student seeing THEIR OWN instalments, balance and
 * receipts is not the same as a student seeing what the business made from them.
 *
 * So the line moves, precisely, and the distinction stays visible in the code:
 *
 *   still hidden   LTV, margin, commissions, what anyone else paid, internal notes, G/A/R signal
 *   now shown      their own instalment schedule, what they have paid, what is outstanding,
 *                  their next due date, and the receipts behind those payments
 *
 * Every query is scoped through `Student.userId` - the session's own id - so there is no id for a
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
  /** The agreed programme fee on its own. */
  readonly totalFeeInrMinor: number;
  /** The surcharge for paying in instalments, zero on a full-payment plan. Shown as its own
   *  line so the student can see WHY the total is more than the fee they were quoted. */
  readonly planExtraInrMinor: number;
  /** fee + surcharge: the figure the instalments add up to, and the one the balance is from. */
  readonly totalToCollectInrMinor: number;
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
      /**
       * DROPPED plans are excluded (FIN/portal issue 17). A student who left the programme
       * was still being shown "Your payment plan" with a live balance and a next due date,
       * which is a bill for something that is no longer happening. PAID_IN_FULL stays: a
       * finished plan with every instalment ticked is a receipt, and worth being able to see.
       */
      where: { ...ACTIVE, studentId, status: { not: "DROPPED" } },
      select: {
        id: true,
        createdAt: true,
        programLevel: true,
        totalFeeInrMinor: true,
        totalFeeEurMinor: true,
        // The instalment surcharge, which THIS READ USED TO OMIT (portal issue 1). It is
        // stored apart from the fee on purpose - "total to collect" is fee + this - and
        // leaving it out understated the student's own balance by the whole surcharge
        // while the instalment rows below, which are split from the real total, included
        // it. The headline therefore disagreed with the list underneath it.
        planExtraInrMinor: true,
        planExtraEurMinor: true,
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
    // business kept - just "you paid this, on this date". `pendingPaymentId` rides along
    // because the same rows are what the allocation below credits to each plan.
    prisma.income.findMany({
      where: { ...ACTIVE, studentId },
      select: {
        id: true,
        date: true,
        amountInrMinor: true,
        amountEurMinor: true,
        fxRateUsed: true,
        pendingPaymentId: true,
      },
      orderBy: { date: "desc" },
    }),
  ]);

  /**
   * How much of this student's money belongs to each plan - the SAME rule Finance uses
   * (`lib/payment-allocation.ts`): a payment that names its plan is credited there, anything
   * left over fills the student's plans oldest-first, and nothing is credited past a plan's
   * own total.
   *
   * This read used to count "paid" as the sum of instalments marked PAID, which was a third
   * definition of paid in an app that had just finished reducing itself to one (portal issue
   * 4). A payment recorded against the student but not yet settled onto an instalment showed
   * in their "Payments received" list and was missing from the "Paid" figure directly above
   * it - the student's own page contradicting itself, and both numbers disagreeing with what
   * the team saw in Finance.
   *
   * Run in ONE currency dimension - the INR equivalent at each row's own stored rate, which
   * is the single figure this page displays. `allocatePayments` is currency-blind and fills
   * ₹ and € independently; handing it both sides here would allocate a euro plan against
   * rupee payments separately and then show their sum, which is not a number that means
   * anything. `eur: 0` keeps the pure function honest about what it was asked.
   */
  const toInr = (inr: bigint, eur: bigint, fx: Prisma.Decimal) => Number(aggInrMinor(inr, eur, fx));
  const allocation = allocatePayments(
    plans.map((p) => ({
      id: p.id,
      toCollect: {
        inr:
          toInr(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed) +
          toInr(p.planExtraInrMinor, p.planExtraEurMinor, p.fxRateUsed),
        eur: 0,
      },
      createdAt: p.createdAt.toISOString(),
    })),
    incomes.map((i) => ({
      pendingPaymentId: i.pendingPaymentId,
      amount: { inr: toInr(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed), eur: 0 },
    })),
  );

  // Compared against `@db.Date` columns, so today must be the IST business day as a day boundary,
  // not a raw UTC instant - else an instalment flips overdue during the 00:00-05:30 IST window.
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

    const fee = toInr(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed);
    const planExtra = toInr(p.planExtraInrMinor, p.planExtraEurMinor, p.fxRateUsed);
    // What actually has to be collected: the agreed fee PLUS the instalment surcharge. This
    // is also the figure the instalments were split from, so the schedule now adds up to the
    // headline instead of overshooting it by the surcharge.
    const total = fee + planExtra;
    const alloc = allocation.byPlan.get(p.id);
    const paid = alloc?.paid.inr ?? 0;
    // The next thing they owe - the earliest unpaid instalment, which is more use than the
    // plan-level `nextDueDate` because it carries the amount too.
    const nextUnpaid = instalments.find((i) => i.status !== "PAID");

    return {
      programLevel: p.programLevel,
      totalFeeInrMinor: fee,
      planExtraInrMinor: planExtra,
      totalToCollectInrMinor: total,
      paidInrMinor: paid,
      // Never show a negative balance: an overpayment is a conversation, not a credit line.
      // `balance` is already clamped by the allocator; the max() is belt-and-braces for the
      // no-allocation case above.
      outstandingInrMinor: Math.max(0, alloc?.balance.inr ?? total - paid),
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
