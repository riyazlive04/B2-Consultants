import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";

import { ftag, FRUN, IST, fname, gotoFinance, openTab, todayIn } from "../../helpers/finance-ui";
import { addExpense, addIncome, reloadFinanceTab } from "../../helpers/finance-flows";

/** PRD1 §6: "Admin can export any table to CSV from a small Export button on that table." */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const incomeNotes = ftag("csv income");
const expenseNotes = ftag("csv expense");

test("seed one income and one expense for the export", async ({ page }) => {
  await gotoFinance(page);
  await addIncome(page, { date: todayIn(IST), student: fname("Csv Payer"), inr: "4321.09", level: "Solo", method: "UPI", notes: incomeNotes });
  await openTab(page, "Expenses");
  await addExpense(page, { date: todayIn(IST), inr: "1234.5", vendor: ftag("Csv Vendor"), notes: expenseNotes });
});

test("Income table 'Export CSV' downloads the visible rows", async ({ page }) => {
  await reloadFinanceTab(page, "Income");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).first().click()]);
  expect(dl.suggestedFilename()).toBe("income.csv");
  const body = fs.readFileSync(await dl.path(), "utf8");
  expect(body).toContain(incomeNotes);
  expect(body).toContain("4321.09");
  // filtered to this run -> only this run's rows
  const lines = body.trim().split(/\r?\n/).slice(1);
  expect(lines.every((l) => l.includes(FRUN))).toBe(true);
});

test("header 'Income CSV' / 'Expenses CSV' export the selected month with the new rows", async ({ page }) => {
  await gotoFinance(page);
  for (const [label, notes, amount] of [["Income CSV", incomeNotes, "4321.09"], ["Expenses CSV", expenseNotes, "1234.5"]] as const) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: label }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^b2-(income|expenses)-.*\.csv$/);
    const body = fs.readFileSync(await dl.path(), "utf8");
    const row = body.split(/\r?\n/).find((l) => l.includes(notes));
    expect(row, `${label} contains ${notes}`).toBeTruthy();
    expect(row).toContain(amount);
  }
});

test("Expenses table 'Export CSV' downloads rows", async ({ page }) => {
  await reloadFinanceTab(page, "Expenses");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).first().click()]);
  expect(dl.suggestedFilename()).toBe("expenses.csv");
  expect(fs.readFileSync(await dl.path(), "utf8")).toContain(expenseNotes);
});

test("non-admin cannot download the finance export", async ({ browser }) => {
  test.skip(!fs.existsSync(authFile("head")), "no HEAD session for this target");
  const ctx = await browser.newContext({ storageState: authFile("head") });
  const res = await ctx.request.get("/api/export/income", { maxRedirects: 0 });
  const body = await res.text();
  expect(body.includes(incomeNotes), `HEAD role received income rows (status ${res.status()})`).toBe(false);
  await ctx.close();
});
