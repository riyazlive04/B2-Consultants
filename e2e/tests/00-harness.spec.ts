import { test, expect } from "@playwright/test";
import { ROLES, authFile, RoleKey } from "../helpers/roles";
import { HAS_DB } from "../helpers/target";
import { one } from "../helpers/db";

for (const key of Object.keys(ROLES) as RoleKey[]) {
  test.describe(`harness ${key}`, () => {
    test.use({ storageState: authFile(key) });
    test(`${key} session works`, async ({ page }) => {
      const res = await page.goto("/");
      expect(res!.status()).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/login/);
    });
  });
}
test("server is on the local DB", async () => {
  test.skip(!HAS_DB);
  // Every seeded role account is present in the database the helpers read. A user count would
  // break as soon as a run leaves E2E accounts behind; the seeded emails are what identify it.
  const emails = Object.values(ROLES).map((r) => r.email);
  const r = await one(`select count(*)::int n from "user" where email = any($1)`, [emails]);
  expect(r.n, "the seeded role accounts exist in the database the tests read").toBe(emails.length);
});
