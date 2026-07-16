import { Prisma, type ExpenseCategory, type PaymentMethod, type ProgramLevel } from "@prisma/client";
import { eurMinorToInrMinor } from "@/lib/fx";
import { ACCOUNT, assetAccountFor, expenseAccountFor, incomeAccountFor } from "@/lib/chart-of-accounts";
import type { DraftEntry, DraftLine } from "./ledger-core";

/**
 * How a Finance row becomes a journal entry (SPEC §4.1, §4.2 → §10.4).
 *
 * This lives apart from `finance-actions.ts` (which is "use server", so every export there
 * is a public RPC endpoint) and apart from `ledger-core.ts` (which knows nothing about
 * income or expenses). Both the live actions and `prisma/seed-ledger.ts` build their drafts
 * here, so a backfilled row and a freshly-entered one post identically. A posting rule that
 * exists twice is a posting rule that will eventually disagree with itself.
 *
 * No "server-only": the seed script must import it.
 */

const ONE = new Prisma.Decimal(1);

/** The columns any dual-currency Finance row carries (SPEC §4.1). */
type DualCurrencyRow = {
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
};

/**
 * The row's value in base currency (INR paise), at the rate stamped on the row itself —
 * never today's rate, or history would shift every time the euro moved.
 */
export function baseTotalMinor(row: DualCurrencyRow): bigint {
  return row.amountInrMinor + eurMinorToInrMinor(row.amountEurMinor, row.fxRateUsed);
}

/**
 * The asset side of a Finance row, one line per currency actually used.
 *
 * A row names ONE payment method but may carry both an INR and a EUR amount, so each
 * amount is its own line on its own account at its own rate. Their base values sum to
 * exactly `baseTotalMinor` — the same `eurMinorToInrMinor` rounding on both sides — which
 * is why the entry balances to the paise rather than to within a paisa.
 */
function assetLines(row: DualCurrencyRow, method: PaymentMethod, side: "debit" | "credit"): DraftLine[] {
  const lines: DraftLine[] = [];
  if (row.amountInrMinor > BigInt(0)) {
    lines.push({
      accountCode: assetAccountFor(method, "INR"),
      side,
      amountMinor: row.amountInrMinor,
      currency: "INR",
      fxRate: ONE,
    });
  }
  if (row.amountEurMinor > BigInt(0)) {
    lines.push({
      accountCode: assetAccountFor(method, "EUR"),
      side,
      amountMinor: row.amountEurMinor,
      currency: "EUR",
      fxRate: row.fxRateUsed,
    });
  }
  return lines;
}

export type IncomeForPosting = DualCurrencyRow & {
  id: string;
  date: Date;
  studentName: string;
  programLevel: ProgramLevel;
  paymentMethod: PaymentMethod;
  enteredById: string | null;
};

/** Dr the asset the money landed in · Cr income for the program level. */
export function incomeEntryDraft(i: IncomeForPosting): DraftEntry {
  return {
    date: i.date,
    narration: `Income — ${i.studentName} (${i.programLevel})`,
    sourceType: "INCOME",
    sourceId: i.id,
    postedById: i.enteredById,
    lines: [
      ...assetLines(i, i.paymentMethod, "debit"),
      {
        accountCode: incomeAccountFor(i.programLevel),
        side: "credit",
        amountMinor: baseTotalMinor(i),
        currency: "INR",
        fxRate: ONE,
      },
    ],
  };
}

export type ExpenseForPosting = DualCurrencyRow & {
  id: string;
  date: Date;
  vendor: string;
  category: ExpenseCategory;
  isCogs: boolean;
  enteredById: string | null;
};

/**
 * Dr the expense category · Cr the asset the money left from.
 *
 * `isCogs` rides on the debit line rather than being inferred from the account, because
 * COGS is orthogonal to category: Karthick's salary is TEAM_SALARIES *and* a direct
 * delivery cost (SPEC §4.2). Gross profit is then `revenue − Σ lines where isCogs`, a
 * slice of the ledger rather than a second source of truth.
 */
export function expenseEntryDraft(e: ExpenseForPosting): DraftEntry {
  return {
    date: e.date,
    narration: `Expense — ${e.vendor} (${e.category})`,
    sourceType: "EXPENSE",
    sourceId: e.id,
    postedById: e.enteredById,
    lines: [
      {
        accountCode: expenseAccountFor(e.category),
        side: "debit",
        amountMinor: baseTotalMinor(e),
        currency: "INR",
        fxRate: ONE,
        isCogs: e.isCogs,
      },
      // Expenses record no payment method; they settle against the bank accounts.
      ...assetLines(e, "BANK_TRANSFER_INR", "credit"),
    ],
  };
}

export type PaymentForPosting = {
  id: string;
  paidAt: Date;
  amountInrMinor: bigint;
  /** `InvoicePayment.method` is free text, not the `PaymentMethod` enum (BUILD_CHECKLIST
   *  §7 — no processor wired yet, see the model comment on InvoicePayment). Mapped below. */
  method: string;
  invoiceNumber: string;
  customerName: string;
  recordedById: string | null;
};

/** Map the Payments module's free-text method onto the closest `PaymentMethod` enum value
 *  so it can resolve a real asset account via `assetAccountFor`. Unrecognised text (a
 *  future processor name, a typo) falls back to the gateway-clearing account rather than
 *  failing to post — the money still lands somewhere real, just not itemised by rail. */
function paymentAssetMethod(method: string): PaymentMethod {
  switch (method.trim().toLowerCase()) {
    case "cash":
      return "CASH";
    case "upi":
      return "UPI";
    case "bank":
    case "bank_transfer":
    case "bank transfer":
      return "BANK_TRANSFER_INR";
    case "card":
    case "credit_card":
    case "credit card":
      return "CREDIT_CARD";
    case "razorpay":
      return "RAZORPAY";
    case "paypal":
      return "PAYPAL";
    default:
      return "OTHER";
  }
}

/**
 * Dr the asset the money landed in · Cr Accounts receivable (1100).
 *
 * `InvoicePayment` carries only an INR amount (no EUR split like Income/Expense), so this
 * is always a plain two-line entry at rate 1.
 *
 * Credits AR rather than an income account because that is the accounting-correct target
 * for "cash came in against an invoice", and the chart of accounts already has one (see
 * `ACCOUNT.RECEIVABLE` in chart-of-accounts.ts) — no new account was invented for this.
 * This pass intentionally does NOT post Invoice issuance itself (Dr AR / Cr Income), only
 * the payment against it (BUILD_CHECKLIST §7 scopes just the payment side) — so today AR
 * only ever receives credits here and will trend negative over time until a follow-up
 * posts the issuance side too. That is a known, flagged gap, not a bug in this function.
 */
export function paymentEntryDraft(p: PaymentForPosting): DraftEntry {
  return {
    date: p.paidAt,
    narration: `Payment — ${p.customerName} (${p.invoiceNumber})`,
    sourceType: "PAYMENT",
    sourceId: p.id,
    postedById: p.recordedById,
    lines: [
      {
        accountCode: assetAccountFor(paymentAssetMethod(p.method), "INR"),
        side: "debit",
        amountMinor: p.amountInrMinor,
        currency: "INR",
        fxRate: ONE,
      },
      {
        accountCode: ACCOUNT.RECEIVABLE,
        side: "credit",
        amountMinor: p.amountInrMinor,
        currency: "INR",
        fxRate: ONE,
      },
    ],
  };
}
