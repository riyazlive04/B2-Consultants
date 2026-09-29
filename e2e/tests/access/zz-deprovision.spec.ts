import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { q } from "../../helpers/db";
import { ACCOUNTS_FILE, CREDS_FILE, apiSignIn, evidence, openPeopleTab, readJson, sleep, writeJson, type TestAccount } from "../../helpers/access-lib";

/**
 * Removes every account this area created - the provisioned per-role accounts and every
 * throwaway lifecycle account - through the admin UI: Suspend first (sessions evicted at once),
 * then Delete. Then proves none of them can sign in.
 *
 * Scope guard: only rows whose email is support+e2e-...@sirahdigital.in are ever touched.
 * Team profiles have no delete in the UI; deleting the login retires them (INACTIVE, listed
 * under "Former team members"), which is the app's own record-keeping rule.
 */

const OURS = /^support\+e2e-[a-z0-9-]+@sirahdigital\.in$/;

test.use({ storageState: authFile("admin") });

async function rowsOnScreen(page: Page) {
  await openPeopleTab(page, "Users & access");
  await page.getByPlaceholder("Filter users…").fill("E2E");
  await page.waitForTimeout(500);
  const rows = page.getByRole("row").filter({ hasText: "support+e2e-" });
  const out: { name: string; email: string }[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const t = await rows.nth(i).innerText();
    const email = t.match(/support\+e2e-[a-z0-9-]+@sirahdigital\.in/)?.[0];
    const name = t.split("\n").map((s) => s.trim()).find((s) => s.startsWith("E2E "));
    if (email && name && OURS.test(email)) out.push({ name, email });
  }
  return out;
}

test("deprovision: suspend then delete every E2E account, then prove none can sign in", async ({ page }) => {
  test.setTimeout(900_000);
  const known = readJson<TestAccount[]>(ACCOUNTS_FILE, []);
  const creds = readJson<Record<string, { email: string; password: string; role: string }>>(CREDS_FILE, {});
  const passwords = new Map<string, string>();
  for (const a of known) passwords.set(a.email, a.password);
  for (const [k, c] of Object.entries(creds)) if (k !== "admin") passwords.set(c.email, c.password);

  const removed: string[] = [];
  const suspendedOnly: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const rows = (await rowsOnScreen(page)).filter((r) => !suspendedOnly.some((s) => s.startsWith(r.email)));
    if (!rows.length) break;
    for (const r of rows) {
      await openPeopleTab(page, "Users & access");
      await page.getByPlaceholder("Filter users…").fill(r.name);
      const row = page.getByRole("row").filter({ hasText: r.email }).filter({ hasNotText: "Nothing matches" });
      if ((await row.count()) !== 1) continue;
      const suspend = row.getByRole("button", { name: "Suspend", exact: true });
      if (await suspend.count()) {
        await suspend.click();
        await page.getByRole("button", { name: "Suspend", exact: true }).last().click();
        await expect(page.getByText(`${r.name} suspended`).first()).toBeVisible({ timeout: 60_000 });
      }
      await row.getByRole("button", { name: `Delete ${r.name}` }).click();
      await page.getByRole("button", { name: "Delete account", exact: true }).click();
      // Delete can be refused (e.g. another area left rows that reference this login). The
      // account is already suspended, so it stays locked out; record it for manual cleanup.
      const ok = page.getByText(`${r.name} deleted`).first();
      const err = page.locator("[role=status],[role=alert]").filter({ hasText: /error|could not|foreign|constraint|failed/i }).first();
      await expect(ok.or(err)).toBeVisible({ timeout: 60_000 });
      if (await ok.isVisible()) removed.push(r.email);
      else suspendedOnly.push(`${r.email}: ${(await err.innerText()).slice(0, 160)}`);
    }
  }

  // Nobody we created can sign in any more (known passwords, spaced for the rate limit).
  const signIns: Record<string, number> = {};
  for (const [email, pw] of passwords) {
    const s = await apiSignIn(email, pw);
    signIns[email] = s.status;
    await s.ctx.dispose();
    await sleep(IS_PROD ? 4_000 : 300);
  }
  const remaining = HAS_DB ? await q(`select email, status from "user" where email like 'support+e2e-%'`) : [];
  evidence(`deprovision-${IS_PROD ? "prod" : "local"}`, { removed, suspendedOnly, signIns, remaining });

  // The hard guarantee: nobody we created can sign in. Deletion is best effort on top of that.
  for (const [email, status] of Object.entries(signIns)) expect(status, `${email} can no longer sign in`).not.toBe(200);
  expect(remaining.filter((u) => u.status !== "SUSPENDED"), "any E2E login that could not be deleted is at least suspended").toEqual([]);
  expect(suspendedOnly, `accounts suspended but not deletable (clean up by hand):\n${suspendedOnly.join("\n")}`).toEqual([]);
  expect(await rowsOnScreen(page), "Users & access lists no E2E accounts").toEqual([]);

  // Leave only the founder's entry in the creds file, and start a fresh run tag next time.
  if (creds.admin) writeJson(CREDS_FILE, IS_PROD ? { admin: creds.admin } : {});
  else if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
  if (!IS_PROD && fs.existsSync(CREDS_FILE) && Object.keys(readJson(CREDS_FILE, {})).length === 0) fs.unlinkSync(CREDS_FILE);
  writeJson(ACCOUNTS_FILE, []);
  const runFile = `reports/.access-run-${IS_PROD ? "prod" : "local"}`;
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
});
