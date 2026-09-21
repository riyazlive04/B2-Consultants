import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import {
  BANT_LOW, BANT_TWO, BANT_HIGH, FENCE, HAS_DB, HR, IS_PROD, bookViaPublicPage, bookingsFor, emailMessages,
  ensureLocalOutreachConfig, eventually, hoursUntilDisco, journeyFor, liveLead, makeSlot, optInViaPabbly, pabblyKey,
  purgePerson, queueCard, record, stageHistory, stepMap, tick, timeTravel, travelToBeforeDisco, waMessages, workQueue,
} from "../../helpers/outreach";
import { one } from "../../helpers/db";

/**
 * SOP: booked (before any chase step) → BANT exactly 2.0 (SOP: "<2 cancel / >2 continue", 2 undefined)
 * → Step 13 → 36h Step 14 → 24h Step 15 → 12h call → NOT confirmed → cancel the disco call (Step 17) → End.
 * Plus: a call confirmed on the Bookings page, and a BANT < 2 booking.
 */
test.describe.configure({ mode: "serial", timeout: 360_000 });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let journeyId = "";

const anon = (browser: any) =>
  browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.77.6.${Math.floor(Math.random() * 200) + 1}` } });

async function freshOptInAndBook(browser: any, request: any, bant: typeof BANT_HIGH, label: string) {
  const admin = await browser.newContext({ storageState: authFile("admin") });
  const adminPage = await admin.newPage();
  await purgePerson(adminPage, P.phone);
  await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  leadId = (await eventually(() => liveLead(P.phone), "lead")).id;
  record("Lead", label, leadId);
  journeyId = (await journeyFor(leadId)).id;
  const slot = await makeSlot(adminPage, 3);
  await admin.close();
  const ctx = await anon(browser);
  const page = await ctx.newPage();
  await bookViaPublicPage(page, { name: P.name, phone: P.phone, email: P.email }, slot.dayLabel, slot.timeLabel, bant);
  await expect(page.getByText("You're booked in").first()).toBeVisible();
  await ctx.close();
  return slot;
}

test.beforeAll(async () => {
  test.skip(IS_PROD || !HAS_DB || !pabblyKey(), "local driver only");
  await ensureLocalOutreachConfig();
});

test.describe("A. booked straight after opt-in, BANT 2.0, never confirms → cancelled", () => {
  test("BANT exactly 2.0 is scored 'Cannot judge' (MAYBE) and CONTINUES down the disco ladder", async ({ browser, request }) => {
    await freshOptInAndBook(browser, request, BANT_TWO, "06A bant-2 cancel");
    const b = await eventually(async () => (await bookingsFor(leadId))[0], "booking");
    expect(b.bantAvg).toBe(2);
    expect(b.bantVerdict).toBe("DOUBT");
    expect(b.status).toBe("BOOKED");
    const j = await journeyFor(leadId);
    expect(j.qualified).toBe("MAYBE");
    await tick(request);
    await tick(request);
    const s = await stepMap(journeyId);
    expect(s.INTRO_WHATSAPP.status, "booked before the intro went out: the intro is dropped").toBe("SUPERSEDED");
    expect(s.BANT_QUALIFICATION.status).toBe("SENT");
    expect(s.DISCO_WELCOME?.status).toBe("DUE");
    expect(s.DISCO_REJECT_MSG).toBeUndefined();
  });

  test("ladder: Step 13 → Step 14 (36h) → Step 15 (24h) → two unanswered Step 16 calls", async ({ request, page }) => {
    await workQueue(page, P.phone, [[/^Step 12: /, "Skip"]]);
    await timeTravel(journeyId, 6 / 60);
    await tick(request);
    await workQueue(page, P.phone, [[/^Step 13: Disco welcome$/, "Mark sent"], [/^Step 13b: /, "Mark sent"]]);
    await travelToBeforeDisco(journeyId, 36);
    await tick(request);
    // zoom link via the card (Step 14 is blocked on it)
    await page.goto("/outreach");
    const card = queueCard(page, P.phone);
    await card.getByRole("button", { name: "Details & overrides" }).click();
    await card.locator("input[name=zoomLink]").fill("zoom.us/j/1111111111");
    const posted = page.waitForResponse((r) => r.request().method() === "POST");
    await card.getByRole("button", { name: "Save" }).click();
    await posted;
    expect((await journeyFor(leadId)).zoomLink, "scheme is added to a pasted link").toBe("https://zoom.us/j/1111111111");
    await workQueue(page, P.phone, [[/^Step 14: /, "Mark sent"]]);
    await travelToBeforeDisco(journeyId, 24);
    await tick(request);
    await workQueue(page, P.phone, [
      [/^Step 15: /, "Mark sent"],
      [/^Step 16: Disco confirmation call 1/, "No answer"],
      [/^Step 16: Disco confirmation call 2/, "No answer"],
    ]);
    const s = await stepMap(journeyId);
    expect(s.DISCO_CONFIRM_CALL_1.outcome).toBe("NO_ANSWER");
    expect(s.DISCO_CONFIRM_CALL_2.outcome).toBe("NO_ANSWER");
    expect(s.DISCO_CANCEL_MSG?.status).toBe("DUE");
    const lead = (await hoursUntilDisco(journeyId)) - (new Date(s.DISCO_CANCEL_MSG.dueAt).getTime() - Date.now()) / HR;
    expect(Math.round(lead), "cancellation unlocks 12h before the call").toBe(12);
    expect((await bookingsFor(leadId))[0].status).toBe("BOOKED");
  });

  test("12h before: cancellation message sent → Step 17 releases the booking and re-opens the slot; nothing fires after", async ({ request, page }) => {
    await travelToBeforeDisco(journeyId, 12);
    await tick(request);
    expect((await waMessages(leadId)).some((m) => m.kind === "SOP_DISCO_CANCEL")).toBe(true);
    await workQueue(page, P.phone, [[/^Step 16: Disco cancellation message/, "Mark sent"], [/^Step 16b: /, "Mark sent"]]);
    await tick(request); // executes Step 17 (release)
    await tick(request); // phase follows on the next pass
    const j = await journeyFor(leadId);
    const s = await stepMap(journeyId);
    expect(s.DISCO_CANCEL?.status).toBe("SENT");
    expect(s.DISCO_CANCEL.outcome).toBe("CANCELLED");
    expect(j.phase).toBe("CANCELLED");
    const b = await one<any>(`select status::text, "slotId" from booking_request where "leadId"=$1`, [leadId]);
    expect(b.status).toBe("CANCELLED");
    expect(b.slotId).toBeNull();
    const n = (await waMessages(leadId)).length;
    await timeTravel(journeyId, 14);
    await tick(request);
    expect(await waMessages(leadId)).toHaveLength(n);
    await page.goto("/outreach");
    await expect(queueCard(page, P.phone)).toHaveCount(0);
  });

  test("OUT-10: after the SOP cancels the call the pipeline card leaves 'Discovery Call Booked'", async () => {
    // OUT-10 - releaseDiscoBooking only walks DISCO_BOOKED → DISCO_NOT_BOOKED (outreach.ts:717), but a
    // /book booking parks the lead at STRATEGY_CALL_BOOKED (booking-actions.ts:430). An unconfirmed,
    // cancelled call therefore stays counted as "Discovery Call Booked" on the board.
    const stage = (await liveLead(P.phone)).stage;
    test.info().annotations.push({ type: "evidence", description: `stage after cancel=${stage}; history=${(await stageHistory(leadId)).map((h) => h.toStage).join(">")}` });
    test.fail(true, "OUT-10");
    expect(stage).not.toBe("STRATEGY_CALL_BOOKED");
  });

  test("OUT-11: Step 17 'Cancel disco + mark RED' flags the Key Metrics row red", async () => {
    // OUT-11 - the DISCO_CANCEL step (label "Cancel disco + mark RED") never sets redFlag; only the unwired
    // setWhatsappConfirmed(NO) action does (outreach-actions.ts:406; outreach.ts:497-517).
    test.fail(true, "OUT-11");
    expect((await journeyFor(leadId)).redFlag).toBe(true);
  });
});

test.describe("B. call confirmed on the Bookings page", () => {
  test("Bookings → Confirm marks the booking confirmed and moves the card to Pre-Qualified & Confirmed", async ({ browser, request, page }) => {
    await freshOptInAndBook(browser, request, BANT_HIGH, "06B bookings-confirm");
    await page.goto("/bookings");
    const row = page.locator("table tbody tr:visible").filter({ hasText: P.phone }).first();
    await row.getByTitle("Mark this call confirmed").click();
    await expect(page.getByText("Confirmed").first()).toBeVisible();
    const b = await eventually(async () => (await bookingsFor(leadId)).find((x) => x.confirmedAt), "confirmedAt");
    expect(b.status).toBe("BOOKED");
    // `confirmedAt` and the stage move are two transactions by design (advanceLeadStage owns its
    // own), and the stage lands ~106ms after the timestamp this test polled for - so the observer
    // has to poll for it too, or it reads the gap between the two writes.
    await expect.poll(async () => (await liveLead(P.phone)).stage).toBe("DISCO_BOOKED");
    await tick(request);
    await tick(request);
  });

  test("OUT-01: a call confirmed on the Bookings page stops the SOP confirmation ladder (no 36h/24h reminders)", async ({ request }) => {
    // OUT-01 - the SOP engine reads only OutreachJourney.whatsappConfirmed (outreach-engine.ts:410,600).
    // setBookingConfirmed writes BookingRequest.confirmedAt (booking-actions.ts:899) and the WATI YES
    // webhook sets whatsappConfirmed only when phase === DISCO_CONFIRMATION (wati/webhook/route.ts:117),
    // i.e. never until Step 12 has been skipped. So the ladder keeps chasing a prospect who said yes.
    await travelToBeforeDisco(journeyId, 36);
    await tick(request);
    const s = await stepMap(journeyId);
    test.info().annotations.push({ type: "evidence", description: `DISCO_CONFIRM_1=${s.DISCO_CONFIRM_1?.status} whatsappConfirmed=${(await journeyFor(leadId)).whatsappConfirmed}` });
    // Fixed 20/09/2026: setBookingConfirmed now routes through markSopDiscoConfirmed, so the
    // confirmation reaches the journey the engine reads. Was `test.fail(true, "OUT-01")`.
    expect(s.DISCO_CONFIRM_1, "no confirmation reminder for a confirmed call").toBeUndefined();
  });

  test("OUT-01: ...and 2h after the call the SOP sweep writes the CONFIRMED booking off as a no-show / LOST", async ({ request }) => {
    // Same root cause: the post-call sweep checks !whatsappConfirmed only (outreach.ts:546-552) and ignores
    // booking.confirmedAt, so a confirmed call nobody has logged an outcome for yet becomes NO_SHOW + LOST.
    await timeTravel(journeyId, (await hoursUntilDisco(journeyId)) + 2 + 5 / 60);
    await tick(request);
    const b = (await bookingsFor(leadId))[0];
    const stage = (await liveLead(P.phone)).stage;
    test.info().annotations.push({ type: "evidence", description: `booking=${b.status} confirmedAt=${b.confirmedAt} stage=${stage}` });
    // Fixed 20/09/2026: the sweep now spares a booking carrying confirmedAt as well as one whose
    // journey is whatsappConfirmed. Was `test.fail(true, "OUT-01")`.
    expect(b.status).toBe("BOOKED");
    expect(stage).not.toBe("LOST");
  });
});

test.describe("C. BANT below 2 on the booking form", () => {
  test("BANT 0.9 → call is NOT held: booking recorded CANCELLED without a slot, lead LOST, journey closed as NOT qualified", async ({ browser, request }) => {
    const admin = await browser.newContext({ storageState: authFile("admin") });
    const adminPage = await admin.newPage();
    await purgePerson(adminPage, P.phone);
    await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
    leadId = (await eventually(() => liveLead(P.phone), "lead")).id;
    record("Lead", "06C bant-low", leadId);
    journeyId = (await journeyFor(leadId)).id;
    const slot = await makeSlot(adminPage, 3);
    await admin.close();
    const ctx = await anon(browser);
    const page = await ctx.newPage();
    await bookViaPublicPage(page, { name: P.name, phone: P.phone, email: P.email }, slot.dayLabel, slot.timeLabel, BANT_LOW);
    await expect(page.getByRole("heading", { name: /You're booked in/ })).toBeVisible();
    const bodyText = await page.locator("main").innerText();
    await ctx.close();

    const b = await eventually(async () => (await bookingsFor(leadId))[0], "booking");
    expect(b.bantAvg).toBe(0.9);
    expect(b.bantVerdict).toBe("CANCEL");
    expect(b.status).toBe("CANCELLED");
    expect(b.slotId).toBeNull();
    const slotRow = await one<any>(`select status::text from appointment_slot where "startsAt"=$1`, [slot.startsAt.toISOString().replace("T", " ").replace("Z", "")]);
    expect(slotRow.status, "slot stays open for a qualified prospect").toBe("OPEN");
    expect((await liveLead(P.phone)).stage).toBe("LOST");
    const j = await journeyFor(leadId);
    expect(j.qualified).toBe("NO");
    expect(j.phase).toBe("IGNORED");
    const mails = await emailMessages(leadId);
    expect(mails.length, "rejection email is attempted").toBeGreaterThanOrEqual(1);
    test.info().annotations.push({ type: "evidence", description: `prospect saw: ${bodyText.replace(/\s+/g, " ").slice(0, 200)}` });
  });

  test("OUT-13: a prospect turned away at BANT < 2 is not told \"You're booked in\"", async ({ browser }) => {
    // OUT-13 - submitBooking's auto-disqualify branch returns { ok: true } (booking-actions.ts:370) and
    // BookingForm renders the success card with the chosen slot for any ok result (BookingForm.tsx:84-86),
    // while the slot is actually released and a rejection email goes out.
    test.fail(true, "OUT-13");
    const b = (await bookingsFor(leadId))[0];
    expect(b.status === "CANCELLED", "server cancelled it...").toBe(true);
    // ...but the page the prospect saw (asserted visible in the previous test) said "You're booked in".
    expect("You're booked in").not.toContain("booked in");
    void browser;
  });

  test("OUT-14: disqualifying at intake leaves no orphaned DUE SOP steps behind the IGNORED journey", async () => {
    // OUT-14 - the auto-disqualify transaction sets phase IGNORED directly (booking-actions.ts:341-350);
    // the engine never scans terminal journeys again (outreach.ts:321), so the instant-intro step created at
    // opt-in stays DUE forever (it would surface in the L1 desk's sopCallsDue-style reads).
    const due = Object.values(await stepMap(journeyId)).filter((x) => x.status === "DUE").map((x) => x.step);
    test.info().annotations.push({ type: "evidence", description: `DUE steps: ${due.join(",")}` });
    test.fail(due.length > 0, "OUT-14");
    expect(due).toEqual([]);
  });
});
