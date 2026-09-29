import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { IS_PROD, RUN, record } from "../../helpers/outreach";
import { one, q } from "../../helpers/db";

/**
 * PRD Phase 3 §3 (Conversion Funnel) + §6 data connections.
 *
 * Writes the CURRENT week's snapshot - a shared, founder-owned number. Local only; 99-cleanup deletes the
 * row if it did not exist before this run. MUST NOT run in prod.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const V = { awarenessReach: 10000, leadsCaptured: 200, callsCompleted: 20, proposalsSent: 10, ghostedDownloads: 40,
  enrollmentsSolo: 0, enrollmentsGuided: 2, enrollmentsElite: 0, workshopAttendees: 30 };
const FUNNEL_STATE_FILE = "reports/outreach-funnel-state.json";
let weekStart = "";

const pct1 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const fmtPct = (v: number) => `${v.toLocaleString("en-IN")}%`;

async function monthSums() {
  return (await one<any>(`
    select coalesce(sum("awarenessReach"),0)::int a, coalesce(sum("leadsCaptured"),0)::int l, coalesce(sum("callsCompleted"),0)::int c,
           coalesce(sum("proposalsSent"),0)::int p, coalesce(sum("enrollmentsSolo"+"enrollmentsGuided"+"enrollmentsElite"),0)::int e,
           coalesce(sum("enrollmentsSolo"),0)::int es, coalesce(sum("enrollmentsGuided"),0)::int eg, coalesce(sum("enrollmentsElite"),0)::int ee,
           coalesce(sum("ghostedDownloads"),0)::int g
      from weekly_funnel_snapshot
     where to_char("weekStart" + 3, 'YYYY-MM') = to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')`))!;
}

test.beforeAll(() => {
  test.skip(IS_PROD, "writes the founder's weekly funnel snapshot - local only");
});

test("weekly snapshot entry: Monday week, manual + pre-filled fields, saved and shown in recent snapshots", async ({ page }) => {
  const errs = watchErrors(page);
  await page.goto("/funnel");
  weekStart = await page.locator("form input[name=weekStart]").inputValue();
  expect(new Date(`${weekStart}T00:00:00Z`).getUTCDay(), "default week is a Monday").toBe(1);
  const existed = await one(`select * from weekly_funnel_snapshot where "weekStart"=$1::date`, [weekStart]);
  if (!fs.existsSync(FUNNEL_STATE_FILE)) fs.writeFileSync(FUNNEL_STATE_FILE, JSON.stringify({ run: RUN, weekStart, existed: existed ?? null }));
  record("WeeklyFunnelSnapshot", `week ${weekStart}`, undefined, existed ? "restore previous values (reports/outreach-funnel-state.json)" : "delete row (local)");

  const form = page.locator("form").filter({ hasText: "Weekly snapshot" });
  for (const [k, v] of Object.entries(V)) await form.locator(`input[name=${k}]`).fill(String(v));
  await form.locator("textarea[name=notes]").fill(`${RUN} automated funnel snapshot`);
  await form.getByRole("button", { name: /Save snapshot|Update snapshot/ }).click();
  await expect(page.getByText("Weekly snapshot saved").first()).toBeVisible();
  errs.assertClean();
  const row = await one<any>(`select * from weekly_funnel_snapshot where "weekStart"=$1::date`, [weekStart]);
  for (const [k, v] of Object.entries(V)) expect(row[k], k).toBe(v);
  await page.reload();
  await expect(page.locator("table tbody tr:visible").filter({ hasText: weekStart.split("-").reverse().join("/") }).first()).toContainText("10,000");
});

test("a non-Monday week start is refused", async ({ page }) => {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  await page.goto(`/funnel?week=${d.toISOString().slice(0, 10)}`);
  const form = page.locator("form").filter({ hasText: "Weekly snapshot" });
  await form.locator("input[name=awarenessReach]").fill("1");
  await form.getByRole("button", { name: /Save snapshot|Update snapshot/ }).click();
  await expect(page.getByText("Week start must be a Monday").first()).toBeVisible();
});

test("five-stage visual funnel shows this month's snapshot totals in order", async ({ page }) => {
  const m = await monthSums();
  await page.goto("/funnel");
  const card = page.locator("div").filter({ has: page.getByRole("heading", { name: /^This month - / }) }).filter({ hasText: "5. Enrolled (paid)" }).last();
  const text = await card.innerText();
  const names = ["Awareness", "Lead captured", "Discovery call", "Proposal sent", "Enrolled (paid)"];
  const vals = [m.a, m.l, m.c, m.p, m.e];
  names.forEach((n, i) => expect(text).toContain(`${i + 1}. ${n}`));
  for (let i = 0; i < 5; i++) {
    const re = new RegExp(`${i + 1}\\. ${names[i].replace(/[()]/g, "\\$&")}\\s*\\n?\\s*([\\d,]+)`);
    expect(Number(text.match(re)?.[1]?.replace(/,/g, "")), names[i]).toBe(vals[i]);
  }
  // blocks narrow as numbers shrink (width style)
  const widths = await card.locator("div.rounded-field").evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.width)));
  expect(widths[0]).toBeGreaterThanOrEqual(widths[4]);
});

test("metrics table: current month + last 3 months, every rate = its PRD formula", async ({ page }) => {
  const m = await monthSums();
  await page.goto("/funnel");
  const table = page.locator("table").filter({ has: page.getByText("Awareness → lead rate") }).first();
  const headers = await table.locator("thead th").allInnerTexts();
  expect(headers.length, "metric + 4 month columns").toBe(5);
  expect(headers[1].toLowerCase()).toContain("(now)");
  const cell = async (label: string) =>
    (await table.locator("tbody tr").filter({ hasText: label }).first().locator("td").nth(1).innerText()).trim();
  expect(await cell("Awareness → lead rate")).toBe(fmtPct(pct1(m.l, m.a)));
  expect(await cell("Lead → call rate")).toBe(fmtPct(pct1(m.c, m.l)));
  expect(await cell("Call → proposal rate")).toBe(fmtPct(pct1(m.p, m.c)));
  expect(await cell("Proposal → enrolment rate")).toBe(fmtPct(pct1(m.e, m.p)));
  expect(await cell("Overall conversion rate")).toBe(fmtPct(pct1(m.e, m.l)));
  expect(await cell("Guided enrolment %")).toBe(fmtPct(pct1(m.eg, m.e)));
  expect(await cell("Solo enrolment %")).toBe(fmtPct(pct1(m.es, m.e)));
});

test("biggest drop-off alert names the weakest stage and its carry-through %", async ({ page }) => {
  const m = await monthSums();
  await page.goto("/funnel");
  const alert = page.locator("div").filter({ has: page.getByText(/^Weakest stage this month|biggest drop-off/i) }).filter({ hasText: "is carrying" }).last();
  await expect(alert).toBeVisible();
  const t = await alert.innerText();
  test.info().annotations.push({ type: "evidence", description: t.replace(/\s+/g, " ") });
  // With these numbers lead→call carries 10% against a ~50% history.
  expect(t).toContain("Lead captured → Discovery call");
  expect(t).toContain(fmtPct(pct1(m.c, m.l)));
});

test("OUT-21: the drop-off alert uses the PRD's rule and wording (largest % drop from the stage above)", async ({ page }) => {
  // OUT-21 - PRD3 §3.3: "Your biggest drop-off this month is between [Stage X] and [Stage Y] - [X%] of people
  // are not moving forward here", largest raw % drop. funnel-metrics.ts:161-192 deliberately compares each
  // transition to its own 3-month norm and page.tsx renders "Weakest stage this month vs your 3-month norm";
  // with no prior history the alert disappears entirely. Divergent by design, never agreed in the PRD.
  test.fail(true, "OUT-21");
  await page.goto("/funnel");
  await expect(page.getByText(/Your biggest drop-off this month is between Awareness and Lead captured/).first()).toBeVisible({ timeout: 3000 });
});

test("Ghosted Blueprint tracker: all-time downloads and download→call/enrolment/Guided rates follow their definitions", async ({ page }) => {
  const total = (await one<{ g: number }>(`select coalesce(sum("ghostedDownloads"),0)::int g from weekly_funnel_snapshot`))!.g;
  const calls = (await one<{ n: number }>(`select count(*)::int n from lead l where l."deletedAt" is null and l."leadSource"='GHOSTED_BLUEPRINT'
      and exists (select 1 from lead_stage_history h where h."leadId"=l.id and h."toStage"='DISCO_COMPLETED')`))!.n;
  const studs = await q<any>(`select s.id, exists(select 1 from enrollment e where e."studentId"=s.id and e."programLevel"='GUIDED') g
      from student s where s."leadSource"='GHOSTED_BLUEPRINT'`);
  await page.goto("/funnel");
  const card = (label: string) => page.locator("div.card-hover, button.card-hover, a.card-hover").filter({ has: page.locator(`span[title="${label}"]`) }).first();
  expect((await card("Downloads all time").innerText()).replace(/,/g, "")).toContain(String(total));
  expect(await card("→ Discovery call").innerText()).toContain(fmtPct(pct1(calls, total)));
  expect(await card("→ Enrolment").innerText()).toContain(fmtPct(pct1(studs.length, total)));
  expect(await card("→ Guided specifically").innerText()).toContain(fmtPct(pct1(studs.filter((s) => s.g).length, total)));
  test.info().annotations.push({ type: "evidence", description: `downloads=${total} gbLeadsWithCall=${calls} gbStudents=${studs.length}` });
});

test("auto-pull: the form pre-fills Calls completed from Pipeline for the selected week (baseline for 09)", async ({ page }) => {
  await page.goto("/funnel");
  const form = page.locator("form").filter({ hasText: "Weekly snapshot" });
  const hint = await form.getByText(/auto: \d+/).nth(1).innerText(); // leads, calls, ...
  const autoCalls = Number(hint.match(/auto: (\d+)/)![1]);
  const db = (await one<{ n: number }>(`select count(distinct "leadId")::int n from lead_stage_history where "toStage"='DISCO_COMPLETED'
      and "changedAt" >= $1::date and "changedAt" < ($1::date + 7)`, [weekStart]))!.n;
  expect(autoCalls).toBe(db);
  const month = (await monthSums()).c;
  const state = JSON.parse(fs.readFileSync(FUNNEL_STATE_FILE, "utf8"));
  fs.writeFileSync(FUNNEL_STATE_FILE, JSON.stringify({ ...state, autoCallsBefore: autoCalls, monthCallsBefore: month }));
});
