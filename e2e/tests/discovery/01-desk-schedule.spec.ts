/**
 * SOP box "Check the Discovery call schedule" - Asma (USER, DISCOVERY_SPECIALIST) opens My Desk
 * and sees TODAY's booked discovery calls on her own calendar, in IST, in time order.
 *
 * Local driver: seeds calls straight into the DB (own rows, RUN-tagged, fenced phone).
 * Prod driver: read-only - asserts the desk renders and every time on it is an IST clock time;
 * it cannot create a call for today without a real prospect booking one, so the ownership /
 * ordering checks are local-only.
 */
import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { watchErrors } from "../../helpers/app";
import { openDesk, deskCallRow, pageAs, bookingsRow } from "../../helpers/discovery-ui";
import {
  seedDiscoveryCall, seedLead, seedDiscoSlot, seedBooking, atMinutesFromNow, minutesLeftTodayIst, NILOFER, closeDiscoveryDb,
} from "../../helpers/discovery-db";

test.use({ storageState: authFile("asma") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });

const istClock = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(d);
/** Chromium and Node ICU disagree on "06:10 pm" vs "6:10 pm"; compare on the digits + am/pm. */
const clockRe = (d: Date) => {
  const [hm, ap] = istClock(d).split(/\s+/);
  const [h, m] = hm.split(":");
  return new RegExp(`^0?${Number(h)}:${m}\\s*${ap}$`, "i");
};

test("desk shows today's calls for the specialist only, in IST and in time order", async ({ page }) => {
  test.skip(!HAS_DB, "prod: cannot put a call on today's calendar without a real booking - see 01 prod smoke below");
  test.skip(minutesLeftTodayIst() < 150, "too close to IST midnight for a same-day schedule");
  const errs = watchErrors(page);

  const startsPast = atMinutesFromNow(-25);
  const startsLater = atMinutesFromNow(95);
  const past = await seedDiscoveryCall({ label: "Sched past unconfirmed", startsAt: startsPast });
  const later = await seedDiscoveryCall({ label: "Sched later confirmed", startsAt: startsLater, confirmed: true });
  // Not Asma's: on Nilofer's calendar.
  const other = await seedDiscoveryCall({ label: "Sched other owner", startsAt: atMinutesFromNow(60), assignedToEmail: NILOFER });
  // Tomorrow.
  const tomorrow = await seedDiscoveryCall({ label: "Sched tomorrow", startsAt: atMinutesFromNow(minutesLeftTodayIst() + 600) });
  // Cancelled today.
  const cancelledLead = await seedLead({ label: "Sched cancelled" });
  const cSlot = await seedDiscoSlot({ startsAt: atMinutesFromNow(70) });
  await seedBooking({ lead: cancelledLead, slotId: cSlot, status: "CANCELLED" });

  await openDesk(page);

  const pastRow = deskCallRow(page, past.lead.name);
  const laterRow = deskCallRow(page, later.lead.name);
  await expect(pastRow).toBeVisible();
  await expect(laterRow).toBeVisible();
  await expect(deskCallRow(page, other.lead.name), "another specialist's call must not be on Asma's desk").toHaveCount(0);
  await expect(deskCallRow(page, tomorrow.lead.name), "tomorrow's call must not be on today's list").toHaveCount(0);
  await expect(deskCallRow(page, cancelledLead.name), "a cancelled booking must not be on the call list").toHaveCount(0);

  // IST clock time on each row, and the right confirmation state.
  await expect(pastRow.locator("span.tnum").first()).toHaveText(clockRe(startsPast));
  await expect(laterRow.locator("span.tnum").first()).toHaveText(clockRe(startsLater));
  await expect(pastRow).toContainText("Chase - no outcome yet");
  await expect(laterRow).toContainText("Confirmed");
  // SOP: "Call the lead" is offered only once the start time has passed without an outcome.
  await expect(pastRow.getByRole("link", { name: /^Call / })).toBeVisible();
  await expect(laterRow.getByRole("link", { name: /^Call / })).toHaveCount(0);

  // Time order: the earlier call is listed first.
  const names = await page.locator("li a[href^='/contacts/']").allInnerTexts();
  expect(names.indexOf(past.lead.name), "calls are listed in start-time order").toBeLessThan(names.indexOf(later.lead.name));
  errs.assertClean();
});

test("a Europe/Berlin browser still sees IST times on the desk and DD/MM/YYYY dates on Bookings", async ({ browser }) => {
  test.skip(!HAS_DB, "prod: needs a seeded call");
  test.skip(minutesLeftTodayIst() < 150, "too close to IST midnight");
  const at = atMinutesFromNow(80);
  const call = await seedDiscoveryCall({ label: "Sched berlin browser", startsAt: at });
  const { ctx, page } = await pageAs(browser, "asma", { timezoneId: "Europe/Berlin" });
  try {
    await openDesk(page);
    await expect(deskCallRow(page, call.lead.name).locator("span.tnum").first()).toHaveText(clockRe(at));
    await page.goto("/bookings");
    const row = await bookingsRow(page, call.lead.name);
    // The IST wall-clock is right whatever the browser zone is.
    const istHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(at);
    await expect(row).toContainText(new RegExp(`${istHm.replace(/\s*(am|pm)$/i, "")}\\s*(am|pm) IST`, "i"));
    // The Germany-side time is the right instant too (Berlin wall-clock)...
    const berlinHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: true }).format(at);
    await expect(row).toContainText(berlinHm.replace(/\s*(am|pm)$/i, ""));
    // ...but DSC-16: labelled "CET" even while Berlin is on summer time (CEST), and the call date is
    // "Thu 17 Sept" rather than the app-wide DD/MM/YYYY.
    const berlinZone = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", timeZoneName: "short" })
      .formatToParts(at).find((p) => p.type === "timeZoneName")!.value; // "CEST" in summer, "CET" in winter
    const zoneLabel = berlinZone === "GMT+2" ? "CEST" : berlinZone === "GMT+1" ? "CET" : berlinZone;
    expect.soft(await row.innerText(), `DSC-16: Berlin time must be labelled ${zoneLabel} on ${at.toISOString()}`).toContain(` ${zoneLabel}`);
    if (zoneLabel === "CEST") expect.soft(await row.innerText(), "DSC-16: summer time labelled CET").not.toMatch(/CET/);
    expect.soft(await row.locator("td").nth(1).innerText(), "DSC-16: call date should read DD/MM/YYYY").toMatch(/\d{2}\/\d{2}\/\d{4}/);
  } finally {
    await ctx.close();
  }
});

test("prod smoke: the L2 desk renders its call list with IST clock times only", async ({ page }) => {
  await openDesk(page);
  const times = await page.locator("li span.tnum.w-16").allInnerTexts();
  for (const t of times) expect(t.trim()).toMatch(/^\d{1,2}:\d{2}\s*(am|pm)$/i);
});
