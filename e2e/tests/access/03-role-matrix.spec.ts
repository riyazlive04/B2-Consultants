import { test, expect, request } from "@playwright/test";
import { BASE_URL } from "../../playwright.config";
import { ROLES, authFile, type RoleKey } from "../../helpers/roles";
import { evidence, writeJson } from "../../helpers/access-lib";
import { ROLE_OF, classify, codeAllows, prdAllows, readCapabilities, readRoutes, readSections, sidebarHrefs, type Role } from "../../helpers/access-matrix";

/**
 * Role x route, enumerated from the filesystem. Every page under src/app/(app) plus the portal
 * sign-in pages is fetched as every seeded role (read-only GETs on the shared sessions - nothing
 * here writes). The code's own rules (sections.ts, capabilities.ts, the guard each page calls)
 * are the expectation; the PRD tables are checked separately and reported as divergences.
 */

const sections = readSections();
const caps = readCapabilities();
const routes = readRoutes().filter((r) => r.file.includes("/(app)/") || ["/portal", "/tutor", "/change-password"].includes(r.pattern));
const roleKeys = (Object.keys(ROLES) as RoleKey[]).filter((k) => ROLES[k]?.email);

type Cell = { outcome: string; to?: string; status: number; ms: number };
const matrix: Record<string, Record<string, Cell>> = {};
const sidebars: Record<string, { href: string; label: string }[]> = {};

test.describe.configure({ mode: "serial" });

test("observe every role x every app route (direct URL)", async () => {
  test.setTimeout(900_000);
  for (const key of roleKeys) {
    const ctx = await request.newContext({ baseURL: BASE_URL, storageState: authFile(key) });
    const home = await ctx.get("/", { maxRedirects: 0, timeout: 120_000 });
    let homeBody = await home.text();
    const hc = classify(home.status(), home.headers()["location"], homeBody);
    expect(["render", "redirect"], `${key} session is alive (${hc.outcome} ${hc.to ?? ""})`).toContain(hc.outcome);
    if (hc.outcome === "redirect" && hc.to) homeBody = await (await ctx.get(hc.to, { timeout: 120_000 })).text();
    sidebars[key] = sidebarHrefs(homeBody);
    // 4 at a time: the server is shared with other agents.
    for (let i = 0; i < routes.length; i += 3) {
      await Promise.all(routes.slice(i, i + 3).map(async (r) => {
        const t0 = Date.now();
        let res;
        for (let a = 0; ; a++) {
          try { res = await ctx.get(r.url, { maxRedirects: 0, timeout: 120_000 }); break; }
          catch (e) { if (a >= 2) throw e; await new Promise((z) => setTimeout(z, 3_000)); }
        }
        const body = await res.text();
        const c = classify(res.status(), res.headers()["location"], body);
        (matrix[r.pattern] ??= {})[key] = { ...c, status: res.status(), ms: Date.now() - t0 };
      }));
    }
    await ctx.dispose();
  }
  writeJson("reports/access-matrix-local.json", { roles: roleKeys, routes: routes.map((r) => ({ ...r })), matrix, sidebars });
});

test("direct URL access matches the app's own rules (sections.ts / capabilities.ts / page guards)", async () => {
  const wrong: string[] = [];
  for (const r of routes) {
    if (["/portal", "/tutor", "/change-password"].includes(r.pattern)) continue;
    for (const key of roleKeys) {
      const role = ROLE_OF[key] as Role;
      const cell = matrix[r.pattern]?.[key];
      if (!cell) continue;
      const allowed = codeAllows(r, role, sections, caps);
      const got = cell.outcome === "denied" || cell.outcome === "login" ? false : true;
      if (cell.outcome === "error") wrong.push(`${r.pattern} as ${key}: server error ${cell.status}`);
      else if (allowed !== got) wrong.push(`${r.pattern} as ${key} (${role}): code says ${allowed ? "ALLOW" : "DENY"}, observed ${cell.outcome}${cell.to ? " -> " + cell.to : ""}`);
    }
  }
  evidence("matrix-vs-code", wrong);
  expect(wrong, `routes whose guard disagrees with the app's own access rules:\n${wrong.join("\n")}`).toEqual([]);
});

test("sidebar lists exactly the sections each role may open (minus off-rail)", async () => {
  const wrong: string[] = [];
  for (const key of roleKeys) {
    const role = ROLE_OF[key] as Role;
    const expected = sections
      .filter((s) => !s.hidden && !s.offRail && (role === "ADMIN" ? true : !s.locked && s.roles.includes(role)))
      .filter((s) => s.key !== "my-journey" || role === "STUDENT")
      .map((s) => s.href);
    const got = sidebars[key].map((s) => s.href);
    const missing = expected.filter((h) => !got.includes(h));
    const extra = got.filter((h) => !expected.includes(h) && h !== "/profile");
    if (missing.length || extra.length) wrong.push(`${key}: missing ${JSON.stringify(missing)} extra ${JSON.stringify(extra)}`);
    // every sidebar link really opens for that role
    for (const h of got) {
      const cell = matrix[h]?.[key];
      if (cell && (cell.outcome === "denied" || cell.outcome === "login")) wrong.push(`${key}: sidebar shows ${h} but it bounces (${cell.to})`);
    }
  }
  evidence("sidebar-vs-code", { sidebars, wrong });
  expect(wrong, wrong.join("\n")).toEqual([]);
});

test("ACC-05 PRD role tables (PRD1 s2, PRD2 s2/s5, PRD3 s2/s5) vs what each role can open", async () => {
  const diverge: string[] = [];
  for (const s of sections) {
    for (const key of ["admin", "head", "asma", "nilofer"] as RoleKey[]) {
      if (!roleKeys.includes(key)) continue;
      const role = ROLE_OF[key] as Role;
      const prd = prdAllows(s.key, role);
      if (prd === undefined) continue;
      const cell = matrix[s.href]?.[key];
      if (!cell) continue;
      const got = !(cell.outcome === "denied" || cell.outcome === "login");
      if (got !== prd) diverge.push(`${s.label} (${s.href}) as ${key}/${role}: PRD ${prd ? "ALLOW" : "DENY"}, app ${got ? "ALLOWS" : "DENIES"}`);
    }
  }
  evidence("ACC-05-prd-divergence", diverge);
  expect(diverge, `ACC-05 PRD divergence (the app follows sections.ts "spec s3" founder ruling, not the PRD tables):\n${diverge.join("\n")}`).toEqual([]);
});
