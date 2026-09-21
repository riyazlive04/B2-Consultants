import { expect, Locator, Page } from "@playwright/test";
import * as fs from "fs";
import { RUN } from "./app";

/**
 * Finance-area UI helpers. Everything here drives the REAL controls (custom DatePicker grid,
 * custom SelectMenu listbox, AmountPair inputs) the way a person does - no hidden-input pokes,
 * except where a spec explicitly says it is simulating a crafted request.
 */

export const IST = "Asia/Kolkata";
export const BERLIN = "Europe/Berlin";

/**
 * One tag for the whole `playwright test` invocation. helpers/app RUN is per worker PROCESS, and
 * Playwright replaces the worker after any failed test - which would rename every record a later
 * test in the same spec depends on. So the first worker writes its RUN to a file keyed by the
 * runner's pid (every worker's parent) and later workers reuse it.
 */
function stableRun(): string {
  const f = `reports/.finance-run-${process.ppid}`;
  try {
    return fs.readFileSync(f, "utf8").trim() || RUN;
  } catch {
    fs.mkdirSync("reports", { recursive: true });
    fs.writeFileSync(f, RUN);
    return RUN;
  }
}
export const FRUN = stableRun();
/** Tag for notes/vendor fields; also satisfies the app's name rule (letters, digits, . , ' - /). */
export const ftag = (s: string) => `${FRUN} ${s}`;
export const fname = ftag;

// ───────────────────────────── dates ─────────────────────────────

export type Ymd = { y: number; m: number; d: number };
export const pad = (n: number) => String(n).padStart(2, "0");
export const ymdStr = (v: Ymd) => `${v.y}-${pad(v.m)}-${pad(v.d)}`;
export const dmyStr = (v: Ymd) => `${pad(v.d)}/${pad(v.m)}/${v.y}`;
export const parseYmd = (s: string): Ymd => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { y, m, d };
};
/** Pure calendar arithmetic on a Y-M-D (no timezone involved). */
export function addDays(v: Ymd, days: number): Ymd {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export function addMonths(v: Ymd, months: number, day?: number): Ymd {
  const t = new Date(Date.UTC(v.y, v.m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: Math.min(day ?? v.d, last) };
}
/** Today's calendar date in a given IANA zone. */
export function todayIn(tz: string, at = new Date()): Ymd {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parseYmd(s);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Pick a date through the app's DatePicker popover: open it, step month by month with the
 * chevrons, click the day cell. Asserts the trigger then reads DD/MM/YYYY for that date.
 */
export async function pickDate(page: Page, trigger: Locator, v: Ymd) {
  await trigger.click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("grid") }).last();
  await expect(dialog).toBeVisible();
  for (let guard = 0; guard < 400; guard++) {
    const header = (await dialog.locator("span[id]").first().innerText()).trim(); // "September 2026"
    const [mName, yStr] = header.split(" ");
    const cur = Number(yStr) * 12 + MONTHS.indexOf(mName);
    const want = v.y * 12 + (v.m - 1);
    if (cur === want) break;
    await dialog.getByRole("button", { name: cur > want ? "Previous month" : "Next month" }).click();
  }
  const lead = (new Date(Date.UTC(v.y, v.m - 1, 1)).getUTCDay() + 6) % 7; // Monday-first grid
  const cell = dialog.getByRole("gridcell").nth(lead + v.d - 1);
  await expect(cell).toHaveText(String(v.d));
  await cell.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toContainText(dmyStr(v));
}

/** Trigger button of a DatePicker by the hidden input's name. */
export const dateTrigger = (scope: Locator, name: string) => scope.locator(`input[type="date"][name="${name}"] + button`);
/** Trigger button of a SelectMenu by the hidden select's name. */
export const selectTrigger = (scope: Locator, name: string) => scope.locator(`select[name="${name}"] + button`);

export async function pickOption(page: Page, trigger: Locator, label: string) {
  await trigger.click();
  const opt = page.getByRole("option", { name: label, exact: true });
  await opt.click();
  await expect(trigger).toContainText(label);
}

/** Options offered by a SelectMenu (read from its hidden native select). */
export async function selectOptions(scope: Locator, name: string): Promise<string[]> {
  return scope.locator(`select[name="${name}"] option`).allInnerTexts();
}

// ───────────────────────────── money ─────────────────────────────

const clean = (s: string) => s.replace(/[  \s]/g, "").replace(/[−–]/g, "-");

/** "₹1,23,456.78" / "-₹500" → paise. */
export function parseInr(s: string): number {
  const c = clean(s);
  const neg = c.includes("-");
  const n = Number(c.replace(/[^\d.]/g, ""));
  return Math.round(n * 100) * (neg ? -1 : 1);
}
/** "1.234,56 €" → cents. */
export function parseEur(s: string): number {
  const c = clean(s);
  const neg = c.includes("-");
  const n = Number(c.replace(/[^\d,]/g, "").replace(",", "."));
  return Math.round(n * 100) * (neg ? -1 : 1);
}
/** PRD1 §6: Indian grouping, e.g. ₹1,00,000.99 */
export function isIndianInr(s: string, decimals = true): boolean {
  const c = clean(s).replace(/^-/, "");
  const re = decimals ? /^₹(\d{1,3}|\d{1,2}(,\d{2})*,\d{3})\.\d{2}$/ : /^₹(\d{1,3}|\d{1,2}(,\d{2})*,\d{3})$/;
  return re.test(c);
}
/** PRD1 §6: German grouping, e.g. 100.000,99 € */
export function isGermanEur(s: string, decimals = true): boolean {
  const c = clean(s).replace(/^-/, "");
  const re = decimals ? /^\d{1,3}(\.\d{3})*,\d{2}€$/ : /^\d{1,3}(\.\d{3})*€$/;
  return re.test(c);
}

// ───────────────────────────── page structure ─────────────────────────────

export async function gotoFinance(page: Page, query = "") {
  await page.goto(`/finance${query}`);
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
}

export async function openTab(page: Page, label: RegExp | string) {
  const tab = page.getByRole("tab", { name: label });
  await tab.first().click();
  await expect(tab.first()).toHaveAttribute("aria-selected", "true");
}

export const incomeForm = (page: Page | Locator) =>
  page.locator('form:has(input[name="studentName"]):has(select[name="paymentType"])').first();
export const expenseForm = (page: Page | Locator) =>
  page.locator('form:has(input[name="vendor"]):has(select[name="category"])').first();
export const pendingForm = (page: Page | Locator) =>
  page.locator('form:has(input[name="totalFeeInr"]):has(select[name="status"])').first();

/** Rows of the visible desktop table whose text contains `text`. */
export const tableRows = (page: Page | Locator, text: string | RegExp) =>
  // A filtered-empty DataTable renders "Nothing matches “<filter>”" INSIDE a tbody row - never count it.
  page.locator("table tbody tr").filter({ hasText: text }).filter({ hasNotText: "Nothing matches" });

/** Map header label → cell text for one table row. */
export async function rowByHeader(row: Locator): Promise<Record<string, string>> {
  const table = row.locator("xpath=ancestor::table[1]");
  const headers = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim().toUpperCase());
  const cells = await row.locator("td").allInnerTexts();
  const out: Record<string, string> = {};
  headers.forEach((h, i) => (out[h] = (cells[i] ?? "").trim()));
  return out;
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
}

/** Fill a DataTable filter box (scoped to the first table toolbar matching the placeholder). */
export async function filterTable(page: Page, placeholder: string | RegExp, text: string) {
  const box = page.getByPlaceholder(placeholder).first();
  await box.fill(text);
}

/** Answer the app's confirm dialog. */
export async function confirmDialog(page: Page, label: string | RegExp) {
  const dlg = page.getByRole("dialog").last();
  await dlg.getByRole("button", { name: label }).click();
}

// ───────────────────────────── KPI popups ─────────────────────────────

export type KpiRead = { primary: string; secondary: string | null; rows: Record<string, string> };

/**
 * Open a Finance KPI card's breakdown popup and read its full-precision headline + rows.
 * The cards themselves show compact (no-decimal) figures; the popup shows paise/cents.
 */
export async function readKpi(page: Page, label: string): Promise<KpiRead> {
  const card = page.locator("span[title]").filter({ hasText: new RegExp(`^${label}$`, "i") }).first();
  await card.click();
  const dlg = page.getByRole("dialog").last();
  await expect(dlg).toBeVisible();
  const head = dlg.locator("p.font-display").first();
  const primary = (await head.innerText()).trim();
  const secEl = head.locator("xpath=following-sibling::p[1]");
  const secondary = (await secEl.count()) ? (await secEl.innerText()).trim() : null;
  const rows: Record<string, string> = {};
  for (const li of await dlg.locator("ul li").all()) {
    const spans = li.locator(":scope > span");
    const k = (await spans.nth(0).innerText()).trim();
    const v = (await spans.nth(1).locator("span").first().innerText()).trim();
    rows[k] = v;
  }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  return { primary, secondary, rows };
}
