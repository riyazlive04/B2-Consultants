import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { postEntry, restatedDate, voidEntryForSource } from "./ledger";
import { expenseEntryDraft, incomeEntryDraft } from "./finance-posting";
import { levelIncomeAccounts } from "./levels";
import { nameKey } from "@/lib/payment-allocation";

/**
 * Auto-post money movements into Finance, DYNAMICALLY (user request).
 *
 * NOT a "use server" module on purpose: these are internal server-only helpers, called by the
 * payout/payment actions AFTER they've authenticated. If they lived in a `"use server"` file every
 * export would become a public RPC endpoint, and since they trust their args a client could then
 * forge expense/income rows. Here they're plain functions the client can never reach.
 *
 * The linked entry tracks its source across create / edit / status-change / delete, so the two can
 * never fork. Linked by (source, externalRef) - no schema change, idempotent re-runs. Both are
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
        const voided = await voidEntryForSource(tx, "EXPENSE", existing.id, {
          reason: "telecaller payout edited", actorId, on: istToday(),
        });
        const draft = expenseEntryDraft(updated);
        await postEntry(tx, { ...draft, date: restatedDate(voided, draft.date) });
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
  /** The euro side of the same receipt, converted once at `fxRateUsed`. */
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
  studentName: string;
  method: string;
  paidOn: Date;
  /** The invoice's contact, when it had one - the surest link back to a person. */
  leadId?: string | null;
  /** The programme the invoice mainly sells (`Level.code`), or null for a one-off invoice. */
  levelCode?: string | null;
};

/**
 * Mirror an invoice payment into an Income row (revenue + LTV). Pass the payment to upsert, or
 * `null` to remove it. Table-only by design - the payment already carries its Dr Cash / Cr AR
 * ledger entry, so posting the Income to the ledger too would double the cash.
 *
 * ── How this row is attributed, and why (the fourth income writer) ────────────────
 * Money reaches the Income table four ways: the Finance form, the top-bar Quick Record, a
 * hand-marked instalment, and this. The first three all name the student and (where there is
 * one) the plan the money pays off. This one could not: it set no `studentId` at all and filed
 * every payment under the level "OTHER", so an invoice-paying customer never appeared in their
 * own payment history and "what has this person paid" had a different answer depending on which
 * door the money came through.
 *
 * Resolved as far as the data honestly allows:
 *
 *   · STUDENT - matched from the customer name against the roster, on the same normalisation
 *     every other pairing in the app uses (`lib/payment-allocation.nameKey`). Linked only when
 *     EXACTLY ONE student matches: two people sharing a name is the ambiguity the student code
 *     exists to settle, and guessing between them would put one person's money in another's
 *     history. No match, or more than one, leaves it unlinked under the typed name - which is
 *     exactly where it was before.
 *
 *   · LEVEL - taken from the invoice's own line items, now that a product names the programme it
 *     sells. The biggest programme line wins (`dominantLevelCode`), because an Income row carries
 *     exactly one level and that level decides both the GL account the revenue posts to and which
 *     business line's book it appears in - so an invoice for GN A1 finally shows up as German
 *     Note's money rather than as a general receipt. An invoice built entirely from hand-typed
 *     lines still files under "OTHER", which is a real account in the chart
 *     (lib/chart-of-accounts) and not a placeholder: the money lands somewhere truthful rather
 *     than being attributed to a course nobody bought.
 *
 *   · PLAN - stays null, deliberately. An invoice IS its own receivable: it is tracked in
 *     accounts receivable and aged by the invoice ageing. Crediting it to a coaching plan as
 *     well would pay down a second debt with the same money and understate what is owed - the
 *     very double-count that FIN-12 was about.
 */
/**
 * Which student an invoice's customer IS, as firmly as the data allows.
 *
 * Two routes, strongest first:
 *   1. THE CONTACT. An invoice raised against a CRM contact names that lead, and a student
 *      converted from that lead points back at it (`Student.leadId`). That is a link somebody
 *      made on purpose, so it beats anything inferred from spelling.
 *   2. THE NAME, normalised the way every other pairing in the app normalises it
 *      (`lib/payment-allocation.nameKey`), and only when EXACTLY ONE student matches. Two people
 *      sharing a name is the ambiguity the student code exists to settle; guessing between them
 *      would file one person's money in another person's history.
 *
 * No match leaves the row unlinked under the typed name - visible in Finance, simply not yet
 * attached to a roster record, which is where an invoice to someone who was never a student
 * belongs.
 */
async function resolveCustomerStudent(
  leadId: string | null,
  customerName: string,
): Promise<string | null> {
  if (leadId) {
    const byLead = await prisma.student.findFirst({ where: { leadId }, select: { id: true } });
    if (byLead) return byLead.id;
  }
  const key = nameKey(customerName);
  const roster = await prisma.student.findMany({ select: { id: true, fullName: true } });
  const matches = roster.filter((r) => nameKey(r.fullName) === key);
  return matches.length === 1 ? matches[0].id : null;
}

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
    /**
     * The customer, matched to the roster where the name resolves to exactly one student. One
     * read against a table of a few hundred rows, on a path that already writes.
     */
    const studentId = await resolveCustomerStudent(payment.leadId ?? null, payment.studentName);

    const data = {
      date: payment.paidOn,
      studentName: payment.studentName,
      studentId,
      amountInrMinor: payment.amountInrMinor,
      /**
       * A euro invoice's receipt is EUROS, and both columns are stored - `lib/money.aggInrMinor`
       * adds the two sides at the stamped rate, so writing the euro figure as 0 (as this did
       * while every invoice was a rupee invoice) would report a German client's payment as
       * whatever the converted rupee figure happened to be and lose what they actually paid.
       */
      amountEurMinor: payment.amountEurMinor,
      fxRateUsed: payment.fxRateUsed,
      programLevel: payment.levelCode || "OTHER",
      paymentType: "FULL_PAYMENT" as const,
      paymentMethod: paymentMethodEnum(payment.method),
      // Null on purpose - an invoice is its own receivable. See the note above.
      pendingPaymentId: null,
      notes: "Auto-posted from an invoice payment",
    };
    if (existing) {
      await prisma.income.update({ where: { id: existing.id }, data });
    } else {
      await prisma.income.create({ data: { ...data, source: "MANUAL", externalRef: ref } });
    }
  } catch {
    // best-effort - never fail the payment write over an income-mirror hiccup
  }
}

const INSTALMENT_INCOME_REF = (instalmentId: string) => `instalment:${instalmentId}`;

export type InstalmentForSync = {
  id: string;
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
  paidDate: Date;
  programLevel: string;
  studentName: string;
  studentId: string | null;
  pendingPaymentId: string;
};

/**
 * Mirror a hand-marked instalment into an Income row (QA: "marking an instalment as Paid doesn't
 * create an income entry, so the collected amount doesn't change").
 *
 * ── Why this has to exist ─────────────────────────────────────────────────────────
 * The money maths runs off Income rows: `getPendingRows` works out what a plan has collected from
 * the payments credited to it. `setInstalmentStatus` wrote only to the `instalment` table, so
 * ticking an instalment Paid moved the ladder and the "next due" date while the balance stayed
 * exactly where it was. The receivable then said the student still owed money its own schedule
 * said they had paid - the two halves of the same fact, disagreeing, with no way to tell which
 * was wrong. That is the Riyaz row in the QA report, from the other direction.
 *
 * The income flows the OTHER way automatically already: recording a payment settles the
 * instalments it covers (instalment-settlement.ts). This closes the loop.
 *
 * ── Why it is safe to undo ────────────────────────────────────────────────────────
 * Keyed by `(source, externalRef)` = `instalment:<id>`, exactly like the invoice-payment mirror
 * above, so it is idempotent: re-marking an already-paid instalment updates one row rather than
 * adding a second. Un-marking it passes `null`, which voids the ledger entry and deletes the row,
 * so the figure goes back to what it was. An income the operator typed in by hand is never
 * touched - it has a different `externalRef` (none) and is therefore never the row found here.
 *
 * Unlike the invoice mirror this DOES post to the ledger, because nothing else has: an invoice
 * payment carries its own Dr Cash / Cr AR entry, and a tick in the EMI window carries nothing.
 */
export async function syncInstalmentIncome(
  actorId: string,
  instalment: InstalmentForSync | null,
  instalmentId: string,
): Promise<void> {
  const ref = INSTALMENT_INCOME_REF(instalmentId);
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.income.findUnique({
        where: { source_externalRef: { source: "MANUAL", externalRef: ref } },
      });

      if (!instalment) {
        if (existing) {
          await voidEntryForSource(tx, "INCOME", existing.id, {
            reason: "instalment no longer marked paid", actorId, on: istToday(),
          });
          await tx.income.delete({ where: { id: existing.id } });
        }
        return;
      }

      const data = {
        // The day the instalment was settled, not the day somebody got round to ticking it.
        date: instalment.paidDate,
        studentName: instalment.studentName,
        studentId: instalment.studentId,
        // The whole point: this payment names the plan it pays off, so it is credited to that
        // plan and to no other (FIN-12).
        pendingPaymentId: instalment.pendingPaymentId,
        amountInrMinor: instalment.amountInrMinor,
        amountEurMinor: instalment.amountEurMinor,
        fxRateUsed: instalment.fxRateUsed,
        programLevel: instalment.programLevel,
        paymentType: "INSTALMENT",
        /**
         * OTHER, honestly. Nobody said how this money arrived - the operator ticked a box in a
         * schedule - and guessing UPI would put a number in the UPI column that nothing can
         * reconcile against. The note says where the row came from.
         */
        paymentMethod: "OTHER" as const,
        paymentMethodOther: "Marked paid on the EMI schedule",
        notes: "Recorded automatically when this instalment was marked paid",
      };

      if (existing) {
        await tx.income.update({ where: { id: existing.id }, data });
        return;
      }

      const income = await tx.income.create({
        data: { ...data, source: "MANUAL", externalRef: ref, enteredById: actorId },
      });
      const accounts = await levelIncomeAccounts();
      await postEntry(tx, incomeEntryDraft({ ...income, enteredById: actorId }, accounts));
    });
  } catch {
    /**
     * Best-effort, like its two siblings above: a hiccup here must never undo the instalment
     * status the operator just set. The gap it leaves is the state the app was in permanently
     * before this function existed, and the next tick of the status re-attempts it.
     */
  }
}
