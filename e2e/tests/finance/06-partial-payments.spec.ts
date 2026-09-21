import { test, expect, Page, Locator } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { runCron } from "../../helpers/app";
import {
  ftag, FRUN, IST, addDays, dmyStr, fname, gotoFinance, incomeForm, openTab, parseInr, pendingForm, rowByHeader,
  selectTrigger, pickOption, tableRows, todayIn, ymdStr,
} from "../../helpers/finance-ui";
import { addIncome, addPending, dbPending, reloadFinanceTab } from "../../helpers/finance-flows";

/**
 * FOUNDER BUG B - "when payment type is partial/instalment there is no way to set the next
 * payment due date, which should drive reminders to the team and follow-up with the student".
 *
 * What exists today (read from the code, proven below): the Finance > Income form asks for
 * "Upcoming due dates" when Payment type = Instalment, and turns them into a receivable with an
 * instalment schedule. The Pending payments form has its own "Next payment due date". What these
 * specs chase is whether the rest of the loop works: balance maths, next-due advancing, Paid in
 * full, overdue highlighting, team notification, and the dunning ladder.
 */
// Default (not serial) mode: a finding in one test must not skip the rest; FRUN keeps names stable across worker restarts.
test.describe.configure({ mode: "default" });
test.use({ storageState: authFile("admin") });

const today = todayIn(IST);
const S1 = fname("Plan Student");
const S2 = fname("Late Student");
const S3 = fname("Manual Receivable");
const S4 = fname("Repeat Student");

const firstInr = (s: string) => parseInr((s.match(/-?₹[\d,.]+/) ?? ["₹0"])[0]);

async function pendingRow(page: Page, student: string) {
  await reloadFinanceTab(page, /^Pending payments/);
  const row = tableRows(page, student);
  await expect(row, `pending row for ${student}`).toHaveCount(1);
  return { row, r: await rowByHeader(row) };
}

async function dunningPreview(page: Page): Promise<string> {
  await page.goto("/console");
  await page.getByRole("tab", { name: "System", exact: true }).click();
  await page.getByRole("tab", { name: "Alerts & Chasing" }).click();
  await page.getByRole("button", { name: "Preview the next run" }).click();
  // Either a table of would-be sends or a "Nothing would be sent" toast.
  const table = page.locator("table").filter({ hasText: "Stage" }).last();
  await expect(table.or(page.getByText("Nothing would be sent on the next run")).first()).toBeVisible({ timeout: 30_000 });
  return (await table.count()) ? table.innerText() : "";
}

test("income form: Instalment reveals number of instalments and upcoming due dates", async ({ page }) => {
  await gotoFinance(page);
  const form = incomeForm(page);
  await expect(form.getByText("Upcoming due dates")).toHaveCount(0);
  await pickOption(page, selectTrigger(form, "paymentType"), "Instalment");
  await expect(form.locator('input[name="instalmentCount"]')).toBeVisible();
  await expect(form.getByText("Upcoming due dates")).toBeVisible();
  await expect(form.getByRole("button", { name: "Due date for instalment 2" })).toBeVisible();
});

test("Record modal (top bar): Instalment also asks for the next due date (FIN-05)", async ({ page }) => {
  await gotoFinance(page);
  await page.getByRole("button", { name: /Record/ }).first().click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Add an income entry or an expense" });
  const form = dlg.locator("form").first();
  await expect(form.locator('input[name="studentName"]')).toBeVisible();
  await pickOption(page, selectTrigger(form, "paymentType"), "Instalment");
  await expect(form.locator('input[name="instalmentCount"]')).toBeVisible();
  await expect(
    form.getByText("Upcoming due dates"),
    "FIN-05: the top-bar Record > Income form (QuickRecordModal) offers Instalment + count but no due-date field, so a partial payment recorded there creates no receivable and nothing is ever chased",
  ).toBeVisible({ timeout: 3000 });
});

test("first instalment creates a receivable: to collect = paid + scheduled, balance, next due", async ({ page }) => {
  const due2 = addDays(today, 30);
  const due3 = addDays(today, 60);
  await gotoFinance(page);
  await addIncome(page, {
    date: today, student: S1, inr: "10000", level: "Guided", type: "Instalment", instalmentCount: "3",
    schedule: [{ date: due2, inr: "10000" }, { date: due3, inr: "10000" }], method: "UPI", notes: ftag("plan instalment 1"),
  });
  const { row, r } = await pendingRow(page, S1);
  expect(firstInr(r["TO COLLECT"])).toBe(3000000);
  expect(firstInr(r["COLLECTED"])).toBe(1000000);
  expect(firstInr(r["STILL TO COLLECT"])).toBe(2000000);
  expect(r["NEXT DUE"]).toBe(dmyStr(due2));
  expect(r["STATUS"]).toBe("Active");
  await expect(row.getByRole("button", { name: "EMI 1/3" })).toBeVisible();
  if (HAS_DB) {
    const [p] = await dbPending(S1);
    expect(p.nextDueDate).toBe(ymdStr(due2));
    expect(p.instalments.map((i: any) => [i.seq, i.status, i.due])).toEqual([
      [1, "PAID", ymdStr(today)], [2, "DUE", ymdStr(due2)], [3, "DUE", ymdStr(due3)],
    ]);
  }
});

test("second instalment: balance drops and the plan moves on to instalment 3 (FIN-06)", async ({ page }) => {
  await gotoFinance(page);
  // Recorded the way the form tells the founder to: Instalment, no new dates.
  await addIncome(page, {
    date: today, student: S1, inr: "10000", level: "Guided", type: "Instalment", instalmentCount: "3",
    method: "UPI", notes: ftag("plan instalment 2"),
  });
  const { row, r } = await pendingRow(page, S1);
  expect(firstInr(r["COLLECTED"])).toBe(2000000);
  expect(firstInr(r["STILL TO COLLECT"])).toBe(1000000);
  expect.soft(
    r["NEXT DUE"],
    "FIN-06: after instalment 2 is paid the receivable still shows instalment 2's due date as next due - it will turn red/Overdue on that date although it is paid",
  ).toBe(dmyStr(addDays(today, 60)));
  expect.soft(
    await row.getByRole("button", { name: /^EMI/ }).innerText(),
    "FIN-06: the EMI schedule does not mark instalment 2 paid when its income is recorded",
  ).toBe("EMI 2/3");
});

test("final instalment: balance reaches zero and the receivable reads Paid in full (FIN-07)", async ({ page }) => {
  await gotoFinance(page);
  await addIncome(page, {
    date: today, student: S1, inr: "10000", level: "Guided", type: "Instalment", instalmentCount: "3",
    method: "UPI", notes: ftag("plan instalment 3"),
  });
  const { r } = await pendingRow(page, S1);
  expect(firstInr(r["STILL TO COLLECT"])).toBe(0);
  expect(
    r["STATUS"],
    "FIN-07: with the full fee collected the receivable status stays Active - nothing flips it to Paid in full",
  ).toBe("Paid in full");
});

test("past-due instalment: red row + Overdue, team notification, Cash Health overdue", async ({ page }) => {
  const overdueCount = (items: any[]) => {
    const it = items.find((i) => i.id === "overdue-receivables");
    return it ? Number(String(it.title).match(/^(\d+)/)?.[1] ?? 0) : 0;
  };
  await gotoFinance(page);
  await addIncome(page, {
    date: addDays(today, -45), student: S2, inr: "5000", level: "Elite", type: "Instalment", instalmentCount: "3",
    schedule: [{ date: addDays(today, -15), inr: "5000" }, { date: addDays(today, 15), inr: "5000" }],
    method: "Bank transfer (INR)", notes: ftag("late plan instalment 1"),
  });
  const { row, r } = await pendingRow(page, S2);
  expect(r["NEXT DUE"]).toBe(dmyStr(addDays(today, -15)));
  expect(r["STATUS"]).toBe("Overdue");
  await expect(row).toHaveClass(/bg-risk-soft/); // PRD1 §4.4 red row

  // Team reminder (notification bell): its overdue count must match the Overdue rows the
  // Pending tab shows at the same moment (a delta would race other agents' data).
  await reloadFinanceTab(page, /^Pending payments/, "", "Overdue");
  // A regex LITERAL: inside a plain string `\d` loses its backslash and the pattern could never match.
  const shown = await page.getByText(/^\d+ of \d+$|^\d+ records?$/).first().innerText();
  const overdueRows = Number(shown.match(/^(\d+)/)![1]);
  const notif = await page.request.get("/api/notifications").then((r) => r.json());
  expect(overdueCount(notif.items), `bell "overdue payments" vs ${overdueRows} Overdue rows`).toBe(overdueRows);

  await page.goto("/cash");
  await openTab(page, /^Receivables/);
  const cashRow = page.locator("table tbody tr").filter({ hasText: S2 });
  await expect(cashRow).toHaveCount(1);
  await expect(cashRow).toContainText("Overdue 15d");
  await expect(cashRow).toHaveClass(/bg-risk-soft/);
});

test("past-due instalment is picked up by the dunning ladder (preview) and the overdue sweep", async ({ page, request }) => {
  const preview = await dunningPreview(page);
  await test.info().attach("dunning-preview-before-payment", { body: preview, contentType: "text/plain" });
  expect(preview, "dunning preview lists the overdue instalment").toContain(S2);
  if (HAS_DB && !IS_PROD) {
    const cron = await runCron(request, "daily");
    await test.info().attach("cron-daily", { body: `${cron.status}\n${cron.body}`, contentType: "application/json" });
    expect(cron.status).toBe(200);
    const [p] = await dbPending(S2);
    expect(p.instalments.find((i: any) => i.seq === 2).status, "overdue sweep flips instalment #2").toBe("OVERDUE");
  }
});

test("paying the overdue instalment stops the chase and clears Overdue (FIN-08)", async ({ page }) => {
  await gotoFinance(page);
  await addIncome(page, {
    date: today, student: S2, inr: "5000", level: "Elite", type: "Instalment", instalmentCount: "3",
    method: "Bank transfer (INR)", notes: ftag("late plan instalment 2"),
  });
  const { r } = await pendingRow(page, S2);
  expect(firstInr(r["STILL TO COLLECT"])).toBe(500000);
  expect.soft(r["STATUS"], "FIN-06: instalment 2 is paid but the row is still Overdue (next due never advances)").toBe("Active");
  const preview = await dunningPreview(page);
  await test.info().attach("dunning-preview-after-payment", { body: preview, contentType: "text/plain" });
  expect(
    preview.includes(S2),
    "FIN-08: after the overdue instalment's money was recorded, the dunning ladder would still send this student a payment chase (the instalment row stays DUE/OVERDUE)",
  ).toBe(false);
});

test("manual receivable with a past next-due date: highlighted, but never reaches the dunning ladder (FIN-09)", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, /^Pending payments/);
  await addPending(page, {
    student: S3, level: "Solo", feeInr: "40000", due: addDays(today, -3), status: "Active", notes: ftag("manual receivable"),
  });
  const { row, r } = await pendingRow(page, S3);
  expect(firstInr(r["STILL TO COLLECT"])).toBe(4000000);
  expect(r["STATUS"]).toBe("Overdue");
  await expect(row).toHaveClass(/bg-risk-soft/);

  const preview = await dunningPreview(page);
  expect(
    preview.includes(S3),
    "FIN-09: a receivable entered in Pending payments with a next-due date has no Instalment rows, so the dunning ladder (which reads only instalments) never chases it",
  ).toBe(true);
});

test("Pending payments form can link the receivable to a student record (FIN-10)", async ({ page }) => {
  await gotoFinance(page);
  await openTab(page, /^Pending payments/);
  const form = pendingForm(page);
  expect(
    await form.locator('input[name="studentId"], [role="combobox"]').count(),
    "FIN-10: the Pending payments form is a free-text name only - no student link, so the WhatsApp payment reminder (needs student.phone) and dunning (needs student email/phone) can never reach this student",
  ).toBeGreaterThan(0);
});

test("a student's earlier, unrelated payment is not counted against a new instalment plan (FIN-12)", async ({ page }) => {
  await gotoFinance(page);
  await addIncome(page, { date: addDays(today, -20), student: S4, inr: "5000", level: "Solo", method: "UPI", notes: ftag("repeat old course") });
  await addIncome(page, {
    date: today, student: S4, inr: "10000", level: "Guided", type: "Instalment", instalmentCount: "2",
    schedule: [{ date: addDays(today, 30), inr: "10000" }], method: "UPI", notes: ftag("repeat new plan 1"),
  });
  const { r } = await pendingRow(page, S4);
  expect(firstInr(r["TO COLLECT"])).toBe(2000000);
  expect(
    [firstInr(r["COLLECTED"]), firstInr(r["STILL TO COLLECT"])],
    "FIN-12: 'Collected' sums EVERY income with the same student name/id (any level, any date), so the old ₹5,000 Solo payment is credited to the new Guided plan and the balance is understated",
  ).toEqual([1000000, 1000000]);
});
