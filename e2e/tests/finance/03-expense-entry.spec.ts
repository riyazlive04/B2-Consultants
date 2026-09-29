import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";

import {
  ftag, FRUN, IST, addDays, dmyStr, expenseForm, gotoFinance, openTab, rowByHeader, selectOptions, selectTrigger,
  tableRows, todayIn, isGermanEur, isIndianInr,
} from "../../helpers/finance-ui";
import { addExpense, dbExpense, reloadFinanceTab } from "../../helpers/finance-flows";

/** PRD1 §4.3 Daily expense entry - categories, COGS toggle, vendor, INR/EUR, business line. */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const CATEGORIES = [
  "Marketing (Meta Ads, Google Ads, Influencers)",
  "Tools and Software",
  "Team Salaries and Commissions",
  "Content Creation",
  "Events and Offline",
  "Operations",
  "COGS - Direct Delivery Cost",
  "Other",
];

test("expense form offers all eight PRD categories and a COGS toggle", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, "Expenses");
  const form = expenseForm(page);
  const offered = await selectOptions(form, "category");
  expect(offered).toHaveLength(8);
  // Labels are allowed to differ in wording; each PRD category must be recognisable.
  for (const key of ["Marketing", "Tools", "Salaries", "Content", "Events", "Operations", "COGS", "Other"]) {
    expect(offered.some((o) => o.includes(key)), `category containing "${key}" in [${offered.join(" | ")}]`).toBe(true);
  }
  await expect(form.getByText("Is this COGS?")).toBeVisible();
  await expect(form.locator('input[name="isCogs"]')).not.toBeChecked();
});

test("one expense per category round-trips (category, COGS flag, vendor, amount, date)", async ({ page }) => {
  test.setTimeout(300_000);
  await gotoFinance(page);
  await openTab(page, "Expenses");
  const offered = await selectOptions(expenseForm(page), "category");
  const date = addDays(todayIn(IST), -1);
  for (let i = 0; i < offered.length; i++) {
    await addExpense(page, {
      date, inr: `${200 + i}.${10 + i}`, category: offered[i], vendor: ftag(`Vendor ${i}`),
      notes: ftag(`expense-cat ${i}`), cogs: i % 2 === 0,
    });
  }
  await reloadFinanceTab(page, "Expenses");
  const problems: string[] = [];
  for (let i = 0; i < offered.length; i++) {
    const r = await rowByHeader(tableRows(page, ftag(`expense-cat ${i}`)));
    const isCogsCategory = /COGS/i.test(offered[i]);
    const wantCogs = i % 2 === 0 || isCogsCategory; // the COGS category is always COGS
    if (r["CATEGORY"] !== offered[i]) problems.push(`cat ${i}: ${r["CATEGORY"]} != ${offered[i]}`);
    if (r["COGS"] !== (wantCogs ? "Yes" : "No")) problems.push(`cogs ${i} (${offered[i]}): ${r["COGS"]}`);
    if (r["PAID TO"] !== ftag(`Vendor ${i}`)) problems.push(`vendor ${i}: ${r["PAID TO"]}`);
    if (r["PAID ₹"] !== `₹${200 + i}.${10 + i}`) problems.push(`amount ${i}: ${r["PAID ₹"]}`);
    if (!isIndianInr(r["PAID ₹"])) problems.push(`format ${i}: ${r["PAID ₹"]}`);
    if (r["DATE"] !== dmyStr(date)) problems.push(`date ${i}: ${r["DATE"]}`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("EUR expense with business line is stored in EUR and edits keep the COGS toggle", async ({ page }) => {
  const notes = ftag("expense EUR GN");
  await gotoFinance(page);
  await openTab(page, "Expenses");
  await addExpense(page, {
    eur: "1234.56", category: "Tools and Software", businessLine: "German Note only", vendor: ftag("Zoho One"), notes, cogs: true,
  });
  await reloadFinanceTab(page, "Expenses");
  const row = tableRows(page, notes);
  const r = await rowByHeader(row);
  expect(r["PAID €"].replace(/\s/g, " ")).toBe("1.234,56 €");
  expect(isGermanEur(r["PAID €"])).toBe(true);
  expect(r["PAID ₹"]).toBe("-");
  expect(r["BUSINESS LINE"]).toBe("German Note");
  expect(r["COGS"]).toBe("Yes");

  // Untick COGS via edit.
  await row.getByRole("button", { name: "Edit" }).click();
  const form = expenseForm(page);
  await expect(form.locator('input[name="isCogs"]')).toBeChecked();
  await expect(selectTrigger(form, "businessLine")).toContainText("German Note only");
  await expect(form.locator('input[name="amountEur"]')).toHaveValue("1234.56");
  await form.getByText("Is this COGS?").click();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Daily expense entry" })).toBeVisible();
  await reloadFinanceTab(page, "Expenses");
  expect((await rowByHeader(tableRows(page, notes)))["COGS"]).toBe("No");
  if (HAS_DB) {
    const [db] = await dbExpense(notes);
    expect([db.inr, db.eur, db.isCogs, db.businessLine]).toEqual(["0", "123456", false, "GERMAN_NOTE"]);
  }
});

test("vendor is required", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, "Expenses");
  const form = expenseForm(page);
  await form.locator('input[name="amountInr"]').fill("10");
  await form.locator('input[name="notes"]').fill(ftag("no vendor"));
  await form.getByRole("button", { name: "Add expense" }).click();
  // Native `required` blocks the submit - the vendor box reports invalid and nothing is saved.
  const valid = await form.locator('input[name="vendor"]').evaluate((e: HTMLInputElement) => e.validity.valid);
  expect(valid).toBe(false);
  await reloadFinanceTab(page, "Expenses");
  await expect(tableRows(page, ftag("no vendor"))).toHaveCount(0);
});
