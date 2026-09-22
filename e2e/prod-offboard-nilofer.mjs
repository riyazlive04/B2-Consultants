/**
 * Production: offboard Nilofer and hand her open work to Asma (People > Team & org chart > Offboard).
 * Dry run by default: walks the dialog to the confirm step, prints what it would hand over, and
 * closes without confirming. --apply clicks "Offboard Nilofer". Not a spec: a one-off operation.
 */
import { chromium } from "playwright";
import * as fs from "fs";

const BASE = "https://b2app.sirahagents.com";
const APPLY = process.argv.includes("--apply");
const { admin } = JSON.parse(fs.readFileSync("creds.prod.json", "utf8"));

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, timezoneId: "Asia/Kolkata" });
const res = await ctx.request.post("/api/auth/sign-in/email", { data: { email: admin.email, password: admin.password }, headers: { Origin: BASE } });
if (!res.ok()) throw new Error(`admin sign-in failed: ${res.status()}`);
const page = await ctx.newPage();
await page.goto("/people", { timeout: 120_000 });
const tab = page.getByRole("tab", { name: /^Team & org chart/ });
await tab.waitFor({ timeout: 120_000 });
await tab.click();
await page.waitForTimeout(2000);

const offboardBtns = page.getByRole("button", { name: "Offboard" });
const cards = page.locator("div").filter({ has: page.getByRole("button", { name: "Offboard" }) }).filter({ hasText: "Nilofer" });
// The smallest element that holds both Nilofer's name and an Offboard button is her card.
console.log("offboard buttons on page:", await offboardBtns.count(), "| cards containing Nilofer:", await cards.count());
const card = cards.last();
if (!(await card.count())) throw new Error("no Nilofer card with an Offboard button (already offboarded?)");
console.log("card:", (await card.innerText()).replace(/\s*\n\s*/g, " | ").slice(0, 200));
await card.getByRole("button", { name: "Offboard" }).click();

const dlg = page.getByRole("dialog");
await dlg.waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);
console.log("STEP 1 (what she did):", (await dlg.innerText()).replace(/\s*\n\s*/g, " | ").slice(0, 700));
await dlg.getByRole("button", { name: "Continue" }).click();
await page.waitForTimeout(1000);
console.log("STEP 2 (what she holds):", (await dlg.innerText()).replace(/\s*\n\s*/g, " | ").slice(0, 900));

const give = dlg.getByText("Give them to the successor");
if (await give.count()) await give.click();
await dlg.getByLabel("Successor").click();
const asma = page.getByRole("option", { name: /^Asma/ });
if ((await asma.count()) !== 1) throw new Error(`expected exactly one "Asma" successor option, found ${await asma.count()}`);
await asma.click();
await dlg.getByRole("button", { name: "Continue" }).click();
await page.waitForTimeout(1000);
console.log("STEP 3 (confirm):", (await dlg.innerText()).replace(/\s*\n\s*/g, " | ").slice(0, 600));

if (!APPLY) { console.log("\nDRY RUN - not confirmed."); await browser.close(); process.exit(0); }

await dlg.locator("textarea, input[type=text]").last().fill("Left the company. Leads handed to Asma.");
await dlg.getByRole("button", { name: /^Offboard Nilofer/ }).click();
await dlg.waitFor({ state: "hidden", timeout: 120_000 });
await page.reload();
await page.getByRole("tab", { name: /^Team & org chart/ }).click();
await page.waitForTimeout(2500);
console.log("AFTER:", (await page.locator("main").innerText()).match(/Nilofer[^\n]*\n?[^\n]*\n?[^\n]*/)?.[0]?.replace(/\n/g, " | "));
await page.screenshot({ path: "reports/prod-nilofer-offboarded.png", fullPage: true });
await browser.close();
