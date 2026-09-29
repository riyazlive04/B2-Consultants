import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { q } from "../../helpers/db";
import { gotoFinance, openTab } from "../../helpers/finance-ui";

/**
 * Removes what the finance specs created, THROUGH THE UI:
 *   Income / Expense / Pending payment -> Delete (archives; income+expense ledger entries are
 *   VOIDED by a reversal, the append-only journal keeps both) -> Archived tab -> Delete permanently.
 *   Payables -> Delete (hard delete).
 *   Cash positions have no delete in the UI; they are only ever created locally and removed here
 *   from the local DB.
 *
 * Which records: every run tag (E2E...) found in reports/created-<target>-finance.jsonl, or the
 * tags given in E2E_FIN_CLEAN_TAGS (comma-separated). Run it on its own:
 *   E2E_AREA=finance npx playwright test tests/finance/99-cleanup.spec.ts --workers=1
 */
test.use({ storageState: authFile("admin") });
test.describe.configure({ mode: "default" });

function runTags(): string[] {
  if (process.env.E2E_FIN_CLEAN_TAGS) return process.env.E2E_FIN_CLEAN_TAGS.split(",").map((s) => s.trim()).filter(Boolean);
  const f = `reports/created-${IS_PROD ? "prod" : "local"}-finance.jsonl`;
  if (!fs.existsSync(f)) return [];
  const tags = new Set<string>();
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = JSON.parse(line).label?.match(/\bE2E[A-Z0-9]{6,}\b/);
    if (m) tags.add(m[0]);
  }
  return [...tags];
}
const TAGS = runTags();

async function archiveAll(page: Page, tab: RegExp | string, tagText: string) {
  // Several passes with a reload between them: the Delete button hides the row optimistically,
  // and under load the archive action can still fail server-side (FIN-01), leaving the row in place.
  for (let pass = 0; pass < 4; pass++) {
    await gotoFinance(page);
    await openTab(page, tab);
    await page.locator('input[aria-label^="Filter"]').first().fill(tagText);
    const rows = () => page.locator("table tbody tr").filter({ hasText: tagText }).filter({ hasNotText: "Nothing matches" });
    await page.waitForTimeout(1000);
    if ((await rows().count()) === 0) return;
    for (let guard = 0; guard < 200 && (await rows().count()) > 0; guard++) {
      const before = await rows().count();
      await rows().first().getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").last().getByRole("button", { name: "Archive" }).click();
      await expect(rows()).toHaveCount(before - 1, { timeout: 30_000 });
      await page.waitForTimeout(1500); // let the archive action finish before the next one
    }
  }
}

async function purgeArchived(page: Page, tagText: string) {
  for (let pass = 0; pass < 4; pass++) {
    await gotoFinance(page);
    await openTab(page, /^Archived/);
    const buttons = () => page.getByRole("button", { name: new RegExp(`^Delete ${tagText}.* permanently$`) });
    await page.waitForTimeout(1000);
    if ((await buttons().count()) === 0) return;
    for (let guard = 0; guard < 300 && (await buttons().count()) > 0; guard++) {
      const before = await buttons().count();
      // The panel disables its buttons while a purge is in flight.
      await expect(buttons().first()).toBeEnabled({ timeout: 120_000 });
      await buttons().first().click();
      await page.getByRole("dialog").last().getByRole("button", { name: "Delete permanently" }).click();
      await expect(buttons()).toHaveCount(before - 1, { timeout: 30_000 });
    }
  }
}

for (const t of TAGS) {
  test(`clean finance records tagged ${t}`, async ({ page }) => {
    test.setTimeout(1_800_000);
    await archiveAll(page, "Income", t);
    await archiveAll(page, "Expenses", t);
    await archiveAll(page, /^Pending payments/, t);
    // Archived tab groups; the archived row's headline is the student name / vendor, both tagged.
    // An archived plan's instalments are removed with it (cascade).
    await purgeArchived(page, t);

    await page.goto("/cash");
    await openTab(page, "Payables");
    const payables = () => page.locator("table tbody tr").filter({ hasText: t }).filter({ hasNotText: "No payables" });
    for (let guard = 0; guard < 50 && (await payables().count()) > 0; guard++) {
      const before = await payables().count();
      await payables().first().getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").last().getByRole("button", { name: "Delete" }).click();
      await expect(payables()).toHaveCount(before - 1, { timeout: 30_000 });
    }

    if (HAS_DB && !IS_PROD) {
      await q(`delete from cash_position where notes like $1`, [`${t}%`]);
      const left = await q(
        `select (select count(*) from income where notes like $1)::int i, (select count(*) from expense where notes like $1)::int e,
                (select count(*) from pending_payment where "studentName" like $1 or notes like $1)::int p,
                (select count(*) from payable where name like $1)::int y`,
        [`${t}%`],
      );
      expect(left[0], `leftovers for ${t}`).toEqual({ i: 0, e: 0, p: 0, y: 0 });
    }
  });
}

test("nothing to clean is not an error", async () => {
  test.skip(TAGS.length > 0);
  expect(TAGS).toEqual([]);
});
