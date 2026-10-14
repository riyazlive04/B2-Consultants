/**
 * Expense categories - the list that used to be a Prisma enum.
 *
 * Eight values, chosen in a spec. Rent, Legal and accounting, Travel and Bank charges were not
 * among them, so every such cost was filed as "Other" and the largest line in the P&L became the
 * one that says nothing. The list is founder-editable now, and each category names the EXPENSE
 * account its costs are debited to - which is what makes adding one a new line in the ledger
 * rather than a new word on a report.
 *
 * These tests defend the PROPERTIES, not the eight:
 *   · the shipped defaults are the enum's values, pointing at the accounts `expenseAccountFor`
 *     hardcoded for them, so an install that never opens the panel records and posts exactly as
 *     it did before;
 *   · a hand-edited or partial setting falls back to the defaults rather than taking every cost
 *     form down (`coerce…`), which is the house rule for every founder config;
 *   · the three codes the app branches on BY NAME cannot be removed, and no two categories can
 *     share a code;
 *   · a category switched off stops being OFFERED without changing what a cost already filed
 *     under it reads as - the one property that makes deactivating safe;
 *   · the posting map wins over the fallback rule, and an unrecognised category still posts
 *     somewhere rather than taking the entry down.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  coerceExpenseCategoriesConfig,
  DEFAULT_EXPENSE_CATEGORIES_CONFIG,
  expenseCategoriesConfigSchema,
  LOCKED_EXPENSE_CATEGORIES,
  NEW_EXPENSE_ACCOUNT,
  type ExpenseCategoriesConfig,
} from "../config-schema";
import {
  activeExpenseCategories,
  expenseAccountMap,
  expenseCategoryIsCogs,
  expenseCategoryLabel,
  expenseCategoryOptions,
  isLockedExpenseCategory,
} from "../expense-categories";
import { expenseAccountFor } from "../chart-of-accounts";

const CONFIG: ExpenseCategoriesConfig = DEFAULT_EXPENSE_CATEGORIES_CONFIG;

describe("the shipped defaults are the old enum", () => {
  test("the same eight codes, in the same order", () => {
    assert.deepEqual(
      CONFIG.categories.map((c) => c.code),
      [
        "MARKETING",
        "TOOLS_SOFTWARE",
        "TEAM_SALARIES",
        "CONTENT_CREATION",
        "EVENTS_OFFLINE",
        "OPERATIONS",
        "COGS_DIRECT_DELIVERY",
        "OTHER",
      ],
    );
  });

  test("each points at the account expenseAccountFor hardcoded for it", () => {
    // The whole point of the default: posting is unchanged until somebody changes it.
    for (const c of CONFIG.categories) {
      assert.equal(c.accountCode, expenseAccountFor(c.code), c.code);
    }
  });

  test("COGS is the only one that defaults to being a direct delivery cost", () => {
    assert.deepEqual(
      CONFIG.categories.filter((c) => c.isCogs).map((c) => c.code),
      ["COGS_DIRECT_DELIVERY"],
    );
  });

  test("all eight are offered", () => {
    assert.equal(activeExpenseCategories(CONFIG).length, 8);
  });
});

describe("a broken setting never takes the cost forms down", () => {
  test("nonsense coerces to the shipped list", () => {
    assert.deepEqual(coerceExpenseCategoriesConfig({ categories: "rent" }), CONFIG);
    assert.deepEqual(coerceExpenseCategoriesConfig(null), CONFIG);
    assert.deepEqual(coerceExpenseCategoriesConfig(undefined), CONFIG);
  });

  test("a list missing a locked code coerces rather than being honoured", () => {
    const withoutOther = { categories: CONFIG.categories.filter((c) => c.code !== "OTHER") };
    assert.deepEqual(coerceExpenseCategoriesConfig(withoutOther), CONFIG);
  });
});

describe("what the founder cannot do", () => {
  test("remove a code the app branches on by name", () => {
    for (const locked of LOCKED_EXPENSE_CATEGORIES) {
      const without = { categories: CONFIG.categories.filter((c) => c.code !== locked) };
      const parsed = expenseCategoriesConfigSchema.safeParse(without);
      assert.equal(parsed.success, false, `${locked} must not be removable`);
      assert.match(parsed.error!.issues[0].message, new RegExp(locked));
    }
  });

  test("code two categories the same", () => {
    const dupe = {
      categories: [
        ...CONFIG.categories,
        { code: "OPERATIONS", label: "Ops again", accountCode: "6050", isCogs: false, active: true },
      ],
    };
    const parsed = expenseCategoriesConfigSchema.safeParse(dupe);
    assert.equal(parsed.success, false);
    assert.match(parsed.error!.issues[0].message, /two categories coded OPERATIONS/);
  });

  test("switch every category off - the form would have nothing to offer", () => {
    const allOff = { categories: CONFIG.categories.map((c) => ({ ...c, active: false })) };
    const parsed = expenseCategoriesConfigSchema.safeParse(allOff);
    assert.equal(parsed.success, false);
    assert.match(parsed.error!.issues[0].message, /has to stay active/);
  });

  test("leave the list empty", () => {
    assert.equal(expenseCategoriesConfigSchema.safeParse({ categories: [] }).success, false);
  });

  test("give a category a code that is not a code", () => {
    const bad = (code: string) => ({
      categories: CONFIG.categories.map((c) => (c.code === "OPERATIONS" ? { ...c, code } : c)),
    });
    // Starting with a digit, lower case, and a space: all stored on rows, in CSVs and in URLs.
    assert.equal(expenseCategoriesConfigSchema.safeParse(bad("1RENT")).success, false);
    assert.equal(expenseCategoriesConfigSchema.safeParse(bad("RENT OFFICE")).success, false);
    // ...but lower case is UPPERCASED rather than refused, because it is unambiguous.
    const lower = expenseCategoriesConfigSchema.safeParse(bad("rent"));
    assert.equal(lower.success, true);
    assert.ok(lower.data!.categories.some((c) => c.code === "RENT"));
  });

  test("point a category at something that is not an account", () => {
    const at = (accountCode: string) => ({
      categories: CONFIG.categories.map((c) => (c.code === "OPERATIONS" ? { ...c, accountCode } : c)),
    });
    assert.equal(expenseCategoriesConfigSchema.safeParse(at("")).success, false);
    assert.equal(expenseCategoriesConfigSchema.safeParse(at("Operations")).success, false);
    // A four-digit code and the "give it its own line" sentinel are the two valid answers.
    assert.equal(expenseCategoriesConfigSchema.safeParse(at("6050")).success, true);
    assert.equal(expenseCategoriesConfigSchema.safeParse(at(NEW_EXPENSE_ACCOUNT)).success, true);
  });
});

describe("adding a category", () => {
  const WITH_RENT: ExpenseCategoriesConfig = {
    categories: [
      ...CONFIG.categories,
      { code: "RENT", label: "Rent", accountCode: "6100", isCogs: false, active: true },
    ],
  };

  test("is offered, named and posted where it says", () => {
    assert.ok(expenseCategoryOptions(WITH_RENT).some((o) => o.value === "RENT" && o.label === "Rent"));
    assert.equal(expenseCategoryLabel(WITH_RENT, "RENT"), "Rent");
    assert.equal(expenseAccountFor("RENT", expenseAccountMap(WITH_RENT)), "6100");
  });

  test("and cannot be locked - only the three the app reads by name are", () => {
    assert.equal(isLockedExpenseCategory("RENT"), false);
    assert.equal(isLockedExpenseCategory("TEAM_SALARIES"), true);
  });
});

describe("switching a category off", () => {
  const OFF: ExpenseCategoriesConfig = {
    categories: CONFIG.categories.map((c) =>
      c.code === "EVENTS_OFFLINE" ? { ...c, active: false } : c,
    ),
  };

  test("stops it being offered", () => {
    assert.equal(expenseCategoryOptions(OFF).some((o) => o.value === "EVENTS_OFFLINE"), false);
  });

  test("but a cost already filed under it still reads, and still posts, correctly", () => {
    assert.equal(expenseCategoryLabel(OFF, "EVENTS_OFFLINE"), "Events and Offline");
    assert.equal(expenseAccountFor("EVENTS_OFFLINE", expenseAccountMap(OFF)), "6040");
  });

  test("and editing that row still offers it, flagged, so saving cannot re-file the cost", () => {
    const options = expenseCategoryOptions(OFF, "EVENTS_OFFLINE");
    const row = options.find((o) => o.value === "EVENTS_OFFLINE");
    assert.ok(row, "the row's own category has to be offerable");
    assert.match(row.label, /no longer offered/);
  });
});

describe("a code with no category behind it", () => {
  test("reads as itself rather than blank", () => {
    assert.equal(expenseCategoryLabel(CONFIG, "RENT"), "RENT");
  });

  test("is not COGS - counting it as one would understate gross profit unasked", () => {
    assert.equal(expenseCategoryIsCogs(CONFIG, "RENT"), false);
  });

  test("still posts somewhere: Other expenses, never undefined", () => {
    // `postEntry` would refuse an entry naming no account, taking a recorded cost down with it.
    assert.equal(expenseAccountFor("RENT"), "6090");
    assert.equal(expenseAccountFor("RENT", expenseAccountMap(CONFIG)), "6090");
  });

  test("and a code dropped out of the config falls back to the shipped list's answer", () => {
    // A config hand-edited in the database can lose a row that live expenses still hold.
    const thin: ExpenseCategoriesConfig = {
      categories: CONFIG.categories.filter((c) => c.code !== "MARKETING"),
    };
    assert.equal(expenseCategoryLabel(thin, "MARKETING"), "Marketing (Meta Ads, Google Ads, Influencers)");
    assert.equal(expenseCategoryIsCogs(thin, "COGS_DIRECT_DELIVERY"), true);
  });
});

describe("re-pointing a category", () => {
  test("moves where its costs are debited, and nothing else", () => {
    const moved: ExpenseCategoriesConfig = {
      categories: CONFIG.categories.map((c) =>
        c.code === "TEAM_SALARIES" ? { ...c, accountCode: "6100" } : c,
      ),
    };
    const map = expenseAccountMap(moved);
    assert.equal(expenseAccountFor("TEAM_SALARIES", map), "6100");
    // Everything else stays where it was - a re-point is not a reorganisation.
    assert.equal(expenseAccountFor("MARKETING", map), "6000");
    assert.equal(expenseAccountFor("COGS_DIRECT_DELIVERY", map), "5000");
  });
});
