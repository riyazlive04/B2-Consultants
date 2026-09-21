import { test, expect } from "@playwright/test";
import { ROLES, authFile } from "../../helpers/roles";
import { IS_PROD, HAS_DB } from "../../helpers/target";
import { one } from "../../helpers/db";
import {
  ARUN, CREDS_FILE, TEST_PASSWORD, acceptInviteViaUI, addTeamProfileViaUI, apiSignIn, inviteViaUI,
  readJson, rememberAccount, sleep, testEmail, writeJson, type TestAccount,
} from "../../helpers/access-lib";

/**
 * Provisions one E2E account per role the other areas sign in as, through the real admin UI:
 * People > Users & access > Invite user, then the invitee's own /invite/<token> page.
 *
 * Emails nobody: the app has no invite mailer (the link is shown to the admin), and every
 * address is plus-addressed onto the fenced support mailbox.
 *
 * Locally writes creds.local-e2e.json (roles.ts keeps using the seeded demo accounts);
 * with E2E_TARGET=prod writes creds.prod.json, keeping the founder-supplied `admin` entry.
 */

type Spec = { key: string; role: "HEAD" | "USER" | "STUDENT" | "TUTOR"; name: string; profile?: { roleTitle: string; dashboardRole: "Head" | "User"; logVariant: string } };
const PLAN: Spec[] = [
  { key: "head", role: "HEAD", name: `E2E Head ${ARUN}`, profile: { roleTitle: "E2E Delivery Coach", dashboardRole: "Head", logVariant: "Program Delivery Coach" } },
  { key: "asma", role: "USER", name: `E2E Discovery ${ARUN}`, profile: { roleTitle: "E2E Discovery Call Specialist", dashboardRole: "User", logVariant: "Discovery Call Specialist" } },
  { key: "nilofer", role: "USER", name: `E2E Setter ${ARUN}`, profile: { roleTitle: "E2E Appointment Setter", dashboardRole: "User", logVariant: "Appointment Setter" } },
  { key: "tutor", role: "TUTOR", name: `E2E Tutor ${ARUN}` },
  { key: "student", role: "STUDENT", name: `E2E Student ${ARUN}` },
  { key: "gnStudent", role: "STUDENT", name: `E2E GN Student ${ARUN}` },
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

test("provision: one E2E account per role via invite UI, then write creds", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const creds: Record<string, { email: string; password: string; role: string }> = readJson(CREDS_FILE, {});
  if (IS_PROD && !creds.admin && !ROLES.admin) throw new Error("prod provisioning needs the founder admin in creds.prod.json");
  creds.admin = IS_PROD ? (creds.admin ?? ROLES.admin) : ROLES.admin;

  for (const s of PLAN) {
    const email = testEmail(s.key.toLowerCase());
    if (creds[s.key]?.email === email) continue; // re-run of the same RUN: already provisioned
    const invitePath = await inviteViaUI(page, { name: s.name, email, role: s.role });
    const ctx = await acceptInviteViaUI(browser, invitePath, TEST_PASSWORD);
    // Landed signed in on their home screen, not bounced to login.
    const home = await ctx.newPage();
    await home.goto("/");
    await expect(home).not.toHaveURL(/\/login/);
    await ctx.close();

    const acct: TestAccount = { key: s.key, name: s.name, email, password: TEST_PASSWORD, role: s.role };
    if (s.profile) {
      await addTeamProfileViaUI(page, { fullName: s.name, roleTitle: s.profile.roleTitle, email, dashboardRole: s.profile.dashboardRole, logVariant: s.profile.logVariant });
    }
    if (HAS_DB) {
      const u = await one(`select id, role, status from "user" where email=$1`, [email]);
      expect(u?.role).toBe(s.role);
      acct.userId = u.id;
      if (s.profile) {
        const p = await one(`select id, "userId", status from team_profile where email=$1 order by "createdAt" desc`, [email]);
        expect(p?.userId, "team profile links to the new login by email").toBe(u.id);
        acct.profileId = p.id;
      }
    }
    rememberAccount(acct);
    creds[s.key] = { email, password: TEST_PASSWORD, role: s.role };
    writeJson(CREDS_FILE, creds); // after every account, so a mid-run failure still deprovisions
  }

  // Every provisioned credential really signs in (spaced for the sign-in rate limit).
  for (const s of PLAN) {
    const r = await apiSignIn(creds[s.key].email, creds[s.key].password);
    expect(r.status, `${s.key}: ${r.body}`).toBe(200);
    await r.ctx.dispose();
    await sleep(IS_PROD ? 4_000 : 500);
  }
});
