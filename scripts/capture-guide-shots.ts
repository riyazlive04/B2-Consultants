/**
 * Capture the App Guide's screenshots, from the real screens, repeatably.
 *
 *   npm run guide:shots                       # against the dev server on :3000
 *   BASE_URL=… npm run guide:shots
 *   npm run guide:shots -- --only=onboarding  # one shot while you iterate on it
 *
 * ── Why a script and not a folder of hand-taken PNGs ────────────────────────────────────
 * The guide asks for "real screen shots and navigation indication". Pasted-in screenshots rot:
 * the first nav change makes them lies, and nobody can tell which of twenty images are stale.
 * This is the opposite - the images are an output, so refreshing the whole set after a redesign
 * is one command, and `git status` shows exactly which screens moved.
 *
 * The highlight boxes are NOT drawn into the images. They live beside each shot in
 * `lib/guide-content.ts` as percentages of the image (`GuideShot.hotspot`), so a re-capture at a
 * different window size cannot move a box off its target. Drawing them in would mean re-editing
 * every picture by hand the moment a button moved.
 *
 * ── LOCAL ONLY, and it refuses otherwise ────────────────────────────────────────────────
 * These images ship inside the app, so a capture against production would publish real clients'
 * names, phone numbers and fees into `public/`. The guard below is the whole reason this is a
 * script with an opinion rather than a one-line playwright call.
 *
 * KNOWN TRAP (docs/refactor/04-refactor-plan.md, step F2): every Claude session on this machine
 * shares one Chrome profile directory, so a run can fail with a profile lock while another
 * session has a browser open. That is why this launches its own browser rather than attaching to
 * one, and why the error below says so explicitly instead of leaving you guessing.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "ameen@b2consultants.in";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const OUT = path.join(process.cwd(), "public", "guide");

/** Phone-width captures as well, for the screens people actually use on a phone. */
const DESKTOP = { width: 1440, height: 900 };

type Shot = {
  /** File name, without extension. Must match the `src` in lib/guide-content.ts. */
  name: string;
  /** Path to open, relative to BASE. */
  at: string;
  /**
   * A selector to wait for before the shutter. Every one of these pages is `force-dynamic` and
   * server-rendered, so "networkidle" alone can catch a skeleton mid-render.
   */
  settleOn?: string;
  /** Capture just this element rather than the viewport - for a panel inside a long page. */
  clip?: string;
  /** Full scrolling page rather than the fold. Off by default: the fold is what the guide shows. */
  fullPage?: boolean;
};

/**
 * ── The shot list ───────────────────────────────────────────────────────────────────────
 * One entry per screen the guide points at, in journey order - the same order
 * `GUIDE_JOURNEYS["onboard-a-student"]` walks, so a reader following the walkthrough sees the
 * screens in the sequence they will meet them.
 *
 * Adding a shot here does not put it in the guide: the matching `shots: [{ src, caption,
 * hotspot }]` has to go on the entry in `lib/guide-content.ts`, which is where the caption and
 * the highlight box live. The `--list` flag prints the names so they can be copied across.
 */
const SHOTS: Shot[] = [
  { name: "onboarding-board", at: "/onboarding", settleOn: "h1" },
  { name: "onboarding-wizard", at: "/onboarding/new", settleOn: "form" },
  { name: "contacts", at: "/contacts", settleOn: "h1" },
  { name: "bookings", at: "/bookings", settleOn: "h1" },
  { name: "pipeline", at: "/pipeline", settleOn: "h1" },
  { name: "deals-board", at: "/opportunities", settleOn: "h1" },
  { name: "agreements", at: "/agreements", settleOn: "h1" },
  { name: "agreement-new", at: "/agreements/new", settleOn: "form" },
  { name: "students", at: "/students", settleOn: "h1" },
  { name: "batches", at: "/batches", settleOn: "h1" },
  { name: "finance-income", at: "/finance", settleOn: "h1" },
  { name: "payments", at: "/payments", settleOn: "h1" },
  { name: "attendance", at: "/attendance", settleOn: "h1" },
  { name: "coaching", at: "/coaching", settleOn: "h1" },
  { name: "my-desk", at: "/my-desk", settleOn: "h1" },
  { name: "whatsapp", at: "/whatsapp", settleOn: "h1" },
  { name: "console-not-armed", at: "/console", settleOn: "h1" },
  { name: "guide", at: "/guide", settleOn: "h1" },
];

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // The form is a client component: submitting before React hydrates does nothing at all, and
  // looks exactly like a wrong password.
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  } catch {
    const shown = await page.locator("body").innerText();
    const msg =
      shown.split("\n").find((l) => /invalid|incorrect|error|failed/i.test(l)) ?? "(no message on screen)";
    throw new Error(`Login did not navigate. Page says: ${msg}`);
  }
}

async function capture(page: Page, shot: Shot): Promise<string> {
  await page.goto(`${BASE}${shot.at}`, { waitUntil: "domcontentloaded" });
  if (shot.settleOn) {
    await page.waitForSelector(shot.settleOn, { timeout: 30_000 });
  }
  await page.waitForLoadState("networkidle").catch(() => {
    /* A page holding a long poll never goes idle - the selector above is the real signal. */
  });
  /*
    Entrance animations. `.row-in` staggers list rows in, and a shutter fired mid-stagger catches
    half a table at half opacity. Waiting is cheaper and steadier than disabling the animation,
    which would mean a capture of a page nobody actually sees.
  */
  await page.waitForTimeout(600);

  const file = path.join(OUT, `${shot.name}.png`);
  const target = shot.clip ? page.locator(shot.clip).first() : page;
  await target.screenshot({ path: file, ...(shot.clip ? {} : { fullPage: shot.fullPage ?? false }) });
  return file;
}

async function main() {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

  if (process.argv.includes("--list")) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(24)} ${s.at}`);
    console.log(`\n${SHOTS.length} shots. Reference one from lib/guide-content.ts as:`);
    console.log(`  shots: [{ src: "/guide/<name>.png", caption: "…", hotspot: { x, y, w, h, label } }]`);
    return;
  }

  /*
    THE GUARD. These images are committed into `public/` and served inside the app, so a capture
    against the live system would publish real clients' names, numbers and fees. `--force` exists
    for a staging copy with made-up data, and is deliberately awkward to type.
  */
  if (!/localhost|127\.0\.0\.1|localtest\.me/.test(BASE) && !process.argv.includes("--force")) {
    throw new Error(
      `Refusing to capture against ${BASE}. These images ship inside the app, so they must come ` +
        `from local data with made-up names - never from production. Pass --force only if you are ` +
        `certain this host holds no real client data.`,
    );
  }
  if (!PASSWORD) throw new Error("Set E2E_PASSWORD (the local dev password) before running.");

  const todo = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
  if (todo.length === 0) throw new Error(`No shot called "${only}". Run with --list to see the names.`);

  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not start Chromium: ${msg}\n` +
        `If this mentions a profile or a lock, another session on this machine has a browser ` +
        `open on the shared profile directory - close it and run again.`,
    );
  });
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await context.newPage();

  let ok = 0;
  try {
    await login(page);
    console.log(`Signed in as ${EMAIL}. Capturing ${todo.length} shot${todo.length === 1 ? "" : "s"} into public/guide/\n`);
    for (const shot of todo) {
      try {
        const file = await capture(page, shot);
        ok += 1;
        console.log(`  ok    ${shot.name.padEnd(24)} ${path.relative(process.cwd(), file)}`);
      } catch (e) {
        // One unreachable screen must not cost the other seventeen. A section switched off for
        // this account, or a route mid-rename, is a normal reason for one of these to fail.
        console.log(`  SKIP  ${shot.name.padEnd(24)} ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${ok} of ${todo.length} captured.`);
  if (ok < todo.length) {
    console.log("A skipped shot is usually a section this account cannot open, or a changed route.");
  }
  console.log("Reference them from lib/guide-content.ts - the caption and the highlight box live there.");
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
