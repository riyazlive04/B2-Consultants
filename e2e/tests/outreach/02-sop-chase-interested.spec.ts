import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import {
  FENCE, HAS_DB, HR, IS_PROD, MIN, PROD_LONG, ensureLocalOutreachConfig, eventually, fakeTemplate, journeyFor, liveLead,
  optInViaPabbly, pabblyKey, purgePerson, queueCard, record, stageHistory, stepMap, tick, timeTravel, waMessages, workQueue,
} from "../../helpers/outreach";

/**
 * SOP branch: reaction < 5 min → Step 3 WhatsApp → Step 4 call → (2h) not booked → Step 6 WhatsApp →
 * (1h) not booked → Step 8 call → INTERESTED → wait 2h → not booked → End.
 * Then: the prospect opts in AGAIN (returning opt-in on a LOST lead).
 *
 * Local driver: DB time travel on this journey + /api/cron/outreach.
 * Prod driver: ~5h of real waiting (E2E_PROD_LONG=1), sends SOP_INTRO, SOP_FOLLOWUP (+email), SOP_FOLLOWUP_2.
 */
test.describe.configure({ mode: "serial", timeout: IS_PROD ? 7 * HR : 240_000 });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let journeyId = "";
let optInAt = 0;

test.beforeAll(async ({ browser }) => {
  if (HAS_DB) await ensureLocalOutreachConfig();
  const ctx = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await ctx.newPage(), P.phone);
  await ctx.close();
});

test.beforeEach(() => {
  test.skip(IS_PROD && !PROD_LONG, "prod: this ladder needs ~5h of real time - run with E2E_PROD_LONG=1");
  test.skip(IS_PROD, "prod driver for the time ladder is not automated yet (see findings prod-run notes)");
  test.skip(!pabblyKey());
});

test("opt-in → Step 3 sent inside 5 min → Step 4 call raised immediately, checks scheduled from opt-in", async ({ request, page }) => {
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  expect(res.body.created).toBe(true);
  const lead = await eventually(() => liveLead(P.phone), "lead");
  leadId = lead.id;
  record("Lead", "02 chase-interested", leadId);
  const j = await journeyFor(leadId);
  journeyId = j.id;
  optInAt = new Date(j.optInAt).getTime();
  await eventually(async () => (await stepMap(journeyId)).INTRO_WHATSAPP, "instant intro step");

  const handled = await workQueue(page, P.phone, [
    [/^Step 3: WhatsApp intro/, "Mark sent"],
    [/^Step 3b: Welcome email/, "Mark sent"],
    [/^Step 4: First call/, "No answer"],
  ]);
  expect(handled.map((h) => h.split(":")[0])).toEqual(expect.arrayContaining(["Step 3", "Step 3b", "Step 4"]));
  expect(Date.now() - optInAt, "Step 3 + Step 4 done inside the 5-minute reaction window").toBeLessThan(5 * MIN);

  const s = await stepMap(journeyId);
  expect(s.INTRO_WHATSAPP.status).toBe("SENT");
  expect(s.INTRO_WHATSAPP.renderedBody).toContain("Hi Mohamed");
  expect(s.FIRST_CALL.status).toBe("SENT");
  expect(s.FIRST_CALL.outcome).toBe("NO_ANSWER");
  expect(new Date(s.CHECK_1.dueAt).getTime() - optInAt).toBe(2 * HR);
  expect((await liveLead(P.phone)).stage, "a sent intro moves the card to WhatsApp Sent").toBe("WHATSAPP_SENT");
  // Card shows nothing actionable now - the check is 2h away.
  await page.goto("/outreach");
  await expect(queueCard(page, P.phone).getByRole("button", { name: "Mark sent" })).toHaveCount(0);
});

test("+2h: Step 5 check finds no booking → Step 6 WhatsApp (and 6b email) queued with the SOP_FOLLOWUP template", async ({ request, page }) => {
  await timeTravel(journeyId, 2 + 1 / 60);
  await tick(request);
  const s = await stepMap(journeyId);
  expect(s.CHECK_1.status).toBe("SENT");
  expect(s.CHECK_1.outcome).toBe("NOT_BOOKED");
  expect(s.FOLLOWUP_WHATSAPP?.status).toBe("DUE");
  expect(s.FOLLOWUP_EMAIL?.status).toBe("DUE");
  const fu = (await waMessages(leadId)).filter((m) => m.kind === "SOP_FOLLOWUP");
  expect(fu.length, "auto-send attempted the Step 6 template").toBeGreaterThanOrEqual(1);
  expect(fu[0].templateName).toBe(fakeTemplate("SOP_FOLLOWUP"));
  expect(fu[0].error).toContain("OUTBOUND_ALLOWLIST");

  const handled = await workQueue(page, P.phone, [
    [/^Step 6: WhatsApp follow-up/, "Mark sent"],
    [/^Step 6b: Email follow-up/, "Mark sent"],
  ]);
  expect(handled).toHaveLength(2);
});

test("+1h: Step 7 check → (engine-only Step 7b second WhatsApp) → +1h Step 7c check → Step 8 call raised", async ({ request, page }) => {
  await timeTravel(journeyId, 1 + 1 / 60);
  await tick(request);
  let s = await stepMap(journeyId);
  expect(s.CHECK_2.status).toBe("SENT");
  expect(s.CHECK_2.outcome).toBe("NOT_BOOKED");
  // Divergence (documented, founder cadence): the SOP goes straight from Step 7 to the Step 8 call.
  expect(s.FOLLOWUP_WHATSAPP_2?.status).toBe("DUE");
  expect(s.FOLLOWUP_CALL, "Step 8 is NOT raised after Step 7 as the SOP says - it waits for 7b/7c").toBeUndefined();
  await workQueue(page, P.phone, [[/^Step 7b: WhatsApp follow-up 2/, "Mark sent"]]);

  await timeTravel(journeyId, 1 + 1 / 60);
  await tick(request);
  s = await stepMap(journeyId);
  expect(s.CHECK_3.status).toBe("SENT");
  expect(s.FOLLOWUP_CALL?.status).toBe("DUE");
  await page.goto("/outreach");
  await expect(queueCard(page, P.phone)).toContainText("Step 8: Call follow-up - not booked");
  await expect(queueCard(page, P.phone)).toContainText("are you still interested");
});

test("Step 8 call: prospect is INTERESTED (Answered - YES) - the chase continues, nothing is closed yet", async ({ page }) => {
  const handled = await workQueue(page, P.phone, [[/^Step 8: Call follow-up/, "Answered - YES"]]);
  expect(handled).toHaveLength(1);
  const s = await stepMap(journeyId);
  expect(s.FOLLOWUP_CALL.outcome).toBe("YES");
  expect((await journeyFor(leadId)).phase).toBe("BOOKING_CHASE");
  expect(s.FINAL_CHECK?.status).toBe("DUE");
});

test("OUT-05: after an INTERESTED answer the SOP waits 2h before the final booking check", async () => {
  // OUT-05 - FINAL_CHECK is scheduled at optIn + finalCheckHours (5h) from the very start, not 2h after
  // the Step 8 call. With the default cadence the call is raised at +4h, so an interested prospect gets
  // ~1h (outreach-engine.ts:361-363, outreach-sop.ts:869).
  test.fail(true, "OUT-05");
  const s = await stepMap(journeyId);
  const gap = new Date(s.FINAL_CHECK.dueAt).getTime() - new Date(s.FOLLOWUP_CALL.actedAt!).getTime();
  expect(gap).toBeGreaterThanOrEqual(2 * HR - MIN);
});

test("final check: still not booked → End: journey IGNORED, card LOST, nothing further fires", async ({ request, page }) => {
  const s0 = await stepMap(journeyId);
  const hoursToFinal = (new Date(s0.FINAL_CHECK.dueAt).getTime() - Date.now()) / HR;
  await timeTravel(journeyId, Math.max(0, hoursToFinal) + 2 / 60);
  await tick(request);
  const j = await journeyFor(leadId);
  expect(j.phase).toBe("IGNORED");
  expect(j.ignoredAt).toBeTruthy();
  const s = await stepMap(journeyId);
  expect(s.FINAL_CHECK.status).toBe("SENT");
  expect(s.FINAL_CHECK.outcome).toBe("NOT_BOOKED");
  expect(Object.values(s).filter((x) => x.status === "DUE").map((x) => x.step)).toEqual([]);
  const lead = await liveLead(P.phone);
  expect(lead.stage).toBe("LOST");
  expect((await stageHistory(leadId)).map((h) => h.toStage)).toEqual(["NEW_LEAD", "WHATSAPP_SENT", "LOST"]);

  // Idempotent: more ticks, more time - no new steps, no new messages.
  const msgCount = (await waMessages(leadId)).length;
  const stepCount = Object.keys(s).length;
  await timeTravel(journeyId, 3);
  await tick(request);
  await tick(request);
  expect(Object.keys(await stepMap(journeyId))).toHaveLength(stepCount);
  expect(await waMessages(leadId)).toHaveLength(msgCount);

  await page.goto("/outreach");
  await expect(queueCard(page, P.phone)).toHaveCount(0);
  await page.getByRole("tab", { name: /^Closed/ }).click();
  await expect(page.locator("li").filter({ hasText: P.phone }).first()).toContainText("Ignored (dormant)");
});

test("returning opt-in on the LOST lead re-opens the card (NEW_LEAD + history) instead of duplicating it", async ({ request }) => {
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  expect(res.body).toMatchObject({ created: false, deduped: "phone", reopened: true });
  const leads = await liveLead(P.phone);
  expect(leads.id).toBe(leadId);
  expect(leads.stage).toBe("NEW_LEAD");
  expect((await stageHistory(leadId)).slice(-1)[0]).toMatchObject({ fromStage: "LOST", toStage: "NEW_LEAD" });
  const j = await journeyFor(leadId);
  expect(j.phase).toBe("OPT_IN");
  expect(Date.now() - new Date(j.optInAt).getTime()).toBeLessThan(2 * MIN);
});

test("OUT-02: the re-opened journey runs the SOP again (fresh Step 3 intro) instead of being re-closed on the next tick", async ({ request }) => {
  // OUT-02 - acceptReturningOptIn resets optInAt/phase but keeps the previous cycle's OutreachStepLog rows
  // (lead-intake.ts:380-384). planJourney sees INTRO_WHATSAPP already SENT and FINAL_CHECK already acted,
  // so nextPhase() returns IGNORED again on the first tick and no message is ever sent to the returning
  // prospect (outreach-engine.ts:632). The instant intro is also skipped because it only fires on `created`.
  test.fail(true, "OUT-02");
  await tick(request);
  const j = await journeyFor(leadId);
  const s = await stepMap(journeyId);
  expect(j.phase).not.toBe("IGNORED");
  expect(s.INTRO_WHATSAPP.status, "a new cycle should have a fresh, DUE intro").toBe("DUE");
});
