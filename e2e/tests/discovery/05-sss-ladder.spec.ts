/**
 * SOP right-hand column, after "Book sales call before closing the discovery call":
 *   24h window -> WhatsApp reminder; 12h window -> WhatsApp; Confirmed? yes -> update key metrics.
 *   No -> wait to 6h -> WhatsApp; Confirmed? No -> wait to 3h -> CALL the prospect; confirmed? yes ->
 *   update key metrics; No -> CANCEL the SSS call -> End.
 *
 * App: OutreachJourney SSS ladder (SSS_CONFIRM_1/2/3 WhatsApp, SSS_CONFIRM_CALL, SSS_CANCEL_MSG,
 * SSS_CANCEL), gated on journey.highlyQualified === true && sssAt.
 *
 * DSC-01 means NO screen can put a prospect into that state (setHighlyQualified is never called from
 * the UI), so every test here seeds it in the DB - the local driver - and then drives the ladder
 * through the real queue UI, the real WATI webhook and runCron("outreach") with DB time travel.
 *
 * Prod: unreachable by UI (DSC-01) - the whole file skips. If DSC-01 is fixed, the prod driver is:
 * book the SSS 11h ahead (inside the 12h window) and assert the timeline/conversations - see
 * findings "prod-run notes" for the exact messages that would go to the fenced lead.
 */
import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB, FENCE } from "../../helpers/target";
import { BASE_URL } from "../../playwright.config";
import { RUN } from "../../helpers/app";
import {
  waitForNextStep, clickStepAction, setZoomLinkOnCard, queueCard, openOutreach, pageAs, openSssCalendar,
} from "../../helpers/discovery-ui";
import {
  seedSssProspect, seedSssSlot, seedStep, timeTravelJourney, stepMap, steps, journeyRow, leadRow, sssSlotRow, dq,
  ensureOutreachEngineEnabledLocal, runOutreachCron, seedOutboundWhatsApp, outboundWhatsApp, closeDiscoveryDb, H, M, istDayKey,
} from "../../helpers/discovery-db";

test.use({ storageState: authFile("asma") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });
test.beforeAll(async () => { if (HAS_DB) await ensureOutreachEngineEnabledLocal(); });
test.beforeEach(() => {
  test.setTimeout(480_000);
  test.skip(!HAS_DB, "DSC-01: no UI can start the SSS ladder, so there is no prod driver; local DB driver only");
});

const S19 = "Step 19: SSS confirmation 1 (+ video)";
const S20 = "Step 20: SSS confirmation 2";
const S20b = "Step 20b: SSS confirmation 3";
const S20c = "Step 20c: SSS confirmation call";
const S21 = "Step 21: SSS cancellation message";

const hoursFromNow = (h: number) => new Date(Math.floor((Date.now() + h * H) / M) * M);
const istDateTime = (d: Date) => {
  const f = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d);
  const i = f.lastIndexOf(", ");
  return { date: f.slice(0, i), time: f.slice(i + 2) };
};
const near = (a: Date | undefined, b: Date, tolMin = 2) => !!a && Math.abs(a.getTime() - b.getTime()) <= tolMin * M;

async function watiReply(page: Page, text: string, from = FENCE.secondary.phone) {
  const res = await page.request.post(`${BASE_URL}/api/wati/webhook?key=e2e-wati`, {
    data: { eventType: "message", owner: false, waId: from.replace(/\D/g, ""), text },
    timeout: 60_000,
  });
  expect(res.status(), await res.text()).toBe(200);
}

test("unconfirmed all the way: 24h -> 12h -> 6h WhatsApp, 3h call, then the SSS is cancelled", async ({ page, request }) => {
  const sssAt0 = hoursFromNow(30);
  const p = await seedSssProspect({ label: "SSS ladder unconfirmed", sssAt: sssAt0 });
  const sss = () => journeyRow(p.journeyId).then((j) => j.sssAt as Date);

  await runOutreachCron(request);
  let s = await stepMap(p.journeyId);
  expect(s.SSS_CONFIRM_1?.status, "Step 19 materialised as soon as the SSS is known").toBe("DUE");
  expect(near(s.SSS_CONFIRM_1.dueAt, new Date(sssAt0.getTime() - 24 * H)), "Step 19 due at T-24h").toBe(true);
  expect(s.SSS_CONFIRM_2, "Step 20 waits for Step 19").toBeUndefined();

  // 6.5h pass -> inside the 24h window.
  await timeTravelJourney(p.journeyId, 6.5);
  await runOutreachCron(request);
  let card = await waitForNextStep(page, p.lead.name, S19);
  const when = istDateTime(await sss());
  await expect(card).toContainText(`Your Success Strategy Session is scheduled for *${when.date}* at *${when.time}*`);
  await expect(card).toContainText("Please reply *YES* to confirm.");
  // The prospect's number is +49: a bare IST clock time reads as German local time.
  expect.soft(await card.innerText(), "DSC-15: SSS message gives an IST time with no timezone to a +49 (Germany) prospect").toMatch(/\b(IST|CET|CEST)\b/);
  await clickStepAction(page, card, "Mark sent");
  s = await stepMap(p.journeyId);
  expect(s.SSS_CONFIRM_1.status).toBe("SENT");
  expect(s.SSS_CONFIRM_1.renderedBody).toContain("Ameen asked me to send you this quick video");
  expect(near(s.SSS_CONFIRM_2?.dueAt, new Date((await sss()).getTime() - 12 * H)), "Step 20 armed at T-12h").toBe(true);

  // 12h pass -> inside the 12h window. Step 20 needs the Zoom link first.
  await timeTravelJourney(p.journeyId, 12);
  await runOutreachCron(request);
  card = await waitForNextStep(page, p.lead.name, S20);
  await expect(card).toContainText("<<INSERT ZOOM LINK HERE>>");
  await setZoomLinkOnCard(page, card, "https://zoom.us/j/9990001111");
  card = await waitForNextStep(page, p.lead.name, S20);
  await expect(card).toContainText("are you joining the Success Strategy Session with Ameen");
  await expect(card).toContainText("https://zoom.us/j/9990001111");
  await clickStepAction(page, card, "Mark sent");
  s = await stepMap(p.journeyId);
  expect(s.SSS_CONFIRM_2.status).toBe("SENT");
  expect(near(s.SSS_CONFIRM_3?.dueAt, new Date((await sss()).getTime() - 6 * H)), "Step 20b armed at T-6h").toBe(true);

  // 6h pass -> the 6h message.
  await timeTravelJourney(p.journeyId, 6);
  await runOutreachCron(request);
  card = await waitForNextStep(page, p.lead.name, S20b);
  await clickStepAction(page, card, "Mark sent");
  s = await stepMap(p.journeyId);
  expect(near(s.SSS_CONFIRM_CALL?.dueAt, new Date((await sss()).getTime() - 3 * H)), "Step 20c call armed at T-3h").toBe(true);

  // 3h pass -> the call task, for a human.
  await timeTravelJourney(p.journeyId, 3);
  await runOutreachCron(request);
  card = await waitForNextStep(page, p.lead.name, S20c);
  await expect(card.getByRole("button", { name: "Answered - YES" })).toBeVisible();
  await clickStepAction(page, card, "No answer");
  s = await stepMap(p.journeyId);
  expect(s.SSS_CONFIRM_CALL.outcome).toBe("NO_ANSWER");
  // SOP: "Call Confirmed? No -> Cancel the SSS call" - straight after the failed call.
  expect.soft(s.SSS_CANCEL_MSG?.dueAt && s.SSS_CANCEL_MSG.dueAt.getTime() <= Date.now() + M,
    `DSC-20: cancellation deferred to T-${2}h instead of following the failed 3h call (due ${s.SSS_CANCEL_MSG?.dueAt?.toISOString()})`).toBe(true);

  await timeTravelJourney(p.journeyId, 1);
  await runOutreachCron(request);
  card = await waitForNextStep(page, p.lead.name, S21);
  await expect(card).toContainText("we had to release your Success Strategy Session slot for another candidate");
  await clickStepAction(page, card, "Mark sent");
  s = await stepMap(p.journeyId);
  expect(s.SSS_CANCEL?.status, "Step 22/23 raised once the cancellation notice is out").toBeDefined();

  for (let i = 0; i < 2; i++) await runOutreachCron(request);
  const dup = await dq(`select step, count(*)::int from outreach_step_log where "journeyId" = $1 group by step having count(*) > 1`, [p.journeyId]);
  expect(dup, "every SSS step fires once").toEqual([]);
  expect((await outboundWhatsApp(p.lead.id)).filter((m: any) => String(m.kind).startsWith("SOP_SSS")), "manual path: nothing auto-sent (autoSend off for SSS steps)").toEqual([]);

  // SOP end state: SSS cancelled.
  const slot = await sssSlotRow(p.sssSlotId!);
  const j = await journeyRow(p.journeyId);
  s = await stepMap(p.journeyId);
  expect.soft(s.SSS_CANCEL.status, "DSC-03: SSS_CANCEL has no executor - it sits DUE forever").toBe("SENT");
  expect.soft(slot.status, "DSC-03: the unconfirmed SSS slot is never released").toBe("OPEN");
  expect.soft(slot.journeyId, "DSC-03: prospect still attached to the SSS slot").toBeNull();
  expect.soft(j.phase, "DSC-03: journey never reaches CANCELLED").toBe("CANCELLED");
  expect.soft((await leadRow(p.lead.id)).stage, "DSC-03: lead still 'SSS Call Booked'").not.toBe("SSS_BOOKED");
});

test("booked 11h ahead (inside 12h window) and confirmed by a WhatsApp YES: ladder stops, metrics update", async ({ page, request }) => {
  const p = await seedSssProspect({ label: "SSS confirmed by reply", sssAt: hoursFromNow(11), zoomLink: "https://zoom.us/j/9990002222" });
  await runOutreachCron(request);
  let s = await stepMap(p.journeyId);
  expect(s.SSS_CONFIRM_1?.status).toBe("DUE");
  expect(s.SSS_CONFIRM_1.dueAt.getTime(), "late booking: Step 19 is already due").toBeLessThanOrEqual(Date.now());

  const card = await waitForNextStep(page, p.lead.name, S19);
  await clickStepAction(page, card, "Mark sent");
  s = await stepMap(p.journeyId);
  // Booked inside 12h: the 24h and 12h messages are both due at once and go back to back.
  expect.soft(s.SSS_CONFIRM_2?.dueAt && s.SSS_CONFIRM_2.dueAt.getTime() > Date.now(),
    "DSC-20: an SSS booked inside the 12h window gets Step 19 AND Step 20 due immediately, back to back").toBe(true);

  // A negated "yes" must not confirm.
  await seedOutboundWhatsApp(p.lead, "SOP_SSS_CONFIRM_1");
  await watiReply(page, "Yes but I can't make it, please reschedule");
  expect((await journeyRow(p.journeyId)).salesCallConfirmed).toBe(false);

  // The real confirmation. A live auto-send leaves an outbound row the reply links to.
  await seedOutboundWhatsApp(p.lead, "SOP_SSS_CONFIRM_1");
  await watiReply(page, "YES");
  let j = await journeyRow(p.journeyId);
  expect(j.salesCallConfirmed, "WhatsApp YES sets Sales Call Confirmed").toBe(true);

  await runOutreachCron(request);
  j = await journeyRow(p.journeyId);
  expect(j.phase, "confirmed SSS completes the outreach journey").toBe("COMPLETED");
  s = await stepMap(p.journeyId);
  const stillDue = Object.values(s).filter((x) => x.step.startsWith("SSS_") && x.status === "DUE");
  expect(stillDue, "no SSS reminder left DUE after confirmation").toEqual([]);

  // Hours pass; nothing else is raised or sent.
  await timeTravelJourney(p.journeyId, 8);
  await runOutreachCron(request);
  const after = await stepMap(p.journeyId);
  expect(Object.keys(after).filter((k) => k.startsWith("SSS_")).sort()).toEqual(Object.keys(s).filter((k) => k.startsWith("SSS_")).sort());
  await openOutreach(page);
  await expect(queueCard(page, p.lead.name), "a completed journey leaves the queue").toHaveCount(0);

  // "Update key metrics": Key Metrics column flips; the board should say "SSS Call Confirmed".
  const { ctx, page: admin } = await pageAs(page.context().browser()!, "admin");
  try {
    await admin.goto("/outreach");
    await admin.getByRole("tab", { name: "Key Metrics" }).click();
    await admin.getByPlaceholder("Filter by name, email, owner…").fill(p.lead.name);
    const row = admin.locator("tr").filter({ hasText: p.lead.name }).first();
    await expect(row, "Key Metrics lists the prospect").toBeVisible();
    await expect(row, "Key Metrics 'Sales Call Confirmed' column flips to YES").toContainText("YES Sales call confirmed");
  } finally {
    await ctx.close();
  }
  expect.soft((await leadRow(p.lead.id)).stage, "DSC-06: a confirmed SSS never moves the lead to 'SSS Call Confirmed' (SSS_COMPLETED)").toBe("SSS_COMPLETED");
});

test("confirmation paths other than a reply to a live send: manual send + reply, manual toggle", async ({ page, request }) => {
  const p = await seedSssProspect({ label: "SSS manual path reply", sssAt: hoursFromNow(20) });
  await runOutreachCron(request);
  const card = await waitForNextStep(page, p.lead.name, S19);
  await clickStepAction(page, card, "Mark sent"); // specialist sent it by hand - the SOP default (autoSend off)
  expect(await outboundWhatsApp(p.lead.id), "manual 'Mark sent' writes no WhatsApp message row").toEqual([]);
  await watiReply(page, "YES");
  const j = await journeyRow(p.journeyId);
  expect.soft(j.salesCallConfirmed,
    "DSC-07: after a manual 'Mark sent' the prospect's YES reply cannot be linked to the journey - the SSS is never confirmed").toBe(true);
  // No manual "Sales call confirmed" toggle anywhere a specialist works (queue tabs + Key Metrics).
  await openOutreach(page);
  let controls = 0;
  for (const tab of [/Due now/, /Scheduled/, /In flight/, "Key Metrics"]) {
    await page.getByRole("tab", { name: tab }).click();
    controls += await page.getByRole("button", { name: /sales call confirmed|confirm(ed)? (the )?SSS|mark confirmed/i }).count();
  }
  expect.soft(controls, "DSC-07: no control to record an SSS confirmation by hand (setSalesCallConfirmed is unused)").toBeGreaterThan(0);
});

test("3h call answered YES counts as confirmation", async ({ page, request }) => {
  const sssAt = hoursFromNow(2.5);
  const p = await seedSssProspect({ label: "SSS verbal yes", sssAt, zoomLink: "https://zoom.us/j/9990003333" });
  for (const [step, h] of [["SSS_CONFIRM_1", 24], ["SSS_CONFIRM_2", 12], ["SSS_CONFIRM_3", 6]] as const) {
    await seedStep(p.journeyId, step, { status: "SENT", dueAt: new Date(sssAt.getTime() - h * H), actedAt: new Date(sssAt.getTime() - h * H + M), channel: "WHATSAPP" });
  }
  await runOutreachCron(request);
  const card = await waitForNextStep(page, p.lead.name, S20c);
  await clickStepAction(page, card, "Answered - YES");
  await runOutreachCron(request);
  const s = await stepMap(p.journeyId);
  expect(s.SSS_CONFIRM_CALL.outcome).toBe("YES");
  expect(s.SSS_CANCEL_MSG, "a YES on the call stops the cancellation").toBeUndefined();
  const j = await journeyRow(p.journeyId);
  expect.soft(j.salesCallConfirmed, "DSC-05: a YES on the 3h confirmation call does not set Sales Call Confirmed").toBe(true);
  expect.soft(j.phase, "DSC-05: journey stays open in SSS_CONFIRMATION after a verbal YES").toBe("COMPLETED");
});

/** A second open SSS slot on the same IST day as `at`, `deltaH` hours away (never across midnight). */
function sameDayTarget(at: Date, deltaH: number) {
  const plus = new Date(at.getTime() + deltaH * H);
  return istDayKey(plus) === istDayKey(at) ? plus : new Date(at.getTime() - deltaH * H);
}

async function moveOnSssCalendar(page: Page, fromAt: Date, toAt: Date) {
  const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(d);
  await openSssCalendar(page, istDayKey(fromAt));
  const from = page.locator("div.group\\/cell").filter({ hasText: `${hm(fromAt)} · 45m` }).filter({ hasText: RUN }).first();
  // dispatchEvent, not a pointer click: hovering a narrow cell reveals its Block/Delete icon buttons
  // on top of it, and a click landing on "Block slot" also bubbles to the cell's place handler
  // (DSC-23) - blocking the very slot being booked.
  await from.locator("div[draggable=true]").dispatchEvent("click");
  await expect(page.getByText(/Placing/)).toBeVisible();
  const to = page.locator("div.group\\/cell").filter({ hasText: `${hm(toAt)} · 45m` }).filter({ hasText: "Open" }).first();
  await to.getByText("Open", { exact: true }).dispatchEvent("click");
  await expect(page.getByText(/Prospect moved - new time sent/).first()).toBeVisible({ timeout: 30_000 });
}

test("SSS rescheduled before confirmation: reminders re-armed for the new time, nothing for the old", async ({ browser, request }) => {
  const oldAt = hoursFromNow(11);
  const p = await seedSssProspect({ label: "SSS moved unconfirmed", sssAt: oldAt, zoomLink: "https://zoom.us/j/9990004444" });
  await seedStep(p.journeyId, "SSS_CONFIRM_1", { status: "SENT", dueAt: new Date(oldAt.getTime() - 24 * H), actedAt: new Date(Date.now() - 30 * M), channel: "WHATSAPP" });
  await runOutreachCron(request);
  let s = await stepMap(p.journeyId);
  expect(near(s.SSS_CONFIRM_2?.dueAt, new Date(oldAt.getTime() - 12 * H))).toBe(true);

  const newAt = sameDayTarget(oldAt, 5);
  const newSlot = await seedSssSlot({ startsAt: newAt });
  const { ctx, page } = await pageAs(browser, "admin");
  try {
    await moveOnSssCalendar(page, oldAt, newAt);
  } finally {
    await ctx.close();
  }
  const j = await journeyRow(p.journeyId);
  expect(j.sssAt.getTime(), "journey follows the slot").toBe(newAt.getTime());
  expect((await sssSlotRow(p.sssSlotId!)).status, "old SSS slot freed").toBe("OPEN");
  expect((await sssSlotRow(newSlot)).status).toBe("BOOKED");
  expect((await outboundWhatsApp(p.lead.id)).map((m: any) => m.kind), "the prospect is told the new time (skipped locally by the allowlist)").toContain("SSS_RESCHEDULED");

  await runOutreachCron(request);
  s = await stepMap(p.journeyId);
  expect.soft(s.SSS_CONFIRM_2?.dueAt?.getTime(), `DSC-04: Step 20 still anchored to the OLD SSS time (${oldAt.toISOString()}), not the new one`).toBe(newAt.getTime() - 12 * H);
  expect.soft(s.SSS_CONFIRM_1?.status === "SENT" && s.SSS_CONFIRM_1.dueAt.getTime() === newAt.getTime() - 24 * H,
    "DSC-04: the 24h reminder is never re-armed for the new time").toBe(true);
});

test("SSS rescheduled AFTER confirmation: the new time must be re-confirmed", async ({ browser, request }) => {
  const oldAt = hoursFromNow(11);
  const p = await seedSssProspect({ label: "SSS moved confirmed", sssAt: oldAt, salesCallConfirmed: true, zoomLink: "https://zoom.us/j/9990005555" });
  const newAt = sameDayTarget(oldAt, 4);
  await seedSssSlot({ startsAt: newAt });
  const { ctx, page } = await pageAs(browser, "admin");
  try {
    await moveOnSssCalendar(page, oldAt, newAt);
  } finally {
    await ctx.close();
  }
  let j = await journeyRow(p.journeyId);
  expect(j.salesCallConfirmed, "move resets Sales Call Confirmed").toBe(false);
  await runOutreachCron(request);
  j = await journeyRow(p.journeyId);
  const s = await steps(p.journeyId);
  expect.soft(j.phase, "DSC-04: journey stays COMPLETED (terminal) after the move, so the engine never scans it again").toBe("SSS_CONFIRMATION");
  expect.soft(s.filter((x) => x.step.startsWith("SSS_")).length, "DSC-04: no SSS confirmation step at all for the new time").toBeGreaterThan(0);
});
