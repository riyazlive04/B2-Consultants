/**
 * End-to-end check of the visual funnel builder, driven headlessly.
 *
 * Exists because everything below the page's HTML - click-to-select, inline typing, drag, the
 * autosave debounce - is invisible to a `curl`. The canvas was shipped verified only by typecheck
 * and a production build, which proves it compiles and proves nothing about whether it works.
 *
 *   npm run e2e:builder            # against the dev server on :3000
 *   BASE_URL=… npm run e2e:builder
 *
 * Reads credentials from SEED_ADMIN_EMAIL / E2E_PASSWORD, so no password is written down here.
 * Points at localhost by default and refuses a non-local BASE_URL without --force: this logs in
 * and EDITS A PAGE, which is not something to do to production by accident.
 */

import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "ameen@b2consultants.in";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const FUNNEL_SLUG = "vsl-funnel";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // The form is a client component; submitting before React hydrates does nothing at all and
  // looks exactly like a wrong password. Waiting for the network to settle is the cheap proxy.
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  } catch {
    // Surface what the form actually said rather than a bare timeout - "Invalid email or
    // password" and "the button never wired up" are different problems with the same symptom.
    const shown = await page.locator("body").innerText();
    const msg = shown.split("\n").find((l) => /invalid|incorrect|error|failed/i.test(l)) ?? "(no message on screen)";
    throw new Error(`Login did not navigate. Page says: ${msg}`);
  }
}

async function main() {
  if (!PASSWORD) throw new Error("Set E2E_PASSWORD (the local dev password) before running.");
  if (!/localhost|127\.0\.0\.1/.test(BASE) && !process.argv.includes("--force")) {
    throw new Error(`BASE_URL is ${BASE} - this test EDITS a funnel page. Pass --force if you really mean it.`);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Hydration mismatches surface as console errors, not exceptions - the class of bug that hit
  // the mobile-override <style> tags. Worth failing on rather than hoping someone reads the log.
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  try {
    await login(page);
    check("login", true, EMAIL);

    // Reach the builder through the UI, not by a guessed id - that also tests the funnels list.
    await page.goto(`${BASE}/funnels`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /VSL Funnel/i }).first().click();
    await page.waitForURL(/\/funnels\/[a-z0-9]+/i, { timeout: 20_000 });
    check("builder opens", true, new URL(page.url()).pathname);

    // Wait for the canvas rather than counting immediately: the builder is a client component, so
    // on a cold dev-server compile the nodes appear a beat after the route resolves. Counting
    // straight away measured how fast the machine was, not whether the canvas works.
    await page.locator("[data-n]").first().waitFor({ state: "attached", timeout: 30_000 });
    const nodeCount = await page.locator("[data-n]").count();
    check("canvas rendered the page", nodeCount > 50, `${nodeCount} nodes`);

    // ── click-to-select ────────────────────────────────────────────────────────
    const heading = page.locator('[data-t="heading"]').first();
    const headingText = (await heading.innerText()).trim();
    await heading.click();
    // The inspector header names the selected node type - a far better assertion than hunting
    // for a tab label, which also matches the word "Styles" elsewhere on the page.
    const inspector = page.getByRole("complementary").getByText("Heading", { exact: true });
    check("click selects a node", await inspector.isVisible(), `selected "${headingText.slice(0, 40)}"`);

    const outlined = await heading.evaluate((el) => getComputedStyle(el).outlineWidth);
    check("selection is outlined", outlined !== "0px", `outline-width ${outlined}`);

    // ── inline typing ──────────────────────────────────────────────────────────
    const editable = await heading.getAttribute("contenteditable");
    check("heading became editable", editable === "true", `contenteditable=${editable}`);

    const typed = `${headingText} EDITED`;
    await heading.evaluate((el, t) => { (el as HTMLElement).innerText = t; }, typed);
    await heading.blur();
    await page.waitForTimeout(300);
    const after = (await heading.innerText()).trim();
    check("inline edit committed", after === typed, `"${after.slice(-24)}"`);

    // ── autosave ───────────────────────────────────────────────────────────────
    // Wait for the STATE, not for a duration. A fixed sleep raced the 1.5s debounce plus the
    // round-trip and caught the indicator mid-"Saving…" - a green test on a slower machine and a
    // red one here, which is worse than no test.
    const status = page.getByText(/Unsaved changes|Saving…|All changes saved/).first();
    await status.filter({ hasText: "All changes saved" }).waitFor({ timeout: 15_000 }).catch(() => {});
    const statusText = (await status.innerText()).trim();
    check("autosave reached a saved state", /All changes saved/.test(statusText), statusText);

    // Persisted? Reload and read it back - the only proof that matters.
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = (await page.locator('[data-t="heading"]').first().innerText()).trim();
    check("edit survived a reload", reloaded === typed, `"${reloaded.slice(-24)}"`);

    // ── put it back ────────────────────────────────────────────────────────────
    const h2 = page.locator('[data-t="heading"]').first();
    await h2.click();
    await h2.evaluate((el, t) => { (el as HTMLElement).innerText = t; }, headingText);
    await h2.blur();
    await page.waitForTimeout(2500);
    const restored = (await page.locator('[data-t="heading"]').first().innerText()).trim();
    check("restored the original copy", restored === headingText, `"${restored.slice(0, 40)}"`);

    // ── device toggle ──────────────────────────────────────────────────────────
    await page.getByLabel("Phone view").click();
    await page.waitForTimeout(400);
    const width = await page.locator('[data-t="section"]').first().evaluate((el) => el.getBoundingClientRect().width);
    check("phone view narrows the canvas", width < 420, `${Math.round(width)}px`);

    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  } finally {
    await page.screenshot({ path: "e2e-builder.png", fullPage: false }).catch(() => {});
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
