import { test, expect, Page, Browser } from "@playwright/test";
import { authFile, ROLES } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun, stableRunIfSame } from "../../helpers/people-data";
import { assertFenced, FENCE, HAS_DB, recordCreated } from "../../helpers/target";
import { one } from "../../helpers/db";
import { chooseOption, confirmDialog, downloadText, istNow, openTab, parseCsv } from "../../helpers/people-ui";

/**
 * PRD2 §3.2 OKRs + §6 OKR CSV export.
 * Creates: up to 3 OKRs on this run's E2E team profile (and one on the Head account's profile, deleted
 * again at the end of its test). OKRs CAN be deleted in the UI - cleanup deletes them.
 */
test.use({ storageState: authFile("admin") });
const RUN = stableRun("okrs");
const tag = (s: string) => `${RUN} ${s}`;

const MONTH = istNow().ymd.slice(0, 7);
const O1 = tag("OKR calls");
const O2 = tag("OKR show-up");
const O3 = tag("OKR referral launch");
let member = "";

const okrRow = (page: Page, name: string) =>
  page.locator("div.border-b", { has: page.locator("p.font-semibold", { hasText: new RegExp(`^${escape(name)}$`) }) }).first();
const okrLine = (page: Page, name: string, title: string) =>
  okrRow(page, name).locator("div.text-sm", { has: page.locator(`span[title="${title}"]`) });
function escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function gotoOkrs(page: Page) {
  await page.goto("/people");
  await openTab(page, /^OKRs/);
  await expect(page.getByRole("heading", { name: `OKRs - ${MONTH}` })).toBeVisible();
}

async function fillOkr(page: Page, v: { title?: string; target?: string; progress?: string; manual?: string; notes?: string }) {
  const form = page.locator("form", { has: page.locator('input[name="targetValue"]') });
  if (v.title !== undefined) await form.locator('input[name="title"]').fill(v.title);
  if (v.target !== undefined) await form.locator('input[name="targetValue"]').fill(v.target);
  if (v.progress !== undefined) await form.locator('input[name="currentProgress"]').fill(v.progress);
  if (v.manual !== undefined) await form.locator('input[name="manualCompletionPct"]').fill(v.manual);
  if (v.notes !== undefined) await form.locator('textarea[name="notes"]').fill(v.notes);
  return form;
}

/** Find (or create) this run's E2E team profile to hang OKRs on. */
async function ensureMember(page: Page): Promise<string> {
  await page.goto("/people");
  await openTab(page, /Team & org chart/);
  const names = await page.locator("div.w-64 p.font-display").allInnerTexts();
  // Prefer this invocation's profile from 01-team-profiles, then any of our own.
  const prof = stableRunIfSame("profiles");
  const existing = names.find((n) => (prof && n === `${prof} Profile Coach Edited`) || n.startsWith(RUN));
  if (existing) return existing;
  const name = tag("OKR Member");
  await page.getByRole("button", { name: "Add team member" }).click();
  const form = page.locator("form", { has: page.locator('input[name="roleTitle"]') });
  await form.locator('input[name="fullName"]').fill(name);
  await form.locator('input[name="roleTitle"]').fill("Appointment Setter");
  await form.locator('input[name="email"]').fill(assertFenced(FENCE.primary.email));
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(page.locator("div.w-64 p.font-display", { hasText: name })).toBeVisible();
  recordCreated("people", { kind: "TeamProfile", label: name, cleanup: "Offboard via People > Team & org chart" });
  return name;
}

test.beforeEach(async ({ page }) => {
  if (!member) member = await ensureMember(page);
});

test("admin creates OKRs; completion % = current/target x100; colours green>=80 / amber 50-79 / red<50", async ({ page }) => {
  const w = watchErrors(page);
  await gotoOkrs(page);
  const row = okrRow(page, member);
  test.skip((await row.locator("span[title]").count()) > 0, "this run's member already has OKRs (re-run) - see cleanup");

  // OKR 1: numeric target with a unit, 45 of 50 = 90% -> green
  await row.getByRole("button", { name: "+ OKR" }).click();
  let form = await fillOkr(page, { title: O1, target: "50 calls", progress: "45", notes: `${RUN} weekly calls` });
  await form.getByRole("button", { name: "Create OKR" }).click();
  await expect(okrLine(page, member, O1)).toContainText("45 / 50 calls · 90%");
  recordCreated("people", { kind: "OKR", label: `${member} / ${O1}`, cleanup: "People > OKRs > Delete" });

  // OKR 2: percentage target, 52 of 80 = 65% -> amber
  await okrRow(page, member).getByRole("button", { name: "+ OKR" }).click();
  form = await fillOkr(page, { title: O2, target: "80%", progress: "52%" });
  await form.getByRole("button", { name: "Create OKR" }).click();
  await expect(okrLine(page, member, O2)).toContainText("52% / 80% · 65%");
  recordCreated("people", { kind: "OKR", label: `${member} / ${O2}`, cleanup: "People > OKRs > Delete" });

  // OKR 3: text target -> manual % (30) -> red
  await okrRow(page, member).getByRole("button", { name: "+ OKR" }).click();
  form = await fillOkr(page, { title: O3, target: "Launch the referral programme", progress: "Drafted the brief", manual: "30" });
  await form.getByRole("button", { name: "Create OKR" }).click();
  await expect(okrLine(page, member, O3)).toContainText("Drafted the brief / Launch the referral programme · 30%");
  recordCreated("people", { kind: "OKR", label: `${member} / ${O3}`, cleanup: "People > OKRs > Delete" });

  // Admin row: exactly 3 circles with the right colours
  const dots = okrRow(page, member).locator("span.inline-flex[title]");
  await expect(dots).toHaveCount(3);
  const colour = async (title: string) =>
    okrRow(page, member).locator(`span.inline-flex[title^="${title} - "] span[aria-hidden]`).getAttribute("style");
  expect(await colour(O1)).toContain("var(--good)");
  expect(await colour(O2)).toContain("var(--warn)");
  expect(await colour(O3)).toContain("var(--bad)");
  // The "+ OKR" button is gone once the member has 3
  await expect(okrRow(page, member).getByRole("button", { name: "+ OKR" })).toHaveCount(0);
  w.assertClean();
});

test("the 4th OKR for the same person+month is blocked server-side (stale form race)", async ({ page, browser }) => {
  // Make room: delete OKR3, open the "+ OKR" form in tab B, re-create OKR3 in tab A, then submit B.
  await gotoOkrs(page);
  await okrLine(page, member, O3).getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete");
  await expect(okrLine(page, member, O3)).toHaveCount(0);

  const ctxB = await browser.newContext({ storageState: authFile("admin"), timezoneId: "Asia/Kolkata" });
  const pageB = await ctxB.newPage();
  await gotoOkrs(pageB);
  await okrRow(pageB, member).getByRole("button", { name: "+ OKR" }).click();
  await fillOkr(pageB, { title: tag("OKR fourth"), target: "10 proposals", progress: "1" });

  await okrRow(page, member).getByRole("button", { name: "+ OKR" }).click();
  const form = await fillOkr(page, { title: O3, target: "Launch the referral programme", progress: "Drafted the brief", manual: "30" });
  await form.getByRole("button", { name: "Create OKR" }).click();
  await expect(okrLine(page, member, O3)).toBeVisible();

  const formB = pageB.locator("form", { has: pageB.locator('input[name="targetValue"]') });
  await formB.getByRole("button", { name: "Create OKR" }).click();
  await expect(formB.getByRole("alert")).toHaveText("Maximum 3 OKRs per person per month - remove one first.");
  await pageB.reload();
  await openTab(pageB, /^OKRs/);
  await expect(okrRow(pageB, member).locator("span.inline-flex[title]")).toHaveCount(3);
  await ctxB.close();
});

test("colour boundaries: exactly 50% is amber, exactly 80% is green, 49% is red", async ({ page }) => {
  await gotoOkrs(page);
  const edit = async (progress: string) => {
    await okrLine(page, member, O2).getByRole("button", { name: "Edit" }).click();
    const form = await fillOkr(page, { progress });
    await form.getByRole("button", { name: "Save OKR" }).click();
  };
  const style = () => okrRow(page, member).locator(`span.inline-flex[title^="${O2} - "] span[aria-hidden]`).getAttribute("style");
  await edit("40"); // 40/80 = 50%
  await expect(okrLine(page, member, O2)).toContainText("· 50%");
  expect(await style()).toContain("var(--warn)");
  await edit("64"); // 80%
  await expect(okrLine(page, member, O2)).toContainText("· 80%");
  expect(await style()).toContain("var(--good)");
  await edit("39.2"); // 49%
  await expect(okrLine(page, member, O2)).toContainText("· 49%");
  expect(await style()).toContain("var(--bad)");
  await edit("52%"); // back to 65%
  await expect(okrLine(page, member, O2)).toContainText("· 65%");
});

test("CSV export of the month's OKR summary carries the computed % and status", async ({ page }) => {
  await gotoOkrs(page);
  const { name, text } = await downloadText(page, () => page.getByRole("button", { name: "Export CSV" }).click());
  expect(name).toBe(`okr-summary-${MONTH}.csv`);
  const rows = parseCsv(text).filter((r) => r.Member === member);
  expect(rows.map((r) => r["OKR title"]).sort()).toEqual([O1, O2, O3].sort());
  const by = Object.fromEntries(rows.map((r) => [r["OKR title"], r]));
  expect(by[O1]).toMatchObject({ Month: MONTH, Target: "50 calls", "Current progress": "45", "Completion %": "90", Status: "Green", Notes: `${RUN} weekly calls` });
  expect(by[O2]).toMatchObject({ "Completion %": "65", Status: "Amber" });
  expect(by[O3]).toMatchObject({ Target: "Launch the referral programme", "Completion %": "30", Status: "Red" });
});

test("PPL-04: OKRs and their CSV are locked to the current month (no month picker / any-month export)", async ({ page }) => {
  // PRD2 §3.2 "Month: month picker" and §6 "export the OKR summary for ANY month".
  const prev = new Date(`${MONTH}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevKey = prev.toISOString().slice(0, 7);
  await page.goto(`/people?month=${prevKey}`);
  await openTab(page, /^OKRs/);
  const heading = await page.locator("h3", { hasText: /^OKRs - / }).innerText();
  const monthControls = await page.locator('input[type="month"], [aria-label*="onth"]').count();
  expect(heading === `OKRs - ${prevKey}` || monthControls > 0,
    `PPL-04: no way to view/export OKRs for ${prevKey} - page shows "${heading}" and has no month picker`).toBe(true);
});

test("team member (Head) updates their own OKR progress from My Daily Log; admin sees the new %", async ({ page, browser }) => {
  const headEmail = ROLES.head?.email;
  test.skip(!headEmail, "no head account");
  // Resolve the head's profile name from the org chart card (email is printed on it).
  await page.goto("/people");
  await openTab(page, /Team & org chart/);
  const headCard = page.locator("div.w-64", { hasText: headEmail });
  test.skip((await headCard.count()) === 0, "head account has no team profile");
  const headName = (await headCard.first().locator("p.font-display").innerText()).trim();

  await gotoOkrs(page);
  const row = okrRow(page, headName);
  test.skip((await row.getByRole("button", { name: "+ OKR" }).count()) === 0, "head already has 3 OKRs this month");
  const title = tag("OKR sessions");
  await row.getByRole("button", { name: "+ OKR" }).click();
  const form = await fillOkr(page, { title, target: "20 sessions", progress: "" });
  await form.getByRole("button", { name: "Create OKR" }).click();
  await expect(okrLine(page, headName, title)).toContainText("- / 20 sessions · 0%");
  recordCreated("people", { kind: "OKR", label: `${headName} / ${title}`, cleanup: "People > OKRs > Delete (deleted at end of test)" });

  const ctx = await browser.newContext({ storageState: authFile("head"), timezoneId: "Asia/Kolkata" });
  const hp = await ctx.newPage();
  const w = watchErrors(hp);
  await hp.goto("/daily-log");
  const okrForm = hp.locator("form", { has: hp.getByText(title, { exact: true }) });
  await expect(okrForm).toBeVisible();
  await okrForm.locator('input[name="currentProgress"]').fill("15");
  await okrForm.getByRole("button", { name: "Save" }).click();
  await expect(okrForm.getByText("75%")).toBeVisible();
  w.assertClean();
  await ctx.close();

  await gotoOkrs(page);
  await expect(okrLine(page, headName, title)).toContainText("15 / 20 sessions · 75%");
  if (HAS_DB) {
    const r = await one(`select "currentNumeric"::text c from okr where title=$1`, [title]);
    expect(r.c).toBe("15.00");
  }
  // clean up the head's OKR straight away (it sits on a real account)
  await okrLine(page, headName, title).getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete");
  await expect(okrLine(page, headName, title)).toHaveCount(0);
});

test("PPL-05: a text target containing a number is auto-computed from the FIRST number, not manual", async ({ page }) => {
  // PRD2 §3.2: "If target is text, admin enters % manually". A target like "Q3 target: 50 calls"
  // is parsed as 3 (the first digit run), so 45 progress shows 200% instead of 90%.
  await gotoOkrs(page);
  await okrLine(page, member, O1).getByRole("button", { name: "Edit" }).click();
  const form = await fillOkr(page, { target: "Q3 target: 50 calls", progress: "45" });
  await form.getByRole("button", { name: "Save OKR" }).click();
  const line = okrLine(page, member, O1);
  await expect(line).toContainText("45 / Q3 target: 50 calls");
  const text = await line.innerText();
  // restore the plain target before asserting so later specs/cleanup see a sane row
  await line.getByRole("button", { name: "Edit" }).click();
  const f2 = await fillOkr(page, { target: "50 calls", progress: "45" });
  await f2.getByRole("button", { name: "Save OKR" }).click();
  await expect(okrLine(page, member, O1)).toContainText("45 / 50 calls · 90%");
  expect(text, `PPL-05: completion for "45 / Q3 target: 50 calls" should be 90% (or require manual %), got: ${text}`).toContain("· 90%");
});
