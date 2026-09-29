import { test, expect, devices, request } from "@playwright/test";
import { BASE_URL } from "../../playwright.config";
import { ROLES, authFile, type RoleKey } from "../../helpers/roles";
import { IS_PROD } from "../../helpers/target";
import { CREDS_FILE, apiSignIn, evidence, ipHeaders, readJson } from "../../helpers/access-lib";

/**
 * Cross-cutting PRD UI rules. Read-only on the seeded sessions (no logout, no writes); the one
 * "survives refresh" write goes to this area's own E2E account.
 */

const PRD3_ORDER = ["Finance", "Pipeline", "People", "Students", "Conversion Funnel", "Cash Health"];
// Where each PRD item lives today (label renamed in sections.ts).
const PRD_HREF: Record<string, string> = { Finance: "/finance", Pipeline: "/opportunities", People: "/people", Students: "/students", "Conversion Funnel": "/funnel", "Cash Health": "/cash" };

test.describe("admin shell", () => {
  test.use({ storageState: authFile("admin") });

  test("ACC-13 sidebar carries the six PRD items in PRD3 s5 order", async ({ page }) => {
    await page.goto("/");
    const links = page.locator("aside nav a[href]");
    await expect(links.first()).toBeVisible();
    const items = await links.evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), label: (a.textContent ?? "").trim() })));
    const order = items.filter((i) => i.href && i.href !== "/").map((i) => `${i.label} (${i.href})`);
    const positions = PRD3_ORDER.map((p) => ({ prd: p, idx: items.findIndex((i) => i.href === PRD_HREF[p]), label: items.find((i) => i.href === PRD_HREF[p])?.label }));
    evidence("ACC-13-sidebar-order", { order, positions });
    const missing = positions.filter((p) => p.idx < 0).map((p) => p.prd);
    expect(missing, "every PRD sidebar item is present").toEqual([]);
    const idx = positions.map((p) => p.idx);
    const sorted = [...idx].sort((a, b) => a - b);
    expect(idx, `ACC-13 PRD3 s5 order Finance > Pipeline > People > Students > Conversion Funnel > Cash Health; actual rail: ${positions.map((p) => `${p.prd}="${p.label}"@${p.idx}`).join(", ")}. Full rail: ${order.join(" | ")}`).toEqual(sorted);
  });

  test("ACC-14 top bar: user name, current month, logout, runway with colour (PRD1 s6, PRD3 s5)", async ({ page }) => {
    await page.goto("/finance");
    const header = page.locator("header").first();
    await expect(header).toBeVisible();
    const text = (await header.innerText()).replace(/\s+/g, " ");
    const name = ROLES.admin.email.startsWith("ameen") ? "Ameen" : "";
    const runway = header.getByRole("link", { name: /Runway|months/ });
    const runwayText = (await runway.count()) ? (await runway.first().innerText()).trim() : "";
    const runwayColor = (await runway.count()) ? await runway.first().evaluate((e) => getComputedStyle(e).color) : "";
    const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
    const found = {
      userName: name ? text.includes(name) : true,
      logout: (await header.getByRole("button", { name: "Log out" }).count()) > 0,
      runway: /Runway: (-|\d+\.\d months)/.test(runwayText),
      currentMonth: text.includes(month) || text.includes(month.split(" ")[0]),
    };
    // Runway colour must follow PRD3 s4.4 (>=6 green, 3-6 amber, <3 red) - compare with the Cash Health signal tokens.
    const m = runwayText.match(/(\d+\.\d) months/);
    const months = m ? parseFloat(m[1]) : null;
    evidence("ACC-14-top-bar", { headerText: text, runwayText, runwayColor, months, found, month });
    expect(found.userName, "user name in top bar").toBe(true);
    expect(found.logout, "logout button in top bar").toBe(true);
    expect(found.runway, `runway pill "${runwayText}"`).toBe(true);
    if (months !== null) {
      const token = months >= 6 ? "--good" : months >= 3 ? "--warn" : "--bad";
      const expected = await page.evaluate((t) => { const d = document.createElement("span"); d.style.color = `var(${t})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, token);
      expect.soft(runwayColor, `runway ${months} months should be ${token}`).toBe(expected);
    }
    expect(found.currentMonth, `ACC-14: PRD1 s6 top bar "Logged-in username | Current month | Logout". The month label was replaced by NavClock (src/components/shell/AppShell.tsx:416-419). Header text: "${text}"`).toBe(true);
  });

  test("ACC-16 dates render DD/MM/YYYY and money uses Indian grouping (INR) / German format (EUR)", async ({ page }) => {
    test.setTimeout(600_000);
    const report: Record<string, unknown> = {};
    const bad: string[] = [];
    for (const path of ["/finance", "/people", "/activity", "/students", "/cash"]) {
      await page.goto(path, { timeout: 120_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      const txt = await page.locator("main").innerText();
      const iso = txt.match(/\b20\d\d-\d\d-\d\d\b/g) ?? [];
      const us = (txt.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/g) ?? []).filter((d) => parseInt(d.split("/")[1], 10) > 12);
      const ddmm = txt.match(/\b\d\d\/\d\d\/20\d\d\b/g) ?? [];
      const inr = txt.match(/₹\s?[\d,]+(\.\d+)?/g) ?? [];
      const badInr = inr.filter((s) => { const n = s.replace(/[₹\s]/g, "").split(".")[0]; return n.replace(/,/g, "").length > 5 && !/^\d{1,2}(,\d{2})*,\d{3}$/.test(n); });
      const eur = txt.match(/[\d.]+(,\d+)?\s?€|€\s?[\d.,]+/g) ?? [];
      const badEur = eur.filter((s) => /\d,\d{3}\b/.test(s) && !/,\d{2}\s?€/.test(s));
      report[path] = { ddmm: ddmm.slice(0, 3), iso: iso.slice(0, 3), usStyle: us.slice(0, 3), inr: inr.slice(0, 5), badInr, eur: eur.slice(0, 5), badEur };
      if (iso.length) bad.push(`${path}: ISO dates shown ${iso.slice(0, 3).join(", ")}`);
      if (us.length) bad.push(`${path}: MM/DD dates ${us.slice(0, 3).join(", ")}`);
      if (badInr.length) bad.push(`${path}: non-Indian INR grouping ${badInr.join(", ")}`);
      if (badEur.length) bad.push(`${path}: non-German EUR ${badEur.join(", ")}`);
    }
    evidence("formats", report);
    expect(bad, `ACC-16 (low): ${bad.join("\n")}\n(/activity summaries: src/server/booking-actions.ts:601 writes raw YYYY-MM-DD)`).toEqual([]);
  });
});

test("CSV export buttons are admin-only (PRD1 s6)", async () => {
  test.setTimeout(600_000);
  const pages = ["/contacts", "/bookings", "/forms", "/funnels", "/outreach", "/reports", "/telecaller", "/students", "/pipeline", "/finance", "/payments", "/cash"];
  const seen: Record<string, string[]> = {};
  const leaks: string[] = [];
  for (const key of (["admin", "head", "asma", "nilofer"] as RoleKey[]).filter((k) => ROLES[k]?.email)) {
    const ctx = await request.newContext({ baseURL: BASE_URL, storageState: authFile(key) });
    seen[key] = [];
    for (const p of pages) {
      const html = await (await ctx.get(p, { maxRedirects: 0, timeout: 120_000 })).text();
      if (/NEXT_REDIRECT/.test(html)) continue;
      if (/Export CSV/.test(html)) {
        seen[key].push(p);
        if (key !== "admin") leaks.push(`${key}: Export CSV on ${p}`);
      }
    }
    await ctx.dispose();
  }
  evidence("csv-buttons", seen);
  expect(leaks, `ACC-07 (UI side): non-admins are offered CSV export:\n${leaks.join("\n")}`).toEqual([]);
});

for (const [deviceName, keys] of [["iPhone 13", ["admin", "asma", "student"]], ["Pixel 7", ["admin", "head", "tutor"]]] as const) {
  test.describe(`mobile ${deviceName}`, () => {
    const { defaultBrowserType, ...device } = devices[deviceName];
    for (const key of keys) {
      test(`${key}: no horizontal scroll, cards stack, drawer navigation works`, async ({ browser }) => {
        test.skip(!ROLES[key as RoleKey]?.email);
        test.setTimeout(240_000);
        const ctx = await browser.newContext({ ...device, storageState: authFile(key as RoleKey), timezoneId: "Asia/Kolkata", locale: "en-IN" });
        const page = await ctx.newPage();
        // Telecallers get a once-a-day "calls to make today" modal; dismiss it whenever it appears.
        await page.addLocatorHandler(page.getByRole("button", { name: "Dismiss", exact: true }), (b) => b.click());
        const paths = key === "admin" ? ["/", "/finance", "/people", "/students", "/cash", "/funnel", "/contacts"] : key === "student" ? ["/my-journey", "/german-note", "/profile"] : key === "tutor" ? ["/german-note", "/daily-log"] : ["/", "/my-desk", "/opportunities", "/students"];
        const overflow: string[] = [];
        const report: Record<string, unknown> = {};
        for (const p of paths) {
          await page.goto(p, { timeout: 120_000 });
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
          const m = await page.evaluate(() => {
            const vw = window.innerWidth;
            const sw = document.documentElement.scrollWidth;
            const wide = [...document.querySelectorAll("main *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 2 && getComputedStyle(e).position !== "fixed"; }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${(e.className || "").toString().slice(0, 40)}`);
            return { vw, sw, wide };
          });
          report[p] = m;
          if (m.sw > m.vw + 1) overflow.push(`${p}: scrollWidth ${m.sw} > viewport ${m.vw} (${m.wide.join(", ")})`);
        }
        // Drawer: open the menu, follow a link, land on it.
        await page.goto(paths[0]);
        await page.getByRole("button", { name: "Open menu" }).click();
        const drawer = page.getByRole("dialog");
        await expect(drawer).toBeVisible();
        const link = drawer.locator("a[href^='/']").filter({ hasNotText: /B2 Consultants/ }).nth(1);
        const href = await link.getAttribute("href");
        await link.click();
        await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`));
        evidence(`mobile-${deviceName.replace(/\s/g, "")}-${key}`, { report, drawerLink: href });
        await ctx.close();
        expect(overflow, `horizontal scroll on ${deviceName}:\n${overflow.join("\n")}`).toEqual([]);
      });
    }
  });
}

test("a saved preference survives a refresh (E2E account, theme)", async ({ browser }) => {
  test.skip(IS_PROD);
  const creds = readJson<Record<string, { email: string; password: string }>>(CREDS_FILE, {});
  test.skip(!creds.asma, "run 01-provision first");
  const r = await apiSignIn(creds.asma.email, creds.asma.password);
  const state = await r.ctx.storageState();
  await r.ctx.dispose();
  const ctx = await browser.newContext({ storageState: state, extraHTTPHeaders: ipHeaders(), colorScheme: "light" });
  const page = await ctx.newPage();
  await page.addLocatorHandler(page.getByRole("button", { name: "Dismiss", exact: true }), (b) => b.click());
  await page.goto("/profile", { timeout: 120_000 });
  const toggle = page.getByRole("button", { name: /Switch to (dark|light) mode/ }).first();
  const before = await toggle.getAttribute("aria-label");
  await toggle.click();
  await expect(page.getByRole("button", { name: /Switch to (dark|light) mode/ }).first()).not.toHaveAttribute("aria-label", before!);
  await page.waitForTimeout(1500);
  await page.reload({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: /Switch to (dark|light) mode/ }).first(), "theme choice persisted server-side").not.toHaveAttribute("aria-label", before!);
  await ctx.close();
});
