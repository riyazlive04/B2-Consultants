import { APIRequestContext, Browser, BrowserContext, Page, expect, request } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { BASE_URL } from "../playwright.config";
import { IS_PROD, recordCreated } from "./target";

/**
 * Access-area helpers: sign-in with rate-limit back-off, server-action replay, account
 * creation through the real People UI, and the per-run identity of every account we make.
 */

export const APP_SRC = process.env.B2_APP_SRC ?? "D:/Sirah Digital/AI Automation/B2 Consultants/b2-dashboard";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const AREA = "access";

/**
 * Locally the production build has no trusted proxy, so better-auth rate-limits every
 * header-less sign-in in ONE shared bucket ("no-trusted-ip") - the same bucket the four other
 * agents use. A per-process X-Forwarded-For gives this spec its own bucket (see ACC finding on
 * rate limiting). In prod the proxy decides; we never send it there.
 */
const octet = () => 1 + Math.floor(Math.random() * 250);
export const MY_IP = `10.${octet()}.${octet()}.${octet()}`;
export const ipHeaders = (ip = MY_IP): Record<string, string> => (IS_PROD ? {} : { "X-Forwarded-For": ip });

/** A run tag that survives Playwright restarting the worker after a failure. */
function stableRun(): string {
  const f = `reports/.access-run-${IS_PROD ? "prod" : "local"}`;
  fs.mkdirSync("reports", { recursive: true });
  if (process.env.ACCESS_RUN) return process.env.ACCESS_RUN;
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 3 * 60 * 60 * 1000) return fs.readFileSync(f, "utf8").trim();
  const run = `a${Date.now().toString(36)}`;
  fs.writeFileSync(f, run);
  return run;
}
export const ARUN = stableRun();

/**
 * Test-account email. Plus-addressed onto the fenced mailbox, so anything the app ever sends
 * (password reset is the only staff email path) lands with us, never with a real person.
 */
export const testEmail = (slug: string) => `support+e2e-${slug}-${ARUN}@sirahdigital.in`.toLowerCase();
export const assertTestEmail = (e: string) => {
  if (!/^support\+e2e-[a-z0-9-]+@sirahdigital\.in$/.test(e)) throw new Error(`not a test email: ${e}`);
  return e;
};
/**
 * Password for the temporary E2E accounts. Random, not derived from the run tag: in production
 * these accounts can read real leads while they exist, and a clock-derived password would be
 * guessable. Generated once per run and kept in the gitignored .auth/ folder, so a worker that
 * restarts mid-run still signs in to the accounts the first worker created.
 */
export const TEST_PASSWORD = (() => {
  const f = path.join(".auth", `test-password-${ARUN}`);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  // Upper, lower, digit and symbol, so it passes the app's password rules whatever they are.
  const pw = `Ee2-${require("crypto").randomBytes(18).toString("base64url")}!9`;
  fs.mkdirSync(".auth", { recursive: true });
  fs.writeFileSync(f, pw);
  return pw;
})();

export const EMPTY_STATE = { cookies: [], origins: [] };

export type SignInResult = { status: number; body: string; ctx: APIRequestContext };

/** API sign-in; backs off on 429 unless told not to. Caller disposes ctx. */
export async function apiSignIn(email: string, password: string, opts: { retry429?: boolean; ip?: string } = {}): Promise<SignInResult> {
  const retry = opts.retry429 ?? true;
  for (let attempt = 0; ; attempt++) {
    const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL, ...ipHeaders(opts.ip) } });
    const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
    const body = await res.text();
    if (res.status() === 429 && retry && attempt < 6) {
      await ctx.dispose();
      await sleep(11_000);
      continue;
    }
    return { status: res.status(), body, ctx };
  }
}

/** A browser context carrying a fresh API session for this account. */
export async function signedInContext(browser: Browser, email: string, password: string, extra: Parameters<Browser["newContext"]>[0] = {}) {
  const r = await apiSignIn(email, password);
  expect(r.status, `sign-in for ${email}: ${r.body}`).toBe(200);
  const state = await r.ctx.storageState();
  await r.ctx.dispose();
  return browser.newContext({ storageState: state, extraHTTPHeaders: ipHeaders(), ...extra });
}

// ─────────────────────────── server-action replay ───────────────────────────

type ActionInfo = { id: string; paths: string[] };
let ACTIONS: Map<string, ActionInfo> | null = null;

/**
 * Next.js 14 action ids, recovered from the running build (read-only). A server action is a
 * POST with a `Next-Action` header; replaying it with another person's cookies is exactly what a
 * hand-crafted request from a signed-in browser can do.
 */
export function actionMap(): Map<string, ActionInfo> {
  if (ACTIONS) return ACTIONS;
  const dist = path.join(APP_SRC, process.env.B2_DIST_DIR ?? ".next-verify3", "server");
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "server-reference-manifest.json"), "utf8")).node as Record<string, { workers: Record<string, string> }>;
  const byName = new Map<string, Set<string>>();
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith(".js")) {
        const s = fs.readFileSync(p, "utf8");
        const re = /[{,]"?([0-9a-f]{40})"?:\(\)=>Promise\.resolve\(\)\.then\([\w$]+\.bind\([\w$]+,\d+\)\)\.then\([\w$]+=>[\w$]+\.([\w$]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s))) {
          if (!byName.has(m[2])) byName.set(m[2], new Set());
          byName.get(m[2])!.add(m[1]);
        }
      }
    }
  };
  walk(path.join(dist, "app"));
  ACTIONS = new Map();
  for (const [name, ids] of byName) {
    if (ids.size !== 1) continue; // ambiguous names are never replayed
    const id = [...ids][0];
    const workers = Object.keys(manifest[id]?.workers ?? {});
    const paths = workers.map((w) =>
      ("/" + w.replace(/^app\//, "").replace(/\/page$/, "").replace(/^page$/, ""))
        .replace(/\([^)]+\)\/?/g, "")
        .replace(/\[\[\.\.\.[^\]]+\]\]/g, "")
        .replace(/\[[^\]]+\]/g, "e2e-none")
        .replace(/\/+$/, "") || "/",
    );
    ACTIONS.set(name, { id, paths });
  }
  return ACTIONS;
}

export type ActionReply = { status: number; redirect: string | null; body: string; result: any };

/**
 * Invoke a server action by name. `args` are JSON args; a `{ form }` entry becomes FormData,
 * encoded the way React's encodeReply does ($K reference + prefixed fields).
 */
export async function callAction(ctx: APIRequestContext, name: string, args: unknown[], via?: string): Promise<ActionReply> {
  const info = actionMap().get(name);
  if (!info) throw new Error(`server action ${name} not found in build`);
  const target = via ?? info.paths.find((p) => !p.includes("e2e-none")) ?? info.paths[0] ?? "/";
  const headers: Record<string, string> = { "Next-Action": info.id, Origin: BASE_URL, Accept: "text/x-component", ...ipHeaders() };
  const formArgs = args.filter((a) => a && typeof a === "object" && "form" in (a as object));
  let res;
  if (formArgs.length) {
    const multipart: Record<string, string> = {};
    let ref = 1;
    const root = args.map((a) => {
      if (a && typeof a === "object" && "form" in (a as object)) {
        const id = ref++;
        for (const [k, v] of Object.entries((a as { form: Record<string, string> }).form)) multipart[`${id}_${k}`] = v;
        return `$K${id.toString(16)}`;
      }
      return a;
    });
    multipart["0"] = JSON.stringify(root);
    res = await ctx.post(target, { headers, multipart, maxRedirects: 0 });
  } else {
    res = await ctx.post(target, { headers: { ...headers, "Content-Type": "text/plain;charset=UTF-8" }, data: JSON.stringify(args), maxRedirects: 0 });
  }
  const body = await res.text();
  const h = res.headers();
  const redirect = h["x-action-redirect"] ?? h["location"] ?? null;
  let result: any = undefined;
  const line = body.split("\n").find((l) => l.startsWith("1:"));
  if (line) {
    try { result = JSON.parse(line.slice(2)); } catch { result = line.slice(2); }
  }
  return { status: res.status(), redirect, body, result };
}

/** True when an action reply means "you were refused / not signed in". */
export function refused(r: ActionReply): boolean {
  if (r.redirect && /\/login|denied=/.test(r.redirect)) return true;
  if (r.result && typeof r.result === "object" && r.result.ok === false && /permission|only an admin|sign in|session/i.test(String(r.result.error))) return true;
  return false;
}

// ─────────────────────────── People UI: accounts ───────────────────────────

export type TestAccount = { key: string; name: string; email: string; password: string; role: string; userId?: string; profileId?: string };

export async function openPeopleTab(page: Page, tab: "Users & access" | "Team & org chart" | "Daily logs" | "OKRs") {
  await page.goto("/people", { timeout: 120_000 });
  // /people streams its tabs in after the shell. In production (app in Mumbai, DB in Singapore)
  // that takes well past the 20s action timeout, so wait for the tab itself before clicking.
  const tabEl = page.getByRole("tab", { name: new RegExp(`^${tab.replace(/[&]/g, "&")}`) });
  await tabEl.waitFor({ state: "visible", timeout: 120_000 });
  await tabEl.click();
}

/** Admin invites through People -> Users & access, returns the invite path (/invite/<token>). */
export async function inviteViaUI(admin: Page, acct: { name: string; email: string; role: "ADMIN" | "HEAD" | "USER" | "STUDENT" | "TUTOR" }) {
  assertTestEmail(acct.email);
  const label = { ADMIN: "Admin", HEAD: "Head coach", USER: "Telecaller", STUDENT: "Student", TUTOR: "Tutor" }[acct.role];
  await openPeopleTab(admin, "Users & access");
  await admin.getByRole("button", { name: "Invite user" }).click();
  const dlg = admin.getByRole("dialog").filter({ hasText: "Invite user" });
  await dlg.locator('input[name="name"]').fill(acct.name);
  await dlg.locator('input[name="email"]').fill(acct.email);
  await dlg.getByRole("group", { name: "Role" }).getByRole("button", { name: label, exact: true }).click();
  await dlg.getByRole("button", { name: "Create invite link" }).click();
  const link = admin.getByRole("textbox", { name: "Invite link" });
  const exists = dlg.getByText("A user with this email already exists");
  await expect(link.or(exists)).toBeVisible({ timeout: 60_000 });
  if (await exists.isVisible()) {
    // A previous attempt created the login but never redeemed it: mint a fresh link instead.
    await dlg.getByRole("button", { name: "Cancel" }).click();
    const row = await userRow(admin, acct.email, acct.name);
    await row.getByRole("button", { name: "Invite link" }).click();
    await expect(link).toBeVisible();
  }
  const url = await link.inputValue();
  await admin.getByRole("button", { name: "Done" }).click();
  recordCreated(AREA, { kind: "user", label: `${acct.role} ${acct.email}`, cleanup: "zz-deprovision: suspend then delete via People > Users & access" });
  const p = new URL(url).pathname;
  expect(p).toMatch(/^\/invite\/[A-Za-z0-9_-]+$/);
  return p;
}

/** The invitee sets a password in a fresh browser; they land signed in. Returns their context. */
export async function acceptInviteViaUI(browser: Browser, invitePath: string, password: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: EMPTY_STATE, extraHTTPHeaders: ipHeaders() });
  const page = await ctx.newPage();
  await page.goto(invitePath);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm"]').fill(password);
  await page.getByRole("button", { name: /Set password/ }).click();
  await expect(page).not.toHaveURL(/\/invite\//, { timeout: 60_000 });
  await page.close();
  return ctx;
}

/** Find a row in the Users & access table by email and return it. */
export async function userRow(admin: Page, email: string, name?: string) {
  await openPeopleTab(admin, "Users & access");
  // The table filter matches on the name column only, not the email.
  if (name) await admin.getByPlaceholder("Filter users…").fill(name);
  const row = admin.getByRole("row").filter({ hasText: email }).filter({ hasNotText: "Nothing matches" });
  await expect(row).toHaveCount(1);
  return row;
}

export async function confirmDialog(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).last().click();
}

/** Create a team profile linked by email, via People -> Team & org chart -> Add team member. */
export async function addTeamProfileViaUI(admin: Page, p: { fullName: string; roleTitle: string; email: string; dashboardRole: "Admin" | "Head" | "User"; logVariant: string }) {
  await openPeopleTab(admin, "Team & org chart");
  await admin.getByRole("button", { name: "Add team member" }).click();
  const form = admin.locator("form").filter({ has: admin.locator('input[name="roleTitle"]') });
  await form.locator('input[name="fullName"]').fill(p.fullName);
  await form.locator('input[name="roleTitle"]').fill(p.roleTitle);
  await pickSelect(admin, form, "dashboardRole", p.dashboardRole);
  await form.locator('input[name="email"]').fill(p.email);
  await pickSelect(admin, form, "logVariant", p.logVariant);
  await form.locator('input[name="firstCallSharePct"]').fill("0");
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(admin.getByText("Team member created").first()).toBeVisible({ timeout: 60_000 });
  recordCreated(AREA, { kind: "team_profile", label: `${p.fullName} <${p.email}>`, cleanup: "no UI delete exists: retired by offboarding/deleting the user (stays under Former team members)" });
}

export async function pickSelect(page: Page, scope: ReturnType<Page["locator"]>, name: string, optionLabel: string) {
  await scope.locator(`select[name="${name}"] + button`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

export function profileCard(admin: Page, fullName: string) {
  return admin.locator("div.w-64").filter({ has: admin.getByText(fullName, { exact: true }) });
}

/** Everything a signed-in-but-should-be-gone person could still touch. */
export async function probeSession(ctx: APIRequestContext) {
  const out: Record<string, number | string> = {};
  for (const p of ["/api/notifications", "/api/work-time", "/api/command-palette", "/api/conversations/poll", "/api/leads/poll-recent"]) {
    const r = await ctx.get(p, { maxRedirects: 0 });
    out[p] = r.status();
  }
  const page = await ctx.get("/profile", { maxRedirects: 0 });
  out["GET /profile"] = page.status() === 200 ? 200 : `${page.status()} -> ${page.headers()["location"] ?? ""}`;
  const sess = await ctx.get("/api/auth/get-session");
  const sj = await sess.text();
  out["get-session"] = sj && sj !== "null" ? "valid" : "null";
  const act = await callAction(ctx, "setThemePreference", ["SYSTEM"]);
  out["action setThemePreference"] = act.redirect ? `redirect ${act.redirect}` : JSON.stringify(act.result);
  return out;
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
export function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
}

/** Evidence log the findings report is written from. */
export function evidence(id: string, data: unknown) {
  fs.mkdirSync("reports/access-evidence", { recursive: true });
  fs.writeFileSync(`reports/access-evidence/${id}.json`, JSON.stringify(data, null, 2));
}

export const CREDS_FILE = IS_PROD ? "creds.prod.json" : "creds.local-e2e.json";
export const ACCOUNTS_FILE = `reports/access-accounts-${IS_PROD ? "prod" : "local"}.json`;

/** Every account this area creates is appended here, so deprovision can find all of them. */
export function rememberAccount(a: TestAccount) {
  const all = readJson<TestAccount[]>(ACCOUNTS_FILE, []);
  if (!all.some((x) => x.email === a.email)) all.push(a);
  writeJson(ACCOUNTS_FILE, all);
}
