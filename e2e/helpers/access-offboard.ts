import { Browser, BrowserContext, Page, expect, request } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { one } from "./db";
import {
  ARUN, TEST_PASSWORD, acceptInviteViaUI, addTeamProfileViaUI, apiSignIn, callAction, inviteViaUI,
  ipHeaders, probeSession, rememberAccount, sleep, testEmail, type TestAccount,
} from "./access-lib";

/** A fresh telecaller (USER) with a linked team profile, created through the People UI. */
export async function makeLeaver(admin: Page, browser: Browser, baseSlug: string, opts: { profile?: boolean; role?: "USER" | "HEAD" } = {}): Promise<TestAccount> {
  // Unique per attempt: a retried test must not collide with the account its last attempt made.
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  const email = testEmail(slug);
  const name = `E2E Leaver ${slug} ${ARUN}`;
  const role = opts.role ?? "USER";
  const invitePath = await inviteViaUI(admin, { name, email, role });
  const ctx = await acceptInviteViaUI(browser, invitePath, TEST_PASSWORD);
  await ctx.close();
  const acct: TestAccount = { key: slug, name, email, password: TEST_PASSWORD, role };
  if (opts.profile !== false) {
    await addTeamProfileViaUI(admin, { fullName: name, roleTitle: "E2E Appointment Setter", email, dashboardRole: role === "HEAD" ? "Head" : "User", logVariant: "Appointment Setter" });
  }
  const u = await one(`select id from "user" where email=$1`, [email]);
  acct.userId = u?.id;
  const p = await one(`select id from team_profile where email=$1 order by "createdAt" desc`, [email]);
  acct.profileId = p?.id;
  rememberAccount(acct);
  return acct;
}

/** A session opened BEFORE the admin acts: a browser with a page already rendered. */
export async function openSession(browser: Browser, acct: TestAccount): Promise<{ ctx: BrowserContext; page: Page; cookieHeader: string }> {
  const r = await apiSignIn(acct.email, acct.password);
  expect(r.status, `${acct.email} signs in before the change: ${r.body}`).toBe(200);
  const state = await r.ctx.storageState();
  await r.ctx.dispose();
  const ctx = await browser.newContext({ storageState: state, extraHTTPHeaders: ipHeaders() });
  const page = await ctx.newPage();
  await page.goto("/my-desk");
  await expect(page).not.toHaveURL(/\/login/);
  const cookieHeader = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { ctx, page, cookieHeader };
}

export type LeaverObservation = {
  signInStatus: number;
  signInBody: string;
  openSessionPageUrl: string;
  openSession: Record<string, number | string>;
  replayedCookie: Record<string, number | string>;
  forgotPassword: { requestStatus: number; tokenIssued: boolean; resetStatus?: number; signInAfterReset?: number };
  sessionsInDb: number;
  userStatus: string | null;
  profileStatus: string | null;
};

/** Everything a person who "left" might still do, measured after the admin's change. */
export async function observeLeaver(acct: TestAccount, before: { ctx: BrowserContext; page: Page; cookieHeader: string }, opts: { tryReset?: boolean } = {}): Promise<LeaverObservation> {
  // (b) the already-open browser: navigate, then hit APIs and a server action with its cookies
  await before.page.goto("/my-desk");
  const openSessionPageUrl = new URL(before.page.url()).pathname + new URL(before.page.url()).search;
  const openSession = await probeSession(before.ctx.request);

  // (d) the raw cookie, replayed from a brand-new client (e.g. copied to another machine)
  const replay = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Cookie: before.cookieHeader, Origin: BASE_URL, ...ipHeaders() } });
  const replayedCookie = await probeSession(replay);
  await replay.dispose();

  // (a) a fresh sign-in with the credentials they still know
  const si = await apiSignIn(acct.email, acct.password);
  const signIn = { status: si.status, body: si.body.replace(/"token":"[^"]*"/, '"token":"<redacted>"').slice(0, 200) };
  await si.ctx.dispose();

  // (f) forgot password -> token from the local verification table -> reset -> sign in
  const forgotPassword: LeaverObservation["forgotPassword"] = { requestStatus: 0, tokenIssued: false };
  if (opts.tryReset !== false) {
    await sleep(1_000);
    const anon = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL, ...ipHeaders() } });
    const { q } = await import("./db");
    const prior = acct.userId ? (await q(`select identifier from verification where value=$1`, [acct.userId])).map((r) => r.identifier) : [];
    const rq = await anon.post("/api/auth/request-password-reset", { data: { email: acct.email, redirectTo: "/reset-password" } });
    forgotPassword.requestStatus = rq.status();
    const tok = acct.userId
      ? await one(`select identifier from verification where value=$1 and identifier like 'reset-password:%' and not (identifier = any($2::text[])) limit 1`, [acct.userId, prior])
      : undefined;
    if (tok) {
      forgotPassword.tokenIssued = true;
      const newPassword = `${acct.password}R`;
      const rs = await anon.post("/api/auth/reset-password", { data: { newPassword, token: tok.identifier.split(":")[1] } });
      forgotPassword.resetStatus = rs.status();
      if (rs.ok()) acct.password = newPassword;
      await sleep(1_000);
      const s2 = await apiSignIn(acct.email, acct.password);
      forgotPassword.signInAfterReset = s2.status;
      await s2.ctx.dispose();
    }
    await anon.dispose();
  }

  const sess = acct.userId ? await one(`select count(*)::int n from session where "userId"=$1`, [acct.userId]) : { n: 0 };
  const u = acct.userId ? await one(`select status from "user" where id=$1`, [acct.userId]) : undefined;
  const p = acct.profileId ? await one(`select status from team_profile where id=$1`, [acct.profileId]) : undefined;
  return {
    signInStatus: signIn.status,
    signInBody: signIn.body,
    openSessionPageUrl,
    openSession,
    replayedCookie,
    forgotPassword,
    sessionsInDb: sess?.n ?? 0,
    userStatus: u?.status ?? null,
    profileStatus: p?.status ?? null,
  };
}

/** Human-readable list of every way the leaver still got in. Empty = fully locked out. */
export function leaks(o: LeaverObservation): string[] {
  const out: string[] = [];
  if (o.signInStatus === 200) out.push(`(a) fresh sign-in with their password succeeded (200)`);
  if (!/^\/login/.test(o.openSessionPageUrl)) out.push(`(b) already-open browser still renders ${o.openSessionPageUrl}`);
  for (const [k, v] of Object.entries(o.openSession)) if (isOpen(k, v)) out.push(`(b/c) open session: ${k} -> ${v}`);
  for (const [k, v] of Object.entries(o.replayedCookie)) if (isOpen(k, v)) out.push(`(d) replayed cookie: ${k} -> ${v}`);
  if (o.forgotPassword.signInAfterReset === 200) out.push(`(f) forgot-password reset then sign-in succeeded`);
  if (o.sessionsInDb > 0 && out.length) out.push(`${o.sessionsInDb} live session row(s) remain in the DB`);
  return out;
}

function isOpen(k: string, v: number | string): boolean {
  if (k === "get-session") return v === "valid";
  if (k.startsWith("action")) return !/redirect \/login/.test(String(v));
  return v === 200;
}
