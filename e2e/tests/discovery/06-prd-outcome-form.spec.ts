/**
 * PRD1 §5.3 "Discovery Call Outcome Entry" - Pipeline -> "Discovery call outcomes" tab
 * (pipeline-actions.createOutcome): Lead (linked), Call date, Call outcome, SSS date (if booked),
 * Call notes (key notes to closer).
 *
 * Asma enters it; Ameen (Admin, the closer) must be able to read the notes.
 * Local: seeded lead. Prod: needs a fenced lead assigned to the specialist - the form writes no
 * message, but a stray outcome on a real lead would pollute metrics, so it stays local-only.
 */
import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { RUN } from "../../helpers/app";
import { installPopupHandlers, pageAs } from "../../helpers/discovery-ui";
import { seedLead, leadRow, outcomes, stageHistory, closeDiscoveryDb } from "../../helpers/discovery-db";

test.use({ storageState: authFile("asma") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });
test.beforeEach(() => {
  test.setTimeout(240_000);
  test.skip(!HAS_DB, "local only - see file header");
});

async function openOutcomeForm(page: Page) {
  await installPopupHandlers(page);
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: "Discovery call outcomes" }).click();
  const form = page.locator("form").filter({ has: page.getByText("SSS date (if booked)") });
  await expect(form).toBeVisible();
  return form;
}

async function fillOutcome(page: Page, form: ReturnType<Page["locator"]>, leadName: string, outcomeLabel: string, notes: string) {
  const [leadTrigger, outcomeTrigger] = [form.getByRole("button", { name: /\(/ }).first(), form.getByRole("button", { name: /Qualified for SSS|Not qualified|Follow up|No show|Sent to Workshop/ }).first()];
  await leadTrigger.click();
  await page.getByRole("option", { name: new RegExp(leadName) }).click();
  await outcomeTrigger.click();
  await page.getByRole("option", { name: outcomeLabel, exact: true }).click();
  await form.locator("textarea[name=notes]").fill(notes);
}

test("Qualified for SSS: SSS date is required and the lead moves to SSS Call Booked", async ({ page }) => {
  const lead = await seedLead({ label: "PRD form qualified", stage: "DISCO_BOOKED" });
  const form = await openOutcomeForm(page);
  const notes = `${RUN} PRD notes qualified`;
  await fillOutcome(page, form, lead.name, "Qualified for SSS", notes);
  await form.getByRole("button", { name: "Add outcome" }).click();
  await page.waitForTimeout(2500);
  const rows = await outcomes(lead.id);
  expect.soft(rows.length, "DSC-02: 'Qualified for SSS' saved with no SSS date - the PRD's SSS date is never enforced").toBe(0);
  if (rows.length) {
    expect.soft((await leadRow(lead.id)).stage, "DSC-18: the PRD outcome form does not move the lead's stage (desk routing does)").toBe("SSS_BOOKED");
  }
});

test("No show via the PRD form moves the lead to No show (counted in the no-show rate)", async ({ page }) => {
  const lead = await seedLead({ label: "PRD form no show", stage: "DISCO_BOOKED" });
  const form = await openOutcomeForm(page);
  await fillOutcome(page, form, lead.name, "No show", `${RUN} PRD notes no show`);
  await form.getByRole("button", { name: "Add outcome" }).click();
  await expect.poll(async () => (await outcomes(lead.id)).length, { timeout: 20_000 }).toBe(1);
  expect((await outcomes(lead.id))[0].outcome).toBe("NO_SHOW");
  const hist = (await stageHistory(lead.id)).map((h) => h.toStage);
  expect.soft(hist, "DSC-18: a No show entered on the PRD form never reaches NO_SHOW, so the no-show rate ignores it").toContain("NO_SHOW");
});

test("notes to closer are visible to the closer (Admin) against the lead", async ({ page, browser }) => {
  const lead = await seedLead({ label: "PRD form notes", stage: "DISCO_BOOKED" });
  const form = await openOutcomeForm(page);
  const notes = `${RUN} key notes to closer: budget ok, wants Q1 start`;
  await fillOutcome(page, form, lead.name, "Follow up needed", notes);
  await form.getByRole("button", { name: "Add outcome" }).click();
  await expect.poll(async () => (await outcomes(lead.id)).length, { timeout: 20_000 }).toBe(1);

  const { ctx, page: admin } = await pageAs(browser, "admin");
  try {
    await openOutcomeForm(admin);
    await admin.getByPlaceholder("Filter outcomes…").fill(lead.name);
    const row = admin.locator("tr").filter({ hasText: lead.name }).first();
    await expect(row).toContainText(notes);
    await expect(row).toContainText("Follow up needed");
    await expect(row).toContainText("Asma");
  } finally {
    await ctx.close();
  }
});
