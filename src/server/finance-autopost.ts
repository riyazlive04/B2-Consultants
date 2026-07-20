import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { postEntry, voidEntryForSource } from "./ledger";
import { expenseEntryDraft } from "./finance-posting";

/**
 * Auto-post money movements into Finance, DYNAMICALLY (user request).
 *
 * NOT a "use server" module on purpose: these are internal server-only helpers, called by the
 * payout/payment actions AFTER they've authenticated. If they lived in a `"use server"` file every
 * export would become a public RPC endpoint, and since they trust their args a client could then
 * forge expense/income rows. Here they're plain functions the client can never reach.
 *
 * The linked entry tracks its source across create / edit / status-change / delete, so the two can
 * never fork. Linked by (source, externalRef) — no schema change, idempotent re-runs. Both are
 * best-effort: a hiccup must never undo the payout/payment write that triggered it.
 */

const PAYOUT_EXPENSE_REF = (payoutId: string) => `payout:${payoutId}`;
const PAYMENT_INCOME_REF = (paymentId: string) => `payment:${paymentId}`;

export type PayoutForSync = {
  id: string;
  month: Date;
  bonusInrMinor: bigint;
  bonusEurMinor: bigint;
  commInrMinor: bigint;
  commEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
  status: "PENDING" | "PAID";
  vendorName: string;
};

/**
 * Keep a TEAM_SALARIES Expense in lock-step with a telecaller payout. Pass the payout to upsert the
 * expense (only while the payout is PAID), or `null` to remove it (payout deleted or marked unpaid).
 * Payouts carry no ledger entry of their own, so this posts one (Dr expense / Cr cash) exactly like
 * a hand-keyed expense.
 */
export async function syncPayoutExpense(
  actorId: string,
  payout: PayoutForSync | null,
  payoutId: string,
): Promise<void> {
  const ref = PAYOUT_EXPENSE_REF(payoutId);
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findUnique({
        where: { source_externalRef: { source: "MANUAL", externalRef: ref } },
      });
      const shouldExist = payout != null && payout.status === "PAID";

      if (!shouldExist) {
        if (existing) {
          await voidEntryForSource(tx, "EXPENSE", existing.id, {
            reason: "telecaller payout no longer paid", actorId, on: istToday(),
          });
          await tx.expense.delete({ where: { id: existing.id } });
        }
        return;
      }

      const data = {
        date: payout.month,
        amountInrMinor: payout.bonusInrMinor + payout.commInrMinor,
        amountEurMinor: payout.bonusEurMinor + payout.commEurMinor,
        fxRateUsed: payout.fxRateUsed,
        category: "TEAM_SALARIES" as const,
        isCogs: false,
        vendor: payout.vendorName,
        notes: "Auto-posted from a telecaller payout",
      };
      if (existing) {
        const updated = await tx.expense.update({ where: { id: existing.id }, data });
        await voidEntryForSource(tx, "EXPENSE", existing.id, {
          reason: "telecaller payout edited", actorId, on: istToday(),
        });
        await postEntry(tx, expenseEntryDraft(updated));
      } else {
        const created = await tx.expense.create({
          data: { ...data, source: "MANUAL", externalRef: ref },
        });
        await postEntry(tx, expenseEntryDraft(created));
      }
    });
  } catch {
    // best-effort: the payout write already succeeded and must not be undone by an accounting hiccup
  }
}

/** Map an invoice payment's free-text method onto the Income PaymentMethod enum. */
function paymentMethodEnum(method: string): PaymentMethod {
  const m = method.toLowerCase();
  if (m.includes("upi")) return "UPI";
  if (m.includes("cash")) return "CASH";
  if (m.includes("razor")) return "RAZORPAY";
  if (m.includes("paypal")) return "PAYPAL";
  if (m.includes("card") || m.includes("stripe")) return "CREDIT_CARD";
  if (m.includes("eur")) return "BANK_TRANSFER_EUR";
  if (m.includes("bank")) return "BANK_TRANSFER_INR";
  return "OTHER";
}

export type PaymentForSync = {
  id: string;
  amountInrMinor: bigint;
  fxRateUsed: Prisma.Decimal;
  studentName: string;
  method: string;
  paidOn: Date;
};

/**
 * Mirror an invoice payment into an Income row (revenue + LTV). Pass the payment to upsert, or
 * `null` to remove it. Table-only by design — the payment already carries its Dr Cash / Cr AR
 * ledger entry, so posting the Income to the ledger too would double the cash.
 */
export async function syncPaymentIncome(
  payment: PaymentForSync | null,
  paymentId: string,
): Promise<void> {
  const ref = PAYMENT_INCOME_REF(paymentId);
  try {
    const existing = await prisma.income.findUnique({
      where: { source_externalRef: { source: "MANUAL", externalRef: ref } },
    });
    if (!payment) {
      if (existing) await prisma.income.delete({ where: { id: existing.id } });
      return;
    }
    const data = {
      date: payment.paidOn,
      studentName: payment.studentName,
      amountInrMinor: payment.amountInrMinor,
      amountEurMinor: BigInt(0),
      fxRateUsed: payment.fxRateUsed,
      programLevel: "OTHER" as const,
      paymentType: "FULL_PAYMENT" as const,
      paymentMethod: paymentMethodEnum(payment.method),
      notes: "Auto-posted from an invoice payment",
    };
    if (existing) {
      await prisma.income.update({ where: { id: existing.id }, data });
    } else {
      await prisma.income.create({ data: { ...data, source: "MANUAL", externalRef: ref } });
    }
  } catch {
    // best-effort — never fail the payment write over an income-mirror hiccup
  }
}
