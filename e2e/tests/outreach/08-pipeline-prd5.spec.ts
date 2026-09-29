import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import {
  FENCE, HAS_DB, IS_PROD, RUN, eventually, journeyFor, liveLead, optInViaPabbly, pabblyKey, pickSelect, purgePerson,
  record, stageHistory,
} from "../../helpers/outreach";
import { one, q } from "../../helpers/db";
import { reEscape } from "../../helpers/target";

/**
 * PRD Phase 1 §5 - Pipeline: manual lead entry, stages + history, discovery call outcomes, dashboard
 * metrics (formula consistency, not absolute values - other agents share the DB), target bar, CSV, dates.
 *
 * Prod: T1-T5 would create a visible fenced lead and move it through WON (commission/revenue side
 * effects are not triggered by a stage change, but the founder's KPIs would count it) - DO NOT run in prod.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
const NOTE = `${RUN} manual pipeline lead - automated test`;
let leadId = "";
const LAST_MONTH_DATE = (() => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 20));
  return m.toISOString().slice(0, 10);
})();
const dmy = (ymd: string) => ymd.split("-").reverse().join("/");

test.beforeAll(async ({ browser }) => {
  test.skip(IS_PROD, "writes shared KPI data - local only");
  const ctx = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await ctx.newPage(), P.phone);
  await ctx.close();
});

async function openLeads(page: Page) {
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: /^Leads$/ }).click();
}
async function leadForm(page: Page) {
  return page.locator("form").filter({ has: page.locator("input[name=dateIn]") }).first();
}
function metricCard(page: Page, label: string) {
  return page.locator("div.card-hover, a.card-hover, button.card-hover").filter({ has: page.locator(`span[title="${label}"]`) }).first();
}
const pctOf = (s: string) => Number((s.match(/([\d.,]+)%/)?.[1] ?? "NaN").replace(/,/g, ""));

test("OUT-18: the New lead source dropdown only offers sources the server accepts", async ({ page }) => {
  // OUT-18 - LeadSection renders optionsFrom(LEAD_SOURCE_LABELS) (incl. "Meta Lead Ad", "Landing page")
  // but leadSchema.leadSource omits META_ADS and LANDING_PAGE (pipeline-actions.ts:47-50). Any lead captured
  // by the Meta or b2consultants webhooks therefore cannot be edited/re-staged from the Pipeline form.
  await openLeads(page);
  const form = await leadForm(page);
  await form.locator("input[name=name]").fill(P.name);
  await form.locator("input[type=tel]").fill(P.localPhone);
  await pickSelect(form as any, "leadSource", "Landing page");
  await form.getByRole("button", { name: "Add lead" }).click();
  test.fail(true, "OUT-18");
  await expect(page.getByText("Lead added to pipeline").first()).toBeVisible({ timeout: 5000 });
});

test("manual lead entry: every PRD field, 'Entered by' filled from the session, first stage-history row", async ({ page }) => {
  const errs = watchErrors(page);
  if (HAS_DB && (await liveLead(P.phone))) await purgePerson(page, P.phone); // in case OUT-18 ever succeeds
  await openLeads(page);
  const form = await leadForm(page);
  await form.locator("input[name=name]").fill(P.name);
  await form.locator("input[type=tel]").fill(P.localPhone);
  await form.locator("input[name=email]").fill(P.email);
  await pickSelect(form as any, "leadSource", "Ghosted Blueprint");
  await form.locator("input[name=dateIn]").fill(LAST_MONTH_DATE);
  await pickSelect(form as any, "stage", "Fresh Optins");
  await form.locator("textarea[name=notes]").fill(NOTE);
  await form.getByRole("button", { name: "Add lead" }).click();
  await expect(page.getByText("Lead added to pipeline").first()).toBeVisible();
  errs.assertClean();

  const lead = await eventually(() => liveLead(P.phone), "manual lead");
  leadId = lead.id;
  record("Lead", "07 manual pipeline lead", leadId);
  const admin = await one<{ id: string }>(`select id from "user" where email='ameen@b2consultants.in'`);
  const row = await one<any>(`select "enteredById", source::text, to_char("dateIn",'YYYY-MM-DD') d, "leadSource"::text ls, notes from lead where id=$1`, [leadId]);
  expect(row).toMatchObject({ enteredById: admin!.id, source: "MANUAL", d: LAST_MONTH_DATE, ls: "GHOSTED_BLUEPRINT", notes: NOTE });
  expect(lead.phone).toBe(P.phone);
  const h = await stageHistory(leadId);
  expect(h).toHaveLength(1);
  expect(h[0]).toMatchObject({ fromStage: null, toStage: "NEW_LEAD", changedById: admin!.id });

  await page.reload();
  await page.getByRole("tab", { name: /^Leads$/ }).click();
  await page.getByPlaceholder("Filter leads…").fill(P.phone);
  const tr = page.locator("table tbody tr:visible").filter({ hasText: P.phone });
  await expect(tr).toContainText(dmy(LAST_MONTH_DATE));
  await expect(tr).toContainText("Ameen");
  await expect(tr).toContainText("Ghosted Blueprint");
  // Observation: a hand-entered lead gets no OutreachJourney, so it never enters the SOP queue.
  test.info().annotations.push({ type: "observation", description: `journey for manual lead: ${JSON.stringify(await journeyFor(leadId))}` });
});

test("duplicate entry of the same person (phone or email) is refused with a pointer to the existing lead", async ({ page }) => {
  await openLeads(page);
  const form = await leadForm(page);
  await form.locator("input[name=name]").fill(`${P.name} Duplicate`);
  await form.locator("input[type=tel]").fill(P.localPhone);
  await form.getByRole("button", { name: "Add lead" }).click();
  await expect(page.getByText(/A lead with this phone number already exists - Mohamed Riyaz/).first()).toBeVisible();
});

test("'Leads this week / this month' count by Date in: last month's lead is not in this month's figure", async ({ page }) => {
  await page.goto("/pipeline");
  const monthCard = page.locator("div.rounded-card").filter({ hasText: /^Leads · / }).first();
  await expect(monthCard).toBeVisible();
  const expected = async () => {
    const r = await one<{ m: number; w: number }>(
      `select count(*) filter (where "dateIn" >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date)::int m,
              count(*) filter (where "dateIn" >= date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date)::int w
         from lead where "deletedAt" is null and "dateIn" < (date_trunc('month', (now() at time zone 'Asia/Kolkata')) + interval '1 month')::date`);
    return r!;
  };
  const e = await expected();
  const text = await monthCard.innerText();
  const m = Number(text.match(/\n\s*(\d+)\s*\n/)?.[1] ?? text.match(/(\d+)\s*First contact/)?.[1]);
  const w = Number(text.match(/\+(\d+) this week/)?.[1]);
  expect(m).toBe(e.m);
  expect(w).toBe(e.w);
  expect(LAST_MONTH_DATE < new Date().toISOString().slice(0, 7) + "-01").toBe(true);
});

test("OUT-15: a prospect who re-opts-in today counts as a lead this month (window by opt-in date, not Date in)", async ({ request }) => {
  // OUT-15 - Pipeline 'Leads this week/month' filter Lead.dateIn and the L1 desk's month targets filter
  // Lead.createdAt (pipeline-metrics.ts:277-278; l1-desk-metrics.ts:324,354). A returning opt-in resets
  // OutreachJourney.optInAt only, so the person who opted in today is attributed to the month they were
  // first typed in.
  test.skip(!pabblyKey());
  const res = await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  expect(res.body).toMatchObject({ created: false, reopened: true });
  const j = await journeyFor(leadId);
  expect(Date.now() - new Date(j.optInAt).getTime()).toBeLessThan(120_000);
  const r = await one<{ inMonth: boolean }>(
    `select "dateIn" >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date "inMonth" from lead where id=$1`, [leadId]);
  test.fail(true, "OUT-15");
  expect(r!.inMonth, "opted in this month → counted this month").toBe(true);
});

const STAGE_WALK: Array<[string, string]> = [
  ["DISCO_BOOKED", "Pre-Qualified & Confirmed"],
  ["DISCO_NOT_BOOKED", "Cancelled/Unqualified - never booked"],
  ["DISCO_COMPLETED", "Pre-Qualified & Confirmed - call done"],
  ["SSS_BOOKED", "SSS Call Booked"],
  ["SSS_COMPLETED", "SSS Call Confirmed"],
  ["PROPOSAL_SENT", "Offer and didn’t buy - awaiting decision"],
  ["NO_SHOW", "No Shows/Rescheduled"],
  ["LOST", "Cancelled/Unqualified"],
  ["WON", "Won"],
];

test("stage changes through every PRD stage (incl. No show, Lost, Won) each append a stage-history row", async ({ page }) => {
  for (const [stage, label] of STAGE_WALK) {
    await openLeads(page);
    await page.getByPlaceholder("Filter leads…").fill(P.phone);
    const tr = page.locator("table tbody tr:visible").filter({ hasText: P.phone }).first();
    await tr.getByRole("button", { name: "Edit" }).click();
    const form = page.locator("form").filter({ has: page.locator("input[name=dateIn]") }).first();
    await pickSelect(form as any, "stage", label);
    if (stage === "WON") await pickSelect(form as any, "wonLevel", /Guided/);
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Lead updated").first()).toBeVisible();
    await eventually(async () => (await liveLead(P.phone)).stage === stage, `stage ${stage}`);
  }
  const h = await stageHistory(leadId);
  const tail = h.map((x) => x.toStage).slice(-STAGE_WALK.length);
  expect(tail).toEqual(STAGE_WALK.map((s) => s[0]));
  const won = await one<any>(`select "wonLevel" from lead where id=$1`, [leadId]);
  expect(won.wonLevel).toBe("GUIDED");
});

test("dashboard rates are consistent with their own counts (show-up, no-show, close) and include this lead", async ({ page }) => {
  await page.goto("/pipeline");
  const completedCard = page.locator("div.rounded-card").filter({ hasText: "Calls completed" }).filter({ hasText: "booked" }).first();
  const t = await completedCard.innerText();
  const [, completed, booked] = t.match(/(\d+)\s*of\s*(\d+)\s*booked/) ?? [];
  const showUp = pctOf(t.match(/Show-up rate ([\d.,]+%)/)?.[1] ?? "");
  const noShowPct = pctOf(t.match(/No-show ([\d.,]+%)/)?.[1] ?? "");
  const wonCard = page.locator("div.rounded-card").filter({ hasText: /Close rate/ }).first();
  const wt = await wonCard.innerText();
  const close = pctOf(wt.match(/Close rate ([\d.,]+%)/)?.[1] ?? "");
  const wonCount = Number(wt.match(/(\d+)\s*new students/)?.[1]);
  const conv = wt.match(/Solo (\d+) · Guided (\d+) · Elite (\d+)/)!;
  const noShowsDetail = await metricCard(page, "No-show rate").innerText();
  const b = Number(booked), c = Number(completed);
  test.info().annotations.push({ type: "evidence", description: `booked=${b} completed=${c} showUp=${showUp} noShow=${noShowPct} close=${close} won=${wonCount} conv=${conv.slice(1).join("/")}` });
  expect(b).toBeGreaterThanOrEqual(1);
  expect(c).toBeGreaterThanOrEqual(1);
  expect(showUp).toBeCloseTo(Math.round((c / b) * 1000) / 10, 1);
  expect(close).toBeCloseTo(Math.round((wonCount / c) * 1000) / 10, 1);
  expect(Number(conv[2])).toBeGreaterThanOrEqual(1);
  expect(Number(conv[1]) + Number(conv[2]) + Number(conv[3])).toBe(wonCount);
  expect(noShowsDetail).toContain("%");
  // this lead is inside booked / completed / no-show / won for the current window
  const reached = new Set((await stageHistory(leadId)).map((x) => x.toStage));
  for (const s of ["DISCO_BOOKED", "DISCO_COMPLETED", "NO_SHOW", "WON"]) expect(reached.has(s)).toBe(true);
});

test("discovery call outcome entry: all five PRD outcomes are offered; entries show DD/MM/YYYY dates", async ({ page }) => {
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: "Discovery call outcomes" }).click();
  const form = page.locator("form").filter({ has: page.locator("input[name=callDate]") }).first();
  await form.locator("span:has(> select[name=outcome]) button").click();
  for (const o of ["Qualified for SSS", "Not qualified for SSS", "Follow up needed", "No show", "Sent to Workshop"]) {
    await expect(page.getByRole("option", { name: o })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const sss = new Date(Date.now() + 5.5 * 3_600_000 + 3 * 86_400_000).toISOString().slice(0, 10);
  await pickSelect(form as any, "leadId", new RegExp(`${P.name} \\(${reEscape(P.phone)}\\)`));
  await form.locator("input[name=callDate]").fill(today);
  await pickSelect(form as any, "outcome", "Qualified for SSS");
  await form.locator("input[name=sssDate]").fill(sss);
  await form.locator("label").filter({ hasText: "Highly qualified" }).click();
  await form.locator("textarea[name=notes]").fill(`${RUN} outcome 1`);
  await form.getByRole("button", { name: "Add outcome" }).click();
  await expect(page.getByText(/outcome/i).first()).toBeVisible();
  await eventually(() => one(`select id from discovery_outcome where "leadId"=$1 and outcome='QUALIFIED_FOR_SSS'`, [leadId]), "outcome row");

  await pickSelect(form as any, "leadId", new RegExp(`${P.name} \\(${reEscape(P.phone)}\\)`));
  await form.locator("input[name=callDate]").fill(today);
  await pickSelect(form as any, "outcome", "No show");
  await form.locator("textarea[name=notes]").fill(`${RUN} outcome 2`);
  await form.getByRole("button", { name: "Add outcome" }).click();
  await eventually(() => one(`select id from discovery_outcome where "leadId"=$1 and outcome='NO_SHOW'`, [leadId]), "no-show outcome row");

  await page.reload();
  await page.getByRole("tab", { name: "Discovery call outcomes" }).click();
  const rows = page.locator("table tbody tr:visible").filter({ hasText: `${RUN} outcome` });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Qualified for SSS" })).toContainText(dmy(sss));
  await expect(rows.first()).toContainText(dmy(today));
  await expect(rows.first()).toContainText("Ameen");
});

test("OUT-19: recording a 'No show' discovery outcome moves the linked lead to No show (and into the no-show rate)", async () => {
  // OUT-19 - createOutcome only inserts a DiscoveryOutcome (pipeline-actions.ts:538-575); it never touches
  // Lead.stage, while every call metric reads LeadStageHistory. An outcome of "No show" (or "Qualified for
  // SSS" with an SSS date) leaves the pipeline stage and the No-show / Calls completed figures unchanged.
  const before = (await stageHistory(leadId)).length;
  test.fail(true, "OUT-19");
  expect((await liveLead(P.phone)).stage).toBe("NO_SHOW");
  expect((await stageHistory(leadId)).length).toBeGreaterThan(before);
});

test("target bar: bands follow % of the monthly target (red < 50, amber 50-80, green > 80)", async ({ page }) => {
  const month = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
  const prev = await one<{ t: string }>(`select "targetInrMinor"::text t from monthly_target where month=$1::date`, [`${month}-01`]);
  const rev = await one<{ r: string }>(`select coalesce(sum("amountInrMinor"),0)::text r from income where "deletedAt" is null and date >= $1::date and date < ($1::date + interval '1 month')`, [`${month}-01`]);
  const revenueMajor = Number(rev!.r) / 100;
  const setTarget = async (major: number) => {
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Change target for this month" }).click();
    await page.getByLabel("Target (₹)").fill(String(Math.round(major)));
    await page.getByRole("button", { name: "Set target" }).click();
    await expect(page.getByText("Monthly target updated").first()).toBeVisible();
    await page.reload();
  };
  const barColour = async () => {
    const card = page.locator("div.rounded-card").filter({ hasText: "Monthly revenue target" }).first();
    return card.locator("div.h-3 > div").first().evaluate((el) => (el as HTMLElement).style.background);
  };
  try {
    await setTarget(Math.max(1, revenueMajor * 4)); // 25% (or 0% with no revenue) → red
    expect(await barColour()).toBe("var(--bad)");
    if (revenueMajor > 0) {
      await setTarget(revenueMajor / 0.65); // 65% → amber
      expect(await barColour()).toBe("var(--warn)");
      await setTarget(revenueMajor / 0.9); // 90% → green
      expect(await barColour()).toBe("var(--good)");
    } else {
      test.info().annotations.push({ type: "gap", description: "no income this month locally - amber/green bands not exercised" });
    }
  } finally {
    await setTarget(prev ? Number(prev.t) / 100 : 800000);
  }
});

test("CSV export of the Leads table contains the lead; OUT-20 dates in the export are DD/MM/YYYY", async ({ page }) => {
  await openLeads(page);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).first().click();
  const file = await (await dl).path();
  const csv = fs.readFileSync(file!, "utf8");
  expect(csv.split(/\r?\n/)[0]).toContain("Phone / WhatsApp");
  const line = csv.split(/\r?\n/).find((l) => l.includes(P.phone));
  expect(line, "lead row exported").toBeTruthy();
  test.info().annotations.push({ type: "evidence", description: line! });
  // OUT-20 - Column.value for "Date in" is r.dateIn.slice(0,10) (LeadSection.tsx:152); PRD §6: all dates DD/MM/YYYY.
  test.fail(true, "OUT-20");
  expect(line).toContain(dmy(LAST_MONTH_DATE));
});

test("non-admin (Nilofer) sees only her own leads and cannot export or delete", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("nilofer") });
  const page = await ctx.newPage();
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: /^Leads$/ }).click();
  await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  await expect(page.locator("table tbody tr:visible").getByRole("button", { name: "Delete" })).toHaveCount(0);
  const mine = await q<{ n: number }>(`select count(*)::int n from lead l join "user" u on u.email='nilofer@b2consultants.in'
      where l."deletedAt" is null and (l."enteredById"=u.id or l."assignedToId"=u.id)`);
  const shown = await page.locator("text=/\\d+ records?/").first().innerText().catch(() => "");
  test.info().annotations.push({ type: "evidence", description: `nilofer own leads=${mine[0].n} table says "${shown}"` });
  await ctx.close();
});
