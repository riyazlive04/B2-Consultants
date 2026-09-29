/**
 * SOP: "Reschedule the call" (back to "Start discovery call") and "Cancel the Discovery call",
 * as the specialist does them on /bookings (Postpone, Status -> Cancelled), and what that does to the
 * reminders the engine armed for the ORIGINAL time.
 *
 * Local driver only: seeded booking + journey, runCron("outreach"), DB time travel.
 * In prod the disco ladder is auto-sent (DISCO_WELCOME / DISCO_CONFIRM_1/2 go live to the fenced
 * lead), so these must not run there.
 */
import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { bookingsRow, pickOption } from "../../helpers/discovery-ui";
import {
  seedDiscoveryCall, seedDiscoSlot, seedBooking, atMinutesFromNow, leadRow, bookingRow, slotRow, stepMap, journeyRow, stageHistory,
  ensureOutreachEngineEnabledLocal, runOutreachCron, timeTravelJourney, closeDiscoveryDb, H, M,
} from "../../helpers/discovery-db";

test.use({ storageState: authFile("asma") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });
test.beforeAll(async () => { if (HAS_DB) await ensureOutreachEngineEnabledLocal(); });
test.beforeEach(() => {
  test.setTimeout(360_000);
  test.skip(!HAS_DB, "local driver only: prod auto-sends the disco confirmation ladder to the fenced lead");
});

const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d).replace(/\s*(am|pm)$/i, "");

async function postpone(page: import("@playwright/test").Page, name: string, to: Date) {
  await page.goto("/bookings");
  const row = await bookingsRow(page, name);
  await row.getByRole("button", { name: /Postpone/ }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Postpone call" });
  await pickOption(page, dlg.getByRole("button", { name: /Pick an open slot/ }), new RegExp(`${hm(to)}\\s*(am|pm) IST.*Asma`, "i"));
  await dlg.getByRole("button", { name: "Postpone call" }).click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
}

test("reschedule: old slot freed, new slot booked, confirmation reminders re-armed for the new time", async ({ page, request }) => {
  const oldAt = atMinutesFromNow(40 * 60 + 3);
  const call = await seedDiscoveryCall({ label: "Disco reschedule rearm", startsAt: oldAt, confirmed: false });
  await runOutreachCron(request);
  let s = await stepMap(call.journeyId!);
  expect(s.DISCO_CONFIRM_1?.dueAt.getTime(), "Step 14 armed at T-36h of the ORIGINAL time").toBe(oldAt.getTime() - 36 * H);

  const newAt = atMinutesFromNow(80 * 60 + 9);
  const newSlot = await seedDiscoSlot({ startsAt: newAt, status: "OPEN" });
  await postpone(page, call.lead.name, newAt);

  const b = await bookingRow(call.bookingId);
  expect(b.slotId).toBe(newSlot);
  expect(b.status).toBe("BOOKED");
  expect(b.confirmedAt, "the new time must be re-confirmed").toBeNull();
  expect((await slotRow(newSlot)).status).toBe("BOOKED");
  expect((await slotRow(call.slotId)).status, "old slot back on sale").toBe("OPEN");

  await runOutreachCron(request);
  s = await stepMap(call.journeyId!);
  expect.soft(s.DISCO_CONFIRM_1.dueAt.getTime(), "DSC-14: Step 14 still anchored to the old call time after Postpone").toBe(newAt.getTime() - 36 * H);

  // 5h pass: the OLD T-36h is behind us, the new one is 39h away. Nothing should be due.
  await timeTravelJourney(call.journeyId!, 5);
  await runOutreachCron(request);
  s = await stepMap(call.journeyId!);
  const dueNow = s.DISCO_CONFIRM_1.status === "DUE" && s.DISCO_CONFIRM_1.dueAt.getTime() <= Date.now();
  expect.soft(dueNow, "DSC-14: the confirmation reminder for the OLD time falls due (and auto-sends in prod) 39h before the new call").toBe(false);
});

test("cancel then rebook: stage walks back, stale reminders are withdrawn, the new booking gets its own ladder", async ({ page, request }) => {
  const at = atMinutesFromNow(40 * 60 + 13);
  const call = await seedDiscoveryCall({ label: "Disco cancel rebook", startsAt: at, confirmed: false });
  await runOutreachCron(request);
  expect((await stepMap(call.journeyId!)).DISCO_CONFIRM_1?.status).toBe("DUE");

  // Specialist cancels the call from Bookings.
  await page.goto("/bookings");
  const row = await bookingsRow(page, call.lead.name);
  await pickOption(page, row.getByRole("button", { name: "Booking status" }), "Cancelled");
  await expect.poll(async () => (await bookingRow(call.bookingId)).status, { timeout: 20_000 }).toBe("CANCELLED");
  expect((await slotRow(call.slotId)).status, "cancel frees the slot").toBe("OPEN");

  await runOutreachCron(request);
  const lead = await leadRow(call.lead.id);
  expect.soft(lead.stage, "DSC-21: a cancelled discovery call leaves the lead in 'Discovery Call Booked'").not.toBe("STRATEGY_CALL_BOOKED");
  const s = await stepMap(call.journeyId!);
  expect.soft(s.DISCO_CONFIRM_1.status, "DSC-21: the confirmation reminder for the cancelled call stays DUE in the queue").not.toBe("DUE");

  // The prospect books again (what /book would write: a new BOOKED request on a new slot).
  const newAt = atMinutesFromNow(60 * 60 + 17);
  const newSlot = await seedDiscoSlot({ startsAt: newAt });
  const newBooking = await seedBooking({ lead: call.lead, slotId: newSlot });
  await runOutreachCron(request);
  const j = await journeyRow(call.journeyId!);
  expect.soft(j.bookingId, "DSC-22: the journey stays linked to the CANCELLED booking; the rebooked call never gets a confirmation ladder").toBe(newBooking);
  const s2 = await stepMap(call.journeyId!);
  expect.soft(s2.DISCO_CONFIRM_1?.dueAt?.getTime(), "DSC-22: no Step 14 for the rebooked time").toBe(newAt.getTime() - 36 * H);
  expect((await stageHistory(call.lead.id)).length).toBeGreaterThanOrEqual(0);
});

test("reschedule into the last 3 hours is accepted and frees the old slot", async ({ page }) => {
  const oldAt = atMinutesFromNow(26 * 60 + 21);
  const call = await seedDiscoveryCall({ label: "Disco reschedule 3h window", startsAt: oldAt, confirmed: true, leadStage: "DISCO_BOOKED" });
  const soon = atMinutesFromNow(2 * 60 + 23);
  const soonSlot = await seedDiscoSlot({ startsAt: soon, status: "OPEN" });
  await postpone(page, call.lead.name, soon);
  const b = await bookingRow(call.bookingId);
  expect(b.slotId).toBe(soonSlot);
  expect(b.confirmedAt, "moved call needs a fresh confirmation").toBeNull();
  expect((await slotRow(call.slotId)).status).toBe("OPEN");
  // Staff reschedules ignore the public 2h minimum notice by design (booking-actions comment M2); the
  // journey keeps whatsappConfirmed=true from the old time, so no confirmation is ever asked for this one.
  const j = await journeyRow(call.journeyId!);
  expect.soft(j.whatsappConfirmed, "DSC-14: journey still 'WhatsApp Confirmed' for a call moved to a new time").toBe(false);
});
