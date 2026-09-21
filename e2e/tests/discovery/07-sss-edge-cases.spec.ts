/**
 * SSS calendar edge cases (Bookings -> SSS Calendar, Admin): double booking one slot, booking a slot
 * in the past, and a Europe/Berlin browser reading the grid.
 *
 * Local driver: prospects in "Needs an SSS time" can only be created in the DB (DSC-01).
 * Prod: the Berlin read-only check runs; the rest skip.
 */
import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { RUN } from "../../helpers/app";
import { openSssCalendar, pageAs } from "../../helpers/discovery-ui";
import {
  seedSssProspect, seedSssSlot, sssSlotRow, journeyRow, stepMap, runOutreachCron, ensureOutreachEngineEnabledLocal,
  closeDiscoveryDb, istDayKey, H, M, minutesLeftTodayIst,
} from "../../helpers/discovery-db";

test.use({ storageState: authFile("admin") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });
test.beforeAll(async () => { if (HAS_DB) await ensureOutreachEngineEnabledLocal(); });

const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(d);
const needsBox = (page: import("@playwright/test").Page) => page.locator("div.rounded-card").filter({ hasText: /Needs an SSS time/ });
const openCell = (page: import("@playwright/test").Page, at: Date) =>
  page.locator("div.group\\/cell").filter({ hasText: `${hm(at)} · 45m` }).first();

async function armBook(page: import("@playwright/test").Page, name: string) {
  const chip = needsBox(page).locator("div[draggable=true]").filter({ hasText: name });
  await chip.getByRole("button", { name: "Book" }).click();
  await expect(page.getByText(/Placing/)).toBeVisible();
}

test("one SSS slot cannot be booked by two prospects", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!HAS_DB, "local driver only (DSC-01)");
  const at = new Date(Math.floor((Date.now() + 26 * H) / M) * M + 7 * M);
  const a = await seedSssProspect({ label: "SSS double A", sssAt: at, withSlot: false });
  const b = await seedSssProspect({ label: "SSS double B", sssAt: at, withSlot: false });
  const slot = await seedSssSlot({ startsAt: at });

  await openSssCalendar(page, istDayKey(at));
  await expect(needsBox(page)).toContainText(a.lead.name);
  await expect(needsBox(page)).toContainText(b.lead.name);

  await armBook(page, a.lead.name);
  await openCell(page, at).getByText("Open", { exact: true }).dispatchEvent("click");
  await expect(page.getByText("Booked into the slot").first()).toBeVisible({ timeout: 30_000 });
  expect((await sssSlotRow(slot)).journeyId).toBe(a.journeyId);
  expect((await journeyRow(a.journeyId)).sssAt.getTime(), "journey time follows the slot").toBe(at.getTime());

  await page.reload();
  await page.getByRole("tab", { name: "SSS Calendar" }).click();
  await armBook(page, b.lead.name);
  // The booked cell is not a drop target; clicking the prospect name there must not place B.
  await openCell(page, at).click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(2000);
  const row = await sssSlotRow(slot);
  expect(row.journeyId, "the slot still holds prospect A").toBe(a.journeyId);
  expect((await journeyRow(b.journeyId)).sssAt, "B was not booked").toBeNull();
});

test("an SSS slot in the past cannot be booked", async ({ page, request }) => {
  test.setTimeout(240_000);
  test.skip(!HAS_DB, "local driver only (DSC-01)");
  test.skip(minutesLeftTodayIst() > 24 * 60 - 150, "needs a past slot earlier today (IST)");
  const past = new Date(Math.floor((Date.now() - 2 * H) / M) * M + 3 * M);
  const c = await seedSssProspect({ label: "SSS past slot", sssAt: past, withSlot: false });
  const slot = await seedSssSlot({ startsAt: past });

  await openSssCalendar(page, istDayKey(past));
  await armBook(page, c.lead.name);
  await openCell(page, past).getByText("Open", { exact: true }).dispatchEvent("click");
  await page.waitForTimeout(3000);
  const row = await sssSlotRow(slot);
  expect.soft(row.journeyId, "DSC-17: a prospect was booked into an SSS slot that had already started").toBeNull();
  if (row.journeyId) {
    await runOutreachCron(request);
    const s = await stepMap(c.journeyId);
    expect.soft(s.SSS_CONFIRM_1?.status, "DSC-17: ...and the engine immediately raises a 'your session is scheduled for' reminder for a time already past").toBeUndefined();
  }
});

test("Europe/Berlin browser: SSS grid still labels slots in IST", async ({ browser }) => {
  test.setTimeout(180_000);
  const at = new Date(Math.floor((Date.now() + 30 * H) / M) * M + 11 * M);
  if (HAS_DB) await seedSssSlot({ startsAt: at });
  const { ctx, page } = await pageAs(browser, "admin", { timezoneId: "Europe/Berlin" });
  try {
    await openSssCalendar(page, HAS_DB ? istDayKey(at) : undefined);
    if (HAS_DB) await expect(openCell(page, at), `slot shown at its IST time ${hm(at)}`).toBeVisible();
    const labels = await page.locator("div.group\\/cell p.text-caption").allInnerTexts();
    for (const l of labels) expect(l).toMatch(/^\d{2}:\d{2} · \d+m$/);
  } finally {
    await ctx.close();
  }
});

test("placing a prospect: clicking the middle of an open slot books it (not blocks it)", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!HAS_DB, "local driver only (DSC-01)");
  const at = new Date(Math.floor((Date.now() + 27 * H) / M) * M + 19 * M);
  const d = await seedSssProspect({ label: "SSS centre click", sssAt: at, withSlot: false });
  const slot = await seedSssSlot({ startsAt: at });
  await openSssCalendar(page, istDayKey(at));
  await armBook(page, d.lead.name);
  // A real pointer click in the middle of the cell, the way a person places someone. Hovering the
  // cell reveals the Block/Delete icons, which sit over the middle of a narrow (1280px) grid cell.
  await openCell(page, at).click();
  await page.waitForTimeout(4000);
  const row = await sssSlotRow(slot);
  expect.soft(row.status, "DSC-23: the click hit the hover 'Block slot' icon AND bubbled to the place handler - the slot was blocked").not.toBe("BLOCKED");
  expect.soft(row.journeyId, "DSC-23: prospect not booked into the slot that was clicked").toBe(d.journeyId);
});
