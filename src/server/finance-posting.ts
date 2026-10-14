import { Prisma, type PaymentMethod } from "@prisma/client";
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
 * The row's value in base currency (INR paise), at the rate stamped on the row itself -
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
 * exactly `baseTotalMinor` - the same `eurMinorToInrMinor` rounding on both sides - which
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

/**
 * The asset side of a row that NAMES its account rather than implying one from a payment method.
 *
 * One line per currency actually used, each at its own rate, exactly like `assetLines` - but
 * against the chosen account, because "it left the euro account" is a fact about the transfer and
 * not something to guess later. A rupee amount is always put on a rupee-capable account and a
 * euro amount on a euro-capable one: the EUR bank cannot hold rupees, and a line that said it
 * did would balance and still describe something that never happened.
 *
 * Shared by equity (money an owner moved in or out) and expenses (money that left to pay a
 * cost), so the two can never disagree about where a euro payment lands.
 */
function moneyAccountLines(
  row: DualCurrencyRow,
  accountCode: string,
  side: "debit" | "credit",
): DraftLine[] {
  const lines: DraftLine[] = [];
  if (row.amountInrMinor > BigInt(0)) {
    lines.push({
      accountCode: accountCode === ACCOUNT.BANK_EUR ? ACCOUNT.BANK_INR : accountCode,
      side,
      amountMinor: row.amountInrMinor,
      currency: "INR",
      fxRate: ONE,
    });
  }
  if (row.amountEurMinor > BigInt(0)) {
    lines.push({
      accountCode: accountCode === ACCOUNT.BANK_INR ? ACCOUNT.BANK_EUR : accountCode,
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
  programLevel: string; // Level.code
  paymentMethod: PaymentMethod;
  enteredById: string | null;
};

/**
 * Dr the asset the money landed in · Cr income for the program level.
 *
 * `incomeAccounts` (code → GL account, from server/levels.ts `levelIncomeAccounts()`) honours a
 * per-level account override. Omit it and posting falls back to the prefix rule in
 * incomeAccountFor - correct for the seeded defaults, so the seed script needs no map.
 */
export function incomeEntryDraft(i: IncomeForPosting, incomeAccounts?: Map<string, string>): DraftEntry {
  return {
    date: i.date,
    narration: `Income - ${i.studentName} (${i.programLevel})`,
    sourceType: "INCOME",
    sourceId: i.id,
    postedById: i.enteredById,
    lines: [
      ...assetLines(i, i.paymentMethod, "debit"),
      {
        accountCode: incomeAccountFor(i.programLevel, incomeAccounts),
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
  /** A founder-configured category code (AppSetting "expenseCategories"), no longer an enum. */
  category: string;
  isCogs: boolean;
  /** Which real-world account the money left from - one of MONEY_ACCOUNTS. */
  paidFromAccount: string;
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
export function expenseEntryDraft(
  e: ExpenseForPosting,
  expenseAccounts?: Map<string, string>,
): DraftEntry {
  return {
    date: e.date,
    narration: `Expense - ${e.vendor} (${e.category})`,
    sourceType: "EXPENSE",
    sourceId: e.id,
    postedById: e.enteredById,
    lines: [
      {
        accountCode: expenseAccountFor(e.category, expenseAccounts),
        side: "debit",
        amountMinor: baseTotalMinor(e),
        currency: "INR",
        fxRate: ONE,
        isCogs: e.isCogs,
      },
      /**
       * ── WHERE THE MONEY ACTUALLY LEFT FROM ──────────────────────────────────────
       * Every expense used to credit the INR bank, whatever had really paid it: the petty-cash
       * tin and the euro account both drained a rupee bank account that no statement would ever
       * agree with, and the Cash account could only ever go up. The row now names the account it
       * left, and that is the account credited.
       */
      ...moneyAccountLines(e, e.paidFromAccount, "credit"),
    ],
  };
}

export type EquityForPosting = DualCurrencyRow & {
  id: string;
  date: Date;
  contributorName: string;
  kind: "CONTRIBUTION" | "DRAWING";
  /** Which real-world account the money moved through - one of MONEY_ACCOUNTS. */
  accountCode: string;
  enteredById: string | null;
};

/**
 * An owner putting money IN: Dr the account it landed in · Cr Owner's equity (3000).
 * A DRAWING is the same entry reversed.
 *
 * ── NEVER AN INCOME ACCOUNT ───────────────────────────────────────────────────────
 * This is the one rule that matters here. Capital is not revenue: a contribution posted to an
 * income account would inflate revenue, gross and net profit, margin, commission (which is a
 * percentage of payments) and every growth figure derived from them - and it would do so
 * invisibly, because the totals would still balance. Equity belongs on the balance sheet.
 *
 * It is also NOT added to "Cash in Hand" anywhere: that figure is the bank balance the founder
 * types each Monday, and money already in the account is already in it. The ledger is where this
 * entry shows its effect.
 *
 * One line per currency on the asset side, each at its own rate, against the CHOSEN account -
 * see `moneyAccountLines`, which an expense's "paid from" side now shares.
 */
export function equityEntryDraft(e: EquityForPosting): DraftEntry {
  const asset = moneyAccountLines(e, e.accountCode, e.kind === "CONTRIBUTION" ? "debit" : "credit");
  return {
    date: e.date,
    narration: `${e.kind === "CONTRIBUTION" ? "Capital introduced" : "Owner drawing"} - ${e.contributorName}`,
    sourceType: "EQUITY",
    sourceId: e.id,
    postedById: e.enteredById,
    lines: [
      ...asset,
      {
        accountCode: ACCOUNT.OWNERS_EQUITY,
        side: e.kind === "CONTRIBUTION" ? "credit" : "debit",
        amountMinor: baseTotalMinor(e),
        currency: "INR",
        fxRate: ONE,
      },
    ],
  };
}

export type TutorFeeForPosting = {
  id: string;
  approvedAt: Date;
  batchName: string;
  level: string;
  trainerName: string | null;
  /** Already resolved through `payableAmountInrMinor` - the override wins over the computed
   *  figure, and the ledger must agree with what the founder approved on screen. */
  payableInrMinor: bigint;
  approvedById: string | null;
};

/**
 * Dr COGS - Direct delivery · Cr Accounts payable, when a tutor fee is APPROVED
 * (ER v2 Track C, behind `financePosting.tutorFeeAccrual`).
 *
 * AN ACCRUAL, NOT A PAYMENT. This asserts "we owe the trainer this", which is true the
 * moment the founder approves it. It deliberately does NOT touch a bank account: the cash
 * leg is the Expense row recorded when the trainer is actually paid, and that debits the
 * expense category and credits the bank.
 *
 * Those two postings hit DIFFERENT accounts on the debit side (5000 COGS here vs the
 * Expense row's category account), which is the one thing standing between this feature and
 * double-counting the fee. If the founders start tagging the trainer's payment expense as
 * COGS_DIRECT_DELIVERY as well, gross margin will be understated by exactly the fee - so
 * `verify-ledger.ts` asserts payable is drawn down rather than re-debited.
 *
 * INR only: `TutorFee.amountInrMinor` is a single-currency figure by construction (the band
 * rates are rupee amounts), so there is no EUR leg and no FX rate to stamp.
 */
export function tutorFeeAccrualDraft(f: TutorFeeForPosting): DraftEntry {
  const who = f.trainerName ? ` - ${f.trainerName}` : "";
  return {
    date: f.approvedAt,
    narration: `Tutor fee owed - ${f.batchName} (${f.level})${who}`,
    sourceType: "TUTOR_FEE",
    sourceId: f.id,
    postedById: f.approvedById,
    lines: [
      {
        accountCode: ACCOUNT.COGS_DELIVERY,
        side: "debit",
        amountMinor: f.payableInrMinor,
        currency: "INR",
        fxRate: ONE,
        isCogs: true,
      },
      {
        accountCode: ACCOUNT.PAYABLE,
        side: "credit",
        amountMinor: f.payableInrMinor,
        currency: "INR",
        fxRate: ONE,
      },
    ],
  };
}

export type PaymentForPosting = {
  id: string;
  paidAt: Date;
  amountInrMinor: bigint;
  /** `InvoicePayment.method` is free text, not the `PaymentMethod` enum (BUILD_CHECKLIST
   *  §7 - no processor wired yet, see the model comment on InvoicePayment). Mapped below. */
  method: string;
  invoiceNumber: string;
  customerName: string;
  recordedById: string | null;
};

/** Map the Payments module's free-text method onto the closest `PaymentMethod` enum value
 *  so it can resolve a real asset account via `assetAccountFor`. Unrecognised text (a
 *  future processor name, a typo) falls back to the gateway-clearing account rather than
 *  failing to post - the money still lands somewhere real, just not itemised by rail. */
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
 * `ACCOUNT.RECEIVABLE` in chart-of-accounts.ts) - no new account was invented for this.
 * This pass intentionally does NOT post Invoice issuance itself (Dr AR / Cr Income), only
 * the payment against it (BUILD_CHECKLIST §7 scopes just the payment side) - so today AR
 * only ever receives credits here and will trend negative over time until a follow-up
 * posts the issuance side too. That is a known, flagged gap, not a bug in this function.
 */
export type InvoiceForIssuance = {
  id: string;
  issueDate: Date;
  totalInrMinor: bigint;
  number: string;
  customerName: string;
  /** the level of the linked won lead, when there is one - else revenue lands in "Other". */
  programLevel?: string | null;
  issuedById?: string | null;
};

/**
 * Dr Accounts receivable (1100) · Cr Income, when an invoice is ISSUED (audit §C #22).
 *
 * paymentEntryDraft above only ever CREDITS 1100 (cash came in against an invoice); without a
 * matching issuance debit, AR is one-sided and trends negative over an invoice's life. This is
 * the missing half: recognising the revenue and the receivable the moment the invoice is issued,
 * so a fully-paid invoice nets AR back to zero (Dr AR on issue, Cr AR on payment) and revenue is
 * booked once, at issue, exactly like a hand-keyed Income row.
 *
 * Income account: an invoice has line items, not a program level, so it credits the linked won
 * lead's level when there is one and "Income - Other" (4090) otherwise - never undefined, so the
 * entry always balances. INR-only, like the payment side (invoices carry no EUR split).
 */
export function invoiceIssuanceEntryDraft(inv: InvoiceForIssuance): DraftEntry {
  return {
    date: inv.issueDate,
    narration: `Invoice issued - ${inv.customerName} (${inv.number})`,
    sourceType: "INVOICE",
    sourceId: inv.id,
    postedById: inv.issuedById ?? null,
    lines: [
      {
        accountCode: ACCOUNT.RECEIVABLE,
        side: "debit",
        amountMinor: inv.totalInrMinor,
        currency: "INR",
        fxRate: ONE,
      },
      {
        accountCode: incomeAccountFor(inv.programLevel ?? "OTHER"),
        side: "credit",
        amountMinor: inv.totalInrMinor,
        currency: "INR",
        fxRate: ONE,
      },
    ],
  };
}

export function paymentEntryDraft(p: PaymentForPosting): DraftEntry {
  return {
    date: p.paidAt,
    narration: `Payment - ${p.customerName} (${p.invoiceNumber})`,
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
