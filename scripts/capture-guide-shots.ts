/**
 * Capture the App Guide's screenshots, from the real screens, repeatably.
 *
 *   npm run guide:shots                       # against the dev server on :3000
 *   BASE_URL=… npm run guide:shots
 *   npm run guide:shots -- --only=onboarding  # one shot while you iterate on it
 *   npm run guide:shots -- --manual           # every per-section manual shot (see runManual)
 *   npm run guide:shots -- --manual --only=payments
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
import { MANUALS } from "../src/lib/guide/manual";
import { SECTION_CATALOGUE } from "../src/lib/sections";
import type { GuideShotSpec } from "../src/lib/guide/manual-types";
import type { CapturedShot } from "../src/lib/guide/shots.generated";

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

async function login(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // The form is a client component: submitting before React hydrates does nothing at all, and
  // looks exactly like a wrong password.
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
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

/**
 * -- --manual: the per-section manuals' screenshots ---------------------------------------
 * The manuals name their own shots (`GuideFeature.shot` in lib/guide/manual-*.ts): a route, a
 * caption, and the visible text of the ONE control to box. This mode walks every one of them,
 * finds that control on the live page, scrolls it into view, and records its box in percent of
 * the picture - so the highlight is measured, never typed, and a re-capture after a redesign
 * moves the box with the button.
 *
 * Output: public/guide/manual/<name>.jpg plus src/lib/guide/shots.generated.ts. JPEG at 1x
 * rather than PNG at 2x because there are ~200 of these inside the image the VPS pulls, and a UI
 * capture at quality 82 is a tenth of the size and indistinguishable at the width it is shown.
 *
 * Student-only screens (Dashboard, My Journey, My Classroom) refuse a staff login by design, so
 * they are captured in a second pass as the seeded demo student (STUDENT_EMAIL / STUDENT_PASSWORD,
 * defaulting to the ones `scripts/seed-role-logins.ts` creates).
 */
const MANUAL_OUT = path.join(OUT, "manual");
const MANIFEST = path.join(process.cwd(), "src", "lib", "guide", "shots.generated.ts");
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "gn.student.demo@b2consultants.in";
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD ?? "hallo-2026";

type ManualShot = GuideShotSpec & { section: string };

function manualShots(): ManualShot[] {
  return MANUALS.flatMap((m) =>
    m.features.flatMap((f) => (f.shot ? [{ ...f.shot, section: m.section as string }] : [])),
  );
}

function readManifest(): Record<string, CapturedShot> {
  if (!fs.existsSync(MANIFEST)) return {};
  const body = fs.readFileSync(MANIFEST, "utf8");
  const json = body.slice(body.indexOf("= {") + 2, body.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json) as Record<string, CapturedShot>;
  } catch {
    return {};
  }
}

function writeManifest(entries: Record<string, CapturedShot>) {
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  const head = fs.readFileSync(MANIFEST, "utf8").split("export const MANUAL_SHOTS")[0];
  fs.writeFileSync(
    MANIFEST,
    head + "export const MANUAL_SHOTS: Record<string, CapturedShot> = " + JSON.stringify(sorted, null, 2) + ";\n",
  );
}

/**
 * `[first]` stands for "whatever the first record on that list is", so a manual can point at a
 * detail screen without naming a record that only exists in one person's seed data.
 *
 * It appears in two shapes, and both are resolved here:
 *   `/students/[first]`              - a path segment, as a detail route
 *   `/improvements?report=[first]`   - a query value, where the list and the detail are one screen
 */
async function resolveRoute(page: Page, route: string): Promise<string> {
  if (!route.includes("[first]")) return route;
  const [pathPart, queryPart] = route.split("?");
  const inQuery = Boolean(queryPart?.includes("[first]"));
  // The list to read ids from: the path itself when `[first]` is a query value, else its parent.
  const base = inQuery ? pathPart : pathPart.split("/[first]")[0];

  await page.goto(`${BASE}${base}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const key = inQuery
    ? new URLSearchParams(queryPart).entries().next().value?.[0] ?? ""
    : "";
  const selector = inQuery ? `a[href*="${key}="]` : `a[href^="${base}/"]`;
  const hrefs = await page
    .locator(selector)
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));

  const idOf = (href: string): string => {
    if (inQuery) return new URLSearchParams(href.split("?")[1] ?? "").get(key) ?? "";
    return href.slice(base.length + 1).split(/[/?#]/)[0];
  };
  const id = hrefs.map(idOf).find((v) => v.length >= 8 && v !== "new");
  if (!id) throw new Error(`no record linked from ${base} to stand in for [first]`);
  return route.replace("[first]", id);
}

/** The control to box: a tab, button, link or heading with that name, else any visible text. */
async function findTarget(page: Page, text: string) {
  const tries = [
    page.getByRole("tab", { name: text, exact: true }),
    page.getByRole("button", { name: text, exact: true }),
    page.getByRole("link", { name: text, exact: true }),
    page.getByRole("heading", { name: text, exact: true }),
    page.getByText(text, { exact: true }),
    page.getByText(text),
  ];
  for (const t of tries) {
    const hit = t.filter({ visible: true }).first();
    if ((await hit.count()) > 0) return hit;
  }
  return null;
}

async function captureManual(page: Page, shot: ManualShot): Promise<CapturedShot> {
  const at = await resolveRoute(page, shot.route);
  await page.goto(`${BASE}${at}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);

  let hotspot: CapturedShot["hotspot"];
  if (shot.highlight) {
    const target = await findTarget(page, shot.highlight.text);
    if (!target) throw new Error(`"${shot.highlight.text}" is not on ${at}`);
    // Keep the top of the page in the picture when the control is already above the fold; only
    // scroll when it is not, and then leave a third of the window above it for context.
    const first = await target.boundingBox();
    if (first && first.y + first.height > DESKTOP.height - 40) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, first.y - DESKTOP.height / 3));
      await page.waitForTimeout(300);
    }
    const box = await target.boundingBox();
    if (box) {
      const pct = (v: number, of: number) => Math.round((v / of) * 1000) / 10;
      hotspot = {
        x: pct(Math.max(0, box.x - 4), DESKTOP.width),
        y: pct(Math.max(0, box.y - 4), DESKTOP.height),
        w: pct(box.width + 8, DESKTOP.width),
        h: pct(box.height + 8, DESKTOP.height),
      };
    }
  }

  const name = shot.file.replace(/\.png$/i, ".jpg");
  await page.screenshot({ path: path.join(MANUAL_OUT, name), type: "jpeg", quality: 82 });
  return { src: `/guide/manual/${name}`, width: DESKTOP.width, height: DESKTOP.height, hotspot };
}

async function runManual(only: string | undefined) {
  const personal = new Set(
    SECTION_CATALOGUE.filter((s) => "personal" in s && s.personal).map((s) => s.key as string),
  );
  const all = manualShots().filter((s) => !only || s.file.startsWith(only) || s.section === only);
  if (all.length === 0) throw new Error(`No manual shot matches "${only}".`);
  fs.mkdirSync(MANUAL_OUT, { recursive: true });
  const manifest = readManifest();

  const browser = await chromium.launch();
  let ok = 0;
  try {
    const passes = [
      { who: "staff", email: EMAIL, password: PASSWORD, shots: all.filter((s) => !personal.has(s.section)) },
      { who: "student", email: STUDENT_EMAIL, password: STUDENT_PASSWORD, shots: all.filter((s) => personal.has(s.section)) },
    ];
    for (const pass of passes) {
      if (pass.shots.length === 0) continue;
      const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
      const page = await context.newPage();
      try {
        await login(page, pass.email, pass.password);
      } catch (e) {
        console.log(`  SKIP  all ${pass.shots.length} ${pass.who} shots - ${e instanceof Error ? e.message : e}`);
        await context.close();
        continue;
      }
      console.log(`Signed in as ${pass.email}. ${pass.shots.length} ${pass.who} shots.`);
      for (const shot of pass.shots) {
        try {
          const done = await captureManual(page, shot);
          manifest[shot.file] = done;
          ok += 1;
          console.log(`  ok    ${shot.file.padEnd(44)} ${done.hotspot ? "" : "(no box)"}`);
        } catch (e) {
          console.log(`  SKIP  ${shot.file.padEnd(44)} ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  writeManifest(manifest);
  console.log(`\n${ok} of ${all.length} manual shots captured; manifest written to src/lib/guide/shots.generated.ts`);
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
  if (process.argv.includes("--manual")) return runManual(only);

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
