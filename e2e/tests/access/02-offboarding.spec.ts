import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { q } from "../../helpers/db";
import { evidence, openPeopleTab, pickSelect, profileCard, userRow } from "../../helpers/access-lib";
import { leaks, makeLeaver, observeLeaver, openSession } from "../../helpers/access-offboard";

/**
 * Founder-reported: "Nilofer left the company, but I can still log in using Nilofer's
 * credentials, and work." Every UI path by which an admin can mark someone as gone is exercised
 * on a brand-new account (never the seeded Nilofer), with a browser session opened BEFORE the
 * change, and then every door is tried: fresh sign-in, the open browser, its APIs and a server
 * action, the raw cookie replayed elsewhere, and forgot-password.
 *
 * Local only: it needs the verification table for the reset token and creates/destroys several
 * accounts per run.
 */

test.skip(IS_PROD || !HAS_DB, "lifecycle probes need the local DB");
test.use({ storageState: authFile("admin") });

test("ACC-01 People > Team & org chart > Edit > Status 'Inactive' locks the leaver out", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const acct = await makeLeaver(page, browser, "inactive");
  const before = await openSession(browser, acct);

  await openPeopleTab(page, "Team & org chart");
  await profileCard(page, acct.name).getByRole("button", { name: "Edit" }).click();
  const form = page.locator("form").filter({ has: page.locator('input[name="roleTitle"]') });
  await pickSelect(page, form, "status", "Inactive");
  await form.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved").first()).toBeVisible({ timeout: 60_000 });

  const o = await observeLeaver(acct, before);
  evidence("ACC-01-status-inactive", o);
  await before.ctx.close();
  expect(o.profileStatus).toBe("INACTIVE");
  const l = leaks(o);
  expect(l, `ACC-01 BUG: marking a team member "Inactive" (the People status meant for someone who left) does not touch their login. ` +
    `User.status stays ${o.userStatus}, ${o.sessionsInDb} session(s) survive. Still open:\n  ${l.join("\n  ")}\n` +
    `Root cause: src/server/people-actions.ts:62,69-71 saveTeamProfile writes TeamProfile.status only; nothing reads TeamProfile.status in src/lib/auth.ts:139-147 (sign-in hook) or src/lib/rbac.ts:66-69 (requireSession).`).toEqual([]);
});

test("ACC-02 'On leave' keeps access (it is not 'left')", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const acct = await makeLeaver(page, browser, "onleave");
  const before = await openSession(browser, acct);
  await openPeopleTab(page, "Team & org chart");
  await profileCard(page, acct.name).getByRole("button", { name: "Edit" }).click();
  const form = page.locator("form").filter({ has: page.locator('input[name="roleTitle"]') });
  await pickSelect(page, form, "status", "On leave");
  await form.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved").first()).toBeVisible({ timeout: 60_000 });

  const o = await observeLeaver(acct, before, { tryReset: false });
  evidence("ACC-02-status-on-leave", o);
  await before.ctx.close();
  expect(o.profileStatus).toBe("ON_LEAVE");
  expect(o.signInStatus, "someone on leave can still sign in").toBe(200);
  expect(o.openSessionPageUrl).not.toMatch(/^\/login/);
});

test("Users & access > Suspend locks out every door", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const acct = await makeLeaver(page, browser, "suspend");
  const before = await openSession(browser, acct);

  const row = await userRow(page, acct.email, acct.name);
  await row.getByRole("button", { name: "Suspend", exact: true }).click();
  await page.getByRole("button", { name: "Suspend", exact: true }).last().click();
  await expect(page.getByText(`${acct.name} suspended`).first()).toBeVisible({ timeout: 60_000 });

  const o = await observeLeaver(acct, before);
  evidence("offboard-suspend", o);
  await before.ctx.close();
  expect(o.userStatus).toBe("SUSPENDED");
  expect(leaks(o), "suspension must close every door").toEqual([]);
  expect(o.signInStatus).not.toBe(200);
  // The password reset still goes through (token issued, password changed) - but sign-in stays shut.
  expect(o.forgotPassword.signInAfterReset ?? 0).not.toBe(200);
});

test("Users & access > Delete locks out every door", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const acct = await makeLeaver(page, browser, "delete");
  const before = await openSession(browser, acct);

  const row = await userRow(page, acct.email, acct.name);
  await row.getByRole("button", { name: `Delete ${acct.name}` }).click();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByText(`${acct.name} deleted`).first()).toBeVisible({ timeout: 60_000 });

  const o = await observeLeaver(acct, before);
  evidence("offboard-delete", o);
  await before.ctx.close();
  expect(o.userStatus).toBeNull();
  expect(o.profileStatus, "deleting the login retires the team profile").toBe("INACTIVE");
  expect(leaks(o)).toEqual([]);
  expect(o.forgotPassword.tokenIssued).toBe(false);
});

test("Team & org chart > Offboard locks out every door", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const acct = await makeLeaver(page, browser, "offboard");
  const before = await openSession(browser, acct);

  await openPeopleTab(page, "Team & org chart");
  await profileCard(page, acct.name).getByRole("button", { name: "Offboard" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: `Offboard ${acct.name}` });
  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: `Offboard ${acct.name}` }).click();
  await expect(page.getByText(`${acct.name} has been offboarded`).first()).toBeVisible({ timeout: 60_000 });

  const o = await observeLeaver(acct, before);
  evidence("offboard-terminate", o);
  await before.ctx.close();
  expect(o.userStatus).toBe("SUSPENDED");
  expect(o.profileStatus).toBe("INACTIVE");
  expect(leaks(o)).toEqual([]);
});

test("ACC-03 Offboarded, then 'Reactivate' in Users & access reopens the login while People still lists them as a former member", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const acct = await makeLeaver(page, browser, "reactivate");
  await openPeopleTab(page, "Team & org chart");
  await profileCard(page, acct.name).getByRole("button", { name: "Offboard" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: `Offboard ${acct.name}` });
  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: `Offboard ${acct.name}` }).click();
  await expect(page.getByText(`${acct.name} has been offboarded`).first()).toBeVisible({ timeout: 60_000 });

  const row = await userRow(page, acct.email, acct.name);
  await row.getByRole("button", { name: "Reactivate", exact: true }).click();
  await expect(page.getByText(`${acct.name} reactivated`).first()).toBeVisible({ timeout: 60_000 });

  const rows = await q(`select u.status us, t.status ts, t."terminatedAt" ta from "user" u join team_profile t on t."userId"=u.id where u.id=$1`, [acct.userId]);
  const { apiSignIn } = await import("../../helpers/access-lib");
  const si = await apiSignIn(acct.email, acct.password);
  await si.ctx.dispose();
  evidence("ACC-03-reactivate-after-offboard", { rows, signIn: si.status });
  expect(si.status === 200 && rows[0]?.ts === "INACTIVE",
    `ACC-03 BUG: after Offboard, the Users & access "Reactivate" button restores sign-in (status ${si.status}) while the team profile ` +
    `stays INACTIVE/terminated (${JSON.stringify(rows[0])}) - the org chart shows a former member who can work. ` +
    `Root cause: src/server/users-actions.ts:588-611 reactivateUser never checks TeamProfile.terminatedAt.`).toBe(false);
});

test("ACC-04 a login suspended outside the Suspend button (DB/status only) keeps its API access", async ({ page, browser }) => {
  test.setTimeout(240_000);
  // requireSession (src/lib/rbac.ts:62-69) says it "covers a row suspended directly in the database".
  // Pages are covered; API routes that call auth.api.getSession directly are not.
  const acct = await makeLeaver(page, browser, "dbsuspend", { profile: false });
  // API-only client: a rendered page would fire RSC prefetches that run requireSession, which
  // deletes the sessions and hides what the API routes do on their own.
  const { apiSignIn, probeSession } = await import("../../helpers/access-lib");
  const si = await apiSignIn(acct.email, acct.password);
  expect(si.status).toBe(200);
  await q(`update "user" set status='SUSPENDED' where id=$1 and email like 'support+e2e-%'`, [acct.userId]);
  const apisFirst: Record<string, number> = {};
  for (const p of ["/api/notifications", "/api/work-time", "/api/command-palette", "/api/conversations/poll", "/api/leads/poll-recent"]) {
    apisFirst[p] = (await si.ctx.get(p, { maxRedirects: 0 })).status();
  }
  const sessionsLeft = (await q(`select count(*)::int n from session where "userId"=$1`, [acct.userId]))[0].n;
  const afterPage = await probeSession(si.ctx);
  await si.ctx.dispose();
  evidence("ACC-04-db-suspended", { apisFirst, sessionsLeft, afterPageLoad: afterPage });
  const open = Object.entries(apisFirst).filter(([k, v]) => k.startsWith("/api/") && v === 200).map(([k]) => k);
  expect(open, `ACC-04 BUG: with User.status=SUSPENDED but the session row still present, these API routes still answer 200: ${open.join(", ")}. ` +
    `They call auth.api.getSession directly and never check status (e.g. src/app/api/notifications/route.ts:14, work-time/route.ts:17, command-palette/route.ts:24, conversations/poll/route.ts:15, leads/poll-recent/route.ts:31).`).toEqual([]);
});
