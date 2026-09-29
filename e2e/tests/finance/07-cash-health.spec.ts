import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD, recordCreated } from "../../helpers/target";
import { q } from "../../helpers/db";
import {
  ftag, fname, IST, addDays, dateTrigger, dmyStr, gotoFinance, openTab, parseInr, pendingForm, pickDate,
  pickOption, readKpi, rowByHeader, selectTrigger, tableRows, todayIn, ymdStr,
} from "../../helpers/finance-ui";
import { addPending, reloadFinanceTab } from "../../helpers/finance-flows";

/** PRD3 §4 Cash Health - receivables auto-pull, payables, runway, top-bar badge. */
test.describe.configure({ mode: "default" });
test.use({ storageState: authFile("admin") });

const today = todayIn(IST);

const kpiAbove = (page: Page, labelStartsWith: string) =>
  page.locator(`xpath=//p[starts-with(normalize-space(.),'${labelStartsWith}')]/preceding-sibling::p[1]`).first();
const valueBelow = (page: Page, label: string) =>
  page.locator(`xpath=//p[normalize-space(.)='${label}']/following-sibling::p[1]`).first();

async function gotoCash(page: Page) {
  await page.goto("/cash");
  await expect(page.getByRole("heading", { name: "Cash Health", exact: true })).toBeVisible();
}
async function cashReceivableRow(page: Page, student: string) {
  await gotoCash(page);
  await openTab(page, /^Receivables/);
  const panel = page.getByRole("tabpanel");
  await panel.getByPlaceholder("Filter students…").fill(student);
  return tableRows(panel, student);
}

// ───────────────────────────── receivables ─────────────────────────────

test("receivables are pulled from Finance pending payments and follow an edit made in Finance", async ({ page }) => {
  const S = fname("Cash Pull Student");
  const due = addDays(today, 10);
  await gotoCash(page);
  const totalBefore = parseInr(await kpiAbove(page, "Receivables ·").innerText());
  const next30Before = parseInr(await kpiAbove(page, "Expected in next 30 days").innerText());

  await gotoFinance(page);
  await openTab(page, /^Pending payments/);
  await addPending(page, { student: S, level: "Guided", feeInr: "12000", due, status: "Active", notes: ftag("cash pull") });

  let row = await cashReceivableRow(page, S);
  await expect(row).toHaveCount(1);
  let r = await rowByHeader(row);
  expect(r["BALANCE"]).toBe("₹12,000.00");
  expect(r["NEXT DUE"]).toBe(dmyStr(due));
  expect(r["STATUS"]).toBe("On schedule");
  expect(parseInr(await kpiAbove(page, "Receivables ·").innerText()) - totalBefore).toBe(1200000);
  expect(parseInr(await kpiAbove(page, "Expected in next 30 days").innerText()) - next30Before).toBe(1200000);

  // Change the pending payment in Finance -> Cash Health must follow (PRD3 §6).
  await reloadFinanceTab(page, /^Pending payments/);
  await tableRows(page, S).getByRole("button", { name: "Edit" }).click();
  const form = pendingForm(page);
  await form.locator('input[name="totalFeeInr"]').fill("15000");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Add pending payment" })).toBeVisible();
  row = await cashReceivableRow(page, S);
  r = await rowByHeader(row);
  expect(r["BALANCE"]).toBe("₹15,000.00");
});

test("a receivable whose status is Overdue still counts in Cash Health receivables (FIN-13)", async ({ page }) => {
  const S = fname("Cash Overdue Status");
  await gotoFinance(page);
  await openTab(page, /^Pending payments/);
  await addPending(page, { student: S, level: "Elite", feeInr: "8000", due: addDays(today, -20), status: "Overdue", notes: ftag("cash overdue status") });
  // Finance counts it as an open, overdue receivable...
  await reloadFinanceTab(page, /^Pending payments/);
  const fin = await rowByHeader(tableRows(page, S));
  expect(fin["STATUS"]).toBe("Overdue");
  // ...Cash Health must too (PRD3 §4.2 "sum of all active balance pending amounts").
  const row = await cashReceivableRow(page, S);
  await expect(
    row,
    "FIN-13: Cash Health receivables filter status === ACTIVE only (cash-metrics.ts:103) while Finance counts ACTIVE + OVERDUE - a receivable marked Overdue vanishes from Cash Health total/overdue/oldest-overdue",
  ).toHaveCount(1, { timeout: 5000 });
});

test("Finance 'Pending receivables' equals Cash Health 'Total receivables' (same moment)", async ({ page }) => {
  await gotoFinance(page);
  const fin = await readKpi(page, "Pending receivables");
  await gotoCash(page);
  const cash = parseInr(await kpiAbove(page, "Receivables ·").innerText());
  expect(
    Math.abs(Math.round(parseInr(fin.primary) / 100) - Math.round(cash / 100)),
    `FIN-13: Finance pending receivables ${fin.primary} vs Cash Health receivables ₹${cash / 100}`,
  ).toBeLessThanOrEqual(1);
});

// ───────────────────────────── payables ─────────────────────────────

async function addPayable(page: Page, v: { name: string; category?: string; amount: string; frequency: string; due?: ReturnType<typeof todayIn>; cogs?: boolean; status?: string }) {
  await gotoCash(page);
  await openTab(page, "Payables");
  await page.getByRole("button", { name: "Add payable" }).click();
  const form = page.locator('form:has(input[name="name"]):has(select[name="frequency"])').first();
  await form.locator('input[name="name"]').fill(v.name);
  if (v.category) await pickOption(page, selectTrigger(form, "category"), v.category);
  await form.locator('input[name="amountInr"]').fill(v.amount);
  await pickOption(page, selectTrigger(form, "frequency"), v.frequency);
  if (v.due) await pickDate(page, dateTrigger(form, "nextDueDate"), v.due);
  if (v.status) await pickOption(page, selectTrigger(form, "status"), v.status);
  if (v.cogs) await form.getByText("Is this COGS?").click();
  await form.getByRole("button", { name: "Add payable" }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  recordCreated("finance", { kind: "Payable", label: v.name, cleanup: "Cash Health > Payables: Delete (hard delete)" });
}

const breakEven = async (page: Page) => {
  await gotoCash(page);
  return parseInr(await valueBelow(page, "Break-even revenue / month").innerText());
};

test("payables CRUD: frequencies feed break-even (monthly equivalent), paused/one-time excluded, delete", async ({ page }) => {
  test.setTimeout(300_000);
  const base = await breakEven(page);
  const M = ftag("Payable monthly");
  const Q = ftag("Payable quarterly");
  const A = ftag("Payable annual");
  const O = ftag("Payable one-time");
  await addPayable(page, { name: M, category: "Tools and Software", amount: "30000", frequency: "Monthly", due: addDays(today, 20), cogs: true });
  await addPayable(page, { name: Q, amount: "9000", frequency: "Quarterly", due: addDays(today, 40) });
  await addPayable(page, { name: A, amount: "12000", frequency: "Annual", due: addDays(today, 100) });
  await addPayable(page, { name: O, amount: "50000", frequency: "One-time" });

  expect(await breakEven(page) - base, "break-even = monthly + quarterly/3 + annual/12").toBe(3000000 + 300000 + 100000);
  await expect(page.getByText(/already committed in \d+ one-time payable/)).toBeVisible();

  await openTab(page, "Payables");
  const row = tableRows(page, M);
  const r = await rowByHeader(row);
  expect([r["AMOUNT"], r["FREQUENCY"], r["COGS"], r["STATUS"], r["NEXT DUE"]]).toEqual(["₹30,000.00", "Monthly", "Yes", "Active", dmyStr(addDays(today, 20))]);
  expect((await rowByHeader(tableRows(page, O)))["NEXT DUE"]).toBe("-");

  // Pause the monthly one -> drops out of break-even.
  await row.getByRole("button", { name: "Edit" }).click();
  const form = page.locator('form:has(input[name="name"]):has(select[name="frequency"])').first();
  await pickOption(page, selectTrigger(form, "status"), "Paused");
  await form.getByRole("button", { name: "Save payable" }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  expect(await breakEven(page) - base).toBe(300000 + 100000);

  // Delete all four.
  await openTab(page, "Payables");
  for (const name of [M, Q, A, O]) {
    await tableRows(page, name).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Delete" }).click();
    await expect(tableRows(page, name)).toHaveCount(0, { timeout: 30_000 });
  }
  expect(await breakEven(page)).toBe(base);
});

test("payable due within 7 days is red when cash < 2x its amount, not when small", async ({ page }) => {
  await gotoCash(page);
  const cashText = await kpiAbove(page, "Cash in Hand").innerText();
  test.skip(cashText.trim() === "-", "no cash position entered - the red rule needs a bank balance");
  const cash = parseInr(cashText);
  const big = ftag("Payable due soon big");
  const small = ftag("Payable due soon small");
  const bigAmount = Math.ceil(cash / 100 / 2) + 1000; // 2x amount > cash
  await addPayable(page, { name: big, amount: String(bigAmount), frequency: "Monthly", due: addDays(today, 3) });
  await addPayable(page, { name: small, amount: "1", frequency: "Monthly", due: addDays(today, 3) });
  await gotoCash(page);
  await openTab(page, "Payables");
  await expect(tableRows(page, big)).toHaveClass(/bg-risk-soft/);
  await expect(tableRows(page, small)).not.toHaveClass(/bg-risk-soft/);
  // "Payables due this month" includes both if the due date is inside this month.
  for (const name of [big, small]) {
    await tableRows(page, name).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Delete" }).click();
    await expect(tableRows(page, name)).toHaveCount(0, { timeout: 30_000 });
  }
});

// ───────────────────────────── cash position + runway (LOCAL ONLY) ─────────────────────────────

/**
 * Cash positions cannot be deleted in the UI and the newest one drives the top-bar runway for
 * everyone, so this block never runs in production. Locally it restores the table afterwards.
 */
test.describe("cash position, runway and top bar", () => {
  test.skip(IS_PROD || !HAS_DB, "writes the live runway and cannot be undone through the UI");
  const entryDate = today;

  test.afterAll(async () => {
    await q(`delete from cash_position where date = $1::date and notes like $2`, [ymdStr(entryDate), `${ftag("")}%`]);
  });

  test("stale badge, entry + history, runway = cash / burn (1 decimal) with colour, on every screen", async ({ page }) => {
    test.setTimeout(300_000);
    const existing = await q(`select 1 from cash_position where date = $1::date`, [ymdStr(entryDate)]);
    test.skip(existing.length > 0, "a real cash position already exists for today - would be overwritten");

    await gotoCash(page);
    const latest = await q<{ d: string }>(`select max(date)::text d from cash_position`);
    const staleExpected = !latest[0].d || (Date.parse(ymdStr(today)) - Date.parse(latest[0].d)) / 86400000 > 7;
    await openTab(page, "Cash position");
    await expect(page.getByText("Last entry is more than 7 days old")).toHaveCount(staleExpected ? 1 : 0);

    // Burn as the page states it; the PRD rule is avg total expenses of the last 3 calendar months.
    const burnText = await page.getByText(/÷ burn ₹[\d,]+\/mo/).innerText();
    const burnInr = parseInr(burnText.match(/burn (₹[\d,]+)/)![1]) / 100;
    const prd = await q<{ total: string; months: string }>(
      `select coalesce(sum("amountInrMinor" + round("amountEurMinor" * "fxRateUsed")),0)::text total,
              count(distinct date_trunc('month', date))::text months
         from expense where "deletedAt" is null
          and date >= (date_trunc('month', $1::date) - interval '3 months') and date < date_trunc('month', $1::date)`,
      [ymdStr(today)],
    );
    const prdBurn = Number(prd[0].total) / 100 / 3;
    await test.info().attach("burn", { body: `page=${burnInr} prd(/3)=${prdBurn.toFixed(2)} monthsWithData=${prd[0].months}`, contentType: "text/plain" });
    expect(Math.abs(burnInr - prdBurn), "burn = average monthly expenses of the last 3 calendar months").toBeLessThanOrEqual(1);

    for (const [months, level] of [[7, "good"], [4, "warn"], [1.5, "bad"]] as const) {
      const cash = Math.round(burnInr * months);
      await openTab(page, "Cash position");
      const form = page.locator('form:has(input[name="bankBalance"])').first();
      await pickDate(page, dateTrigger(form, "date"), entryDate);
      await form.locator('input[name="bankBalance"]').fill(String(cash));
      await form.locator('input[name="personalSavings"]').fill("100000");
      await form.locator('input[name="notes"]').fill(ftag(`cash position ${months}`));
      await form.getByRole("button", { name: "Save position" }).click();
      await expect(page.getByText("Cash position saved").first()).toBeVisible();
      await gotoCash(page);
      await openTab(page, "Cash position");
      await expect(page.getByText("Last entry is more than 7 days old")).toHaveCount(0);
      const hist = tableRows(page, ftag(`cash position ${months}`));
      await expect(hist).toHaveCount(1);
      expect((await rowByHeader(hist))["DATE"]).toBe(dmyStr(entryDate));

      const shownCash = parseInr(await kpiAbove(page, "Cash in Hand").innerText()) / 100;
      const shownBurn = parseInr((await page.getByText(/÷ burn ₹[\d,]+\/mo/).innerText()).match(/burn (₹[\d,]+)/)![1]) / 100;
      const want = Math.round((shownCash / shownBurn) * 10) / 10;
      const badge = page.getByRole("link", { name: /Runway: [\d.]+ months/ });
      const text = await badge.innerText();
      const shown = Number(text.match(/([\d.]+) months/)![1]);
      expect(text).toMatch(/\d+\.\d months/); // always one decimal
      expect(Math.abs(shown - want), `runway ${shown} vs cash ${shownCash} / burn ${shownBurn}`).toBeLessThanOrEqual(0.1);
      const style = (await badge.getAttribute("style")) ?? "";
      expect(style, `runway ${shown} colour`).toContain(`--${level}`);
      // Top bar on other screens shows the same number.
      for (const path of ["/finance", "/pipeline", "/students"]) {
        await page.goto(path);
        await expect(page.getByRole("link", { name: /Runway: [\d.]+ months/ })).toHaveText(new RegExp(`${shown.toFixed(1)} months`));
      }
      await gotoCash(page);
    }
  });
});

test("monthly revenue target bar colour follows red <50 / amber 50-80 / green >=80", async ({ page }) => {
  await page.goto("/pipeline");
  const card = page.locator("xpath=//h2[normalize-space(.)='Monthly revenue target']/ancestor::*[.//div[contains(@class,'h-3')]][1]");
  test.skip((await card.count()) === 0, "no target bar on /pipeline for this role");
  const pctText = (await card.getByText(/ of ₹[\d,]+ · [\d.,]+%/).first().innerText()).match(/([\d.,]+)%/)![1];
  const pct = Number(pctText.replace(/,/g, ""));
  const bar = card.locator("div.h-3 > div").first();
  const style = (await bar.getAttribute("style")) ?? "";
  const want = pct >= 80 ? "--good" : pct >= 50 ? "--warn" : "--bad";
  expect(style, `target ${pct}%`).toContain(want);
});
