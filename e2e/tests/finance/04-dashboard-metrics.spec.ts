import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";

import {
  ftag, FRUN, IST, KpiRead, addDays, fname, gotoFinance, incomeForm, isGermanEur, isIndianInr, openTab,
  parseEur, parseInr, readKpi, todayIn,
} from "../../helpers/finance-ui";
import { addExpense, addIncome, dbIncome } from "../../helpers/finance-flows";

/**
 * PRD1 §4.5 Finance dashboard - every metric proven by DELTA: read the full-precision popups,
 * add known income/expenses through the UI, read again. Other agents may write concurrently,
 * so the deltas are taken back-to-back and the identities (gross = revenue - COGS, net =
 * revenue - expenses, margin = net / revenue) are checked on the same rendered page.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

type Snap = {
  net: KpiRead; gross: KpiRead; cogs: KpiRead; expenses: KpiRead; receivables: KpiRead; ytd: KpiRead;
  margin: string;
};

async function snapshot(page: Page): Promise<Snap> {
  await gotoFinance(page);
  const margin = (await page.locator("button", { has: page.locator('span[title="Profit margin"]') }).locator("div.font-display").innerText()).trim();
  return {
    net: await readKpi(page, "Net profit"),
    gross: await readKpi(page, "Gross profit"),
    cogs: await readKpi(page, "COGS this month"),
    expenses: await readKpi(page, "Expenses this month"),
    receivables: await readKpi(page, "Pending receivables"),
    ytd: await readKpi(page, "Yearly revenue to date"),
    margin,
  };
}

const inr = (s: string | undefined) => parseInr(s ?? "0");
const eur = (s: string | null | undefined) => parseEur(s ?? "0");

let before: Snap;
let after: Snap;
let eurIncomeInrPaise = 0; // the €100.00 income's INR aggregate at its stamped rate
let eurRate = 0;

test("capture metrics, add known income + expenses, capture again", async ({ page }) => {
  test.setTimeout(300_000);
  before = await snapshot(page);

  // Read the rate the form will stamp (AmountPair hint: "at ₹104.12/€ · ECB ...").
  await gotoFinance(page);
  const form = incomeForm(page);
  await form.locator('input[name="amountEur"]').fill("100");
  const hint = await form.getByText(/Converted at ₹[\d,.]+\/€/).first().innerText();
  eurRate = inr(hint.match(/₹[\d,.]+/)![0]) / 100;
  await form.locator('input[name="amountEur"]').fill("");

  const d = todayIn(IST);
  await addIncome(page, { date: d, student: fname("Metric Guided"), inr: "11111.11", level: "Guided", method: "UPI", notes: ftag("metric income INR") });
  await addIncome(page, { date: d, student: fname("Metric Solo"), eur: "100", level: "Solo", method: "PayPal", notes: ftag("metric income EUR") });
  await openTab(page, "Expenses");
  await addExpense(page, { date: d, inr: "2222.22", category: "COGS - Direct Delivery Cost", vendor: ftag("Tutor"), notes: ftag("metric expense COGS"), cogs: true });
  await addExpense(page, { date: d, inr: "3333.33", category: "Marketing (Meta Ads, Google Ads, Influencers)", vendor: ftag("Meta"), notes: ftag("metric expense ads"), cogs: false });

  if (HAS_DB) {
    const [row] = await dbIncome(ftag("metric income EUR"));
    eurRate = Number(row.fx);
  }
  eurIncomeInrPaise = Math.round(10000 * eurRate);
  after = await snapshot(page);
});

test("revenue this month moves by exactly the income added (INR + EUR converted)", async () => {
  const dRev = inr(after.net.rows["Revenue (money in)"]) - inr(before.net.rows["Revenue (money in)"]);
  const tol = HAS_DB ? 1 : 100; // prod: rate read from a 2-decimal hint
  expect(Math.abs(dRev - (1111111 + eurIncomeInrPaise)), `revenue delta ${dRev}`).toBeLessThanOrEqual(tol);
});

test("expenses and COGS move by exactly the expenses added", async () => {
  expect(inr(after.expenses.primary) - inr(before.expenses.primary)).toBe(555555);
  expect(inr(after.cogs.primary) - inr(before.cogs.primary)).toBe(222222);
});

test("gross profit = revenue - COGS and net profit = revenue - all expenses (same page)", async () => {
  const rev = inr(after.gross.rows["Revenue"]);
  expect(inr(after.gross.primary)).toBe(rev - inr(after.gross.rows["COGS (delivery)"]));
  expect(inr(after.gross.rows["COGS (delivery)"])).toBe(inr(after.cogs.primary));
  expect(inr(after.net.primary)).toBe(inr(after.net.rows["Revenue (money in)"]) - inr(after.expenses.primary));
  expect(inr(after.net.rows["All costs (money out)"])).toBe(inr(after.expenses.primary));
});

test("profit margin % = net / revenue x 100, one decimal", async () => {
  const rev = inr(after.net.rows["Revenue (money in)"]);
  const net = inr(after.net.primary);
  const want = rev > 0 ? Math.round((net / rev) * 1000) / 10 : 0;
  expect(Number(after.margin.replace(/[%,]/g, ""))).toBeCloseTo(want, 1);
});

test("revenue by level: Guided and Solo move by their incomes", async () => {
  const g = inr(after.ytd.rows["Guided"]) - inr(before.ytd.rows["Guided"] ?? "₹0");
  const s = inr(after.ytd.rows["Solo"]) - inr(before.ytd.rows["Solo"] ?? "₹0");
  expect(g).toBe(1111111);
  expect(Math.abs(s - eurIncomeInrPaise)).toBeLessThanOrEqual(HAS_DB ? 1 : 100);
  // PRD1 §4.5 breakdown: Solo | Guided | Elite | German Note
  for (const k of ["Solo", "Guided", "Elite", "German Note"]) expect(Object.keys(after.ytd.rows)).toContain(k);
});

test("yearly revenue to date moves by the same amount as this month's revenue", async () => {
  const dYtd = inr(after.ytd.primary) - inr(before.ytd.primary);
  const dRev = inr(after.net.rows["Revenue (money in)"]) - inr(before.net.rows["Revenue (money in)"]);
  expect(dYtd).toBe(dRev);
});

test("INR figures use Indian grouping and EUR figures German grouping (PRD1 §6)", async () => {
  const bad: string[] = [];
  for (const [k, v] of Object.entries(after)) {
    if (typeof v === "string") continue;
    if (!isIndianInr(v.primary)) bad.push(`${k} INR "${v.primary}"`);
    if (v.secondary && !isGermanEur(v.secondary)) bad.push(`${k} EUR "${v.secondary}"`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

test("gross and net profit carry an info tooltip in plain English", async ({ page }) => {
  await gotoFinance(page);
  for (const [label, text] of [
    ["Gross profit", /Gross Profit = Revenue minus only delivery costs/],
    ["Net profit", /Net Profit = Revenue minus all costs/],
  ] as const) {
    const card = page.locator("button", { has: page.locator(`span[title="${label}"]`) });
    const hint = card.getByLabel(text);
    await expect(hint).toHaveCount(1);
    await hint.hover();
    // The bubble is aria-hidden (the icon's aria-label is what AT reads), so query it by role attribute.
    await expect(page.locator('[role="tooltip"]').filter({ hasText: text }).first()).toBeVisible();
  }
});

test("EUR toggle leads with euros using the stamped-rate aggregate", async ({ page }) => {
  await gotoFinance(page);
  await page.getByRole("button", { name: "€ EUR" }).click();
  const net = await readKpi(page, "Net profit");
  expect(isGermanEur(net.primary), net.primary).toBe(true);
  expect(isIndianInr(net.secondary ?? ""), String(net.secondary)).toBe(true);
  await page.getByRole("button", { name: "₹ INR" }).click();
});

/**
 * The page has a period switch (Week/Month/.../Custom). The KPI cards follow it, but "Top 5
 * payments" and "Expenses by category" are filtered with today's month key (page.tsx
 * `monthKey = today.slice(0, 7)`), so any other month shows them empty next to non-zero totals.
 */
test("viewing last month: Top 5 payments lists last month's income (FIN-11)", async ({ page }) => {
  const lastMonthDay = addDays({ ...todayIn(IST), d: 1 }, -10);
  const notes = ftag("metric last-month income");
  const student = fname("Last Month Payer");
  await gotoFinance(page);
  await addIncome(page, { date: lastMonthDay, student, inr: "98765", level: "Elite", method: "Cash", notes });
  const on = `${lastMonthDay.y}-${String(lastMonthDay.m).padStart(2, "0")}-01`;
  await gotoFinance(page, `?period=month&on=${on}`);
  const rev = await readKpi(page, "Net profit");
  expect(inr(rev.rows["Revenue (money in)"])).toBeGreaterThanOrEqual(9876500);
  // Every "Top 5 payments" row must be dated inside the month being viewed.
  const topText = await page
    .locator("xpath=//*[normalize-space(text())='Top 5 payments']/ancestor::*[.//ol][1]//ol")
    .first()
    .innerText();
  const mm = `/${String(lastMonthDay.m).padStart(2, "0")}/${lastMonthDay.y}`;
  const dates = topText.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
  const outside = dates.filter((d) => !d.endsWith(mm));
  await test.info().attach("top5-last-month", { body: topText, contentType: "text/plain" });
  expect(
    outside,
    `FIN-11: viewing ${mm.slice(1)} the revenue KPI follows the period, but "Top 5 payments" lists entries dated ${outside.join(", ")} (current month)`,
  ).toEqual([]);
});
