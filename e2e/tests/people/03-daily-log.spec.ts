import { test, expect, Page, Locator } from "@playwright/test";
import { authFile, ROLES } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun } from "../../helpers/people-data";
import { HAS_DB, IS_PROD, recordCreated } from "../../helpers/target";
import { one, pool } from "../../helpers/db";
import { dmy, istNow, mondayOf, openTab } from "../../helpers/people-ui";

/**
 * PRD2 §3.3 Daily activity log + §6 (logs undeletable, admin correction note).
 *
 * Creates: ONE DailyLog for the Head account for today (IST) - undeletable by design, plus one
 * correction note on it. On a re-run the same day the log already exists: the create/duplicate tests
 * skip and the read-only checks still run.
 *
 * Asma/Nilofer (USER) no longer have My Daily Log by default (founder's call, lib/sections.ts), so the
 * Discovery / Setter field sets are checked from code (DAILY_LOG_FIELDS) and the Head (coach) form is
 * the one exercised end to end.
 */
const RUN = stableRun("dailylog");
const COACH_FIELDS = [
  "Sessions delivered today",
  "Students checked in on",
  "Assignments reviewed",
  "Students flagged as at risk",
];
const SUBMIT = { sessionsDelivered: 3, studentsCheckedInOn: 5, assignmentsReviewed: 2, studentsFlaggedAtRisk: 1 };
const SHORT: Record<string, string> = {
  sessionsDelivered: "Sessions", studentsCheckedInOn: "Check-ins", assignmentsReviewed: "Assignments", studentsFlaggedAtRisk: "At-risk flags",
};

async function headState(page: Page): Promise<"form" | "logged" | "closed" | "amend" | "noprofile"> {
  await page.goto("/daily-log");
  await expect(page.getByRole("heading", { name: "My Daily Log" })).toBeVisible();
  if (await page.getByText("Your team profile isn’t set up yet").count()) return "noprofile";
  if (await page.getByRole("heading", { name: "Log today" }).count()) return "form";
  if (await page.getByText("Today's log is in.").count()) return "logged";
  if (await page.getByText("Today's log is closed.").count()) return "closed";
  return "amend";
}

/** Read the Admin rollup table for `user`: { [rowLabel]: { [shortHeader]: number } }. */
async function readRollup(page: Page, user: string, kind: "Weekly totals" | "Monthly totals") {
  const details = page.locator("details", { hasText: "Weekly & monthly totals" });
  if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) await details.locator("summary").click();
  const section = details.locator("div", { has: page.locator("h4", { hasText: kind }) }).last();
  const block = section.locator("div.rounded-field", { has: page.locator("p.font-semibold", { hasText: new RegExp(`^${user}$`) }) });
  if ((await block.count()) === 0) return {};
  const heads = await block.locator("thead th").allInnerTexts();
  const out: Record<string, Record<string, number>> = {};
  for (const tr of await block.locator("tbody tr").all()) {
    const cells = await tr.locator("td").allInnerTexts();
    out[cells[0].trim()] = Object.fromEntries(heads.slice(1).map((h, i) => [h.trim(), Number(cells[i + 1].trim())]));
  }
  return out;
}

async function headProfileName(page: Page): Promise<string> {
  await page.goto("/people");
  await openTab(page, /Team & org chart/);
  const c = page.locator("div.w-64", { hasText: ROLES.head.email });
  return (await c.first().locator("p.font-display").innerText()).trim();
}

const rosterCard = (page: Page, name: string): Locator =>
  page.locator("div.rounded-card", { has: page.locator("span.font-medium", { hasText: new RegExp(`^${name}$`) }) }).first();

test.describe("Head (coach) daily log", () => {
  test.use({ storageState: authFile("head") });

  test("form shows the coach fields, date is fixed to today (no date control)", async ({ page }) => {
    const w = watchErrors(page);
    const st = await headState(page);
    test.skip(st === "noprofile", "head account has no team profile");
    if (st !== "form") {
      test.info().annotations.push({ type: "state", description: `today's log already ${st}` });
      await expect(page.getByText(/Today's log is in\.|Today's log is closed\.|Amend/)).toBeVisible();
      return;
    }
    const form = page.locator("form", { has: page.getByRole("heading", { name: "Log today" }) });
    for (const label of COACH_FIELDS) await expect(form.getByText(label, { exact: false }).first()).toBeVisible();
    await expect(form.getByText("Date is fixed to today.")).toBeVisible();
    await expect(form.locator('input[type="date"], input[name="date"]')).toHaveCount(0);
    w.assertClean();
  });
});

test("Admin board: missing-log badge follows the 7:00 PM IST rule for someone who has not logged", async ({ browser }) => {
  // The badge is computed on the SERVER from the real clock (people-metrics istHourNow), so a mocked
  // browser clock cannot move it; the test asserts whichever side of 19:00 IST the request lands on.
  const admin = await browser.newContext({ storageState: authFile("admin") });
  const page = await admin.newPage();
  const name = await headProfileName(page);
  const before = istNow();
  await page.goto("/people");
  const after = istNow();
  test.skip((before.hour >= 19) !== (after.hour >= 19) || before.ymd !== after.ymd, "request straddled 19:00 IST");
  const card = rosterCard(page, name);
  await expect(card).toBeVisible();
  const logged = await card.getByText("Logged ✓").count();
  if (logged) {
    test.info().annotations.push({ type: "state", description: `${name} already logged today - badge rule checked on "Logged" only` });
    await expect(card.getByText("⚠ Missing log")).toHaveCount(0);
  } else if (after.hour >= 19) {
    await expect(card.getByText("⚠ Missing log")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Daily logs ⚠/ })).toBeVisible();
  } else {
    await expect(card.getByText("Pending")).toBeVisible();
    await expect(card.getByText("⚠ Missing log")).toHaveCount(0);
  }
  await admin.close();
});

test("Head submits once; a second submit for the same day is refused; admin feed + weekly/monthly rollups move by exactly the numbers", async ({ browser }) => {
  const head = await browser.newContext({ storageState: authFile("head") });
  const admin = await browser.newContext({ storageState: authFile("admin") });
  const hp = await head.newPage();
  const hp2 = await head.newPage();
  const ap = await admin.newPage();
  const w = watchErrors(hp);

  const st = await headState(hp);
  test.skip(st !== "form", `today's log is already ${st} - duplicate path needs a fresh day`);
  await headState(hp2); // stale second tab, still showing the form

  const name = await headProfileName(ap);
  const today = istNow().ymd;
  const weekLabel = dmy(mondayOf(today));
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`));
  await ap.goto("/people");
  const wBefore = (await readRollup(ap, name, "Weekly totals"))[weekLabel] ?? {};
  const mBefore = (await readRollup(ap, name, "Monthly totals"))[monthLabel] ?? {};

  const form = hp.locator("form", { has: hp.getByRole("heading", { name: "Log today" }) });
  for (const [k, v] of Object.entries(SUBMIT)) await form.locator(`input[name="${k}"]`).fill(String(v));
  await form.locator('textarea[name="notes"]').fill(`${RUN} e2e coach log`);
  await form.getByRole("button", { name: "Submit today's log" }).click();
  await expect(hp.getByText("Today's log is in.")).toBeVisible();
  recordCreated("people", { kind: "DailyLog", label: `${ROLES.head.email} ${today}`, cleanup: "NONE - daily logs are append-only by design (PRD2 §6); cannot be deleted" });

  // Stale tab: same user, same day -> PRD error text
  const form2 = hp2.locator("form", { has: hp2.getByRole("heading", { name: "Log today" }) });
  await form2.locator('input[name="sessionsDelivered"]').fill("9");
  await form2.getByRole("button", { name: "Submit today's log" }).click();
  await expect(form2.getByRole("alert")).toHaveText("You have already submitted today. Contact Admin to make changes.");

  // Admin: roster shows Logged, feed shows today's entry with the notes
  await ap.goto("/people");
  await expect(rosterCard(ap, name).getByText("Logged ✓")).toBeVisible();
  const feedEntry = ap.locator("div.rounded-card", { hasText: `${RUN} e2e coach log` }).last();
  await expect(feedEntry).toBeVisible();
  await expect(feedEntry).toContainText("Today");

  const wAfter = (await readRollup(ap, name, "Weekly totals"))[weekLabel] ?? {};
  const mAfter = (await readRollup(ap, name, "Monthly totals"))[monthLabel] ?? {};
  for (const [k, v] of Object.entries(SUBMIT)) {
    const h = SHORT[k];
    expect((wAfter[h] ?? 0) - (wBefore[h] ?? 0), `weekly ${h} delta`).toBe(v);
    expect((mAfter[h] ?? 0) - (mBefore[h] ?? 0), `monthly ${h} delta`).toBe(v);
  }
  if (HAS_DB) {
    const r = await one(`select d.date::text, d."sessionsDelivered" s, d.source from daily_log d join "user" u on u.id=d."userId" where u.email=$1 and d.notes=$2`, [ROLES.head.email, `${RUN} e2e coach log`]);
    expect(r.date).toBe(today); // stored as the IST calendar day
    expect(r.s).toBe(3);
    expect(r.source).toBe("HUMAN");
  }
  w.assertClean();
  await head.close();
  await admin.close();
});

test.describe("own log only", () => {
  test.use({ storageState: authFile("head") });
  test("the Head's history lists only their own entries", async ({ page }) => {
    test.skip(!HAS_DB, "entry count compared against the DB");
    await headState(page);
    const shown = await page.locator("span", { hasText: /^\d+ entr(y|ies)$/ }).first().innerText();
    const r = await one(`select count(*)::int n from daily_log d join "user" u on u.id=d."userId" where u.email=$1`, [ROLES.head.email]);
    // the page loads at most 120 of your own logs
    expect(Number(shown.split(" ")[0])).toBe(Math.min(r.n, 120));
    // no other member's name leaks into the personal timeline
    for (const other of ["Asma", "Nilofer"]) {
      await expect(page.locator("section", { has: page.getByRole("heading", { name: "My log history" }) }).getByText(other)).toHaveCount(0);
    }
  });
});

test.describe("USER role (Asma / Nilofer)", () => {
  test.use({ storageState: authFile("asma") });
  test("DIV: a telecaller USER has no My Daily Log by default (PRD2 §3.3 expects one)", async ({ page }) => {
    await page.goto("/daily-log");
    // Divergence, not a bug: lib/sections.ts removes daily-log from USER - their day is measured from CallLog.
    await expect(page).toHaveURL(/denied=daily-log/);
    test.info().annotations.push({ type: "DIV-01", description: "USER redirected away from /daily-log" });
  });
});

test.describe("Admin: undeletable logs + correction note", () => {
  test.use({ storageState: authFile("admin") });

  test("no delete control on any log; a direct DELETE is refused by the database", async ({ page }) => {
    await page.goto("/people");
    const feed = page.locator("div", { has: page.getByRole("heading", { name: "Team activity" }) }).last();
    await expect(feed.getByRole("button", { name: /delete|remove|archive/i })).toHaveCount(0);
    test.skip(!HAS_DB, "DB guard is checked locally only");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (await c.query(`select id from daily_log order by date desc limit 1`)).rows[0];
      let err = "";
      try {
        await c.query(`delete from daily_log where id=$1`, [row.id]);
      } catch (e: any) {
        err = e.message;
      }
      expect(err).toContain("append-only");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  test("admin adds a correction note; the original numbers stay intact", async ({ page }) => {
    await page.goto("/people");
    const entry = page.locator("div.rounded-card.p-4", { hasText: `${RUN} e2e coach log` }).first();
    test.skip((await entry.count()) === 0, "no log from this run to correct");
    test.skip((await entry.getByRole("button", { name: "Add correction" }).count()) === 0, "already corrected");
    const chipsBefore = await entry.locator("div.mt-3.flex.flex-wrap").first().innerText();
    await entry.getByRole("button", { name: "Add correction" }).click();
    const form = page.locator("form", { hasText: "Correction note for" });
    await form.locator('input[name="correctionNote"]').fill(`${RUN} actually 4 sessions - one was not logged`);
    await form.getByRole("button", { name: "Save note" }).click();
    const corrected = page.locator("div.rounded-card.p-4", { hasText: `${RUN} e2e coach log` }).first();
    await expect(corrected.getByText("Admin correction")).toBeVisible();
    await expect(corrected).toContainText(`${RUN} actually 4 sessions`);
    expect(await corrected.locator("div.mt-3.flex.flex-wrap").first().innerText()).toBe(chipsBefore);
    // Only ONE correction per log: the button disappears (PPL-08 - a later correction cannot be added).
    await expect(corrected.getByRole("button", { name: "Add correction" })).toHaveCount(0);
    recordCreated("people", { kind: "DailyLog.correctionNote", label: `${RUN} correction`, cleanup: "NONE - correction notes cannot be removed" });
    if (HAS_DB) {
      const r = await one(`select "sessionsDelivered" s, "correctionNote" n from daily_log where notes=$1`, [`${RUN} e2e coach log`]);
      expect(r.s).toBe(3);
      expect(r.n).toContain("actually 4 sessions");
    }
  });

  test("DIV: Admin's People feed hides Discovery/Setter logs (Asma, Nilofer) that exist", async ({ page }) => {
    test.skip(!HAS_DB, "needs DB to know the hidden logs exist");
    const r = await one(`select count(*)::int n from daily_log where variant in ('DISCOVERY_SPECIALIST','APPOINTMENT_SETTER')`);
    await page.goto("/people");
    const feedSearch = page.getByRole("textbox", { name: "Search log entries" });
    await feedSearch.fill("Asma");
    await expect(page.getByText("No entries match")).toBeVisible();
    test.info().annotations.push({ type: "DIV-02", description: `${r.n} telecaller logs exist but the People feed filters them out (people/page.tsx logEntries)` });
  });

  test("live badge: the board refreshes itself every 60s (mocked browser clock)", async ({ page }) => {
    await page.clock.install();
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "Today", exact: true }).first()).toBeVisible();
    const refresh = page.waitForRequest((r) => r.url().includes("/people") && !!r.headers()["rsc"], { timeout: 20_000 });
    await page.clock.runFor(61_000);
    await refresh;
  });
});
