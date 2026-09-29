/** Discovery (Level 2) UI helpers - usable against local AND prod (no DB here). */
import { expect, type Locator, type Page, type Browser } from "@playwright/test";
import { authFile, type RoleKey } from "./roles";
import { BASE_URL } from "../playwright.config";

/** A context for another role in the same test (e.g. Admin as the closer, Asma as the specialist). */
export async function pageAs(browser: Browser, role: RoleKey, opts: { timezoneId?: string } = {}) {
  const ctx = await browser.newContext({
    storageState: authFile(role),
    baseURL: BASE_URL,
    timezoneId: opts.timezoneId ?? "Asia/Kolkata",
    locale: "en-IN",
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** The app's custom SelectMenu: click the trigger, then the option. */
export async function pickOption(page: Page, trigger: Locator, optionText: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: optionText }).first().click();
}

// ─────────────────────────────── popups ───────────────────────────────

const handled = new WeakSet<Page>();
/**
 * The app greets a telecaller once a day ("Good day, Asma - N calls to make today") and the L2 desk
 * pops "New lead just came in" when a lead is assigned. Both are modal and block every click, so
 * dismiss them whenever they appear.
 */
export async function installPopupHandlers(page: Page) {
  if (handled.has(page)) return;
  handled.add(page);
  await page.addLocatorHandler(page.getByRole("dialog").filter({ hasText: "calls to make today" }), async (d) => {
    await d.getByRole("button", { name: "Dismiss" }).click();
  });
  await page.addLocatorHandler(page.getByRole("dialog").filter({ hasText: "New lead just came in" }), async (d) => {
    await d.getByRole("button", { name: "Later" }).click();
  });
}

// ─────────────────────────────── My Desk (L2) ───────────────────────────────

export async function openDesk(page: Page) {
  await installPopupHandlers(page);
  await page.goto("/my-desk");
  await expect(page.getByRole("heading", { name: /Today's calls/i })).toBeVisible();
}

/** One call row on "Today's calls", found by the lead's (RUN-tagged) name. */
export function deskCallRow(page: Page, name: string) {
  return page.locator("li").filter({ has: page.getByRole("link", { name, exact: true }) }).first();
}

export async function recordOutcomeOnDesk(
  page: Page,
  name: string,
  outcome: "QUALIFIED_FOR_SSS" | "NOT_QUALIFIED_FOR_SSS" | "SENT_TO_WORKSHOP" | "FOLLOW_UP_NEEDED" | "NO_SHOW",
  opts: { notes?: string; highlyQualified?: boolean; sssAt?: string } = {},
) {
  const row = deskCallRow(page, name);
  await row.getByRole("button", { name: "Record outcome" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText(`Record outcome - ${name}`);
  const radioLabel: Record<string, RegExp> = {
    QUALIFIED_FOR_SSS: /Ready - route to Level 3/,
    SENT_TO_WORKSHOP: /Needs more understanding - workshop/,
    NOT_QUALIFIED_FOR_SSS: /Not qualified - close/,
  };
  if (radioLabel[outcome]) await dlg.locator("label").filter({ hasText: radioLabel[outcome] }).click();
  if (outcome === "FOLLOW_UP_NEEDED") await dlg.getByRole("button", { name: "Follow-up needed" }).click();
  if (outcome === "NO_SHOW") await dlg.getByRole("button", { name: "No show" }).click();
  if (opts.highlyQualified) await dlg.locator("label").filter({ hasText: /^Highly qualified$/ }).click();
  if (opts.notes) await dlg.getByPlaceholder("What should Level 3 know?").fill(opts.notes);
  // The SSS time the specialist agreed on the call (added with the DSC-01 fix): IST wall-clock,
  // "YYYY-MM-DDTHH:mm". Only rendered on the Level 3 route.
  if (opts.sssAt) await dlg.locator('input[type="datetime-local"][name="sssAt"]').fill(opts.sssAt);
  return dlg;
}

export async function submitRouteModal(page: Page) {
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Record outcome" }).click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
}

// ─────────────────────────────── Outreach queue ───────────────────────────────

export function queueCard(page: Page, name: string) {
  return page.locator("div.rounded-card").filter({ has: page.locator("p.font-display", { hasText: name }) }).first();
}

export async function openOutreach(page: Page) {
  await installPopupHandlers(page);
  await page.goto("/outreach");
  await expect(page.getByRole("heading", { name: "Outreach" })).toBeVisible();
}

/** Reload /outreach until the prospect's card shows `nextLabel` as its actionable step. */
export async function waitForNextStep(page: Page, name: string, nextLabel: string | RegExp, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await openOutreach(page);
    const card = queueCard(page, name);
    if ((await card.count()) && (await card.locator("span.rounded-full.bg-accent-soft").filter({ hasText: nextLabel }).count())) return card;
    if (Date.now() > deadline) {
      const txt = (await card.count()) ? await card.innerText() : "(no card)";
      throw new Error(`queue card for ${name} never showed next step ${nextLabel}. Card:\n${txt}`);
    }
    await page.waitForTimeout(1500);
  }
}

/** Click a step action on the card, then wait for the server action round-trip to settle. */
export async function clickStepAction(page: Page, card: Locator, button: string | RegExp) {
  await card.getByRole("button", { name: button }).first().click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1200);
}

export async function setZoomLinkOnCard(page: Page, card: Locator, url: string) {
  await card.getByRole("button", { name: /Details & overrides/ }).click();
  await card.getByPlaceholder("https://zoom.us/j/…").fill(url);
  await card.locator("form").filter({ has: page.getByPlaceholder("https://zoom.us/j/…") }).getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1500);
}

// ─────────────────────────────── Bookings ───────────────────────────────

export async function openSssCalendar(page: Page, weekKey?: string) {
  await installPopupHandlers(page);
  await page.goto(weekKey ? `/bookings?week=${weekKey}` : "/bookings");
  await page.getByRole("tab", { name: "SSS Calendar" }).click();
  await expect(page.getByText(/Needs an SSS time \(\d+\)/)).toBeVisible();
}

/** An SSS slot cell by its IST "HH:MM · NNm" label inside the day column for `dayKey`. */
export function sssSlotCell(page: Page, timeIst: string) {
  return page.locator("div.group\\/cell").filter({ hasText: `${timeIst} · 45m` });
}

/** A Booking requests row, filtered by name (the table paginates). */
export async function bookingsRow(page: Page, name: string) {
  await installPopupHandlers(page);
  if (!/\/bookings/.test(page.url())) await page.goto("/bookings");
  const filter = page.getByPlaceholder("Filter bookings…");
  await filter.fill(name);
  const row = page.locator("tr").filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  return row;
}
