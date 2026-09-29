import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { BASE_URL } from "../../playwright.config";
import { ROLES, authFile, type RoleKey } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { one, q } from "../../helpers/db";
import { CREDS_FILE, apiSignIn, callAction, evidence, ipHeaders, readJson, refused, sleep } from "../../helpers/access-lib";

/**
 * The doors behind the screens: server actions replayed with each role's cookies, the CSV export
 * route, and the JSON APIs. A hidden button is not a permission - these must refuse on their own.
 *
 * Write-shaped calls use this area's own E2E accounts (creds.local-e2e.json) and arguments that
 * cannot write even if a guard were missing (nonexistent ids, invalid forms). The seeded shared
 * sessions are used for GETs only.
 */

test.skip(IS_PROD || !HAS_DB, "action replay reads the local build's action ids; DB checks are local");

type C = { email: string; password: string; role: string };
const creds = readJson<Record<string, C>>(CREDS_FILE, {});
const TEST_ROLES = ["head", "asma", "tutor", "student"].filter((k) => creds[k]);

async function sessionFor(key: string): Promise<{ ctx: APIRequestContext; userId: string }> {
  const c = creds[key];
  const r = await apiSignIn(c.email, c.password);
  expect(r.status, `${key} test account signs in: ${r.body}`).toBe(200);
  const state = await r.ctx.storageState();
  await r.ctx.dispose();
  const ctx = await request.newContext({ baseURL: BASE_URL, storageState: state, extraHTTPHeaders: ipHeaders() });
  const u = await one(`select id from "user" where email=$1`, [c.email]);
  return { ctx, userId: u.id };
}

test("privileged server actions refuse every non-admin role (replayed with their cookies)", async () => {
  test.setTimeout(300_000);
  test.skip(TEST_ROLES.length === 0, "run 01-provision first");
  const admin = await one(`select id from "user" where email=$1`, [ROLES.admin.email]);
  const results: Record<string, Record<string, string>> = {};
  const failures: string[] = [];
  // Positive control: the replay reaches the action body for an admin (validation error, no write),
  // so a "refused" below is the guard talking, not a broken replay.
  const adminCtx = await request.newContext({ baseURL: BASE_URL, storageState: authFile("admin") });
  const control = await callAction(adminCtx, "createIncome", [{ form: {} }]);
  await adminCtx.dispose();
  results.adminControl = { createIncome: JSON.stringify(control.result) };
  expect(refused(control), `admin control call: ${JSON.stringify(control.result)}`).toBe(false);
  expect(control.result?.ok).toBe(false);
  for (const key of TEST_ROLES) {
    const { ctx, userId } = await sessionFor(key);
    const calls: [string, unknown[]][] = [
      ["createIncome", [{ form: {} }]],
      ["createExpense", [{ form: {} }]],
      ["saveCashPosition", [{ form: {} }]],
      ["saveWeeklySnapshot", [{ form: {} }]],
      ["inviteUser", [{ form: { name: "Nobody", email: "not-an-email", role: "ADMIN" } }]],
      ["updateUserAccess", [userId, { form: { name: "Self Promote", role: "ADMIN" } }]],
      ["setUserCapability", [userId, "users.manage", true]],
      ["suspendUser", [admin.id]],
      ["deleteUser", ["e2e-nonexistent-user"]],
      ["terminateUser", [{ profileId: "e2e-nonexistent-profile", successorProfileId: null, reason: "" }]],
      ["saveTeamProfile", [null, { form: {} }]],
      ["createStudent", [{ form: {} }]],
      ["updateStudent", ["e2e-nonexistent-student", { form: {} }]],
      ["assignLead", ["e2e-nonexistent-lead", userId]],
      ["deleteContact", ["e2e-nonexistent-lead"]],
    ];
    results[key] = {};
    for (const [name, args] of calls) {
      const r = await callAction(ctx, name, args);
      const summary = r.redirect ? `redirect ${r.redirect}` : r.status >= 500 ? `HTTP ${r.status}` : JSON.stringify(r.result)?.slice(0, 140);
      results[key][name] = summary;
      if (!refused(r)) failures.push(`${key} (${creds[key].role}) ${name} -> ${summary}`);
    }
    const role = await one(`select role, capabilities from "user" where id=$1`, [userId]);
    if (role.role !== creds[key].role) failures.push(`${key} role changed to ${role.role}!`);
    await ctx.dispose();
  }
  evidence("actions-refused-matrix", results);
  expect(failures, `server actions that did not refuse a non-admin:\n${failures.join("\n")}`).toEqual([]);
});

test("a user cannot change their own role through the auth API", async () => {
  test.skip(!creds.asma, "run 01-provision first");
  const { ctx, userId } = await sessionFor("asma");
  const before = await one(`select role, capabilities, "sectionAccess" from "user" where id=$1`, [userId]);
  const res = await ctx.post("/api/auth/update-user", { data: { role: "ADMIN", status: "ACTIVE", capabilities: { "users.manage": true }, sectionAccess: { finance: true } }, headers: { Origin: BASE_URL } });
  const row = await one(`select role, capabilities, "sectionAccess" from "user" where id=$1`, [userId]);
  evidence("self-role-change-auth-api", { status: res.status(), body: (await res.text()).slice(0, 300), row });
  await ctx.dispose();
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(row).toEqual(before);
});

test("ACC-06 a telecaller can reassign any lead's owner through Contacts (bypasses pipeline.configure)", async () => {
  test.skip(!creds.asma, "run 01-provision first");
  const { ctx, userId } = await sessionFor("asma");
  // Same outcome, two doors. assignLead is capability-gated; setContactOwner only checks the section.
  const viaPipeline = await callAction(ctx, "assignLead", ["e2e-nonexistent-lead", userId]);
  const viaContacts = await callAction(ctx, "setContactOwner", ["e2e-nonexistent-lead", userId]);
  evidence("ACC-06-owner-reassign", { viaPipeline: { r: viaPipeline.result, redirect: viaPipeline.redirect }, viaContacts: { status: viaContacts.status, r: viaContacts.result, redirect: viaContacts.redirect, body: viaContacts.body.slice(0, 300) } });
  await ctx.dispose();
  expect(refused(viaPipeline), "assignLead refuses a USER").toBe(true);
  // A nonexistent id makes the write itself throw (HTTP 500) - which only happens AFTER the guard let the USER through.
  expect(refused(viaContacts),
    `ACC-06 BUG: setContactOwner did not refuse a USER (HTTP ${viaContacts.status}); it reached prisma.lead.update. ` +
    `src/server/contacts-actions.ts:232-235 guards with requireSection("contacts") only, while assignLead (pipeline-actions.ts:288) requires pipeline.configure.`).toBe(true);
});

test("ACC-07 CSV export is admin-only (PRD1 s6: 'Admin can export any table to CSV')", async () => {
  test.setTimeout(180_000);
  const results: Record<string, Record<string, string>> = {};
  const leaks: string[] = [];
  for (const key of (Object.keys(ROLES) as RoleKey[]).filter((k) => ROLES[k]?.email)) {
    const ctx = await request.newContext({ baseURL: BASE_URL, storageState: authFile(key) });
    results[key] = {};
    for (const entity of ["leads", "income", "expenses", "form-responses"]) {
      // A filter that matches only other agents' E2E rows keeps the file tiny but non-empty.
      const res = await ctx.get(`/api/export/${entity}?q=E2E&period=all&formId=e2e-nonexistent-form`, { maxRedirects: 0 });
      const ct = res.headers()["content-type"] ?? "";
      const body = await res.text();
      const isCsv = /text\/csv/.test(ct);
      const rows = isCsv ? body.trim().split("\n").length - 1 : 0;
      results[key][entity] = isCsv ? `CSV ${rows} row(s)` : `${res.status()} ${res.headers()["location"] ?? ""}${/NEXT_REDIRECT/.test(body) ? " (redirect)" : ""}`;
      if (isCsv && key !== "admin") leaks.push(`${key}: /api/export/${entity} -> ${results[key][entity]}`);
    }
    // Is the button on the page for them?
    const contacts = await ctx.get("/contacts", { maxRedirects: 0 });
    const html = await contacts.text();
    results[key]["Export CSV button on /contacts"] = /NEXT_REDIRECT/.test(html) ? "page denied" : /Export CSV/.test(html) ? "visible" : "absent";
    await ctx.dispose();
  }
  evidence("ACC-07-exports", results);
  expect(leaks, `ACC-07 non-admin roles download CSV exports (src/app/api/export/[entity]/route.ts:253 gates on requireSection only; leads -> "contacts" section includes USER, form-responses -> "forms" includes USER):\n${leaks.join("\n")}`).toEqual([]);
});

test("ACC-08 JSON APIs do not hand lead data to students and tutors", async () => {
  const results: Record<string, Record<string, string>> = {};
  const leaks: string[] = [];
  for (const key of (["student", "tutor", "gnStudent", "asma"] as RoleKey[]).filter((k) => ROLES[k]?.email)) {
    const ctx = await request.newContext({ baseURL: BASE_URL, storageState: authFile(key) });
    results[key] = {};
    for (const p of ["/api/leads/poll-recent?scope=kanban&since=2000-01-01T00:00:00Z", "/api/leads/poll-recent?scope=table&since=2000-01-01T00:00:00Z", "/api/leads/poll?since=2000-01-01T00:00:00Z", "/api/conversations/poll", "/api/command-palette"]) {
      const res = await ctx.get(p, { maxRedirects: 0 });
      const txt = await res.text();
      let n = "";
      try { const j = JSON.parse(txt); n = Array.isArray(j.leads) ? `${j.leads.length} leads` : Array.isArray(j.items) ? `${j.items.length} items` : JSON.stringify(j).slice(0, 60); } catch { n = txt.slice(0, 40); }
      results[key][p] = `${res.status()} ${n}`;
      if (["student", "tutor", "gnStudent"].includes(key) && /poll-recent\?scope=kanban/.test(p) && /^200 [1-9]\d* leads/.test(results[key][p])) leaks.push(`${key}: GET ${p} -> ${results[key][p]} (names, stage, owner)`);
    }
    await ctx.dispose();
  }
  evidence("ACC-08-json-apis", results);
  expect(leaks, `ACC-08 BUG: src/app/api/leads/poll-recent/route.ts:30-49 has no role/section gate; scope=kanban returns every new lead's name, stage and owner to any signed-in account:\n${leaks.join("\n")}`).toEqual([]);
});

test("ACC-09 releaseDeferredBookOrders is an unguarded server action any signed-in role can run", async () => {
  test.skip(!creds.student, "run 01-provision first");
  const deferred = await one(`select count(*)::int n from book_order where status='DEFERRED'`);
  test.skip(deferred.n > 0, "would change real book orders - code-reading only when DEFERRED rows exist");
  const { ctx } = await sessionFor("student");
  const r = await callAction(ctx, "releaseDeferredBookOrders", []);
  evidence("ACC-09-release-deferred", { status: r.status, result: r.result, redirect: r.redirect });
  await ctx.dispose();
  expect(refused(r) || r.status >= 400,
    `ACC-09 BUG: a STUDENT ran releaseDeferredBookOrders -> ${JSON.stringify(r.result)}. src/server/book-order-actions.ts:362 is exported from a "use server" file with no guard, so it is a public endpoint for any session.`).toBe(true);
});

test("termination record PDF and other per-record API downloads refuse non-admins", async () => {
  const out: Record<string, Record<string, number>> = {};
  const bad: string[] = [];
  const profile = await one(`select id from team_profile limit 1`);
  for (const key of (["head", "asma", "student", "tutor"] as RoleKey[]).filter((k) => ROLES[k]?.email)) {
    const ctx = await request.newContext({ baseURL: BASE_URL, storageState: authFile(key) });
    out[key] = {};
    for (const p of [`/api/people/${profile.id}/termination-report`, `/api/agreements/e2e-nonexistent/pdf`, `/api/resume/e2e-nonexistent/download`]) {
      const res = await ctx.get(p, { maxRedirects: 0 });
      out[key][p] = res.status();
      if (res.status() === 200) bad.push(`${key} ${p} -> 200`);
    }
    await ctx.dispose();
    await sleep(200);
  }
  evidence("record-downloads", out);
  expect(bad).toEqual([]);
  expect(out.asma?.[`/api/people/${profile.id}/termination-report`]).toBe(403);
});

test("ACC-15 a telecaller can publish/unpublish forms and funnels without the sites.manage capability", async () => {
  test.skip(!creds.asma, "run 01-provision first");
  const { ctx } = await sessionFor("asma");
  const results = {
    deleteForm: await callAction(ctx, "deleteForm", ["e2e-nonexistent-form"]),
    togglePublishForm: await callAction(ctx, "togglePublishForm", ["e2e-nonexistent-form"]),
    deleteFunnel: await callAction(ctx, "deleteFunnel", ["e2e-nonexistent-funnel"]),
    togglePublishFunnel: await callAction(ctx, "togglePublishFunnel", ["e2e-nonexistent-funnel"]),
  };
  await ctx.dispose();
  const summary = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.redirect ? `redirect ${r.redirect}` : `${r.status} ${JSON.stringify(r.result)}`]));
  evidence("ACC-15-publish-without-sites-manage", summary);
  expect(refused(results.deleteForm), "deleteForm is sites.manage-gated").toBe(true);
  const through = ["togglePublishForm", "togglePublishFunnel"].filter((k) => !refused(results[k as keyof typeof results]));
  expect(through,
    `ACC-15: capabilities.ts:129-135 says sites.manage guards "forms-actions · funnels-actions - publishing included", but a USER passes the guard of ${through.join(", ")} ` +
    `(${through.map((k) => summary[k]).join(" | ")}). src/server/forms-actions.ts:221 and funnels-actions.ts:94 only call requireSection.`).toEqual([]);
});
