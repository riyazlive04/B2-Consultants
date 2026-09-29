import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun } from "../../helpers/people-data";
import { HAS_DB, IS_PROD, recordCreated } from "../../helpers/target";
import { one, q } from "../../helpers/db";
import { addDaysYmd, chooseOption, confirmDialog, istNow, setDate } from "../../helpers/people-ui";
import { createStudentUI, deleteStudentUI, enrollmentCard, gotoStudentsList, openStudent, studentRow } from "../../helpers/people-students";

/**
 * PRD2 §4.6 LTV + §6 "editing the fee in Finance updates the student LTV".
 * LOCAL ONLY: it records real income in Finance (posts ledger entries). Do NOT run in production.
 * Creates: 1 Solo student upgraded to Guided, 2 income entries (archived again at the end), student deleted.
 */
test.use({ storageState: authFile("admin") });
test.skip(IS_PROD, "records income in Finance - local only");
const RUN = stableRun("ltv");
const NAME = `${RUN} Ltv Upgrade`;
const TODAY = istNow().ymd;
const inr = (rupees: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);

async function addIncome(page: Page, amount: string, levelLabel: RegExp) {
  await page.goto("/finance");
  const form = page.locator("form", { has: page.locator('input[name="amountInr"]') }).first();
  await form.getByRole("combobox").fill(NAME);
  await page.getByRole("option", { name: new RegExp(`^${RUN} Ltv Upgrade`) }).first().click();
  await form.locator('input[name="amountInr"]').fill(amount);
  await chooseOption(page, form.locator('select[name="programLevel"]'), levelLabel);
  await form.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByText("Payment recorded").last()).toBeVisible({ timeout: 30_000 });
  recordCreated("people", { kind: "Income", label: `${NAME} ₹${amount}`, cleanup: "Finance > Income > Delete (archives; stays in Archived tab)" });
}

async function incomeRows(page: Page) {
  await page.goto("/finance");
  await page.getByPlaceholder("Filter income…").fill(NAME);
  await page.waitForTimeout(800);
  return page.locator("tbody tr", { hasText: NAME }).filter({ has: page.getByRole("button", { name: "Delete" }) });
}

async function totalPaid(page: Page) {
  await openStudent(page, NAME);
  const box = page.locator("div.text-right", { has: page.getByText("Total paid", { exact: true }) }).first();
  return { total: (await box.locator("p").nth(1).innerText()).trim(), linked: (await box.locator("p").nth(2).innerText()).trim() };
}

test("LTV: Solo payment, upgrade to Guided with a second payment, fee edited in Finance - Total paid follows", async ({ page }) => {
  test.setTimeout(420_000);
  const w = watchErrors(page);
  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(NAME);
  await page.waitForTimeout(600);
  if ((await studentRow(page, NAME).count()) === 0) {
    expect(await createStudentUI(page, { name: NAME, level: "SOLO", enrollmentDate: addDaysYmd(TODAY, -30) })).toBeNull();
  }
  expect(await totalPaid(page)).toEqual({ total: inr(0), linked: "0 linked payment(s)" });

  await addIncome(page, "10000", /^Solo/);
  expect(await totalPaid(page)).toEqual({ total: inr(10000), linked: "1 linked payment(s)" });

  // Upgrade: SAME student, new Guided enrollment
  await openStudent(page, NAME);
  await page.getByRole("button", { name: "+ Add enrollment (upgrade)" }).click();
  const up = page.locator("form", { has: page.getByRole("button", { name: "Add enrolment" }) });
  await chooseOption(page, up.locator('select[name="programLevel"]'), "Guided (90d)");
  await setDate(up.locator('input[name="enrollmentDate"]'), TODAY);
  await up.getByRole("button", { name: "Add enrolment" }).click();
  await expect(enrollmentCard(page, "Guided")).toBeVisible({ timeout: 30_000 });

  await addIncome(page, "25000", /^Guided/);
  expect((await totalPaid(page)).total).toBe(inr(35000));
  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(NAME);
  await expect(studentRow(page, NAME)).toContainText("SOLO + GUIDED");
  await expect(studentRow(page, NAME)).toContainText(inr(35000));

  // Edit the Guided fee in Finance: 25,000 -> 30,000
  const rows = await incomeRows(page);
  const guidedRow = rows.filter({ hasText: "Guided" }).first();
  await guidedRow.getByRole("button", { name: "Edit" }).click();
  const form = page.locator("form", { has: page.locator('input[name="amountInr"]') }).first();
  await form.locator('input[name="amountInr"]').fill("30000");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Income entry updated").last()).toBeVisible({ timeout: 30_000 });
  expect((await totalPaid(page)).total, "LTV follows the edited Finance fee").toBe(inr(40000));
  w.assertClean();
});

test("upgrade rate and per-level averages on the dashboard match PRD2 §4.6 formulas", async ({ page }) => {
  test.skip(!HAS_DB, "formula check needs the DB");
  await page.goto("/students");
  const line = await page.locator("p", { hasText: "Average paid:" }).first().innerText();
  const m = line.match(/Solo (.+?) · Guided (.+?) · Elite (.+?) · Upgrade rate: ([\d.,]+)%/);
  expect(m, line).toBeTruthy();
  const [, soloShown, guidedShown, , rateShown] = m!;

  // The dashboard population (students-metrics): students with an enrollment or without a GN membership.
  const pop = await q(`select s.id from student s where exists (select 1 from enrollment e where e."studentId"=s.id)
                       or not exists (select 1 from batch_member b where b."studentId"=s.id)`);
  const upgraded = await one(`select count(*)::int n from (select "studentId" from enrollment group by 1 having count(*)>1) x`);
  const rate = Math.round(((upgraded.n / pop.length) * 100) * 10) / 10;
  expect(Number(rateShown.replace(/,/g, "")), "upgrade rate = students with >1 enrollment / total students x 100").toBe(rate);

  // PRD: "Average fee paid by all students who enrolled in Solo program" - the fee paid FOR that program.
  const prdAvg = async (level: string) => {
    const r = await one(`
      select coalesce(avg(fee),0)::float8 a from (
        select s.id, coalesce((select sum(i."amountInrMinor" + round(i."amountEurMinor" * i."fxRateUsed")) from income i
                      where i."studentId"=s.id and i."deletedAt" is null and i."programLevel"=$1),0) fee
        from student s where exists (select 1 from enrollment e where e."studentId"=s.id and e."programLevel"=$1)) t`, [level]);
    return inr(Math.round(r.a / 100));
  };
  const soloPrd = await prdAvg("SOLO");
  const guidedPrd = await prdAvg("GUIDED");
  expect({ solo: soloShown.trim(), guided: guidedShown.trim() },
    "PPL-13: 'Avg paid - Solo/Guided' uses each student's WHOLE lifetime total, so an upgrader's Guided fee inflates the Solo average").toEqual({ solo: soloPrd, guided: guidedPrd });
});

test("cleanup: archive the two incomes and delete the student; LTV returns to zero first", async ({ page }) => {
  test.setTimeout(300_000);
  let rows = await incomeRows(page);
  while ((await rows.count()) > 0) {
    await rows.first().getByRole("button", { name: "Delete" }).click();
    await confirmDialog(page, "Archive");
    await expect(page.getByText("Income entry archived").last()).toBeVisible({ timeout: 30_000 });
    rows = await incomeRows(page);
  }
  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(NAME);
  await page.waitForTimeout(600);
  if ((await studentRow(page, NAME).count()) > 0) {
    expect((await totalPaid(page)).total, "archived income leaves LTV").toBe(inr(0));
    await deleteStudentUI(page, NAME);
  }
});
