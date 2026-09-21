import { test, expect, request, type Page } from "@playwright/test";
import { BASE_URL } from "../../playwright.config";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { one, q } from "../../helpers/db";
import {
  EMPTY_STATE, acceptInviteViaUI, apiSignIn, evidence, inviteViaUI, ipHeaders, openPeopleTab, sleep, testEmail, userRow, ARUN, TEST_PASSWORD,
} from "../../helpers/access-lib";
import { makeLeaver } from "../../helpers/access-offboard";

/**
 * Sign-in, sign-out, the password flows and role changes - all on fresh E2E accounts, never the
 * seeded ones (logging a shared session out would break the other agents).
 */

test.skip(IS_PROD || !HAS_DB, "uses the local verification table and creates accounts");
test.use({ storageState: authFile("admin") });
test.describe.configure({ timeout: 360_000 });

const freshIp = () => `10.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@b2consultants.in").fill(email);
  await page.getByPlaceholder("••••••••").first().fill(password);
  await page.locator('form button[type="submit"]').click();
}

test("wrong password shows a generic error and no session", async ({ browser, page }) => {
  const acct = await makeLeaver(page, browser, "wrongpw", { profile: false });
  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: { "X-Forwarded-For": freshIp() } });
  const p = await ctx.newPage();
  await uiLogin(p, acct.email, "definitely-not-it");
  await expect(p.locator('form p[role="alert"]')).toContainText("Invalid email or password.");
  await expect(p).toHaveURL(/\/login/);
  const unknown = await apiSignIn(`support+e2e-nobody-${ARUN}@sirahdigital.in`, "whatever-123", { ip: freshIp() });
  expect(unknown.status, "unknown email answers like a wrong password (no account enumeration)").toBe(401);
  await unknown.ctx.dispose();
  await ctx.close();
});

test("ACC-10 sign-in rate limit shows a message - and is keyed on a client-controlled header", async ({ browser, page }) => {
  test.setTimeout(360_000);
  const acct = await makeLeaver(page, browser, "ratelimit", { profile: false });
  const ip = freshIp();
  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: { "X-Forwarded-For": ip } });
  const p = await ctx.newPage();
  const messages: string[] = [];
  const statuses: number[] = [];
  // Burst of wrong passwords from one address (better-auth: 3 sign-ins per 10 s per IP)...
  const burst = async () => {
    for (let i = 0; i < 4; i++) {
      const w = await apiSignIn(acct.email, `wrong-${i}-password`, { retry429: false, ip });
      statuses.push(w.status);
      await w.ctx.dispose();
    }
  };
  await burst();
  // ...then, inside the same 10 s window, the right password: same address vs a different X-Forwarded-For.
  const sameIp = await apiSignIn(acct.email, acct.password, { retry429: false, ip });
  const bypass = await apiSignIn(acct.email, acct.password, { retry429: false, ip: freshIp() });
  // What the person at the keyboard sees: form filled first, burst, then submit.
  await p.goto("/login");
  await p.getByPlaceholder("you@b2consultants.in").fill(acct.email);
  await p.getByPlaceholder("••••••••").first().fill(acct.password);
  p.on("response", (r) => { if (r.url().includes("/api/auth/sign-in")) statuses.push(r.status()); });
  await burst();
  await p.locator('form button[type="submit"]').click();
  await expect(p.locator('form p[role="alert"]')).toBeVisible();
  messages.push((await p.locator('form p[role="alert"]').innerText()).trim());
  const limited = statuses.includes(429);
  evidence("ACC-10-rate-limit", { statuses, messages, bypassStatus: bypass.status, sameIpStatus: sameIp.status });
  await bypass.ctx.dispose();
  await sameIp.ctx.dispose();
  await ctx.close();
  expect(limited, `sign-in attempts ${JSON.stringify(statuses)}`).toBe(true);
  expect(messages.some((m) => /too many|try again|Sign-in failed/i.test(m)), `UI message on 429: ${JSON.stringify(messages)}`).toBe(true);
  expect(sameIp.status, "still limited on the same address").toBe(429);
  expect(bypass.status,
    `ACC-10: changing X-Forwarded-For resets the limiter (better-auth trusts it by default; src/lib/auth.ts sets no advanced.ipAddress). ` +
    `Behind a proxy that forwards the client's header this makes brute force unlimited; with no header every client shares one bucket.`).toBe(429);
});

test("logout clears the session (cookie no longer works anywhere)", async ({ browser, page }) => {
  const acct = await makeLeaver(page, browser, "logout", { profile: false });
  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: ipHeaders() });
  const p = await ctx.newPage();
  await uiLogin(p, acct.email, acct.password);
  await expect(p).not.toHaveURL(/\/login/, { timeout: 30_000 });
  const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  await p.getByRole("button", { name: "Log out" }).first().click();
  await expect(p).toHaveURL(/\/login/, { timeout: 30_000 });
  await p.goto("/profile");
  await expect(p).toHaveURL(/\/login/);
  const replay = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Cookie: cookies } });
  const s = await replay.get("/api/auth/get-session");
  expect(await s.text()).toMatch(/^null$|^$/);
  const prof = await replay.get("/profile", { maxRedirects: 0 });
  expect(prof.status()).toBe(307);
  await replay.dispose();
  const rows = await one(`select count(*)::int n from session where "userId"=$1`, [acct.userId]);
  evidence("logout", { sessionsLeftForUser: rows.n });
  await ctx.close();
});

test("forgot password -> emailed token -> reset page -> sign in with the new password", async ({ browser, page }) => {
  const acct = await makeLeaver(page, browser, "forgot", { profile: false });
  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: ipHeaders() });
  const p = await ctx.newPage();
  const prior = (await q(`select identifier from verification where value=$1`, [acct.userId])).map((r) => r.identifier);
  await p.goto("/login");
  await p.getByRole("link", { name: /forgot/i }).click();
  await expect(p).toHaveURL(/\/forgot-password/);
  await p.getByPlaceholder("you@b2consultants.in").fill(acct.email);
  await p.getByRole("button", { name: "Send reset link" }).click();
  await expect(p.getByRole("status")).toContainText("If that email has an account");
  let tok: { identifier: string } | undefined;
  for (let i = 0; i < 10 && !tok; i++) {
    tok = await one(`select identifier from verification where value=$1 and identifier like 'reset-password:%' and not (identifier = any($2::text[]))`, [acct.userId, prior]);
    if (!tok) await sleep(500);
  }
  expect(tok, "a reset token was issued").toBeTruthy();
  const token = tok!.identifier.split(":")[1];
  // The link in the email goes through better-auth's callback, which forwards to /reset-password?token=
  const cb = await p.request.get(`/api/auth/reset-password/${token}?callbackURL=/reset-password`, { maxRedirects: 0 });
  expect(cb.status()).toBe(302);
  expect(cb.headers()["location"]).toContain(`/reset-password?token=${token}`);
  await p.goto(`/reset-password?token=${token}`);
  const newPw = `${TEST_PASSWORD}-reset`;
  await p.getByPlaceholder("••••••••").nth(0).fill(newPw);
  await p.getByPlaceholder("••••••••").nth(1).fill(newPw);
  await p.getByRole("button", { name: "Set new password" }).click();
  await expect(p).toHaveURL(/\/login\?reset=success/);
  await expect(p.getByText("Password updated - sign in with your new password.")).toBeVisible();
  const old = await apiSignIn(acct.email, acct.password, { ip: `10.200.${Math.floor(Math.random() * 250)}.1` });
  expect(old.status, "old password no longer works").toBe(401);
  await old.ctx.dispose();
  await uiLogin(p, acct.email, newPw);
  await expect(p).not.toHaveURL(/\/login/, { timeout: 30_000 });
  // Token is single use.
  const again = await p.request.post("/api/auth/reset-password", { data: { newPassword: `${newPw}2`, token }, headers: { Origin: BASE_URL } });
  expect(again.status()).toBe(400);
  await ctx.close();
});

test("admin 'Reset password' forces a change on next sign-in; change-password flow works", async ({ browser, page }) => {
  const acct = await makeLeaver(page, browser, "forcechange", { profile: false });
  const row = await userRow(page, acct.email, acct.name);
  await row.getByRole("button", { name: "Reset password" }).click();
  const temp = `Temp-${ARUN}-pw`;
  await page.getByRole("dialog").locator('input[name="password"]').fill(temp);
  await page.getByRole("button", { name: "Set password", exact: true }).click();
  await expect(page.getByText(`Password updated for ${acct.name}`).first()).toBeVisible({ timeout: 60_000 });

  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: ipHeaders() });
  const p = await ctx.newPage();
  await uiLogin(p, acct.email, temp);
  await p.waitForURL(/change-password/, { timeout: 30_000 });
  await p.goto("/finance");
  await expect(p, "every app route bounces to /change-password until it is changed").toHaveURL(/change-password/);
  const next = `${TEST_PASSWORD}-changed`;
  await p.locator('input[name="currentPassword"]').fill(temp);
  await p.locator('input[name="newPassword"]').fill(next);
  await p.locator('input[name="confirm"]').fill(next);
  await p.locator('form button[type="submit"]').click();
  await expect(p).not.toHaveURL(/change-password/, { timeout: 30_000 });
  const flag = await one(`select "mustChangePassword" m from "user" where id=$1`, [acct.userId]);
  expect(flag.m).toBe(false);
  const s = await apiSignIn(acct.email, next);
  expect(s.status).toBe(200);
  await s.ctx.dispose();
  await ctx.close();
});

test("ACC-11 the mustChangePassword gate only covers pages - JSON APIs answer before the password is changed", async ({ browser, page }) => {
  const acct = await makeLeaver(page, browser, "forcedapi", { profile: false });
  const row = await userRow(page, acct.email, acct.name);
  await row.getByRole("button", { name: "Reset password" }).click();
  const temp = `Temp-${ARUN}-api`;
  await page.getByRole("dialog").locator('input[name="password"]').fill(temp);
  await page.getByRole("button", { name: "Set password", exact: true }).click();
  await expect(page.getByText(`Password updated for ${acct.name}`).first()).toBeVisible({ timeout: 60_000 });
  const s = await apiSignIn(acct.email, temp);
  expect(s.status).toBe(200);
  const out: Record<string, number> = {};
  for (const path of ["/api/notifications", "/api/command-palette", "/api/leads/poll-recent?scope=kanban&since=2000-01-01T00:00:00Z", "/api/export/leads?q=E2E"]) {
    out[path] = (await s.ctx.get(path, { maxRedirects: 0 })).status();
  }
  await s.ctx.dispose();
  evidence("ACC-11-must-change-password-apis", out);
  const open = Object.entries(out).filter(([, v]) => v === 200).map(([k]) => k);
  expect(open, `ACC-11: with mustChangePassword=true (admin-set temporary password) these still answer 200: ${open.join(", ")} (routes call auth.api.getSession, not requireSession - src/lib/rbac.ts:74-76 is the only gate)`).toEqual([]);
});

test("invite links are single use and show the right message afterwards", async ({ browser, page }) => {
  const email = testEmail(`invite-${Math.random().toString(36).slice(2, 6)}`);
  const name = `E2E Invitee ${ARUN}`;
  const path = await inviteViaUI(page, { name, email, role: "USER" });
  const ctx = await acceptInviteViaUI(browser, path, TEST_PASSWORD);
  await ctx.close();
  const { rememberAccount } = await import("../../helpers/access-lib");
  const u = await one(`select id from "user" where email=$1`, [email]);
  rememberAccount({ key: "invitee", name, email, password: TEST_PASSWORD, role: "USER", userId: u.id });
  const anon = await browser.newContext({ storageState: EMPTY_STATE });
  const p = await anon.newPage();
  await p.goto(path);
  await expect(p.getByText("This invite has already been used")).toBeVisible();
  await p.goto("/invite/not-a-real-token-123456");
  await expect(p.getByText("This invite link isn't valid")).toBeVisible();
  await anon.close();
});

test("admin role change applies to an already-open session on its next request; user cannot self-edit", async ({ browser, page }) => {
  test.setTimeout(360_000);
  const acct = await makeLeaver(page, browser, "rolechange", { profile: false });
  const r = await apiSignIn(acct.email, acct.password);
  const state = await r.ctx.storageState();
  await r.ctx.dispose();
  const ctx = await browser.newContext({ storageState: state, extraHTTPHeaders: ipHeaders() });
  const p = await ctx.newPage();
  await p.goto("/telecaller");
  await expect(p).toHaveURL(/denied=telecaller/);

  // The user's own page has no role control.
  await p.goto("/profile");
  await expect(p.getByRole("group", { name: "Role" })).toHaveCount(0);

  const row = await userRow(page, acct.email, acct.name);
  await row.getByRole("button", { name: "Edit access" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Edit access" });
  await dlg.getByRole("group", { name: "Role" }).getByRole("button", { name: "Head coach", exact: true }).click();
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Access updated for/).first()).toBeVisible({ timeout: 60_000 });

  await p.goto("/telecaller");
  await expect(p, "promotion to HEAD takes effect on the next request in the open session").toHaveURL(/\/telecaller$/);
  await expect(p.locator("aside").getByRole("link", { name: "Telecaller Pay" })).toBeVisible();

  const back = await userRow(page, acct.email, acct.name);
  await back.getByRole("button", { name: "Edit access" }).click();
  const dlg2 = page.getByRole("dialog").filter({ hasText: "Edit access" });
  await dlg2.getByRole("group", { name: "Role" }).getByRole("button", { name: "Student", exact: true }).click();
  await dlg2.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Access updated for/).first()).toBeVisible({ timeout: 60_000 });
  await p.goto("/my-desk");
  await expect(p, "demotion to STUDENT takes effect immediately too").not.toHaveURL(/\/my-desk$/);
  await expect(p.locator("aside").getByRole("link", { name: "My Desk" })).toHaveCount(0);
  await ctx.close();
});

test("ACC-12 login ?next= accepts a backslash path and leaves the site after sign-in (open redirect)", async ({ browser, page }) => {
  const acct = await makeLeaver(page, browser, "nextredirect", { profile: false });
  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: ipHeaders() });
  const p = await ctx.newPage();
  // Never actually load a third-party page: abort anything that is not our server.
  const offsite: string[] = [];
  await ctx.route((u) => !u.href.startsWith(BASE_URL), (route) => { offsite.push(route.request().url()); return route.abort(); });
  await p.goto(`/login?next=${encodeURIComponent("/\\example.invalid/phish")}`);
  await p.getByPlaceholder("you@b2consultants.in").fill(acct.email);
  await p.getByPlaceholder("••••••••").first().fill(acct.password);
  await p.locator('form button[type="submit"]').click();
  await sleep(6_000);
  evidence("ACC-12-next-open-redirect", { finalUrl: p.url(), offsite });
  await ctx.close();
  expect(offsite.filter((u) => u.includes("example.invalid")),
    `ACC-12: after sign-in the app navigated off-site to ${offsite.join(", ")} - src/app/login/LoginForm.tsx:192 only rejects "//" prefixes, and "/\\host" is normalised by the browser to "//host".`).toEqual([]);
});
