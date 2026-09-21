/**
 * SOP (left + right branches of "Lead joined? No"):
 *   Call the lead -> responded? No -> call a 2nd time -> responded? No -> send WhatsApp -> cancel the
 *   discovery call -> End.
 *   Responded -> Interested? No -> cancel the discovery call -> End.
 *   Interested -> Participating (now)? No -> reschedule the call -> back to "Start discovery call".
 *   Participating? Yes -> conduct the call.
 *
 * App model: the specialist records NO_SHOW on the desk; the outreach engine then raises
 * DISCO_NOSHOW_CALL_1 -> DISCO_NOSHOW_CALL_2 -> DISCO_NOSHOW_MSG on the /outreach queue.
 *
 * Local driver: seeded call + runCron("outreach"). Prod: the engine runs on the VPS every minute and
 * the no-show WhatsApp (SOP_DISCO_NOSHOW) would go LIVE to the fenced lead - so this whole file
 * needs a real booked call and is local-only (see findings "prod-run notes").
 */
import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import {
  openDesk, deskCallRow, recordOutcomeOnDesk, submitRouteModal, waitForNextStep, clickStepAction, queueCard, openOutreach,
  installPopupHandlers, pickOption, bookingsRow,
} from "../../helpers/discovery-ui";
import {
  seedDiscoveryCall, seedDiscoSlot, atMinutesFromNow, minutesLeftTodayIst, leadRow, bookingRow, slotRow, stepMap, journeyRow,
  ensureOutreachEngineEnabledLocal, outcomes, closeDiscoveryDb, dq, H, runOutreachCron,
} from "../../helpers/discovery-db";

test.use({ storageState: authFile("asma") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });
test.beforeAll(async () => { if (HAS_DB) await ensureOutreachEngineEnabledLocal(); });
test.beforeEach(() => {
  test.setTimeout(360_000);
  test.skip(!HAS_DB, "local driver only: needs a call on today's calendar; in prod the no-show WhatsApp is live");
  test.skip(minutesLeftTodayIst() < 60, "too close to IST midnight");
});

const CALL_1 = "L2 · no-show: No-show - call attempt 1";
const CALL_2 = "L2 · no-show: No-show - call attempt 2";
const MSG = "L2 · no-show: No-show - WhatsApp";

/** Lead did not join: the specialist records a no-show and the engine opens the chase. */
async function noShowAndOpenChase(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, label: string) {
  // Confirmed call that started 20 minutes ago (confirmed, so the engine's 2h no-show sweep leaves it alone).
  const call = await seedDiscoveryCall({ label, startsAt: atMinutesFromNow(-20), confirmed: true, leadStage: "DISCO_BOOKED" });
  await openDesk(page);
  await expect(deskCallRow(page, call.lead.name)).toContainText("Chase - no outcome yet");
  await recordOutcomeOnDesk(page, call.lead.name, "NO_SHOW");
  await submitRouteModal(page);
  const cron = await runOutreachCron(request);
  expect(cron.run.sop.enabled, "outreach engine enabled locally").toBe(true);
  const card = await waitForNextStep(page, call.lead.name, CALL_1);
  return { call, card };
}

test("not joined, no answer twice: WhatsApp, then the discovery call is cancelled", async ({ page, request }) => {
  const { call } = await noShowAndOpenChase(page, request, "NoShow twice unanswered");

  let card = await waitForNextStep(page, call.lead.name, CALL_1);
  await clickStepAction(page, card, "No answer");
  card = await waitForNextStep(page, call.lead.name, CALL_2);
  let s = await stepMap(call.journeyId!);
  expect(s.DISCO_NOSHOW_CALL_1.status).toBe("SENT");
  expect(s.DISCO_NOSHOW_CALL_1.outcome).toBe("NO_ANSWER");
  expect(s.DISCO_NOSHOW_MSG, "no WhatsApp before the 2nd attempt").toBeUndefined();

  await clickStepAction(page, card, "No answer");
  card = await waitForNextStep(page, call.lead.name, MSG);
  // The message the specialist sends (and, in prod with auto-send on, the live template's text).
  await expect(card).toContainText("We noticed you missed your scheduled Personalized Discovery Call.");
  await expect(card).toContainText(call.lead.name.split(" ")[0]); // [Prospect's First Name]
  await clickStepAction(page, card, "Mark sent");

  // Engine ticks twice: nothing is raised twice.
  for (let i = 0; i < 2; i++) await runOutreachCron(request);
  s = await stepMap(call.journeyId!);
  expect(s.DISCO_NOSHOW_MSG.status).toBe("SENT");
  expect(s.DISCO_NOSHOW_MSG.renderedBody).toContain("We noticed you missed your scheduled Personalized Discovery Call.");
  const rows = await dq(`select step, count(*)::int n from outreach_step_log where "journeyId" = $1 group by step having count(*) > 1`, [call.journeyId]);
  expect(rows, "each SOP step exists once").toEqual([]);

  // SOP: "Send WhatsApp message -> Cancel the Discovery call -> End".
  const b = await bookingRow(call.bookingId);
  const slot = await slotRow(call.slotId);
  const j = await journeyRow(call.journeyId!);
  expect.soft(b.status, "DSC-09: after the no-show WhatsApp the discovery call is never cancelled (booking stays NO_SHOW)").toBe("CANCELLED");
  expect.soft(slot.status, "DSC-09/10: the no-show's slot is never released").not.toBe("BOOKED");
  expect.soft(["CANCELLED", "IGNORED"], `DSC-09: the journey never ends after the chase (phase ${j.phase})`).toContain(j.phase);
});

test("responded but NOT interested: the call is cancelled and the chase stops", async ({ page, request }) => {
  const { call, card } = await noShowAndOpenChase(page, request, "NoShow not interested");
  await clickStepAction(page, card, "Answered - NO");
  await runOutreachCron(request);
  const s = await stepMap(call.journeyId!);
  expect(s.DISCO_NOSHOW_CALL_1.outcome).toBe("NO");
  expect.soft(s.DISCO_NOSHOW_CALL_2, "DSC-08: a prospect who answered and said NO is still queued for a 2nd call attempt").toBeUndefined();
  expect.soft(s.DISCO_NOSHOW_MSG?.status, "DSC-08: ...and the no-show WhatsApp would follow").toBeUndefined();
  const lead = await leadRow(call.lead.id);
  const b = await bookingRow(call.bookingId);
  expect.soft(lead.stage, "DSC-08: not interested does not close the lead").toBe("LOST");
  expect.soft(b.status, "DSC-08: not interested does not cancel the discovery call").toBe("CANCELLED");
});

test("responded, interested and participating now: chase stops and the real call outcome can be recorded", async ({ page, request }) => {
  const { call, card } = await noShowAndOpenChase(page, request, "NoShow joins after call");
  await clickStepAction(page, card, "Answered - YES");
  await runOutreachCron(request);
  const s = await stepMap(call.journeyId!);
  expect(s.DISCO_NOSHOW_CALL_1.outcome).toBe("YES");
  expect(s.DISCO_NOSHOW_CALL_2, "a YES stops the chase: no 2nd attempt").toBeUndefined();
  expect(s.DISCO_NOSHOW_MSG, "a YES stops the chase: no no-show WhatsApp").toBeUndefined();

  // SOP: Participating -> "Conduct Discovery call" -> Qualified? The desk must let her record it.
  await openDesk(page);
  const row = deskCallRow(page, call.lead.name);
  expect.soft(await row.getByRole("button", { name: "Record outcome" }).count(),
    "DSC-11: once NO_SHOW is recorded (required to open the chase) the row is 'Recorded' - the call that then happened cannot be routed from the desk").toBe(1);
  expect.soft((await leadRow(call.lead.id)).stage, "DSC-11: the lead stays in No Shows although they joined").not.toBe("NO_SHOW");
});

test("interested but not now: reschedule to a new slot - old slot freed, stage and reminders re-armed for the new time", async ({ page, request }) => {
  const { call, card } = await noShowAndOpenChase(page, request, "NoShow reschedule");
  await clickStepAction(page, card, "Answered - YES");
  const newAt = atMinutesFromNow(26 * 60 + 7);
  const newSlot = await seedDiscoSlot({ startsAt: newAt, status: "OPEN" });

  await page.goto("/bookings");
  let row = await bookingsRow(page, call.lead.name);
  // A NO_SHOW booking offers no "Postpone": the status must be put back to Booked first.
  const postponeVisible = await row.getByRole("button", { name: /Postpone/ }).count();
  expect.soft(postponeVisible, "DSC-11: a no-show booking cannot be rescheduled directly - Postpone is hidden until the status is set back to Booked").toBe(1);
  if (!postponeVisible) {
    await pickOption(page, row.getByRole("button", { name: "Booking status" }), "Booked");
    await expect.poll(async () => (await bookingRow(call.bookingId)).status, { timeout: 20_000 }).toBe("BOOKED");
    await page.reload();
    row = await bookingsRow(page, call.lead.name);
    await expect(row.getByRole("button", { name: /Postpone/ })).toBeVisible({ timeout: 15_000 });
  }
  await row.getByRole("button", { name: /Postpone/ }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Postpone call" });
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(newAt);
  await pickOption(page, dlg.getByRole("button", { name: /Pick an open slot/ }), new RegExp(`${label.replace(/\s*(am|pm)$/i, "")}.*IST.*Asma`, "i"));
  await dlg.getByRole("button", { name: "Postpone call" }).click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });

  const b = await bookingRow(call.bookingId);
  expect(b.slotId, "booking moved to the new slot").toBe(newSlot);
  expect(b.status).toBe("BOOKED");
  expect((await slotRow(newSlot)).status).toBe("BOOKED");
  expect((await slotRow(call.slotId)).status, "old slot released (BLOCKED when inside min-notice)").not.toBe("BOOKED");

  await runOutreachCron(request);
  const lead = await leadRow(call.lead.id);
  expect.soft(lead.stage, "DSC-14: a rescheduled no-show stays in 'No Shows/Rescheduled' instead of returning to a booked stage").not.toBe("NO_SHOW");
  const j = await journeyRow(call.journeyId!);
  expect.soft(j.whatsappConfirmed, "DSC-14: journey still marked confirmed for the OLD time - the new time is never re-confirmed").toBe(false);
  const s = await stepMap(call.journeyId!);
  expect.soft(s.DISCO_CONFIRM_1?.dueAt?.getTime(), "DSC-14: no confirmation reminder armed for the new call time (T-36h)").toBe(newAt.getTime() - 36 * H);
});
