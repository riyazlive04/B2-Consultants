import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { IS_PROD } from "../../helpers/target";
import { createdEntries } from "../../helpers/people-data";
import { confirmDialog, openTab } from "../../helpers/people-ui";
import { deleteStudentUI } from "../../helpers/people-students";

/**
 * Removes / archives what the People specs recorded in reports/created-<target>-people.jsonl.
 * Only touches labels that start with "E2E" (the run tag), never real records.
 *
 * What CANNOT be cleaned up through the app (by design):
 *  - DailyLog rows and their correction notes (append-only, PRD2 §6).
 *  - TeamProfiles: no delete - they are offboarded and remain under "Former team members".
 *  - Archived Finance income rows stay in Finance > Archived (restorable) until purged.
 */
test.use({ storageState: authFile("admin") });
test.setTimeout(900_000);

const done: string[] = [];
const log = (s: string) => {
  done.push(s);
  fs.appendFileSync(`reports/cleaned-${IS_PROD ? "prod" : "local"}-people.jsonl`, JSON.stringify({ at: new Date().toISOString(), s }) + "\n");
};
const isOurs = (label: string) => /^E2E[0-9A-Z]+ /.test(label);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

test("delete E2E students", async ({ page }) => {
  const names = uniq(createdEntries().filter((e) => e.kind === "Student" && isOurs(e.label)).map((e) => e.label as string));
  for (const n of names) {
    if (await deleteStudentUI(page, n)) log(`student deleted: ${n}`);
  }
});

test("archive E2E income entries", async ({ page }) => {
  const names = uniq(createdEntries().filter((e) => e.kind === "Income" && isOurs(e.label)).map((e) => (e.label as string).split(" ₹")[0]));
  for (const n of names) {
    await page.goto("/finance");
    await page.getByPlaceholder("Filter income…").fill(n);
    await page.waitForTimeout(800);
    let rows = page.locator("tbody tr", { hasText: n }).filter({ has: page.getByRole("button", { name: "Delete" }) });
    while ((await rows.count()) > 0) {
      await rows.first().getByRole("button", { name: "Delete" }).click();
      await confirmDialog(page, "Archive");
      await expect(page.getByText("Income entry archived").last()).toBeVisible({ timeout: 30_000 });
      log(`income archived: ${n}`);
      await page.goto("/finance");
      await page.getByPlaceholder("Filter income…").fill(n);
      await page.waitForTimeout(800);
      rows = page.locator("tbody tr", { hasText: n }).filter({ has: page.getByRole("button", { name: "Delete" }) });
    }
  }
});

async function deleteOkr(page: Page, member: string, title: string) {
  await page.goto("/people");
  await openTab(page, /^OKRs/);
  const line = page.locator("div.text-sm", { has: page.locator(`span[title="${title}"]`) }).first();
  if ((await line.count()) === 0) return false;
  await line.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete");
  await expect(page.locator(`span[title="${title}"]`)).toHaveCount(0, { timeout: 20_000 });
  return true;
}

test("delete E2E OKRs", async ({ page }) => {
  const okrs = uniq(createdEntries().filter((e) => e.kind === "OKR").map((e) => e.label as string));
  for (const l of okrs) {
    const [member, title] = l.split(" / ");
    if (!isOurs(title)) continue;
    if (await deleteOkr(page, member, title)) log(`okr deleted: ${l}`);
  }
});

test("offboard E2E team profiles (cannot be deleted)", async ({ page }) => {
  await page.goto("/people");
  await openTab(page, /Team & org chart/);
  const onChart = await page.locator("div.w-64 p.font-display").allInnerTexts();
  const recorded = createdEntries().filter((e) => String(e.kind).startsWith("TeamProfile")).map((e) => e.label as string);
  const targets = uniq(onChart.filter((n) => isOurs(n) && (recorded.includes(n))));
  for (const n of targets) {
    await page.goto("/people");
    await openTab(page, /Team & org chart/);
    const card = page.locator("div.w-64", { has: page.locator("p.font-display", { hasText: new RegExp(`^${n}$`) }) });
    await card.getByRole("button", { name: "Offboard" }).click();
    const dlg = page.getByRole("dialog", { name: new RegExp(`Offboard ${n}`) });
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await dlg.getByRole("button", { name: "Continue" }).click();
    await dlg.getByRole("button", { name: "Continue" }).click();
    await dlg.getByRole("button", { name: `Offboard ${n}` }).click();
    await expect(dlg).toBeHidden({ timeout: 30_000 });
    log(`profile offboarded: ${n}`);
  }
  test.info().annotations.push({ type: "not-removable", description: "TeamProfiles stay under Former team members; DailyLogs + correction notes are append-only" });
});
