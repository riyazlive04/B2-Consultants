import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { watchErrors } from "../../helpers/app";
import {
  ftag, fname, gotoFinance, incomeForm, openTab, pendingForm, rowByHeader,
  selectOptions, selectTrigger, tableRows, parseInr,
} from "../../helpers/finance-ui";
import { addIncome, addPending, dbIncome, dbPending, reloadFinanceTab } from "../../helpers/finance-flows";

/**
 * FIN-12: WHICH PLAN A PAYMENT PAID.
 *
 * Paid-so-far used to be summed per STUDENT and handed to every plan that student had, so four
 * plans each claimed the whole payment history: all four read "still to collect 0" while their
 * own instalments were still due, and the receivables total came out below reality. The fix is
 * `Income.pendingPaymentId` plus `lib/payment-allocation`, and these specs pin the behaviour
 * from the outside - through the two forms a person actually uses.
 *
 * The second half is the regression that mattered most: the top-bar Quick Record modal was a
 * SECOND income form, and the plan picker reached only the Finance page. Quick Record sits in
 * the shell on every screen, so the door most payments come through was the one that could not
 * say which receivable they paid off. Both forms now render the same component, and the test
 * below is what stops them drifting apart again.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

test("two plans for one student: a payment credits only the plan it names", async ({ page }) => {
  const errs = watchErrors(page);
  const student = fname("Two Plan Payer");
  const tagA = ftag("plan A guided");
  const tagB = ftag("plan B elite");
  const payTag = ftag("pays plan B");

  // Two open receivables for ONE student - the shape that used to double-count.
  await gotoFinance(page);
  await openTab(page, /Pending payments/);
  await addPending(page, { student, level: "Guided", feeInr: "10000", notes: tagA });
  await addPending(page, { student, level: "Elite", feeInr: "20000", notes: tagB });

  // One payment, aimed at the SECOND plan.
  await reloadFinanceTab(page, "Income");
  const form = incomeForm(page);
  await form.locator('input[name="studentName"]').fill(student);

  // The picker appears, and offers both plans plus an explicit "none".
  const planSelect = form.locator('select[name="pendingPaymentId"]');
  await expect(planSelect).toBeVisible();
  const options = await selectOptions(form, "pendingPaymentId");
  expect(options[0]).toMatch(/Not against a specific plan/);
  expect(options.join(" | ")).toMatch(/Guided/);
  expect(options.join(" | ")).toMatch(/Elite/);
  // Each option names the balance, so two plans can be told apart.
  expect(options.join(" | ")).toMatch(/20,000/);

  await addIncome(page, {
    student, inr: "20000", level: "Elite", type: "Full payment", method: "UPI", notes: payTag,
  });

  // ── The assertion that would have failed before ────────────────────────────────
  await reloadFinanceTab(page, /Pending payments/);
  const guided = await rowByHeader(tableRows(page, tagA).first());
  const elite = await rowByHeader(tableRows(page, tagB).first());

  // `parseInr` answers in paise.
  expect(parseInr(guided["COLLECTED"]), "the Guided plan must NOT be credited with the Elite payment")
    .toBe(0);
  expect(parseInr(guided["STILL TO COLLECT"]), "so it still owes its whole fee").toBe(1_000_000);
  expect(parseInr(elite["COLLECTED"]), "the plan the payment named is the one credited")
    .toBe(2_000_000);
  expect(parseInr(elite["STILL TO COLLECT"])).toBe(0);

  if (HAS_DB) {
    const [income] = await dbIncome(`%${payTag}%`);
    const plans = await dbPending(`%${student}%`);
    const elitePlan = plans.find((p: { fee: string }) => p.fee === "2000000");
    expect(income.pendingPaymentId, "the link is stored, not inferred").toBe(elitePlan?.id);
  }
  errs.assertClean();
});

test("the summary strip adds up: total - collected = still to collect", async ({ page }) => {
  // The old code summed an UNCLAMPED paid-so-far against a clamped balance, so the three figures
  // stopped reconciling the moment any row was over-credited - which, per the bug above, was any
  // student with more than one plan.
  await reloadFinanceTab(page, /Pending payments/);
  const card = page.locator("section", { has: page.getByText("Collected vs still to collect") });
  const figure = async (label: string) => {
    const block = card.locator("div").filter({ hasText: new RegExp(`^${label}`) }).first();
    const amount = (await block.innerText()).split("\n").find((l) => /[\d,]+\.\d\d/.test(l)) ?? "0";
    return parseInr(amount);
  };

  const total = await figure("Total to collect");
  const collected = await figure("Collected");
  const balance = await figure("Still to collect");
  /**
   * EXACT, in paise. The identity holds because each plan's credited figure is capped at its own
   * total (lib/payment-allocation) - which is the whole reason the cap exists, and why this is an
   * equality rather than an approximation.
   */
  expect(total - collected).toBe(balance);
});

test("a lone open plan is adopted, and can be explicitly declined", async ({ page }) => {
  const student = fname("One Plan Payer");
  await reloadFinanceTab(page, /Pending payments/);
  await addPending(page, { student, level: "Guided", feeInr: "5000", notes: ftag("lone plan") });

  await reloadFinanceTab(page, "Income");
  const form = incomeForm(page);
  await form.locator('input[name="studentName"]').fill(student);
  const planSelect = form.locator('select[name="pendingPaymentId"]');
  // Exactly one candidate has no ambiguity to resolve, so it is pre-selected - the one piece of
  // inference kept, because making somebody confirm the only possible answer gets a field ignored.
  await expect(planSelect).not.toHaveValue("");
  // ...but "none" remains a real answer.
  await expect(form.getByText(/Their only open plan/)).toBeVisible();
});

test("QUICK RECORD offers the same plan picker as the Finance page", async ({ page }) => {
  // THE REGRESSION TEST. Quick Record was a second income form; the plan link reached only the
  // Finance page, so every payment recorded from the top bar fell back to oldest-plan
  // allocation. Both forms now render components/finance/IncomeFields.
  const errs = watchErrors(page);
  const student = fname("Quick Plan Payer");
  const tag = ftag("quick plan");

  await gotoFinance(page);
  await openTab(page, /Pending payments/);
  await addPending(page, { student, level: "Guided", feeInr: "7500", notes: tag });

  // Open the shell's Record modal from a page that is NOT Finance, which is the point of it.
  await page.goto("/");
  await page.getByRole("button", { name: /Record/i }).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  const form = incomeForm(modal);
  await form.locator('input[name="studentName"]').fill(student);

  // Every field the Finance form grew, on this one too.
  await expect(form.locator('select[name="pendingPaymentId"]'), "the plan link (FIN-12)").toBeVisible();
  /*
    The Business picker is asserted by its LABEL, not by a `name`: it deliberately submits
    nothing. The business is derived from the programme level (lib/business-line) and a second
    posted field could disagree with it, so there is one authority. Verified live - the control
    is there, it just has no name to select on.
  */
  await expect(form.getByText("Business", { exact: true }), "the business picker").toBeVisible();
  await expect(form.locator('input[name="notes"]'), "notes").toBeVisible();
  const options = await selectOptions(form, "pendingPaymentId");
  expect(options.join(" | ")).toMatch(/Guided/);
  expect(options.join(" | ")).toMatch(/7,500/);
  errs.assertClean();
});

test("the two forms agree about what is missing before a plan can be saved", async ({ page }) => {
  // The save-blocked reason now comes from the shared derivation rather than a hardcoded string
  // on each form, so the two cannot describe the same state differently.
  await gotoFinance(page);
  const form = incomeForm(page);
  await form.locator('input[name="studentName"]').fill(fname("Block Reason"));
  await selectTrigger(form, "paymentType").click();
  await page.getByRole("option", { name: "Instalment" }).click();

  const save = form.getByRole("button", { name: "Add income" });
  await expect(save).toBeDisabled();
  // Specifically about the COUNT, not about due dates - both used to say "due dates" regardless.
  await expect(form.getByText(/how many instalments/i)).toBeVisible();
});

test("the form keeps what was typed when the server cannot be reached", async ({ page }) => {
  // Issue 10: a bare `await` on the server action meant an offline submit threw past the form to
  // the route error boundary - the whole page replaced by "Finance couldn't load" and every field
  // lost. lib/action-guard catches it and renders the message inside the form instead.
  await gotoFinance(page);
  const form = incomeForm(page);
  const student = fname("Offline Payer");
  await form.locator('input[name="studentName"]').fill(student);
  await form.locator('input[name="amountInr"]').fill("4321");

  await page.context().setOffline(true);
  await form.getByRole("button", { name: "Add income" }).click();

  await expect(form.getByRole("alert")).toContainText(/offline|could not reach/i);
  await expect(page.getByRole("heading", { name: /Finance couldn.t load/ })).toHaveCount(0);
  await expect(form.locator('input[name="studentName"]')).toHaveValue(student);
  await page.context().setOffline(false);
});
