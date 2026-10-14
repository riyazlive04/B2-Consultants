/**
 * Reading the founder's expense-category list (lib/config-schema `expenseCategories`).
 *
 * Pure and isomorphic: the Console panel, the three cost forms and the posting engine all decide
 * "what is this category and where does it post" with these functions, so a category's behaviour
 * cannot differ between the form that captured it and the ledger entry that recorded it.
 */

import {
  DEFAULT_EXPENSE_CATEGORIES_CONFIG,
  LOCKED_EXPENSE_CATEGORIES,
  type ExpenseCategoriesConfig,
  type ExpenseCategoryOption,
} from "./config-schema";

/** The categories a form should offer - active ones, in the founder's order. */
export function activeExpenseCategories(config: ExpenseCategoriesConfig): ExpenseCategoryOption[] {
  return config.categories.filter((c) => c.active);
}

/**
 * Select options for a form.
 *
 * `include` is the code currently ON THE ROW being edited. A category deactivated after that row
 * was saved still has to appear, or opening the row to fix a typo would silently re-file the cost
 * as something else the moment it saved.
 */
export function expenseCategoryOptions(
  config: ExpenseCategoriesConfig,
  include?: string | null,
): { value: string; label: string }[] {
  const active = activeExpenseCategories(config);
  const extra =
    include && !active.some((c) => c.code === include)
      ? config.categories.filter((c) => c.code === include)
      : [];
  return [...active, ...extra].map((c) => ({
    value: c.code,
    label: extra.some((e) => e.code === c.code) ? `${c.label} (no longer offered)` : c.label,
  }));
}

/** The founder's name for a code, falling back to the code itself so nothing renders blank. */
export function expenseCategoryLabel(config: ExpenseCategoriesConfig, code: string): string {
  return (
    config.categories.find((c) => c.code === code)?.label ??
    DEFAULT_EXPENSE_CATEGORIES_CONFIG.categories.find((c) => c.code === code)?.label ??
    code
  );
}

/**
 * The category's default answer to "is this a direct delivery cost".
 *
 * A DEFAULT, not a verdict: the per-row checkbox still wins, because COGS is orthogonal to
 * category (a tutor's salary is Team salaries *and* a delivery cost). Unknown codes read false -
 * counting an unrecognised cost as COGS would understate gross profit without being asked to.
 */
export function expenseCategoryIsCogs(config: ExpenseCategoriesConfig, code: string): boolean {
  return (
    config.categories.find((c) => c.code === code)?.isCogs ??
    DEFAULT_EXPENSE_CATEGORIES_CONFIG.categories.find((c) => c.code === code)?.isCogs ??
    false
  );
}

/**
 * code → EXPENSE account code, for the posting engine.
 *
 * Shaped like `levelIncomeAccounts()` for the same reason: `expenseAccountFor` takes the map and
 * falls back to the seeded prefix rule when it is absent, so the seed script and the backfill
 * need no database read to post identically to the live actions.
 */
export function expenseAccountMap(config: ExpenseCategoriesConfig): Map<string, string> {
  return new Map(config.categories.map((c) => [c.code, c.accountCode]));
}

/** Whether a code is one the app branches on by name - locked against deletion. */
export function isLockedExpenseCategory(code: string): boolean {
  return (LOCKED_EXPENSE_CATEGORIES as readonly string[]).includes(code);
}
