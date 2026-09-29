import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { watchErrors } from "../../helpers/app";
import {
  ftag, FRUN, IST, addDays, dmyStr, fname, gotoFinance, incomeForm, openTab, rowByHeader, selectOptions,
  tableRows, todayIn, ymdStr, dateTrigger, selectTrigger, isIndianInr, isGermanEur,
} from "../../helpers/finance-ui";
import { addIncome, dbIncome, ensureRunFilter, reloadFinanceTab, waitSaved } from "../../helpers/finance-flows";
import { recordCreated } from "../../helpers/target";

/**
 * PRD1 §4.2 Daily income entry - every field, INR and EUR, level/type/method, round-tripped
 * through save + reload (list row, edit form, and locally the stored row).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

test("income form offers the PRD dropdown options and defaults the date to today", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  expect(await selectOptions(form, "programLevel")).toEqual(
    expect.arrayContaining(["Solo", "Guided", "Elite", "GN A1", "GN A2", "GN B1", "GN B2", "GN Bundle", "Other"]),
  );
  expect(await selectOptions(form, "paymentType")).toEqual(["Full payment", "Instalment"]);
  expect(await selectOptions(form, "paymentMethod")).toEqual(
    expect.arrayContaining(["Bank transfer (INR)", "Bank transfer (EUR)", "PayPal", "Razorpay", "Cash", "UPI", "Credit Card", "Other"]),
  );
  // PRD: "Defaults to today"; the app's business day is IST.
  await expect(dateTrigger(form, "date")).toContainText(dmyStr(todayIn(IST)));
});

test("INR full payment round-trips exactly (list, edit form, DB)", async ({ page }) => {
  const errs = watchErrors(page);
  const date = addDays(todayIn(IST), -2);
  const notes = ftag("income INR full");
  const student = fname("Inr Payer");
  await gotoFinance(page);
  await addIncome(page, {
    date, student, inr: "12345.67", level: "Elite", type: "Full payment", method: "Bank transfer (INR)", notes,
  });

  await reloadFinanceTab(page, "Income");
  const row = tableRows(page, notes);
  await expect(row).toHaveCount(1);
  const r = await rowByHeader(row);
  expect(r["DATE"]).toBe(dmyStr(date));
  expect(r["STUDENT"]).toContain(student);
  expect(r["RECEIVED ₹"]).toBe("₹12,345.67");
  expect(isIndianInr(r["RECEIVED ₹"])).toBe(true);
  expect(r["RECEIVED €"]).toBe("-");
  expect(r["LEVEL"]).toBe("Elite");
  expect(r["TYPE"]).toBe("Full payment");
  expect(r["METHOD"]).toBe("Bank transfer (INR)");
  expect(r["NOTES"]).toBe(notes);

  // The edit form must show exactly what was entered.
  await row.getByRole("button", { name: "Edit" }).click();
  const form = incomeForm(page);
  await expect(page.getByText(`Edit income - ${student}`)).toBeVisible();
  await expect(dateTrigger(form, "date")).toContainText(dmyStr(date));
  await expect(form.locator('input[name="studentName"]')).toHaveValue(student);
  await expect(form.locator('input[name="amountInr"]')).toHaveValue("12345.67");
  await expect(selectTrigger(form, "programLevel")).toContainText("Elite");
  await expect(selectTrigger(form, "paymentType")).toContainText("Full payment");
  await expect(selectTrigger(form, "paymentMethod")).toContainText("Bank transfer (INR)");
  await expect(form.locator('input[name="notes"]')).toHaveValue(notes);

  if (HAS_DB) {
    const [db] = await dbIncome(notes);
    expect(db.date).toBe(ymdStr(date));
    expect(db.inr).toBe("1234567");
    expect(db.eur).toBe("0");
    expect(db.programLevel).toBe("ELITE");
    expect(db.paymentType).toBe("FULL_PAYMENT");
    expect(db.paymentMethod).toBe("BANK_TRANSFER_INR");
  }
  errs.assertClean();
});

test("EUR payment round-trips exactly and is stored in EUR only", async ({ page }) => {
  const date = addDays(todayIn(IST), -1);
  const notes = ftag("income EUR full");
  const student = fname("Eur Payer");
  await gotoFinance(page);
  await addIncome(page, { date, student, eur: "1250.50", level: "GN A1", method: "PayPal", notes });

  await reloadFinanceTab(page, "Income");
  const row = tableRows(page, notes);
  await expect(row).toHaveCount(1);
  const r = await rowByHeader(row);
  expect(r["DATE"]).toBe(dmyStr(date));
  expect(r["RECEIVED €"].replace(/\s/g, " ")).toBe("1.250,50 €");
  expect(isGermanEur(r["RECEIVED €"])).toBe(true);
  expect(r["RECEIVED ₹"]).toBe("-");
  expect(r["LEVEL"]).toBe("GN A1");
  expect(r["METHOD"]).toBe("PayPal");

  await row.getByRole("button", { name: "Edit" }).click();
  const form = incomeForm(page);
  await expect(form.locator('input[name="amountEur"]')).toHaveValue("1250.50");
  await expect(selectTrigger(form, "programLevel")).toContainText("GN A1");

  if (HAS_DB) {
    const [db] = await dbIncome(notes);
    expect(db.inr).toBe("0");
    expect(db.eur).toBe("125050");
    expect(Number(db.fx)).toBeGreaterThan(50); // INR per EUR stamped at entry
  }
});

test("payment split across INR and EUR stores both amounts as entered", async ({ page }) => {
  const notes = ftag("income split");
  await gotoFinance(page);
  const form = incomeForm(page);
  await form.locator('input[name="studentName"]').fill(fname("Split Payer"));
  await page.keyboard.press("Escape");
  await form.locator('input[name="amountInr"]').fill("5000");
  // Typing INR mirrors a converted EUR figure into a disabled box - switch to "each separately".
  await expect(form.locator('input[name="amountEur"]')).toBeDisabled();
  await form.getByRole("button", { name: "Enter each currency separately" }).click();
  await form.locator('input[name="amountEur"]').fill("40");
  await form.locator('input[name="notes"]').fill(notes);
  await ensureRunFilter(page);
  await form.getByRole("button", { name: "Add income" }).click();
  await waitSaved(page, form, notes);
  recordCreated("finance", { kind: "Income", label: notes, cleanup: "Finance > Income: Delete, then Archived > Delete permanently" });

  await reloadFinanceTab(page, "Income");
  const r = await rowByHeader(tableRows(page, notes));
  expect(r["RECEIVED ₹"]).toBe("₹5,000.00");
  expect(r["RECEIVED €"].replace(/\s/g, " ")).toBe("40,00 €");
  if (HAS_DB) {
    const [db] = await dbIncome(notes);
    expect([db.inr, db.eur]).toEqual(["500000", "4000"]);
  }
});

test("editing an income (method, level, amount, notes) persists after reload", async ({ page }) => {
  const notes = ftag("income to edit");
  await gotoFinance(page);
  await addIncome(page, { student: fname("Edit Payer"), inr: "700", level: "Solo", method: "Cash", notes });
  await reloadFinanceTab(page, "Income");
  await tableRows(page, notes).getByRole("button", { name: "Edit" }).click();
  const form = incomeForm(page);
  await form.locator('input[name="amountInr"]').fill("750.25");
  const { pickOption } = await import("../../helpers/finance-ui");
  await pickOption(page, selectTrigger(form, "paymentMethod"), "Razorpay");
  await pickOption(page, selectTrigger(form, "programLevel"), "GN Bundle");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Daily income entry" })).toBeVisible();

  await reloadFinanceTab(page, "Income");
  const r = await rowByHeader(tableRows(page, notes));
  expect(r["RECEIVED ₹"]).toBe("₹750.25");
  expect(r["METHOD"]).toBe("Razorpay");
  expect(r["LEVEL"]).toBe("GN Bundle");
  // An edit must not have created a second row.
  await expect(tableRows(page, notes)).toHaveCount(1);
  expect(FRUN).toBeTruthy();
});
