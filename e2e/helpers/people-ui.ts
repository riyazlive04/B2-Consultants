import { expect, Locator, Page, Download } from "@playwright/test";
import * as fs from "fs";

/**
 * UI helpers for the People / Students area.
 *
 * The app renders its own dropdowns (SelectMenu) and date pickers (DatePicker) on top of a hidden
 * native <select>/<input type="date"> that carries the form value. Selects are driven through the
 * real popover (click trigger, click option). Dates are written into the hidden input the same way
 * the picker's own commit() does (native setter + input/change events), because clicking through a
 * month grid to 2023-12-01 adds nothing but flake.
 */

/** Open a SelectMenu whose hidden <select> is `select`, then click the option by visible label. */
export async function chooseOption(page: Page, select: Locator, optionLabel: string | RegExp) {
  const trigger = select.locator("xpath=following-sibling::button[1]");
  await trigger.click();
  const opt = page.getByRole("option", { name: optionLabel, exact: typeof optionLabel === "string" });
  await opt.first().click();
}

/** Same, for a SelectMenu found by its aria-label (filter bars, status pickers). */
export async function chooseByAria(page: Page, ariaLabel: string, optionLabel: string | RegExp, scope?: Locator) {
  const root = scope ?? page;
  await root.getByRole("button", { name: ariaLabel, exact: true }).first().click();
  await page.getByRole("option", { name: optionLabel, exact: typeof optionLabel === "string" }).first().click();
}

/** Write YYYY-MM-DD into a DatePicker's hidden input (what the picker's commit() does). */
export async function setDate(input: Locator, ymd: string) {
  await input.evaluate((el: HTMLInputElement, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, ymd);
}

export async function openTab(page: Page, name: RegExp | string) {
  const tab = page.getByRole("tab", { name });
  await tab.first().click();
  await expect(tab.first()).toHaveAttribute("aria-selected", "true");
}

/** The big number on a MetricCard, found by its label (the label span carries title=label). */
export function metricCard(page: Page, label: string): Locator {
  return page.locator("button", { has: page.locator(`span[title="${label}"]`) }).first();
}
export async function metricText(page: Page, label: string): Promise<string> {
  return (await metricCard(page, label).locator("div.font-display").first().innerText()).trim();
}
export async function metricNumber(page: Page, label: string): Promise<number> {
  const t = await metricText(page, label);
  const n = Number(t.replace(/[^\d.-]/g, ""));
  if (Number.isNaN(n)) throw new Error(`metric "${label}" is not a number: ${t}`);
  return n;
}
/** Open a MetricCard's detail modal and read its rows as {label: value}. */
export async function metricDetail(page: Page, label: string): Promise<Record<string, string>> {
  await metricCard(page, label).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  const rows = await dlg.locator("li").evaluateAll((lis) =>
    lis.map((li) => {
      const spans = li.querySelectorAll(":scope > span");
      return [spans[0]?.textContent?.trim() ?? "", spans[1]?.textContent?.trim() ?? ""];
    }),
  );
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  return Object.fromEntries(rows);
}

/** Confirm an askConfirm() dialog by its confirm label. */
export async function confirmDialog(page: Page, confirmLabel: string | RegExp) {
  const dlg = page.getByRole("dialog").last();
  await dlg.getByRole("button", { name: confirmLabel }).click();
}

/** Save a download and return its text (BOM stripped). */
export async function downloadText(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string; path: string }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const p = await (dl as Download).path();
  const text = fs.readFileSync(p!, "utf8").replace(/^﻿/, "");
  return { name: dl.suggestedFilename(), text, path: p! };
}

/** Minimal RFC4180 CSV parser (papaparse output: quoted fields, "" escapes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** IST calendar helpers computed in the TEST process (independent of the browser timezone). */
export function istNow(): { ymd: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** DD/MM/YYYY - the app's formatDate(). */
export const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
/** Monday (YYYY-MM-DD) of the ISO week containing ymd. */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
