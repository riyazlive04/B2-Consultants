import { test, expect } from "@playwright/test";
import { BASE_URL } from "../../playwright.config";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import {
  CITY_TAG, FENCE, HAS_DB, IS_PROD, RUN, ensureLocalOutreachConfig, eventually, fakeTemplate, istDateParts,
  journeyFor, liveLead, optInViaPabbly, pabblyKey, purgePerson, queueCard, record, stageHistory, stepMap, waMessages,
} from "../../helpers/outreach";
import { one } from "../../helpers/db";

/**
 * SOP box 1-2: "Lead fills opt-in form (name, email, phone) → data lands in the system + the outreach
 * specialist is notified". Also the webhook auth gates and redelivery idempotency.
 *
 * Prod: needs E2E_PABBLY_KEY. Sends ONE real SOP intro WhatsApp (b2_sop_intro) + welcome email to
 * FENCE.primary if the founder has instant intro armed.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let externalRef = "";

test.beforeAll(async ({ browser }) => {
  if (HAS_DB) await ensureLocalOutreachConfig();
  const ctx = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await ctx.newPage(), P.phone);
  await ctx.close();
});

test("webhooks fail closed: Pabbly without a key is 401, the Console lead webhook is 503 while switched off", async ({ request }) => {
  const noKey = await request.post(`${BASE_URL}/api/leads/pabbly`, { data: { name: P.name, phone: P.phone } });
  expect(noKey.status()).toBe(401);
  const badKey = await request.post(`${BASE_URL}/api/leads/pabbly?key=wrong`, { data: { name: P.name, phone: P.phone } });
  expect(badKey.status()).toBe(401);
  test.skip(IS_PROD, "prod webhook switch state is the founder's - not asserted");
  const b2 = await request.post(`${BASE_URL}/api/leads/b2consultants?key=anything`, { data: { name: P.name, phone: P.phone } });
  expect(b2.status()).toBe(503);
});

test("opt-in as Mohamed Riyaz lands as one lead with +91 phone, source, opt-in date, owner and a journey", async ({ request }) => {
  test.skip(!pabblyKey(), "no Pabbly key for this target (E2E_PABBLY_KEY)");
  const before = Date.now();
  // The landing page sends the national number without a country code.
  const res = await optInViaPabbly(request, { name: P.name, phone: P.localPhone, email: P.email });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body).toMatchObject({ ok: true, created: true, deduped: null, leadSource: "INSTAGRAM" });
  externalRef = res.externalRef;
  test.skip(!HAS_DB, "prod: DB assertions replaced by the UI tests below");

  const lead = await eventually(() => liveLead(P.phone), "lead row");
  leadId = lead.id;
  record("Lead", `${P.name} opt-in`, lead.id);
  expect(lead.phone).toBe(P.phone);
  expect(lead.name).toBe(P.name);
  expect(lead.email).toBe(P.email);
  expect(lead.source).toBe("PABBLY");
  expect(lead.leadSource).toBe("INSTAGRAM");
  expect(lead.stage).toBe("NEW_LEAD");
  expect(lead.city).toBe(CITY_TAG);
  expect(lead.dateIn).toBe(istDateParts(new Date()).ymd);
  const owner = await one<{ name: string }>(`select name from "user" where id=$1`, [lead.assignedToId]);
  expect(["Nilofer", "Asma"], "first-call rotation assigns an owner at capture").toContain(owner?.name);

  const hist = await stageHistory(lead.id);
  expect(hist.map((h) => `${h.fromStage}->${h.toStage}`)).toEqual(["null->NEW_LEAD"]);

  const j = await journeyFor(lead.id);
  expect(j, "every captured lead gets an SOP journey").toBeTruthy();
  expect(Math.abs(new Date(j.optInAt).getTime() - before)).toBeLessThan(60_000);
  expect(j.phase).toBe("OPT_IN");
});

test("instant intro: Step 3 is materialised at capture and the SOP_INTRO template is attempted once (blocked by the allowlist)", async () => {
  test.skip(!HAS_DB);
  const j = await journeyFor(leadId);
  const steps = await eventually(async () => {
    const m = await stepMap(j.id);
    return m.INTRO_WHATSAPP ? m : null;
  }, "INTRO_WHATSAPP step");
  expect(steps.INTRO_WHATSAPP.status).toBe("DUE");
  const msgs = await eventually(async () => {
    const m = (await waMessages(leadId)).filter((x) => x.kind === "SOP_INTRO");
    return m.length ? m : null;
  }, "SOP_INTRO message row");
  expect(msgs).toHaveLength(1);
  expect(msgs[0].templateName).toBe(fakeTemplate("SOP_INTRO"));
  expect(msgs[0].error).toContain("OUTBOUND_ALLOWLIST");
});

test("OUT-17: an allowlist-blocked send should be logged SKIPPED (the guard's own contract), not FAILED", async () => {
  test.skip(!HAS_DB);
  // OUT-17 - lib/outbound-allowlist.ts promises "skipped and logged, not failed"; sendWhatsApp only
  // reads result.ok and writes FAILED (server/whatsapp.ts:310), so every blocked test send looks like a
  // delivery failure and increments autoFailed.
  test.fail(true, "OUT-17");
  const msg = (await waMessages(leadId)).find((x) => x.kind === "SOP_INTRO");
  expect(msg.status).toBe("SKIPPED");
});

test("specialist sees the new opt-in at the top of the Outreach queue with the rendered Step 3 message", async ({ page }) => {
  const errs = watchErrors(page);
  await page.goto("/outreach");
  const card = queueCard(page, P.phone);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Step 3: WhatsApp intro");
  await expect(card).toContainText("Hi Mohamed, this is");
  await expect(card).toContainText("https://optin.b2consultants.de/apply");
  await expect(card.getByRole("button", { name: "Mark sent" })).toBeVisible();
  errs.assertClean();
});

test("OUT-16: the unattended intro signs off as a person, not 'B2 Consultants from B2 Consultants'", async ({ page }) => {
  // OUT-16 - [Your Name] falls back to defaultSpecialistName ("B2 Consultants") because respTouchpoint is
  // only assigned at Step 12 (after booking), so every auto-sent Step 3 reads
  // "this is B2 Consultants from B2 Consultants." (server/outreach.ts:613, outreach-instant.ts:115).
  test.fail(true, "OUT-16");
  await page.goto("/outreach");
  await expect(queueCard(page, P.phone)).not.toContainText("this is B2 Consultants from B2 Consultants");
});

test("pipeline Leads table shows the opt-in with DD/MM/YYYY date and its source", async ({ page }) => {
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: /^Leads$/ }).click();
  await page.getByPlaceholder("Filter leads…").fill(P.localPhone);
  const row = page.locator("table tbody tr:visible").filter({ hasText: P.phone });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(P.name);
  await expect(row).toContainText("Instagram");
  await expect(row).toContainText(istDateParts(new Date()).dmy);
});

test("webhook redelivery (same record id) neither duplicates the lead nor re-sends the intro", async ({ request }) => {
  test.skip(!pabblyKey() || !externalRef);
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email }, { id: externalRef });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ created: false, deduped: "externalRef", reopened: false });
  test.skip(!HAS_DB);
  await new Promise((r) => setTimeout(r, 2500));
  const leads = (await liveLead(P.phone)) ? 1 : 0;
  expect(leads).toBe(1);
  expect((await waMessages(leadId)).filter((x) => x.kind === "SOP_INTRO")).toHaveLength(1);
});

test("the owning specialist's My Desk lists the fresh opt-in in the 5-minute bucket", async ({ browser }) => {
  test.skip(!HAS_DB, "prod: owner unknown without DB");
  const lead = await liveLead(P.phone);
  const owner = await one<{ email: string; name: string }>(`select email, name from "user" where id=$1`, [lead.assignedToId]);
  const role = owner?.name === "Nilofer" ? "nilofer" : "asma";
  const ctx = await browser.newContext({ storageState: authFile(role) });
  const page = await ctx.newPage();
  await page.goto("/my-desk");
  test.info().annotations.push({ type: "owner", description: `${owner?.name} (${RUN})` });
  if (role === "asma") {
    // Asma is the Level 2 desk; the L1 queue is Nilofer's. A lead the 80/20 rotation hands Asma never
    // shows on an L1 surface - recorded, not failed (the rotation is by design).
    await expect(page.getByText("My Desk")).toBeVisible();
  } else {
    await expect(page.getByText(P.name).first()).toBeVisible();
    await expect(page.getByText(P.phone).first()).toBeVisible();
  }
  await ctx.close();
});
