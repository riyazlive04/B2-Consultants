import type { Prisma } from "@prisma/client";

/**
 * KEEPING A RECEIVABLE AND ITS SCHEDULE IN AGREEMENT.
 *
 * ── The invariant ─────────────────────────────────────────────────────────────────
 * A plan's headline figure and its instalment rows are two statements about the same debt, and
 * exactly one of them is editable at a time: the schedule. So the headline is DERIVED - whatever
 * the rows now say, minus the surcharge that was snapshotted on top of the fee - and never typed
 * twice. `toCollect = totalFee + planExtra` is read all over Finance (lib/payment-allocation,
 * getPendingRows, the dunning ladder), which is why the fee has to carry the sum MINUS the
 * surcharge rather than the sum itself.
 *
 * ── Why this is its own module ────────────────────────────────────────────────────
 * Two places restate a plan and they must do it identically: editing an instalment row
 * (`emi-actions.updateInstalment`) and editing the income that AGREED the plan
 * (`finance-actions.updateIncome`, via `PendingPayment.startedByIncomeId`). The second did not
 * exist at all until now - correcting the amount received left the plan's total and its
 * instalment 1 holding the figure typed first, so the schedule and the balance disagreed for
 * good, and the ladder chased the difference. Two copies of this arithmetic would eventually
 * disagree about which of them was right.
 *
 * No "use server": these are helpers called INSIDE a transaction, not endpoints.
 */

/** Anything that can run a query: the client or, as every caller here passes, a transaction. */
type Tx = Prisma.TransactionClient;

/**
 * Re-derive a plan's agreed fee and next due date from its instalment rows.
 *
 * Clamped at zero per currency: a plan whose instalments come to less than its own surcharge is
 * a data-entry mistake, and a negative agreed fee would read as a credit note.
 *
 * `nextDueDate` is the earliest row that is not PAID, or null when every one of them is - which
 * is what "nothing further is due" looks like to the badge, the digest and the ladder.
 */
export async function restatePlanFromInstalments(tx: Tx, planId: string): Promise<void> {
  const [plan, rows] = await Promise.all([
    tx.pendingPayment.findUnique({
      where: { id: planId },
      select: { planExtraInrMinor: true, planExtraEurMinor: true },
    }),
    tx.instalment.findMany({
      where: { pendingPaymentId: planId },
      select: { amountInrMinor: true, amountEurMinor: true, dueDate: true, status: true },
    }),
  ]);
  if (!plan || rows.length === 0) return;

  const sumInr = rows.reduce((a, r) => a + r.amountInrMinor, BigInt(0));
  const sumEur = rows.reduce((a, r) => a + r.amountEurMinor, BigInt(0));
  const feeInr = sumInr - plan.planExtraInrMinor;
  const feeEur = sumEur - plan.planExtraEurMinor;
  const nextDue = rows
    .filter((r) => r.status !== "PAID")
    .map((r) => r.dueDate)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  await tx.pendingPayment.update({
    where: { id: planId },
    data: {
      totalFeeInrMinor: feeInr > BigInt(0) ? feeInr : BigInt(0),
      totalFeeEurMinor: feeEur > BigInt(0) ? feeEur : BigInt(0),
      nextDueDate: nextDue ?? null,
    },
  });
}

/**
 * The income that agreed a plan has been corrected - carry the correction onto the plan.
 *
 * Instalment 1 IS that payment (it is written PAID at the same moment the plan is created, so
 * the schedule reads as the whole plan rather than only its unpaid tail). It therefore has to
 * follow the income's amount and date, and the headline has to follow the rows.
 *
 * `paid` is false when the income has been ARCHIVED: the money it stood for is withdrawn, so the
 * first instalment goes back to being owed. Left PAID, the plan would show a payment that no
 * longer exists anywhere else in the app, and the balance - computed from live income rows -
 * would rise while the schedule insisted it had been settled.
 *
 * Deliberately touches ONLY instalment 1. The rest of the schedule is the operator's, editable
 * row by row on the Pending tab, and rebuilding it from an edit to the first payment would throw
 * away dates and amounts somebody had since corrected by hand.
 */
export async function restatePlanForStarterIncome(
  tx: Tx,
  planId: string,
  income: { date: Date; amountInrMinor: bigint; amountEurMinor: bigint },
  paid: boolean,
): Promise<void> {
  const first = await tx.instalment.findFirst({
    where: { pendingPaymentId: planId },
    orderBy: { seq: "asc" },
    select: { id: true },
  });
  if (first) {
    await tx.instalment.update({
      where: { id: first.id },
      data: {
        amountInrMinor: income.amountInrMinor,
        amountEurMinor: income.amountEurMinor,
        dueDate: income.date,
        ...(paid
          ? { status: "PAID" as const, paidDate: income.date }
          : // DUE rather than OVERDUE: the nightly sweep decides that, by its own rule, and
            // guessing here would make an archived receipt look like a missed payment.
            { status: "DUE" as const, paidDate: null }),
      },
    });
  }
  await restatePlanFromInstalments(tx, planId);
}
