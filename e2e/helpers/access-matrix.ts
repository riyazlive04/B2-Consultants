import * as fs from "fs";
import * as path from "path";
import { APP_SRC } from "./access-lib";

/**
 * The app's own access rules, read from source so the expectations never drift from the code:
 *  - src/lib/sections.ts   SECTION_CATALOGUE (key, href, roles, hidden, locked, offRail)
 *  - src/lib/capabilities.ts CAPABILITIES (key, roles)
 *  - every src/app/(app)/.../page.tsx and portal page, with the guards each one calls.
 */

export type Role = "ADMIN" | "HEAD" | "USER" | "STUDENT" | "TUTOR";
export type Section = { key: string; label: string; href: string; group: string; roles: Role[]; hidden: boolean; locked: boolean; offRail: boolean };

export function readSections(): Section[] {
  const src = fs.readFileSync(path.join(APP_SRC, "src/lib/sections.ts"), "utf8");
  const body = src.slice(src.indexOf("export const SECTION_CATALOGUE"), src.indexOf("] as const satisfies readonly SectionCatalogueEntry[]"));
  const out: Section[] = [];
  const re = /\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*href:\s*"([^"]+)",[^}]*?group:\s*"([^"]+)",\s*roles:\s*\[([^\]]*)\]([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({
      key: m[1], label: m[2], href: m[3], group: m[4],
      roles: m[5].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) as Role[],
      hidden: /hidden:\s*true/.test(m[6]), locked: /locked:\s*true/.test(m[6]), offRail: /offRail:\s*true/.test(m[6]),
    });
  }
  if (out.length < 20) throw new Error(`parsed only ${out.length} sections from sections.ts`);
  return out;
}

export function readCapabilities(): Record<string, Role[]> {
  const src = fs.readFileSync(path.join(APP_SRC, "src/lib/capabilities.ts"), "utf8");
  const out: Record<string, Role[]> = {};
  const re = /key:\s*"([^"]+)",[\s\S]*?roles:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = m[2].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) as Role[];
  return out;
}

export type RouteDef = { file: string; pattern: string; url: string; sections: string[]; admin: boolean; adminOrHead: boolean; capabilities: string[]; roleChecks: string[] };

/** Every page under src/app, with dynamic segments filled by a placeholder id. */
export function readRoutes(): RouteDef[] {
  const appDir = path.join(APP_SRC, "src/app");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== "api") walk(p); }
      else if (f.name === "page.tsx") files.push(p);
    }
  };
  walk(appDir);
  return files.map((f) => {
    const rel = path.relative(appDir, path.dirname(f)).split(path.sep).join("/");
    const pattern = "/" + rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
    const url = pattern
      .replace(/\/\[\[\.\.\.[^\]]+\]\]/g, "")
      .replace(/\[[^\]]+\]/g, "e2e-missing-id");
    const src = fs.readFileSync(f, "utf8");
    const all = (re: RegExp) => [...src.matchAll(re)].map((m) => m[1]);
    return {
      file: path.relative(APP_SRC, f).split(path.sep).join("/"),
      pattern: pattern === "/" ? "/" : pattern,
      url: url || "/",
      sections: all(/requireSection\("([^"]+)"\)/g),
      admin: /requireAdmin\(\)/.test(src),
      adminOrHead: /requireAdminOrHead\(\)/.test(src),
      capabilities: all(/requireCapability\("([^"]+)"\)/g),
      roleChecks: [...new Set(all(/role (?:===|!==) "([A-Z]+)"/g))],
    };
  }).sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/** What the code says: can `role` open `route` with default (no per-user override) settings? */
export function codeAllows(route: RouteDef, role: Role, sections: Section[], caps: Record<string, Role[]>): boolean {
  if (route.admin && role !== "ADMIN") return false;
  if (route.adminOrHead && role !== "ADMIN" && role !== "HEAD") return false;
  for (const k of route.sections) {
    const s = sections.find((x) => x.key === k);
    if (!s || s.hidden) return false;
    if (role !== "ADMIN" && (s.locked || !s.roles.includes(role))) return false;
  }
  for (const c of route.capabilities) if (role !== "ADMIN" && !(caps[c] ?? []).includes(role)) return false;
  return true;
}

/** PRD 1/2/3 role tables, for the sections they name. undefined = PRD silent. */
export function prdAllows(sectionKey: string, role: Role): boolean | undefined {
  const admin = role === "ADMIN";
  switch (sectionKey) {
    case "finance": return admin; // PRD1 User: cannot see Finance; PRD2 Head: Finance+Pipeline no access
    case "pipeline": case "opportunities": return admin; // PRD2: Finance + Pipeline -> Head and User "No access"
    case "people": return admin; // PRD2: People -> Head/User "own daily log only", People hidden in sidebar
    case "daily-log": return admin || role === "HEAD" || role === "USER"; // PRD2: own daily log for Head and User
    case "students": return admin || role === "HEAD"; // PRD2: Head view all (read-only), User no access
    case "funnel": case "cash": return admin; // PRD3: Admin-only
    default: return undefined;
  }
}

export const ROLE_OF: Record<string, Role> = { admin: "ADMIN", head: "HEAD", asma: "USER", nilofer: "USER", student: "STUDENT", tutor: "TUTOR", gnStudent: "STUDENT" };

/** Classify a GET of an app page. */
export function classify(status: number, location: string | undefined, body: string): { outcome: "render" | "denied" | "login" | "redirect" | "notfound" | "error"; to?: string } {
  if (status >= 300 && status < 400) {
    const to = location ?? "";
    if (/\/login/.test(to)) return { outcome: "login", to };
    if (/denied=/.test(to)) return { outcome: "denied", to };
    return { outcome: "redirect", to };
  }
  const nr = body.match(/NEXT_REDIRECT;(?:replace|push);([^;"]+);/);
  if (nr) {
    if (/denied=/.test(nr[1])) return { outcome: "denied", to: nr[1] };
    if (/\/login/.test(nr[1])) return { outcome: "login", to: nr[1] };
    return { outcome: "redirect", to: nr[1] };
  }
  if (status === 404 || /NEXT_NOT_FOUND/.test(body)) return { outcome: "notfound" };
  if (status >= 500) return { outcome: "error" };
  return { outcome: "render" };
}

/** Sidebar hrefs (in order) from a rendered app page's HTML. */
export function sidebarHrefs(html: string): { href: string; label: string }[] {
  const start = html.indexOf("<aside");
  if (start < 0) return [];
  const nav = html.slice(start, html.indexOf("</aside>", start));
  const out: { href: string; label: string }[] = [];
  const re = /<a[^>]*href="(\/[^"#?]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nav))) {
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (m[1] === "/" || !label || /B2 Consultants/.test(label)) continue;
    out.push({ href: m[1], label });
  }
  return out;
}
