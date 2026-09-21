import { test, expect, request } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { BASE_URL } from "../../playwright.config";
import { ROLES } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { q } from "../../helpers/db";
import { APP_SRC, callAction, evidence } from "../../helpers/access-lib";
import { readRoutes } from "../../helpers/access-matrix";

/**
 * Unauthenticated: every page outside the app shell and every /api route, enumerated from the
 * filesystem. Nothing internal may render, and every non-public API must refuse. Webhooks and
 * cron are only probed without / with a wrong secret.
 */

test("public pages render without leaking internal data", async () => {
  test.setTimeout(240_000);
  const pages = readRoutes().filter((r) => !r.file.includes("/(app)/"));
  const staff = HAS_DB ? (await q(`select email, name from "user" where role in ('ADMIN','HEAD','USER')`)).map((u) => u.email) : [ROLES.admin.email];
  const leads = HAS_DB ? (await q(`select name from lead where "deletedAt" is null and length(name) > 8 order by "createdAt" desc limit 25`)).map((l) => l.name) : [];
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const out: Record<string, string> = {};
  const leaks: string[] = [];
  for (const r of pages) {
    const url = r.url.replace(/e2e-missing-id/g, "e2e-no-such-slug");
    const res = await ctx.get(url, { maxRedirects: 0, timeout: 90_000 });
    const body = await res.text();
    const loc = res.headers()["location"] ?? "";
    out[r.pattern] = `${res.status()}${loc ? " -> " + loc : ""} ${body.length}b`;
    const visible = body.replace(/<script[\s\S]*?<\/script>/g, " ");
    for (const e of staff) if (body.includes(e)) leaks.push(`${url}: staff email ${e}`);
    for (const n of leads) if (visible.includes(n)) leaks.push(`${url}: lead name "${n}"`);
    if (/session_token|DATABASE_URL|BETTER_AUTH_SECRET|RESEND_API_KEY/.test(body)) leaks.push(`${url}: secret-looking token in body`);
    if (res.status() >= 500) leaks.push(`${url}: HTTP ${res.status()}`);
  }
  // A signed-out visitor never reaches the authenticated shell.
  for (const p of ["/", "/finance", "/people", "/students", "/change-password", "/api/export/leads"]) {
    const res = await ctx.get(p, { maxRedirects: 0, timeout: 90_000 });
    out[`(guarded) ${p}`] = `${res.status()} -> ${res.headers()["location"] ?? ""}`;
    if (!(res.status() === 307 && /\/login/.test(res.headers()["location"] ?? ""))) leaks.push(`${p} unauthenticated -> ${res.status()}`);
  }
  await ctx.dispose();
  evidence("public-pages", out);
  expect(leaks, leaks.join("\n")).toEqual([]);
});

test("every /api route refuses an unauthenticated caller (webhooks/cron: missing and wrong secret)", async () => {
  test.setTimeout(240_000);
  const apiDir = path.join(APP_SRC, "src/app/api");
  const files: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name === "route.ts") files.push(p); } };
  walk(apiDir);
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const out: Record<string, string> = {};
  const bad: string[] = [];
  // Public by design: health, the browser error beacon, auth itself.
  const PUBLIC_OK = new Set(["/api/health GET", "/api/observability/client-error POST"]);
  for (const f of files.sort()) {
    const rel = "/" + path.relative(path.join(APP_SRC, "src/app"), path.dirname(f)).split(path.sep).join("/");
    if (rel.startsWith("/api/auth")) continue;
    const src = fs.readFileSync(f, "utf8");
    const methods = new Set<string>();
    for (const m of src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(m[1]);
    const destructured = src.match(/export const \{([^}]*)\}/);
    if (destructured) for (const m of destructured[1].split(",")) methods.add(m.trim());
    const url = rel.replace(/\[entity\]/, "leads").replace(/\[[^\]]+\]/g, "e2e-no-such-id");
    for (const method of methods) {
      const variants: [string, Record<string, string>, string][] = [["no secret", {}, url]];
      if (/\/api\/(cron|leads\/(b2consultants|meta|pabbly)|intake|wati|resend|twilio)/.test(url)) {
        variants.push(["wrong secret", { "x-cron-secret": "wrong", "x-webhook-secret": "wrong", authorization: "Bearer wrong", "x-hub-signature-256": "sha256=00", "svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,AAAA", "x-twilio-signature": "AAAA" }, `${url}?key=wrong`]);
      }
      for (const [label, headers, u] of variants) {
        const res = await ctx.fetch(u, { method, headers: { "content-type": "application/json", ...headers }, data: method === "GET" ? undefined : "{}", maxRedirects: 0 });
        const status = res.status();
        const loc = res.headers()["location"] ?? "";
        const key = `${url} ${method}`;
        out[`${key} (${label})`] = `${status}${loc ? " -> " + loc : ""}`;
        const refused = status === 401 || status === 403 || status === 503 || status === 404 || status === 400 || status === 405 || status === 422 || (status === 307 && /login/.test(loc));
        if (!refused && !PUBLIC_OK.has(key)) bad.push(`${key} (${label}) -> ${status} ${(await res.text()).slice(0, 120)}`);
      }
    }
  }
  const health = await ctx.get("/api/health");
  const healthBody = await health.text();
  out["/api/health body"] = healthBody.slice(0, 300);
  if (/postgres|password|secret|key/i.test(healthBody)) bad.push(`/api/health body mentions credentials: ${healthBody.slice(0, 200)}`);
  await ctx.dispose();
  evidence("public-apis", out);
  expect(bad, `API routes answering an unauthenticated caller:\n${bad.join("\n")}`).toEqual([]);
});

test("privileged server actions compiled into public pages refuse a caller with no session", async () => {
  test.skip(IS_PROD, "action ids come from the local build");
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const calls: [string, unknown[], string][] = [
    ["deleteSlot", ["e2e-no-such-slot"], "/book"],
    ["setBookingStatus", ["e2e-no-such-booking", "CANCELLED"], "/book"],
    ["runBookingAutomationNow", [], "/book"],
    ["updateBookingRules", [{ form: {} }], "/book"],
    ["generateSlots", [{ form: {} }], "/book"],
    ["deleteForm", ["e2e-no-such-form"], "/f/e2e-no-such-slug"],
    ["togglePublishForm", ["e2e-no-such-form"], "/f/e2e-no-such-slug"],
    ["createForm", [{ form: { name: "x" } }], "/f/e2e-no-such-slug"],
    ["listAccessRequests", [], "/login"],
    ["declineAccessRequest", ["e2e-no-such-request"], "/login"],
    ["consumeAccessRequest", ["nobody@e2e.invalid"], "/login"],
    ["setThemePreference", ["DARK"], "/login"],
    ["changeOwnPassword", [{ form: { currentPassword: "x", newPassword: "yyyyyyyyyy" } }], "/change-password"],
  ];
  const out: Record<string, string> = {};
  const bad: string[] = [];
  for (const [name, args, via] of calls) {
    const r = await callAction(ctx, name, args, via);
    const s = r.redirect ? `redirect ${r.redirect}` : `${r.status} ${JSON.stringify(r.result)?.slice(0, 120)}`;
    out[`${name} via ${via}`] = s;
    const ok = (r.redirect && /login/.test(r.redirect)) || (r.result && r.result.ok === false && /session|sign in|permission/i.test(String(r.result.error)));
    if (!ok) bad.push(`${name} via ${via}: ${s}`);
  }
  await ctx.dispose();
  evidence("public-actions", out);
  expect(bad, bad.join("\n")).toEqual([]);
});
