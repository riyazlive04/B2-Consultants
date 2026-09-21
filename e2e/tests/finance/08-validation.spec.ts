import { test, expect, Page, Locator } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { recordCreated } from "../../helpers/target";
import {
  ftag, fname, IST, addDays, expenseForm, gotoFinance, incomeForm, openTab, pendingForm, pickOption,
  selectTrigger, tableRows, todayIn,
} from "../../helpers/finance-ui";
import { ensureRunFilter, fillExpense, fillIncome, reloadFinanceTab } from "../../helpers/finance-flows";

/** Validation on the money forms: zero/negative/empty amounts, required fields, bad plans, double submit. */
test.describe.configure({ mode: "default" });
test.use({ storageState: authFile("admin") });

const today = todayIn(IST);

/** Submit and report what happened: the form's error text, or "saved" when the row appears. */
async function submitOutcome(page: Page, form: Locator, button: string, notes: string): Promise<string> {
  await ensureRunFilter(page);
  await form.getByRole("button", { name: button }).click();
  const row = tableRows(page, notes);
  const alert = form.getByRole("alert");
  await expect(row.or(alert).first()).toBeVisible({ timeout: 30_000 });
  if (await alert.isVisible()) return (await alert.innerText()).trim();
  return "saved";
}

test("income with no amount in either currency is refused", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  const notes = ftag("val no amount");
  await fillIncome(page, form, { student: fname("Val Payer"), notes });
  expect(await submitOutcome(page, form, "Add income", notes)).toMatch(/Enter an amount in INR, EUR, or both/);
});

test("income of 0.00 is refused (FIN-14)", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  const notes = ftag("val zero income");
  await fillIncome(page, form, { student: fname("Val Zero"), inr: "0.00", notes });
  const out = await submitOutcome(page, form, "Add income", notes);
  if (out === "saved") recordCreated("finance", { kind: "Income", label: notes, cleanup: "Finance > Income: Delete, then Archived > Delete permanently" });
  expect(out, "FIN-14: a ₹0.00 income is accepted (requireSomeAmount only checks the box is non-empty) and posts a zero ledger entry").not.toBe("saved");
});

test("expense of 0 is refused (FIN-14)", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, "Expenses");
  const form = expenseForm(page);
  const notes = ftag("val zero expense");
  await fillExpense(page, form, { inr: "0", vendor: ftag("Zero Vendor"), notes });
  const out = await submitOutcome(page, form, "Add expense", notes);
  if (out === "saved") recordCreated("finance", { kind: "Expense", label: notes, cleanup: "Finance > Expenses: Delete, then Archived > Delete permanently" });
  expect(out, "FIN-14: a ₹0 expense is accepted").not.toBe("saved");
});

test("pending payment with a total fee of 0 is refused (FIN-14)", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, /^Pending payments/);
  const form = pendingForm(page);
  const S = fname("Val Zero Fee");
  await form.locator('input[name="studentName"]').fill(S);
  await form.locator('input[name="totalFeeInr"]').fill("0");
  await form.locator('input[name="notes"]').fill(ftag("val zero fee"));
  const out = await submitOutcome(page, form, "Add pending payment", S);
  if (out === "saved") recordCreated("finance", { kind: "PendingPayment", label: S, cleanup: "Finance > Pending payments: Delete, then Archived > Delete permanently" });
  expect(out, "FIN-14: a receivable with a ₹0 total fee is accepted").not.toBe("saved");
});

test("negative amounts cannot be typed (money fields strip the minus sign)", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  const box = form.locator('input[name="amountInr"]');
  await box.pressSequentially("-500.456");
  await expect(box).toHaveValue("500.45");
});

test("student name is required (native validation blocks the submit)", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  const notes = ftag("val no student");
  await form.locator('input[name="amountInr"]').fill("10");
  await form.locator('input[name="notes"]').fill(notes);
  await form.getByRole("button", { name: "Add income" }).click();
  expect(await form.locator('input[name="studentName"]').evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
  await reloadFinanceTab(page, "Income");
  await expect(tableRows(page, notes)).toHaveCount(0);
});

test("instalment plan rules: count required, dates after the payment, count matches dates", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  const S = fname("Val Plan");
  // due date BEFORE the payment date
  await fillIncome(page, form, {
    date: today, student: S, inr: "1000", type: "Instalment", instalmentCount: "2",
    schedule: [{ date: addDays(today, -1), inr: "1000" }], notes: ftag("val plan past"),
  });
  expect(await submitOutcome(page, form, "Add income", ftag("val plan past"))).toMatch(/Instalment dates must be after the payment date/);

  // count says 3 but only one further date
  await gotoFinance(page);
  await fillIncome(page, incomeForm(page), {
    date: today, student: S, inr: "1000", type: "Instalment", instalmentCount: "3",
    schedule: [{ date: addDays(today, 30), inr: "1000" }], notes: ftag("val plan mismatch"),
  });
  expect(await submitOutcome(page, incomeForm(page), "Add income", ftag("val plan mismatch"))).toMatch(/3-instalment plan needs 2 more due dates/);

  // a due date with no amount
  await gotoFinance(page);
  await fillIncome(page, incomeForm(page), {
    date: today, student: S, inr: "1000", type: "Instalment", instalmentCount: "2",
    schedule: [{ date: addDays(today, 30) }], notes: ftag("val plan no amount"),
  });
  expect(await submitOutcome(page, incomeForm(page), "Add income", ftag("val plan no amount"))).toMatch(/Enter how much is due/);
});

test("double-clicking 'Add income' records the payment once", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  const notes = ftag("val double submit");
  await fillIncome(page, form, { student: fname("Val Double"), inr: "321", notes });
  await ensureRunFilter(page);
  await form.getByRole("button", { name: "Add income" }).dblclick();
  await expect(tableRows(page, notes).first()).toBeVisible({ timeout: 30_000 });
  recordCreated("finance", { kind: "Income", label: notes, cleanup: "Finance > Income: Delete (each duplicate), then Archived > Delete permanently" });
  await page.waitForTimeout(3000);
  await reloadFinanceTab(page, "Income");
  await expect(tableRows(page, notes), "double submit created duplicate income rows").toHaveCount(1);
});

test("pressing Enter twice in the expense form records the expense once", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, "Expenses");
  const form = expenseForm(page);
  const notes = ftag("val double enter");
  await fillExpense(page, form, { inr: "123", vendor: ftag("Double Vendor"), notes });
  await ensureRunFilter(page);
  const notesBox = form.locator('input[name="notes"]');
  await notesBox.press("Enter");
  await notesBox.press("Enter").catch(() => undefined);
  await expect(page.getByText("Expense added").first()).toBeVisible({ timeout: 30_000 });
  recordCreated("finance", { kind: "Expense", label: notes, cleanup: "Finance > Expenses: Delete (each duplicate), then Archived > Delete permanently" });
  await page.waitForTimeout(3000);
  await reloadFinanceTab(page, "Expenses");
  await expect(tableRows(page, notes), "double Enter created duplicate expense rows").toHaveCount(1);
});

test("payable with amount 0 is refused (FIN-14)", async ({ page }) => {
  await page.goto("/cash");
  await openTab(page, "Payables");
  await page.getByRole("button", { name: "Add payable" }).click();
  const form = page.locator('form:has(input[name="name"]):has(select[name="frequency"])').first();
  const name = ftag("Val zero payable");
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="amountInr"]').fill("0");
  await form.getByRole("button", { name: "Add payable" }).click();
  const alert = form.getByRole("alert");
  const saved = page.locator("table tbody tr").filter({ hasText: name });
  await expect(alert.or(saved).first()).toBeVisible({ timeout: 30_000 });
  if (await saved.count()) recordCreated("finance", { kind: "Payable", label: name, cleanup: "Cash Health > Payables: Delete" });
  expect(await saved.count(), "FIN-14: a ₹0 payable is accepted").toBe(0);
});
