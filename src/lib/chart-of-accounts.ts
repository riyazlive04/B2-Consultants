import type { Currency, LedgerAccountType, PaymentMethod } from "@prisma/client";

/**
 * B2's chart of accounts (SPEC §10.1), and the maps that decide which account a
 * Finance entry posts to.
 *
 * `code` - not `name` - is the stable key. The founder may reword "Marketing" to
 * "Ads & marketing" without breaking a single posting rule.
 *
 * Isomorphic and dependency-free (types only), so the seed script, the posting
 * engine and the Ledger UI all read one definition. A rule that lives in two
 * places is a rule that will disagree with itself.
 */

export type AccountSeed = {
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  /** null = accepts any currency. Set only where the real-world account is denominated. */
  readonly currency: Currency | null;
  readonly isCogs?: boolean;
};

export const CHART_OF_ACCOUNTS = [
  // ── Assets ──
  { code: "1000", name: "Bank - INR", type: "ASSET", currency: "INR" },
  { code: "1010", name: "Bank - EUR", type: "ASSET", currency: "EUR" },
  // Cash and the gateway clearing account hold either currency, so neither is pinned.
  { code: "1020", name: "Cash", type: "ASSET", currency: null },
  { code: "1030", name: "Payment gateway clearing", type: "ASSET", currency: null },
  { code: "1100", name: "Accounts receivable", type: "ASSET", currency: null },

  // ── Liabilities ──
  { code: "2000", name: "Accounts payable", type: "LIABILITY", currency: null },

  // ── Equity ──
  { code: "3000", name: "Owner's equity", type: "EQUITY", currency: null },
  { code: "3900", name: "Retained earnings", type: "EQUITY", currency: null },

  // ── Income, by program level (SPEC §4.4 "revenue by level") ──
  { code: "4000", name: "Income - Solo", type: "INCOME", currency: null },
  { code: "4010", name: "Income - Guided", type: "INCOME", currency: null },
  { code: "4020", name: "Income - Elite", type: "INCOME", currency: null },
  { code: "4030", name: "Income - German Note", type: "INCOME", currency: null },
  { code: "4090", name: "Income - Other", type: "INCOME", currency: null },

  // ── Expenses, by category (SPEC §4.2) ──
  { code: "5000", name: "COGS - Direct delivery", type: "EXPENSE", currency: null, isCogs: true },
  { code: "6000", name: "Marketing", type: "EXPENSE", currency: null },
  { code: "6010", name: "Tools & software", type: "EXPENSE", currency: null },
  { code: "6020", name: "Team salaries & commissions", type: "EXPENSE", currency: null },
  { code: "6030", name: "Content creation", type: "EXPENSE", currency: null },
  { code: "6040", name: "Events & offline", type: "EXPENSE", currency: null },
  { code: "6050", name: "Operations", type: "EXPENSE", currency: null },
  { code: "6090", name: "Other expenses", type: "EXPENSE", currency: null },
  { code: "7000", name: "FX gain / loss (realized)", type: "EXPENSE", currency: null },
] as const satisfies readonly AccountSeed[];

export type AccountCode = (typeof CHART_OF_ACCOUNTS)[number]["code"];

/**
 * A code a journal line may name: one from the seeded chart above, or one of the EXPENSE
 * accounts the founder has since created for a category of their own
 * (`saveExpenseCategoriesConfig`).
 *
 * The `string & {}` arm widens the type without losing autocomplete for the known codes. It is
 * safe because nothing here is trusted: `postEntry` resolves every code against the
 * `ledger_account` table and throws `LedgerError` on one it cannot find, so a code that names no
 * account fails the action loudly instead of writing a half-entry.
 */
export type PostableAccountCode = AccountCode | (string & {});

/** The codes a founder-created expense account is allocated from, in order. */
export const CUSTOM_EXPENSE_CODE_RANGE = { first: 6100, last: 6899 } as const;

export const ACCOUNT = {
  BANK_INR: "1000",
  BANK_EUR: "1010",
  CASH: "1020",
  GATEWAY_CLEARING: "1030",
  RECEIVABLE: "1100",
  PAYABLE: "2000",
  /// Direct delivery cost of goods sold - where a tutor fee accrues (ER v2 Track C). Already
  /// flagged isCogs, so gross profit stays a ledger slice rather than a second calculation.
  COGS_DELIVERY: "5000",
  FX_GAIN_LOSS: "7000",
  /// Capital put in by an owner (and drawn back out) - see server/equity-actions.ts. Already in
  /// the seeded chart; nothing could post to it until equity became a record rather than an
  /// unattributed figure on the weekly cash position.
  OWNERS_EQUITY: "3000",
} as const;

/**
 * The real-world accounts money can arrive into or leave from - what an equity contribution
 * picks between.
 *
 * Deliberately a short, named list rather than "every ASSET account": a contribution cannot land
 * in Accounts receivable or in the gateway clearing account, and offering them would invite an
 * entry that balances and still describes something that never happened.
 */
export const MONEY_ACCOUNTS = [
  { code: ACCOUNT.BANK_INR, label: "Bank - INR", currency: "INR" as Currency },
  { code: ACCOUNT.BANK_EUR, label: "Bank - EUR", currency: "EUR" as Currency },
  { code: ACCOUNT.CASH, label: "Cash", currency: null },
] as const;

export type MoneyAccountCode = (typeof MONEY_ACCOUNTS)[number]["code"];

export function isMoneyAccount(code: string): code is MoneyAccountCode {
  return MONEY_ACCOUNTS.some((a) => a.code === code);
}

/** The valid INCOME account codes, for validating a per-level override. */
const INCOME_CODES = new Set<string>(CHART_OF_ACCOUNTS.filter((a) => a.type === "INCOME").map((a) => a.code));

/**
 * Which income account a program level credits.
 *
 * Levels are configurable rows now (the `Level` table), so the authority is each level's own
 * `incomeAccountCode`: pass `accountByCode` (from server/levels.ts `levelIncomeAccounts()`) to honour
 * a per-level override. Without the map - e.g. the seed script - it falls back to a prefix rule that
 * reproduces the seeded defaults (every German level → the one German Note account, mirroring the
 * `byLevel` tile in finance-metrics.ts). NEVER returns undefined, so a journal line always balances,
 * even for a brand-new level that predates any mapping.
 */
export function incomeAccountFor(level: string, accountByCode?: Map<string, string>): AccountCode {
  const override = accountByCode?.get(level);
  if (override && INCOME_CODES.has(override)) return override as AccountCode;
  switch (level) {
    case "SOLO":
      return "4000";
    case "GUIDED":
      return "4010";
    case "ELITE":
      return "4020";
    case "OTHER":
      return "4090";
    default:
      return level.startsWith("GN_") ? "4030" : "4090";
  }
}

/**
 * Which expense account a cost category debits.
 *
 * Categories are configurable rows now (AppSetting "expenseCategories"), so the authority is
 * each category's own `accountCode`: pass `accountByCategory` (from
 * `lib/expense-categories.expenseAccountMap`) to honour the founder's mapping, including the
 * accounts created for categories they added. Without the map - e.g. `prisma/seed-ledger.ts` -
 * it falls back to the rule below, which reproduces the eight codes the enum was hardcoded to,
 * so a backfilled row and a freshly entered one post to the same account.
 *
 * NEVER returns undefined: an unrecognised category lands in "Other expenses" rather than
 * taking the whole entry down, because a cost that cannot be filed still has to be recorded.
 */
export function expenseAccountFor(
  category: string,
  accountByCategory?: Map<string, string>,
): PostableAccountCode {
  const mapped = accountByCategory?.get(category);
  if (mapped) return mapped;
  switch (category) {
    case "COGS_DIRECT_DELIVERY":
      return "5000";
    case "MARKETING":
      return "6000";
    case "TOOLS_SOFTWARE":
      return "6010";
    case "TEAM_SALARIES":
      return "6020";
    case "CONTENT_CREATION":
      return "6030";
    case "EVENTS_OFFLINE":
      return "6040";
    case "OPERATIONS":
      return "6050";
    default:
      return "6090";
  }
}

/**
 * Which real-world asset account the money moved through.
 *
 * A Finance entry names ONE payment method but may carry an INR amount and a EUR
 * amount (SPEC §4.1). Each amount is therefore its own line, and each line asks this
 * function for its own account - that is why `currency` is a parameter and not read
 * off the method. Gateways settle in a clearing account regardless of currency,
 * because the money is not in the bank yet.
 */
export function assetAccountFor(method: PaymentMethod, currency: Currency): AccountCode {
  switch (method) {
    case "PAYPAL":
    case "RAZORPAY":
    case "UPI":
    case "CREDIT_CARD":
    case "OTHER":
      return ACCOUNT.GATEWAY_CLEARING;
    case "CASH":
      return ACCOUNT.CASH;
    case "BANK_TRANSFER_INR":
    case "BANK_TRANSFER_EUR":
      // The method records the *primary* rail; a EUR amount always lands in the EUR
      // bank account and an INR amount in the INR one, whichever rail was named.
      return currency === "EUR" ? ACCOUNT.BANK_EUR : ACCOUNT.BANK_INR;
  }
}
