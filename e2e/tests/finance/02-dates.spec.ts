import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { watchErrors } from "../../helpers/app";
import {
  ftag, FRUN, BERLIN, IST, Ymd, addDays, dateTrigger, dmyStr, expenseForm, fname, gotoFinance, incomeForm,
  openTab, pickDate, rowByHeader, tableRows, todayIn, ymdStr,
} from "../../helpers/finance-ui";
import { addExpense, addIncome, dbExpense, dbIncome, fillIncome, reloadFinanceTab } from "../../helpers/finance-flows";
import { recordCreated } from "../../helpers/target";

/**
 * FOUNDER BUG A - "entering a date on income AND expense and saving stores a different date".
 *
 * Each date is picked through the real DatePicker grid, saved, then checked in four places:
 * the list (DD/MM/YYYY), the edit form after reload, the month bucket it is reported in (the
 * app's own period export, which uses the same `date >= start < end` window as the dashboard),
 * and locally the raw @db.Date column. Then "edit and save without changes" must not move it.
 * Run under the browser timezone of the Indian team AND the founder in Germany.
 */

const today = todayIn(IST);
const firstOfMonth: Ymd = { ...today, d: 1 };
const lastOfPrevMonth = addDays(firstOfMonth, -1);
const dec31 = { y: today.y - 1, m: 12, d: 31 };
const CASES: { key: string; date: Ymd }[] = [
  { key: "today", date: today },
  { key: "yesterday", date: addDays(today, -1) },
  { key: "first-of-month", date: firstOfMonth },
  { key: "last-of-prev-month", date: lastOfPrevMonth },
  { key: "dec-31", date: dec31 },
];

const monthOn = (d: Ymd) => `period=month&on=${ymdStr({ ...d, d: 1 })}`;

async function exportCsv(page: Page, entity: "income" | "expenses", query: string) {
  const res = await page.request.get(`/api/export/${entity}?${query}`);
  expect(res.status()).toBe(200);
  return res.text();
}

for (const tz of [IST, BERLIN]) {
  test.describe(`dates with browser timezone ${tz}`, () => {
    test.describe.configure({ mode: "default" });
    test.use({ storageState: authFile("admin"), timezoneId: tz });
    const zone = tz === IST ? "IST" : "BER";

    test(`income: picked dates are stored, listed, edited and bucketed unchanged (${zone})`, async ({ page }) => {
      test.setTimeout(300_000);
      const errs = watchErrors(page);
      await gotoFinance(page);
      for (const c of CASES) {
        await addIncome(page, {
          date: c.date, student: fname(`Date ${zone} ${c.key}`), inr: "101", method: "UPI",
          notes: ftag(`date-income ${zone} ${c.key}`),
        });
      }
      await reloadFinanceTab(page, "Income");
      const problems: string[] = [];
      for (const c of CASES) {
        const notes = ftag(`date-income ${zone} ${c.key}`);
        const row = tableRows(page, notes);
        await expect(row, `row for ${c.key}`).toHaveCount(1);
        const r = await rowByHeader(row);
        if (r["DATE"] !== dmyStr(c.date)) problems.push(`list ${c.key}: picked ${dmyStr(c.date)} shows ${r["DATE"]}`);
        await row.getByRole("button", { name: "Edit" }).click();
        const shown = (await dateTrigger(incomeForm(page), "date").innerText()).trim();
        if (shown !== dmyStr(c.date)) problems.push(`edit form ${c.key}: picked ${dmyStr(c.date)} shows ${shown}`);
        await page.getByRole("button", { name: "Cancel edit" }).click();
        if (HAS_DB) {
          const [db] = await dbIncome(notes);
          if (db?.date !== ymdStr(c.date)) problems.push(`db ${c.key}: picked ${ymdStr(c.date)} stored ${db?.date}`);
        }
        const inMonth = await exportCsv(page, "income", monthOn(c.date));
        if (!inMonth.includes(notes)) problems.push(`bucket ${c.key}: not in ${ymdStr(c.date).slice(0, 7)} export`);
        const prev = await exportCsv(page, "income", monthOn(addDays({ ...c.date, d: 1 }, -1)));
        if (prev.includes(notes)) problems.push(`bucket ${c.key}: leaked into the previous month`);
      }
      expect(problems, `FIN-DATE income date drift:\n${problems.join("\n")}`).toEqual([]);
      errs.assertClean();
    });

    test(`income: edit + save without changes, then re-date via picker, does not shift (${zone})`, async ({ page }) => {
      const notes = ftag(`date-income ${zone} first-of-month`);
      await reloadFinanceTab(page, "Income");
      const row = tableRows(page, notes);
      await row.getByRole("button", { name: "Edit" }).click();
      await incomeForm(page).getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("heading", { name: "Daily income entry" })).toBeVisible();
      await reloadFinanceTab(page, "Income");
      expect((await rowByHeader(tableRows(page, notes)))["DATE"]).toBe(dmyStr(firstOfMonth));

      const moved = addDays(today, -3);
      await tableRows(page, notes).getByRole("button", { name: "Edit" }).click();
      await pickDate(page, dateTrigger(incomeForm(page), "date"), moved);
      await incomeForm(page).getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("heading", { name: "Daily income entry" })).toBeVisible();
      await reloadFinanceTab(page, "Income");
      expect((await rowByHeader(tableRows(page, notes)))["DATE"]).toBe(dmyStr(moved));
      if (HAS_DB) expect((await dbIncome(notes))[0].date).toBe(ymdStr(moved));
    });

    test(`expense: picked dates are stored, listed, edited and bucketed unchanged (${zone})`, async ({ page }) => {
      test.setTimeout(300_000);
      await gotoFinance(page);
      await openTab(page, "Expenses");
      for (const c of CASES) {
        await addExpense(page, {
          date: c.date, inr: "102", vendor: ftag("date vendor"), notes: ftag(`date-expense ${zone} ${c.key}`),
        });
      }
      await reloadFinanceTab(page, "Expenses");
      const problems: string[] = [];
      for (const c of CASES) {
        const notes = ftag(`date-expense ${zone} ${c.key}`);
        const row = tableRows(page, notes);
        await expect(row, `row for ${c.key}`).toHaveCount(1);
        const r = await rowByHeader(row);
        if (r["DATE"] !== dmyStr(c.date)) problems.push(`list ${c.key}: picked ${dmyStr(c.date)} shows ${r["DATE"]}`);
        await row.getByRole("button", { name: "Edit" }).click();
        const shown = (await dateTrigger(expenseForm(page), "date").innerText()).trim();
        if (shown !== dmyStr(c.date)) problems.push(`edit form ${c.key}: picked ${dmyStr(c.date)} shows ${shown}`);
        // save unchanged - must not shift
        await expenseForm(page).getByRole("button", { name: "Save changes" }).click();
        // The save is done when the form leaves edit mode (a toast from the previous save may still be up).
        await expect(page.getByRole("heading", { name: "Daily expense entry" })).toBeVisible();
        if (HAS_DB) {
          const [db] = await dbExpense(notes);
          if (db?.date !== ymdStr(c.date)) problems.push(`db ${c.key}: picked ${ymdStr(c.date)} stored ${db?.date}`);
        }
        const inMonth = await exportCsv(page, "expenses", monthOn(c.date));
        if (!inMonth.includes(notes)) problems.push(`bucket ${c.key}: not in ${ymdStr(c.date).slice(0, 7)} export`);
      }
      await reloadFinanceTab(page, "Expenses");
      for (const c of CASES) {
        const r = await rowByHeader(tableRows(page, ftag(`date-expense ${zone} ${c.key}`)));
        if (r["DATE"] !== dmyStr(c.date)) problems.push(`after unchanged re-save ${c.key}: shows ${r["DATE"]}`);
      }
      expect(problems, `FIN-DATE expense date drift:\n${problems.join("\n")}`).toEqual([]);
    });

    test(`Record modal (top bar) income + expense keep the picked date (${zone})`, async ({ page }) => {
      const date = addDays(today, -5);
      await page.goto("/finance");
      await page.getByRole("button", { name: /Record/ }).first().click();
      const dlg = page.getByRole("dialog").filter({ hasText: "Add an income entry or an expense" });
      await expect(dlg.locator('input[name="studentName"]')).toBeVisible();
      const notes = ftag(`date-modal-income ${zone}`);
      await fillIncome(page, dlg.locator("form").first(), { date, student: fname(`Modal ${zone}`), inr: "103", notes });
      // The picker popover is portalled outside the modal - the modal must still be open.
      await expect(dlg).toBeVisible();
      await dlg.getByRole("button", { name: "Add income" }).click();
      await expect(dlg).toBeHidden({ timeout: 30_000 }); // saves then closes
      recordCreated("finance", { kind: "Income", label: notes, cleanup: "Finance > Income: Delete, then Archived > Delete permanently" });
      await reloadFinanceTab(page, "Income");
      expect((await rowByHeader(tableRows(page, notes)))["DATE"]).toBe(dmyStr(date));
      if (HAS_DB) expect((await dbIncome(notes))[0].date).toBe(ymdStr(date));
    });
  });
}

/**
 * The founder works from Germany. The form's default "today" is computed on the SERVER in IST
 * (finance/page.tsx `toDateInputValue(istToday())`), while the picker's own "Today" button and
 * today-ring use the BROWSER's local date. Between 20:30 and 24:00 Berlin time (CEST) India is
 * already on the next calendar day, so an entry saved with the default date lands on TOMORROW.
 *
 * Simulated faithfully: the browser clock is set to 23:00 Berlin on the day BEFORE the server's
 * current IST date - the exact instant (02:30 IST) at which the server's IST date is the one it
 * reports now.
 */
test.describe("Berlin evening entry (founder timezone)", () => {
  test.use({ storageState: authFile("admin"), timezoneId: BERLIN });

  test("default income date equals the founder's local today at 23:00 Berlin (FIN-02)", async ({ page }) => {
    const serverToday = todayIn(IST);
    const berlinEvening = addDays(serverToday, -1);
    // 23:00 Berlin on berlinEvening, expressed as UTC (CEST = UTC+2 in summer, CET = UTC+1 in winter).
    const probe = new Date(Date.UTC(berlinEvening.y, berlinEvening.m - 1, berlinEvening.d, 21, 0));
    const offsetH = Number(new Intl.DateTimeFormat("en-GB", { timeZone: BERLIN, hour: "2-digit", hourCycle: "h23" }).format(probe)) - 21;
    const instant = new Date(Date.UTC(berlinEvening.y, berlinEvening.m - 1, berlinEvening.d, 23 - offsetH, 0));
    expect(todayIn(BERLIN, instant)).toEqual(berlinEvening);
    expect(todayIn(IST, instant)).toEqual(serverToday);
    await page.clock.setFixedTime(instant);

    await gotoFinance(page);
    const form = incomeForm(page);
    // The page renders India's date server-side as a first-paint placeholder and the browser
    // replaces it on mount (measured at ~120ms, long before anyone can fill the form in). Read
    // the value the form would actually SUBMIT rather than that first frame - but on a short
    // budget, because a default that takes seconds to settle would be its own bug.
    await expect
      .poll(async () => (await dateTrigger(form, "date").innerText()).trim(), { timeout: 5_000 })
      .not.toBe("");
    await page.waitForTimeout(400);
    const defaultShown = (await dateTrigger(form, "date").innerText()).trim();
    // What the picker itself calls "today" in the founder's browser.
    await dateTrigger(form, "date").click();
    const dlg = page.getByRole("dialog").filter({ has: page.getByRole("grid") }).last();
    const ring = (await dlg.locator('[aria-current="date"]').innerText()).trim();
    await page.keyboard.press("Escape");
    await test.info().attach("berlin-evening", {
      body: `browser now=${instant.toISOString()} (23:00 Berlin)\nform default=${defaultShown}\npicker today-ring day=${ring}\nfounder local today=${dmyStr(berlinEvening)}`,
      contentType: "text/plain",
    });
    expect(
      defaultShown,
      `FIN-02: at 23:00 in Berlin on ${dmyStr(berlinEvening)} the income form pre-fills ${defaultShown} (India's date). ` +
        `Saving with the default stores the next day; the picker's own today-ring says ${ring}.`,
    ).toBe(dmyStr(berlinEvening));
  });
});
