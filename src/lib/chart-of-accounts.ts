import type {
  Currency,
  ExpenseCategory,
  LedgerAccountType,
  PaymentMethod,
} from "@prisma/client";

/**
 * B2's chart of accounts (SPEC §10.1), and the maps that decide which account a
 * Finance entry posts to.
 *
 * `code` — not `name` — is the stable key. The founder may reword "Marketing" to
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
  { code: "1000", name: "Bank — INR", type: "ASSET", currency: "INR" },
  { code: "1010", name: "Bank — EUR", type: "ASSET", currency: "EUR" },
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
  { code: "4000", name: "Income — Solo", type: "INCOME", currency: null },
  { code: "4010", name: "Income — Guided", type: "INCOME", currency: null },
  { code: "4020", name: "Income — Elite", type: "INCOME", currency: null },
  { code: "4030", name: "Income — German Note", type: "INCOME", currency: null },
  { code: "4090", name: "Income — Other", type: "INCOME", currency: null },

  // ── Expenses, by category (SPEC §4.2) ──
  { code: "5000", name: "COGS — Direct delivery", type: "EXPENSE", currency: null, isCogs: true },
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

export const ACCOUNT = {
  BANK_INR: "1000",
  BANK_EUR: "1010",
  CASH: "1020",
  GATEWAY_CLEARING: "1030",
  RECEIVABLE: "1100",
  PAYABLE: "2000",
  FX_GAIN_LOSS: "7000",
} as const;

/** The valid INCOME account codes, for validating a per-level override. */
const INCOME_CODES = new Set<string>(CHART_OF_ACCOUNTS.filter((a) => a.type === "INCOME").map((a) => a.code));

/**
 * Which income account a program level credits.
 *
 * Levels are configurable rows now (the `Level` table), so the authority is each level's own
 * `incomeAccountCode`: pass `accountByCode` (from server/levels.ts `levelIncomeAccounts()`) to honour
 * a per-level override. Without the map — e.g. the seed script — it falls back to a prefix rule that
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

export function expenseAccountFor(category: ExpenseCategory): AccountCode {
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
    case "OTHER":
      return "6090";
  }
}

/**
 * Which real-world asset account the money moved through.
 *
 * A Finance entry names ONE payment method but may carry an INR amount and a EUR
 * amount (SPEC §4.1). Each amount is therefore its own line, and each line asks this
 * function for its own account — that is why `currency` is a parameter and not read
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
