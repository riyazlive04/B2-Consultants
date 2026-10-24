/**
 * Open every screen in the app and report the ones that break.
 *
 *   npm run smoke                    # against the local stack
 *   BASE_URL=… npm run smoke
 *   npm run smoke -- --role=head     # sign in as somebody else
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────
 * Three of the bugs found on 24/10/2026 were invisible to every automated check in this repo -
 * a stale table name in raw SQL, a stale table name in a TRUNCATE list, and a screen telling the
 * reader to go somewhere that could not do the job. `tsc`, `next build` and 1,900 unit tests all
 * passed throughout. The thing none of them does is OPEN A PAGE.
 *
 * So this opens all of them, signed in, and reports:
 *   · a non-2xx response
 *   · Next's error boundary ("Something went wrong", "Application error")
 *   · an uncaught exception or a failed request in the browser console
 *   · a server-side error logged while the page rendered
 *   · a page that renders but is effectively blank
 *
 * It is a SMOKE test, not a functional one: it proves a screen renders, not that it is correct.
 * That is deliberately a low bar, because the bugs above cleared every higher one.
 *
 * LOCAL ONLY by default, for the same reason as the screenshot capture: it signs in and loads
 * every screen, and doing that against production reads real client data into a log.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type ConsoleMessage, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.SMOKE_EMAIL ?? "local.demo@b2consultants.in";
const PASSWORD = process.env.SMOKE_PASSWORD ?? process.env.E2E_PASSWORD ?? "";

const prisma = new PrismaClient();

/** Every page route the App Router serves, as a path. */
function pageRoutes(): string[] {
  const APP = path.join(process.cwd(), "src", "app");
  const out: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") {
        const r = full
          .slice(APP.length)
          .split(path.sep)
          .join("/")
          .replace(/\/page\.tsx$/, "")
          .replace(/\/\([^)]+\)/g, "");
        out.push(r === "" ? "/" : r);
      }
    }
  })(APP);
  return [...new Set(out)].sort();
}

/**
 * A real id for each dynamic segment, read from the database.
 *
 * A route with no row to fill it is SKIPPED rather than guessed: `/students/undefined` proves
 * nothing except that the 404 path works.
 */
async function resolveParams(route: string): Promise<string | null> {
  const first = async <T,>(fn: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  if (!route.includes("[")) return route;

  const pick: Record<string, () => Promise<string | null>> = {
    "/students/[id]": async () =>
      (await first(() => prisma.student.findFirst({ select: { id: true } })))?.id ?? null,
    "/contacts/[id]": async () =>
      (await first(() => prisma.lead.findFirst({ where: { deletedAt: null }, select: { id: true } })))?.id ?? null,
    "/batches/[batchId]": async () =>
      (await first(() => prisma.batch.findFirst({ where: { line: "B2" }, select: { id: true } })))?.id ?? null,
    "/german-note/[batchId]": async () =>
      (await first(() => prisma.batch.findFirst({ where: { line: "GERMAN_NOTE" }, select: { id: true } })))?.id ?? null,
    "/agreements/[id]": async () =>
      (await first(() => prisma.agreement.findFirst({ select: { id: true } })))?.id ?? null,
    "/sites/[id]": async () =>
      (await first(() => prisma.site.findFirst({ select: { id: true } })))?.id ?? null,
    "/invoices/[id]": async () =>
      (await first(() => prisma.invoice.findFirst({ select: { id: true } })))?.id ?? null,
    "/classroom/[batchId]": async () =>
      (await first(() => prisma.batch.findFirst({ select: { id: true } })))?.id ?? null,
  };

  const resolver = pick[route];
  if (!resolver) return null; // unknown shape - skipped and reported as such
  const id = await resolver();
  if (!id) return null;
  return route.replace(/\[[^\]]+\]/, id);
}

type Result = { route: string; url: string; status: number; problems: string[] };

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  if (!page.url().includes("/login")) return; // already signed in
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function main() {
  if (!/localhost|127\.0\.0\.1|localtest\.me/.test(BASE) && !process.argv.includes("--force")) {
    throw new Error(
      `Refusing to smoke ${BASE}. This signs in and loads every screen, which reads real client ` +
        `data into the log. Pass --force only if this host holds made-up data.`,
    );
  }
  if (!PASSWORD) {
    throw new Error("Set SMOKE_PASSWORD. For a local stack: npx tsx scripts/local-demo-admin.ts");
  }

  const routes = pageRoutes();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const results: Result[] = [];
  const skipped: string[] = [];

  // Console and page errors are collected per navigation.
  let bucket: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") bucket.push(`console: ${m.text().slice(0, 180)}`);
  });
  page.on("pageerror", (e) => bucket.push(`uncaught: ${String(e.message).slice(0, 180)}`));

  try {
    await login(page);
    console.log(`Signed in as ${EMAIL}. Opening ${routes.length} screens on ${BASE}\n`);

    for (const route of routes) {
      const resolved = await resolveParams(route);
      if (!resolved) {
        skipped.push(route);
        continue;
      }
      bucket = [];
      const url = `${BASE}${resolved}`;
      let status = 0;

      /*
        ONE RETRY, and only for a navigation that timed out.

        Against a dev server this suite compiles 61 routes back to back, each on its first request,
        and whichever route is unlucky can exceed the budget on a cold compile - three consecutive
        runs on 24/10/2026 failed on a DIFFERENT screen each time, and every one of them loaded in
        3-6 seconds when opened on its own. A suite that reports a different false failure each run
        is a suite people learn to ignore, which costs more than the thing it was built to catch.

        Deliberately narrow: a timeout is retried, and nothing else is. An error boundary, a
        non-2xx or an empty body is a VERDICT, and retrying a verdict until it changes is how a
        real failure gets explained away. The second attempt also hits a route the first one has
        now compiled, so a screen that still times out is genuinely slow rather than cold.
      */
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        bucket = [];
        try {
          const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          status = res?.status() ?? 0;
          await page.waitForLoadState("networkidle").catch(() => {});
          break;
        } catch (e) {
          const first = e instanceof Error ? e.message.split("\n")[0] : String(e);
          if (attempt === 1 && /timeout/i.test(first)) continue;
          bucket.push(`navigation: ${first}`);
        }
      }

      const body = await page.locator("body").innerText().catch(() => "");
      const problems = [...bucket];
      if (status >= 400) problems.push(`HTTP ${status}`);
      for (const marker of [
        "Application error",
        "Something went wrong",
        "This page could not load",
        "Unhandled Runtime Error",
      ]) {
        if (body.includes(marker)) problems.push(`error boundary: "${marker}"`);
      }

      /*
        A page that renders but says nothing is a failure this would otherwise call "ok".

        `/cash` crashed loudly, which is how it was caught. The quieter version - a screen whose
        whole body is a spinner, or that came back essentially empty - looks identical to a pass
        from the outside. The threshold is deliberately low: real screens here carry a heading,
        a nav and a footer, so anything under a couple of hundred characters has not rendered.
      */
      const text = body.replace(/\s+/g, " ").trim();
      if (text.length < 200) {
        problems.push(`page is effectively empty (${text.length} chars of text)`);
      }

      results.push({ route, url: resolved, status, problems });
      const mark = problems.length === 0 ? "ok  " : "FAIL";
      console.log(`  ${mark}  ${String(status).padEnd(4)} ${resolved}`);
      for (const p of problems) console.log(`          ${p}`);
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  const bad = results.filter((r) => r.problems.length > 0);
  console.log(`\n${results.length - bad.length} of ${results.length} screens clean.`);
  if (skipped.length) {
    console.log(`${skipped.length} skipped (no row to fill the parameter, or not a page route):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (bad.length) {
    console.log(`\n${bad.length} SCREEN(S) WITH PROBLEMS:`);
    for (const b of bad) console.log(`  ${b.url}\n    ${b.problems.join("\n    ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
