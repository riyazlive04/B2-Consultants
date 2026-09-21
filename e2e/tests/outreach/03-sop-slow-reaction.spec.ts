import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import {
  FENCE, HAS_DB, HR, IS_PROD, MIN, ensureLocalOutreachConfig, eventually, journeyFor, liveLead, optInViaPabbly,
  pabblyKey, purgePerson, queueCard, record, stepMap, tick, timeTravel, waMessages,
} from "../../helpers/outreach";

/**
 * SOP branch: reaction time > 5 min → check whether the lead booked → not booked → Step 3 WhatsApp
 * (→ Step 4 call). And the case where the team never acts at all.
 *
 * Local only: prod cannot stage a "nobody touched it" lead without leaving a real prospect unworked.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let journeyId = "";

test.beforeAll(async ({ browser }) => {
  test.skip(IS_PROD || !HAS_DB, "local driver only");
  await ensureLocalOutreachConfig();
  const ctx = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await ctx.newPage(), P.phone);
  await ctx.close();
});

test("opt-in, nobody reacts for 10 minutes: the queue flags the blown reaction window", async ({ request, page }) => {
  test.skip(IS_PROD || !pabblyKey());
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  expect(res.body.created).toBe(true);
  leadId = (await eventually(() => liveLead(P.phone), "lead")).id;
  record("Lead", "03 slow reaction", leadId);
  journeyId = (await journeyFor(leadId)).id;
  await eventually(async () => (await stepMap(journeyId)).INTRO_WHATSAPP, "instant intro step");
  await timeTravel(journeyId, 10 / 60);
  await page.goto("/outreach");
  await expect(queueCard(page, P.phone)).toContainText("Response time missed");
});

test("OUT-06: >5 min without contact → the SOP checks the booking straight away (then sends Step 3)", async ({ request }) => {
  test.skip(IS_PROD);
  // OUT-06 - the instant intro materialises INTRO_WHATSAPP at capture, and planJourney treats an existing
  // intro as proof of the FAST branch (outreach-engine.ts:246). So the ">5 min → check booking now" branch
  // is unreachable for every live-capture lead; Check 1 stays 2h out. (When it IS reachable - no intro
  // row - the engine goes the other way and skips Step 3 entirely: outreach-engine.ts:276-279.)
  test.fail(true, "OUT-06");
  await tick(request);
  const s = await stepMap(journeyId);
  expect(s.CHECK_1?.status, "booking check should run at the 5-minute breach").toBe("SENT");
});

test("while Step 3 sits unsent the engine schedules NO booking check at all - only the 5h write-off", async ({ page, request }) => {
  test.skip(IS_PROD);
  await tick(request);
  const s = await stepMap(journeyId);
  const optIn = new Date((await journeyFor(leadId)).optInAt).getTime();
  expect(s.CHECK_1, "Check 1 waits for the intro to be acted on").toBeUndefined();
  expect(s.INTRO_WHATSAPP.status).toBe("DUE");
  expect(new Date(s.FINAL_CHECK.dueAt).getTime() - optIn).toBe(5 * HR);
  await page.goto("/outreach");
  // The card label said "Step 10 path"; once the engine has run the card is on the Step 3 path.
  await expect(queueCard(page, P.phone)).toContainText(/Step 3b?: (WhatsApp intro|Welcome email)/);
});

test("OUT-07: a lead nobody ever contacted is not written off before the SOP's Step 3/4/8 contacts happen", async ({ request }) => {
  test.skip(IS_PROD);
  // OUT-07 - FINAL_CHECK is materialised for every live chase at optIn+5h regardless of whether Step 3 was
  // ever sent or any call made (outreach-engine.ts:361-363). At +5h the cron marks the journey IGNORED and
  // moves the card to LOST (outreach.ts:366-368) with zero SOP touches logged.
  await timeTravel(journeyId, 5 + 5 / 60);
  await tick(request);
  const j = await journeyFor(leadId);
  const s = await stepMap(journeyId);
  const touched = ["INTRO_WHATSAPP", "FIRST_CALL", "FOLLOWUP_WHATSAPP", "FOLLOWUP_CALL"].filter((k) => s[k]?.status === "SENT");
  test.info().annotations.push({ type: "evidence", description: `phase=${j.phase} stage=${(await liveLead(P.phone)).stage} sentSteps=${JSON.stringify(touched)} dueLeft=${Object.values(s).filter((x) => x.status === "DUE").length}` });
  test.fail(true, "OUT-07");
  expect(j.phase === "IGNORED" && touched.length === 0, "written off with no SOP contact").toBe(false);
});

test("after the write-off nothing is sent: the unsent intro is superseded, no further WhatsApp attempts", async ({ request }) => {
  test.skip(IS_PROD);
  const s = await stepMap(journeyId);
  expect(s.INTRO_WHATSAPP.status).toBe("SUPERSEDED");
  const n = (await waMessages(leadId)).length;
  await tick(request);
  expect(await waMessages(leadId)).toHaveLength(n);
  expect(Date.now()).toBeGreaterThan(0 * MIN);
});
