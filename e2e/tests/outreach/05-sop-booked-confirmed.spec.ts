import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import {
  FENCE, HAS_DB, HR, IS_PROD, MIN, BANT_HIGH, bookViaPublicPage, bookingsFor, ensureLocalOutreachConfig, eventually,
  fakeTemplate, hoursUntilDisco, journeyFor, liveLead, makeSlot, optInViaPabbly, pabblyKey, purgePerson, queueCard,
  record, stageHistory, stepMap, tick, timeTravel, travelToBeforeDisco, waMessages, workQueue,
} from "../../helpers/outreach";

/**
 * SOP: booked mid-chase → BANT qualification from the booking form (score > 2) → Step 13 WhatsApp →
 * 36h Step 14 → not confirmed → 24h Step 15 → 12h call (Step 16) → CONFIRMED → "Call confirmed, update
 * key metrics"; the ladder stops.
 *
 * Local driver: DB time travel of this journey (and its booked slot) + /api/cron/outreach.
 * Prod driver (not automated): book a slot ~37h ahead so Step 14 is due within the hour, then wait.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let journeyId = "";
let slot: Awaited<ReturnType<typeof makeSlot>>;

test.beforeAll(async ({ browser }) => {
  test.skip(IS_PROD || !HAS_DB, "local driver only - prod needs a real 36h wait");
  await ensureLocalOutreachConfig();
  const ctx = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await ctx.newPage(), P.phone);
  await ctx.close();
});

test("chase is running: intro + first call done, 2h check found no booking, Step 6 follow-up sent", async ({ request, page }) => {
  test.skip(!pabblyKey());
  await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  leadId = (await eventually(() => liveLead(P.phone), "lead")).id;
  record("Lead", "05 booked-confirmed", leadId);
  journeyId = (await journeyFor(leadId)).id;
  await eventually(async () => (await stepMap(journeyId)).INTRO_WHATSAPP, "intro");
  await workQueue(page, P.phone, [[/^Step 3: /, "Mark sent"], [/^Step 3b: /, "Mark sent"], [/^Step 4: /, "No answer"]]);
  await timeTravel(journeyId, 2 + 1 / 60);
  await tick(request);
  await workQueue(page, P.phone, [[/^Step 6: /, "Mark sent"], [/^Step 6b: /, "Mark sent"]]);
  expect((await stepMap(journeyId)).FOLLOWUP_WHATSAPP.status).toBe("SENT");
});

test("prospect books on the public /book page (BANT 5.0) → booking linked to the journey and scored Qualified", async ({ browser }) => {
  const admin = await browser.newContext({ storageState: authFile("admin") });
  slot = await makeSlot(await admin.newPage(), 3);
  await admin.close();
  record("AppointmentSlot", `slot ${slot.dayLabel} ${slot.timeLabel}`);

  // A fresh anonymous visitor; a unique client IP keeps the public per-IP booking limit per test.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.77.5.${Math.floor(Math.random() * 200) + 1}` } });
  const page = await ctx.newPage();
  await bookViaPublicPage(page, { name: P.name, phone: P.phone, email: P.email }, slot.dayLabel, slot.timeLabel, BANT_HIGH);
  await expect(page.getByText("You're booked in").first()).toBeVisible();
  await ctx.close();

  const b = await eventually(async () => (await bookingsFor(leadId))[0], "booking row");
  expect(b.status).toBe("BOOKED");
  expect(b.bantAvg).toBe(4);
  expect(b.bantVerdict).toBe("CONFIRM");
  expect(b.slotStatus).toBe("BOOKED");
  const j = await journeyFor(leadId);
  expect(j.bookingId).toBe(b.id);
  expect(j.qualified).toBe("YES");
  expect(j.bantScoreAtQual).toBe(4);
  expect((await liveLead(P.phone)).stage).toBe("STRATEGY_CALL_BOOKED");
  expect((await stageHistory(leadId)).map((h) => h.toStage)).toEqual(["NEW_LEAD", "WHATSAPP_SENT", "STRATEGY_CALL_BOOKED"]);
});

test("OUT-23: the Bookings table labels the Berlin time with its real zone (CEST in summer)", async ({ page }) => {
  // OUT-23 - BookingsTable renders `{r.slotCet} CET` and /book renders `({cet} CET)` with a hardcoded "CET"
  // (BookingsTable.tsx:151, BookingForm.tsx:92) while Key Metrics derives CET/CEST correctly (berlinLabel).
  const dst = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", timeZoneName: "short" }).format(slot.startsAt).includes("+2");
  await page.goto("/bookings");
  const row = page.locator("table tbody tr:visible").filter({ hasText: P.phone }).first();
  await expect(row).toContainText("IST");
  test.fail(dst, "OUT-23");
  await expect(row).toContainText(dst ? "CEST" : "CET", { timeout: 3000 });
});

test("OUT-12: a booked discovery call counts in the pipeline's 'Calls booked' (PRD §5.4)", async () => {
  // OUT-12 - /book moves the lead to STRATEGY_CALL_BOOKED ("Discovery Call Booked") but getPipelineOverview
  // counts `distinctLeadsReaching("DISCO_BOOKED")` ("Pre-Qualified & Confirmed"), so a booked-but-not-yet-
  // confirmed call is invisible to Calls booked, Show-up rate and No-show rate (pipeline-metrics.ts:283).
  test.fail(true, "OUT-12");
  const reached = (await stageHistory(leadId)).some((h) => h.toStage === "DISCO_BOOKED");
  expect(reached, "lead should be inside the 'Calls booked' population now").toBe(true);
});

test("the booking stops the chase: pending chase steps superseded, BANT closed, no more chase messages", async ({ request }) => {
  const chaseKinds = () => waMessages(leadId).then((m) => m.filter((x) => ["SOP_INTRO", "SOP_FOLLOWUP", "SOP_FOLLOWUP_2"].includes(x.kind)).length);
  const before = await chaseKinds();
  await tick(request);
  await tick(request);
  const s = await stepMap(journeyId);
  expect(Object.values(s).filter((x) => x.status === "DUE" && /CHECK|FOLLOWUP|INTRO|FIRST_CALL/.test(x.step)).map((x) => x.step)).toEqual([]);
  expect(s.FINAL_CHECK.status).toBe("SUPERSEDED");
  expect(s.BANT_QUALIFICATION.status).toBe("SENT");
  expect(s.BANT_QUALIFICATION.outcome).toBe("YES");
  // Step 12 is bookkeeping the booking already did, so the system closes it (OUT-09 fix) and the
  // journey moves straight on to the confirmation phase.
  expect(s.KEY_METRICS_TRANSFER?.status).toBe("SENT");
  expect(s.KEY_METRICS_TRANSFER?.outcome).toBe("AUTO_COMPLETED");
  expect(s.DISCO_WELCOME?.status).toBe("DUE");
  const delay = new Date(s.DISCO_WELCOME.dueAt).getTime() - new Date(s.BANT_QUALIFICATION.actedAt!).getTime();
  expect(delay).toBe(5 * MIN);
  expect((await journeyFor(leadId)).phase).toBe("DISCO_CONFIRMATION");
  // Time passes far beyond every chase window: still no chase message.
  await timeTravel(journeyId, 6 / 60);
  await tick(request);
  expect(await chaseKinds()).toBe(before);
});

test("Key Metrics tab shows the booked prospect with BANT 5.0, Qualified YES", async ({ page }) => {
  await page.goto("/outreach");
  await page.getByRole("tab", { name: "Key Metrics" }).click();
  await page.getByPlaceholder("Filter by name, email, owner…").fill(P.email);
  const row = page.locator("table tbody tr:visible").filter({ hasText: P.phone });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("5.0");
  await expect(row).toContainText("YES");
  await expect(row).toContainText(slot.dayLabel.slice(0, 5).split("/").join("/")); // appointment date (Berlin)
});

test("OUT-09: Step 12 (Key Metrics transfer) completes itself and never blocks the queue card", async ({ page }) => {
  // OUT-09 (fixed 22/09/2026) - Step 12 used to sit DUE until someone clicked Skip ("Run the booking
  // check" never closed it), pinning the card on it, hiding Step 13 and gating DISCO_CONFIRMATION.
  // It is now closed by the system with a reason, so nobody has to find the Skip button.
  const s = await stepMap(journeyId);
  expect(s.KEY_METRICS_TRANSFER.status).toBe("SENT");
  expect(s.KEY_METRICS_TRANSFER.outcome).toBe("AUTO_COMPLETED");
  expect(s.KEY_METRICS_TRANSFER.actedById, "closed by the system, not a person").toBeNull();
  await page.goto("/outreach");
  const card = queueCard(page, P.phone);
  await expect(card).not.toContainText("Step 12: Key Metrics transfer");
  await expect(card).toContainText("Step 13");
});

test("specialist sends Step 13 welcome (template SOP_DISCO_WELCOME attempted)", async ({ page }) => {
  // No Step 12 to skip any more: it is closed by the system (OUT-09 fix).
  const handled = await workQueue(page, P.phone, [
    [/^Step 13: Disco welcome$/, "Mark sent"],
    [/^Step 13b: /, "Mark sent"],
  ]);
  expect(handled.length).toBeGreaterThanOrEqual(2);
  const s = await stepMap(journeyId);
  expect(s.DISCO_WELCOME.status).toBe("SENT");
  expect(s.DISCO_WELCOME.renderedBody).toMatch(/booked a Personalized Discovery Call with our team on \*.+\* at \*.+\* IST/);
  expect((await waMessages(leadId)).some((m) => m.kind === "SOP_DISCO_WELCOME" && m.templateName === fakeTemplate("SOP_DISCO_WELCOME"))).toBe(true);
  expect((await journeyFor(leadId)).phase).toBe("DISCO_CONFIRMATION");
  const disco = Date.now() + (await hoursUntilDisco(journeyId)) * HR;
  expect(Math.abs(new Date(s.DISCO_CONFIRM_1.dueAt).getTime() - (disco - 36 * HR))).toBeLessThan(2000);
});

test("36h before: Step 14 is due but blocked until the Zoom link is set; then sent", async ({ request, page }) => {
  await travelToBeforeDisco(journeyId, 36);
  await tick(request);
  let s = await stepMap(journeyId);
  expect(s.DISCO_CONFIRM_1.status).toBe("DUE");
  expect((await waMessages(leadId)).some((m) => m.kind === "SOP_DISCO_CONFIRM_1"), "unresolved zoom placeholder blocks auto-send").toBe(false);
  await page.goto("/outreach");
  const card = queueCard(page, P.phone);
  await expect(card).toContainText("Step 14: Disco confirmation 1");
  await expect(card).toContainText("<<INSERT ZOOM LINK HERE>>");
  await card.getByRole("button", { name: "Details & overrides" }).click();
  await card.locator("input[name=zoomLink]").fill("https://zoom.us/j/9999999999");
  const posted = page.waitForResponse((r) => r.request().method() === "POST");
  await card.getByRole("button", { name: "Save" }).click();
  await posted;
  await tick(request);
  expect((await waMessages(leadId)).some((m) => m.kind === "SOP_DISCO_CONFIRM_1")).toBe(true);
  await workQueue(page, P.phone, [[/^Step 14: /, "Mark sent"]]);
  s = await stepMap(journeyId);
  expect(s.DISCO_CONFIRM_1.status).toBe("SENT");
  expect(s.DISCO_CONFIRM_1.renderedBody).toContain("https://zoom.us/j/9999999999");
  expect((await journeyFor(leadId)).whatsappSent).toBe(true);
  expect(s.DISCO_CONFIRM_2?.status).toBe("DUE");
  expect(Math.round((await hoursUntilDisco(journeyId)) - (new Date(s.DISCO_CONFIRM_2.dueAt).getTime() - Date.now()) / HR)).toBe(24);
});

test("24h before, not confirmed: Step 15 sent → Step 16 confirmation calls raised", async ({ request, page }) => {
  await travelToBeforeDisco(journeyId, 24);
  await tick(request);
  await workQueue(page, P.phone, [[/^Step 15: /, "Mark sent"]]);
  const s = await stepMap(journeyId);
  expect(s.DISCO_CONFIRM_2.status).toBe("SENT");
  expect(s.DISCO_CONFIRM_CALL_1).toBeTruthy();
});

test("OUT-04: the Step 16 confirmation call is due 12h before the call (SOP; setting discoConfirmCallLeadHours=12)", async () => {
  // OUT-04 - planJourney schedules DISCO_CONFIRM_CALL_1/2 with sla.discoConfirm2LeadHours (24h) instead of
  // sla.discoConfirmCallLeadHours (outreach-engine.ts:423-427), so the "Disco confirm calls" setting does
  // nothing and the calls land at T-24h together with Step 15.
  test.fail(true, "OUT-04");
  const s = await stepMap(journeyId);
  const leadH = (await hoursUntilDisco(journeyId)) - (new Date(s.DISCO_CONFIRM_CALL_1.dueAt).getTime() - Date.now()) / HR;
  expect(Math.round(leadH)).toBe(12);
});

test("Step 16 call: prospect CONFIRMS → WhatsApp Confirmed, card to Pre-Qualified & Confirmed, ladder stops", async ({ request, page }) => {
  await travelToBeforeDisco(journeyId, 12);
  await tick(request);
  const handled = await workQueue(page, P.phone, [[/^Step 16: Disco confirmation call 1/, "Answered - YES"]]);
  expect(handled).toHaveLength(1);
  const j = await journeyFor(leadId);
  expect(j.whatsappConfirmed).toBe(true);
  expect(j.phase).toBe("AWAITING_DISCO");
  expect((await liveLead(P.phone)).stage).toBe("DISCO_BOOKED");
  const s = await stepMap(journeyId);
  expect(s.DISCO_CONFIRM_CALL_2, "second call never raised").toBeUndefined();
  expect(s.DISCO_CANCEL_MSG).toBeUndefined();
  const n = (await waMessages(leadId)).length;
  // through the call time and past the no-show sweep: nothing fires, booking untouched
  await timeTravel(journeyId, 12 + 3);
  await tick(request);
  await tick(request);
  expect(await waMessages(leadId)).toHaveLength(n);
  expect((await stepMap(journeyId)).DISCO_CANCEL).toBeUndefined();
  const b = (await bookingsFor(leadId))[0];
  expect(b.status).toBe("BOOKED");
  await page.goto("/outreach");
  await page.getByRole("tab", { name: "Key Metrics" }).click();
  await page.getByPlaceholder("Filter by name, email, owner…").fill(P.email);
  await expect(page.locator("table tbody tr:visible").filter({ hasText: P.phone })).toContainText("Disco confirmed");
});
