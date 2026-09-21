import { test, expect, Page, Locator } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun } from "../../helpers/people-data";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { one, pool, q } from "../../helpers/db";
import { addDaysYmd, chooseByAria, chooseOption, dmy, istNow, setDate } from "../../helpers/people-ui";
import { createStudentUI, deleteStudentUI, enrollmentCard, gotoStudentsList, openStudent, studentRow } from "../../helpers/people-students";

/**
 * PRD2 §4.3 90/120-day tracker, §4.4 milestone log, §6 signal log + append-only rules.
 * Creates 3 students (Elite, Guided, Solo) + a throwaway Guided that is deleted inside PPL-10.
 * Milestone / signal log rows cannot be deleted directly; they disappear only with their student.
 */
test.use({ storageState: authFile("admin") });
const RUN = stableRun("tracker");
const tag = (s: string) => `${RUN} ${s}`;
const TODAY = istNow().ymd;
const ELITE = tag("Tracker Elite");
const GUIDED = tag("Tracker Guided");
const SOLO = tag("Tracker Solo");

async function ensureStudents(page: Page) {
  await gotoStudentsList(page);
  for (const s of [
    { name: ELITE, level: "ELITE" as const, enrollmentDate: addDaysYmd(TODAY, -33) },
    { name: GUIDED, level: "GUIDED" as const, enrollmentDate: addDaysYmd(TODAY, -10) },
    { name: SOLO, level: "SOLO" as const, enrollmentDate: addDaysYmd(TODAY, -3) },
  ]) {
    await gotoStudentsList(page);
    await page.getByPlaceholder("Filter students…").fill(s.name);
    await page.waitForTimeout(500);
    if ((await studentRow(page, s.name).count()) === 0) expect(await createStudentUI(page, s)).toBeNull();
  }
}

async function gotoTracker(page: Page) {
  await page.goto("/students");
  await page.getByRole("tab", { name: /90\/120-day tracker/ }).click();
}
const trackerRow = (page: Page, name: string): Locator =>
  page.locator("tbody tr", { has: page.getByRole("link", { name, exact: true }) }).first();
async function trackerCells(row: Locator) {
  const t = await row.locator("td").allInnerTexts();
  return { name: t[0], level: t[1], day: t[2], milestone: t[3], signal: t[5], sinceSession: t[6], checkIn: t[7] };
}
const trackerForm = (page: Page, level: "Guided" | "Elite") =>
  enrollmentCard(page, level).locator("form", { has: page.locator('select[name="currentMilestone"]') });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ storageState: authFile("admin"), timezoneId: "Asia/Kolkata" });
  await ensureStudents(await ctx.newPage());
  await ctx.close();
});

test("admin updates the Elite tracker: milestone + signal are logged with user/date; list columns show the state", async ({ page }) => {
  const w = watchErrors(page);
  await openStudent(page, ELITE);
  const card = enrollmentCard(page, "Elite");
  await expect(card).toContainText("Day 34 of 120 · 28.3%");
  await expect(card).toContainText(`ends ${dmy(addDaysYmd(TODAY, -33 + 120))}`);
  const form = trackerForm(page, "Elite");
  test.skip((await card.getByText("Signal history").count()) > 0, "tracker already updated in this invocation");

  await setDate(form.locator('input[name="lastSessionDate"]'), addDaysYmd(TODAY, -5));
  await form.locator('input[name="totalSessionsCompleted"]').fill("4");
  await form.locator('input[name="totalSessionsPlanned"]').fill("16");
  await form.locator('input[name="lastTaskAssigned"]').fill(`${RUN} rewrite CV summary`);
  await chooseOption(page, form.locator('select[name="lastTaskCompleted"]'), "Pending");
  await form.locator('input[name="applicationsSubmitted"]').fill("3");
  await form.locator('input[name="interviewsReceived"]').fill("1");
  await chooseOption(page, form.locator('select[name="currentMilestone"]'), "Resume build");
  await form.locator('input[name="milestoneNote"]').fill(`${RUN} CV draft reviewed`);
  await chooseOption(page, form.locator('select[name="signalColour"]'), "Red");
  await setDate(form.locator('input[name="nextCheckInDate"]'), addDaysYmd(TODAY, 2));
  await form.locator('textarea[name="signalNotes"]').fill(`${RUN} missed two sessions`);
  await form.getByRole("button", { name: "Save tracker" }).click();

  await expect(card.getByText("Milestone progress log")).toBeVisible();
  const logRows = card.locator("table tbody tr");
  await expect(logRows.first()).toContainText("Resume build");
  const top = await logRows.first().locator("td").allInnerTexts();
  expect(top).toEqual([dmy(TODAY), "Ameen", "Onboarding", "Resume build", `${RUN} CV draft reviewed`]);
  await expect(card.getByText(`${dmy(TODAY)} - unset → Red by Ameen · ${RUN} missed two sessions`)).toBeVisible();

  await gotoTracker(page);
  const c = await trackerCells(trackerRow(page, ELITE));
  expect(c).toMatchObject({ level: "Elite", day: "Day 34 of 120", milestone: "Resume build", signal: "Red", sinceSession: "5", checkIn: dmy(addDaysYmd(TODAY, 2)) });
  w.assertClean();
});

test("tracker list: Solo excluded; Guided day number; filters Red only / Elite only / Guided only", async ({ page }) => {
  await gotoTracker(page);
  await expect(trackerRow(page, SOLO)).toHaveCount(0);
  expect((await trackerCells(trackerRow(page, GUIDED))).day).toBe("Day 11 of 90");

  await chooseByAria(page, "Signal filter", "Red only");
  const signals = await page.locator("tbody tr td:nth-child(6)").allInnerTexts();
  expect(signals.length).toBeGreaterThan(0);
  expect(new Set(signals)).toEqual(new Set(["Red"]));
  await expect(trackerRow(page, ELITE)).toHaveCount(1);
  await expect(trackerRow(page, GUIDED)).toHaveCount(0);

  await chooseByAria(page, "Signal filter", "All signals");
  await chooseByAria(page, "Level filter", "Elite only");
  expect(new Set(await page.locator("tbody tr td:nth-child(2)").allInnerTexts())).toEqual(new Set(["Elite"]));
  await expect(trackerRow(page, GUIDED)).toHaveCount(0);
  await chooseByAria(page, "Level filter", "Guided only");
  expect(new Set(await page.locator("tbody tr td:nth-child(2)").allInnerTexts())).toEqual(new Set(["Guided"]));
  await expect(trackerRow(page, GUIDED)).toHaveCount(1);
  await expect(page.locator("span", { hasText: /of \d+ active tracked students/ })).toBeVisible();
});

test("tracker sorts: Red first, longest since session, programme ends soonest", async ({ page }) => {
  await gotoTracker(page);
  const rank: Record<string, number> = { Red: 0, Amber: 1, Green: 2, "Not set": 3 };
  const sig = (await page.locator("tbody tr td:nth-child(6)").allInnerTexts()).map((s) => rank[s.trim()]);
  expect(sig, "default sort: Red, Amber, Green, Not set").toEqual([...sig].sort((a, b) => a - b));

  await chooseByAria(page, "Sort", "Sort: longest since session");
  const days = (await page.locator("tbody tr td:nth-child(7)").allInnerTexts()).map((d) => (d.trim() === "-" ? -1 : Number(d)));
  expect(days, "highest days-since-session first, never-had-a-session last").toEqual([...days].sort((a, b) => b - a));

  await chooseByAria(page, "Sort", "Sort: program ends soonest");
  const names = await page.locator("tbody tr td:nth-child(1)").allInnerTexts();
  // Our Guided (ends today+80) must come before our Elite (ends today+87).
  expect(names.indexOf(GUIDED)).toBeLessThan(names.indexOf(ELITE));
  if (HAS_DB) {
    const rows = await q(
      `select s."fullName" n, e."programEndDate"::text d from enrollment e join student s on s.id=e."studentId"
       where e.status='ACTIVE' and e."programLevel" in ('GUIDED','ELITE')`);
    const end = new Map(rows.map((r: any) => [r.n, r.d]));
    const seq = names.map((n) => end.get(n.trim()) ?? "9999");
    expect(seq).toEqual([...seq].sort());
  }
});

test.describe("Head (Karthick)", () => {
  test.use({ storageState: authFile("head") });
  test("head changes signal and milestone; both logs record Karthick; head sees the milestone log", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto("/students");
    await page.getByRole("tab", { name: /All students & totals/ }).click();
    await page.getByPlaceholder("Filter students…").fill(ELITE);
    await studentRow(page, ELITE).getByRole("link").first().click();
    const card = enrollmentCard(page, "Elite");
    test.skip((await card.getByText(new RegExp(`→ Amber by \S+ · ${RUN} attended`)).count()) > 0, "already done in this invocation");
    const form = trackerForm(page, "Elite");
    await chooseOption(page, form.locator('select[name="signalColour"]'), "Amber");
    await chooseOption(page, form.locator('select[name="currentMilestone"]'), "LinkedIn optimisation");
    await form.locator('textarea[name="signalNotes"]').fill(`${RUN} attended after reminder`);
    await form.getByRole("button", { name: "Save tracker" }).click();
    await expect(card.getByText(new RegExp(`(unset|Red) → Amber by ${IS_PROD ? "\\S+" : "Karthick"} · ${RUN} attended after reminder`))).toBeVisible({ timeout: 45_000 });
    const top = await card.locator("table tbody tr").first().locator("td").allInnerTexts();
    expect(top[0]).toBe(dmy(TODAY));
    expect(top[1]).toBe(IS_PROD ? top[1] : "Karthick");
    expect(top[1]).not.toBe("-");
    expect(top[3]).toBe("LinkedIn optimisation");
    // no way to remove a history row
    await expect(card.locator("table").getByRole("button", { name: /delete|remove/i })).toHaveCount(0);
    w.assertClean();
  });
});

test("milestone + signal log rows cannot be deleted or edited directly (DB guard)", async ({ page }) => {
  await openStudent(page, ELITE);
  await expect(enrollmentCard(page, "Elite").locator("table").getByRole("button", { name: /delete|remove/i })).toHaveCount(0);
  test.skip(!HAS_DB, "DB guard checked locally");
  const c = await pool.connect();
  try {
    for (const [table, sql] of [
      ["milestone_log", `delete from milestone_log where "enrollmentId" in (select e.id from enrollment e join student s on s.id=e."studentId" where s."fullName"=$1)`],
      ["milestone_log", `update milestone_log set note='x' where "enrollmentId" in (select e.id from enrollment e join student s on s.id=e."studentId" where s."fullName"=$1)`],
      ["signal_change_log", `delete from signal_change_log where "enrollmentId" in (select e.id from enrollment e join student s on s.id=e."studentId" where s."fullName"=$1)`],
    ]) {
      await c.query("BEGIN");
      let err = "";
      try { await c.query(sql, [ELITE]); } catch (e: any) { err = e.message; }
      await c.query("ROLLBACK");
      expect(err, `${table}: ${sql.slice(0, 20)}`).toContain("append-only");
    }
  } finally {
    c.release();
  }
});

test("Solo detail has no tracker", async ({ page }) => {
  await openStudent(page, SOLO);
  await expect(page.getByText("Solo is self-paced - no 90/120-day tracker.")).toBeVisible();
  await expect(enrollmentCard(page, "Solo")).toContainText("lifetime");
});

test.describe("tracker dates under Europe/Berlin browser", () => {
  test.use({ timezoneId: "Europe/Berlin" });
  test("next check-in / last session saved from a Berlin browser keep their calendar date", async ({ page }) => {
    await openStudent(page, GUIDED);
    const form = trackerForm(page, "Guided");
    await setDate(form.locator('input[name="lastSessionDate"]'), "2026-03-29"); // Berlin DST switch day
    await setDate(form.locator('input[name="nextCheckInDate"]'), addDaysYmd(TODAY, 1));
    await form.getByRole("button", { name: "Save tracker" }).click();
    await page.waitForTimeout(1500);
    await page.reload();
    const f2 = trackerForm(page, "Guided");
    await expect(f2.locator('input[name="lastSessionDate"]')).toHaveValue("2026-03-29");
    await expect(f2.locator('input[name="nextCheckInDate"]')).toHaveValue(addDaysYmd(TODAY, 1));
    await gotoTracker(page);
    const c = await trackerCells(trackerRow(page, GUIDED));
    expect(c.checkIn).toBe(dmy(addDaysYmd(TODAY, 1)));
    expect(Number(c.sinceSession)).toBe(Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse("2026-03-29T00:00:00Z")) / 86400000));
  });
});

test("PPL-09: the first milestone log entry (Onboarding at enrollment) has no 'Updated by'", async ({ page }) => {
  await openStudent(page, SOLO);
  // Solo has no tracker UI but the log is still written; check on the Guided card instead.
  await openStudent(page, GUIDED);
  const card = enrollmentCard(page, "Guided");
  const rows = card.locator("table tbody tr");
  await expect(rows.last()).toContainText("Onboarding");
  const cells = await rows.last().locator("td").allInnerTexts();
  expect(cells[1], "PPL-09: PRD2 §4.4 'Updated by (auto-filled from logged-in user)' - the creation entry shows '-'").not.toBe("-");
});

test("PPL-11: Weekly update (batch) of ONE field wipes last session, task, check-in date and signal notes", async ({ page }) => {
  // Set known values on the Elite tracker first.
  await openStudent(page, ELITE);
  let form = trackerForm(page, "Elite");
  await setDate(form.locator('input[name="lastSessionDate"]'), addDaysYmd(TODAY, -5));
  await form.locator('input[name="lastTaskAssigned"]').fill(`${RUN} rewrite CV summary`);
  await setDate(form.locator('input[name="nextCheckInDate"]'), addDaysYmd(TODAY, 2));
  await form.locator('textarea[name="signalNotes"]').fill(`${RUN} batch baseline`);
  await form.getByRole("button", { name: "Save tracker" }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  form = trackerForm(page, "Elite");
  await expect(form.locator('input[name="lastTaskAssigned"]')).toHaveValue(`${RUN} rewrite CV summary`);

  // Coach's weekly round: only the signal changes for this student.
  await page.goto("/students");
  await page.getByRole("tab", { name: "Weekly update" }).click();
  const current = (await page.getByRole("button", { name: `Signal for ${ELITE}` }).innerText()).trim();
  await chooseByAria(page, `Signal for ${ELITE}`, current.startsWith("Red") ? "Amber - slipping" : "Red - at risk");
  await page.getByRole("button", { name: "Save 1 change" }).click();
  await expect(page.getByRole("button", { name: "No changes" })).toBeVisible({ timeout: 30_000 });

  await openStudent(page, ELITE);
  form = trackerForm(page, "Elite");
  const got = {
    lastSessionDate: await form.locator('input[name="lastSessionDate"]').inputValue(),
    lastTaskAssigned: await form.locator('input[name="lastTaskAssigned"]').inputValue(),
    nextCheckInDate: await form.locator('input[name="nextCheckInDate"]').inputValue(),
    signalNotes: await form.locator('textarea[name="signalNotes"]').inputValue(),
  };
  expect(got, "PPL-11: fields the coach did not touch in the weekly round must be preserved").toEqual({
    lastSessionDate: addDaysYmd(TODAY, -5),
    lastTaskAssigned: `${RUN} rewrite CV summary`,
    nextCheckInDate: addDaysYmd(TODAY, 2),
    signalNotes: `${RUN} batch baseline`,
  });
});

test("PPL-10: deleting a student (Admin) erases its milestone + signal history (PRD2 §6: not deletable by anyone)", async ({ page }) => {
  test.skip(!HAS_DB, "needs DB to see the history rows disappear");
  const name = tag("Tracker Throwaway");
  expect(await createStudentUI(page, { name, level: "GUIDED", enrollmentDate: addDaysYmd(TODAY, -2) })).toBeNull();
  await openStudent(page, name);
  const form = trackerForm(page, "Guided");
  await chooseOption(page, form.locator('select[name="currentMilestone"]'), "Resume build");
  await chooseOption(page, form.locator('select[name="signalColour"]'), "Green");
  await form.getByRole("button", { name: "Save tracker" }).click();
  await expect(enrollmentCard(page, "Guided").getByText("Signal history")).toBeVisible();
  const eid = (await one(`select e.id from enrollment e join student s on s.id=e."studentId" where s."fullName"=$1`, [name])).id;
  const before = await one(`select (select count(*)::int from milestone_log where "enrollmentId"=$1) m, (select count(*)::int from signal_change_log where "enrollmentId"=$1) s`, [eid]);
  expect(before.m).toBeGreaterThanOrEqual(2);
  await deleteStudentUI(page, name);
  const after = await one(`select (select count(*)::int from milestone_log where "enrollmentId"=$1) m, (select count(*)::int from signal_change_log where "enrollmentId"=$1) s`, [eid]);
  expect(after, `PPL-10: history before delete ${JSON.stringify(before)} - an admin delete must not erase it`).toEqual(before);
});
