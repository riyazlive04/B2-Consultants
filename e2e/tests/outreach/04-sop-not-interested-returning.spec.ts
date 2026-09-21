import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import {
  FENCE, HAS_DB, IS_PROD, ensureLocalOutreachConfig, eventually, journeyFor, liveLead, optInViaPabbly, pabblyKey,
  purgePerson, queueCard, record, stageHistory, stepMap, tick, timeTravel, waMessages, workQueue,
} from "../../helpers/outreach";

/**
 * SOP branch: Step 8 call → NOT interested → End. Then the same person opts in again a few days later
 * (returning opt-in on a dormant-but-not-LOST lead), and an archived lead opting in.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let journeyId = "";

test.beforeAll(async ({ browser }) => {
  test.skip(IS_PROD || !HAS_DB, "local driver (prod needs ~4h real time: E2E_PROD_LONG, not automated)");
  await ensureLocalOutreachConfig();
  const ctx = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await ctx.newPage(), P.phone);
  await ctx.close();
});

test("chase to the Step 8 call (intro, call, 2h check, follow-ups, 1h checks)", async ({ request, page }) => {
  test.skip(!pabblyKey());
  await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  leadId = (await eventually(() => liveLead(P.phone), "lead")).id;
  record("Lead", "04 not-interested", leadId);
  journeyId = (await journeyFor(leadId)).id;
  await eventually(async () => (await stepMap(journeyId)).INTRO_WHATSAPP, "intro");
  await workQueue(page, P.phone, [[/^Step 3: /, "Mark sent"], [/^Step 3b: /, "Mark sent"], [/^Step 4: /, "No answer"]]);
  await timeTravel(journeyId, 2 + 1 / 60);
  await tick(request);
  await workQueue(page, P.phone, [[/^Step 6: /, "Mark sent"], [/^Step 6b: /, "Mark sent"]]);
  await timeTravel(journeyId, 1 + 1 / 60);
  await tick(request);
  await workQueue(page, P.phone, [[/^Step 7b: /, "Mark sent"]]);
  await timeTravel(journeyId, 1 + 1 / 60);
  await tick(request);
  expect((await stepMap(journeyId)).FOLLOWUP_CALL?.status).toBe("DUE");
});

test("Step 8 'Answered - NO' ends the cycle at once: IGNORED, final check never scheduled to fire", async ({ page, request }) => {
  const handled = await workQueue(page, P.phone, [[/^Step 8: /, "Answered - NO"]]);
  expect(handled).toHaveLength(1);
  const j = await journeyFor(leadId);
  expect(j.phase).toBe("IGNORED");
  const s = await stepMap(journeyId);
  expect(s.FOLLOWUP_CALL.outcome).toBe("NO");
  expect(s.FINAL_CHECK.status).toBe("SUPERSEDED");
  const msgs = (await waMessages(leadId)).length;
  await timeTravel(journeyId, 6);
  await tick(request);
  expect(await waMessages(leadId)).toHaveLength(msgs);
  await page.goto("/outreach");
  await expect(queueCard(page, P.phone)).toHaveCount(0);
});

test("OUT-08: 'not interested' (SOP End) takes the card off the live pipeline like the final check does", async () => {
  // OUT-08 - only the FINAL_CHECK branch moves the card to LOST (outreach.ts:366-368). The Step 8 NO
  // branch sets IGNORED via refreshJourney (outreach-actions.ts:191) and leaves Lead.stage at
  // WHATSAPP_SENT, so a prospect who said "not interested" keeps inflating the open pipeline and stays
  // in the callback chase's CHASEABLE_STAGES.
  test.fail(true, "OUT-08");
  expect((await liveLead(P.phone)).stage).toBe("LOST");
});

test("returning opt-in on the dormant lead restarts the journey clock (no duplicate lead)", async ({ request }) => {
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  expect(res.body).toMatchObject({ created: false, deduped: "phone", reopened: true });
  const lead = await liveLead(P.phone);
  expect(lead.id).toBe(leadId);
  expect((await stageHistory(leadId)).map((h) => h.toStage)).toEqual(["NEW_LEAD", "WHATSAPP_SENT"]);
  expect((await journeyFor(leadId)).phase).toBe("OPT_IN");
});

test("OUT-02: the returning prospect is chased again (new Step 3) rather than instantly re-IGNORED", async ({ request, page }) => {
  test.fail(true, "OUT-02");
  await tick(request);
  await page.goto("/outreach");
  expect((await journeyFor(leadId)).phase).not.toBe("IGNORED");
  await expect(queueCard(page, P.phone)).toContainText("Step 3: WhatsApp intro", { timeout: 3000 });
});

test("an ARCHIVED lead that opts in again is restored and put back in front of a caller", async ({ request, page }) => {
  // archive through the UI
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: /^Leads$/ }).click();
  await page.getByPlaceholder("Filter leads…").fill(P.phone);
  const row = page.locator("table tbody tr:visible").filter({ hasText: P.phone }).first();
  await row.getByRole("button", { name: "Delete" }).click();
  await eventually(async () => !(await liveLead(P.phone)), "archived");
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  expect(res.body).toMatchObject({ created: false, reopened: true });
  const lead = await liveLead(P.phone);
  expect(lead?.id).toBe(leadId);
  expect(lead.stage).toBe("NEW_LEAD");
});
