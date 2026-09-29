import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun } from "../../helpers/people-data";
import { FENCE, HAS_DB, IS_PROD } from "../../helpers/target";
import { one } from "../../helpers/db";
import { addDaysYmd, dmy, downloadText, istNow, metricDetail, metricText, parseCsv } from "../../helpers/people-ui";
import {
  createStudentUI, deleteStudentUI, enrollmentCard, foreignStudentsSince, gotoStudentsList, openStudent,
  readCounts, setStatus, studentRow,
} from "../../helpers/people-students";

/**
 * PRD2 §4.1 profile, §4.2 count dashboard, §4.5 satisfaction, §6 CSV; PRD3 §3.4 Ghosted Blueprint tag.
 * Creates Students (deleted by the cleanup spec, or inline for the date-arithmetic ones).
 */
test.use({ storageState: authFile("admin") });
const RUN = stableRun("students");
const tag = (s: string) => `${RUN} ${s}`;
const TODAY = istNow().ymd;
const MAIN = tag("Student Guided");

test("create a Guided student (all fields, Ghosted Blueprint) - list, detail and counts move", async ({ page }) => {
  const w = watchErrors(page);
  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(MAIN);
  test.skip((await studentRow(page, MAIN).count()) > 0, "already created in this invocation");

  const since = new Date().toISOString();
  const before = await readCounts(page);
  const err = await createStudentUI(page, {
    name: MAIN, level: "GUIDED", enrollmentDate: TODAY, leadSource: "Ghosted Blueprint", email: true, phone: true,
    industry: "Mechanical Engineer", targetRole: "Design Engineer", notes: `${RUN} internal note`, sessionsPlanned: "12",
  });
  expect(err).toBeNull();
  const after = await readCounts(page);
  const foreign = await foreignStudentsSince(since, RUN);

  expect(after.totalActive - before.totalActive, "Total active +1").toBe(1);
  expect(after.guided - before.guided, "Active Guided +1").toBe(1);
  expect(after.solo - before.solo).toBe(0);
  expect(after.elite - before.elite).toBe(0);
  if (IS_PROD) expect(after.allTime - before.allTime).toBeGreaterThanOrEqual(1);
  else expect(after.allTime - before.allTime - foreign, "Enrolled all time +1").toBe(1);

  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(MAIN);
  const row = studentRow(page, MAIN);
  await expect(row).toContainText(dmy(TODAY));
  await expect(row).toContainText("Ghosted Blueprint");
  await expect(row).toContainText("Mechanical Engineer");
  await expect(row).toContainText("ACTIVE");

  await openStudent(page, MAIN);
  await expect(page.getByText(`${FENCE.primary.email} · ${FENCE.primary.phone} · Mechanical Engineer`)).toBeVisible();
  await expect(page.getByText("Target: Design Engineer")).toBeVisible();
  await expect(page.getByText("Lead source: Ghosted Blueprint")).toBeVisible();
  const card = enrollmentCard(page, "Guided");
  await expect(card).toContainText(`Guided - enrolled ${dmy(TODAY)}`);
  await expect(card).toContainText("Day 1 of 90 · 1.1%");
  await expect(card).toContainText(`ends ${dmy(addDaysYmd(TODAY, 90))}`);
  await expect(card).toContainText("Coach: Karthick");
  w.assertClean();
});

const END_CASES: Array<{ level: "SOLO" | "GUIDED" | "ELITE"; start: string; end: string | null; why: string }> = [
  { level: "GUIDED", start: "2023-12-01", end: "2024-02-29", why: "Guided +90 lands on a leap day" },
  { level: "ELITE", start: "2023-11-01", end: "2024-02-29", why: "Elite +120 lands on a leap day" },
  { level: "ELITE", start: "2024-10-03", end: "2025-01-31", why: "Elite +120 crosses the year" },
  { level: "GUIDED", start: "2025-12-31", end: "2026-03-31", why: "Guided +90 from New Year's Eve (non-leap Feb)" },
  { level: "SOLO", start: "2024-02-29", end: null, why: "Solo has no end date" },
];

for (const tz of ["Asia/Kolkata", "Europe/Berlin"]) {
  test.describe(`programme end date arithmetic (${tz} browser)`, () => {
    test.use({ timezoneId: tz });
    test(`end date = enrollment + 90/120, none for Solo; no day shift (${tz})`, async ({ page }) => {
      test.setTimeout(600_000);
      const tzKey = tz === "Europe/Berlin" ? "BER" : "IST";
      const created: string[] = [];
      try {
        for (const [i, c] of END_CASES.entries()) {
          const name = tag(`Dates ${tzKey} ${i + 1}`);
          const err = await createStudentUI(page, { name, level: c.level, enrollmentDate: c.start });
          expect(err, c.why).toBeNull();
          created.push(name);
          await gotoStudentsList(page);
          await page.getByPlaceholder("Filter students…").fill(name);
          await expect(studentRow(page, name), `${c.why}: list Enrolled`).toContainText(dmy(c.start));
          await openStudent(page, name);
          const label = c.level === "SOLO" ? "Solo" : c.level === "GUIDED" ? "Guided" : "Elite";
          const card = enrollmentCard(page, label);
          await expect(card, c.why).toContainText(`${label} - enrolled ${dmy(c.start)}`);
          if (c.end) await expect(card, c.why).toContainText(`ends ${dmy(c.end)}`);
          else await expect(card, c.why).toContainText("lifetime");
          if (HAS_DB) {
            const r = await one(
              `select e."enrollmentDate"::text s, e."programEndDate"::text e, e.duration from enrollment e join student s on s.id=e."studentId" where s."fullName"=$1`, [name]);
            expect(r.s, `${c.why}: stored enrollment date`).toBe(c.start);
            expect(r.e, `${c.why}: stored end date`).toBe(c.end);
          }
        }
      } finally {
        for (const n of created) await deleteStudentUI(page, n);
      }
    });
  });
}

test("status changes move Completed / Dropped this month and Active counts", async ({ page }) => {
  await openStudent(page, MAIN);
  const card = enrollmentCard(page, "Guided");
  const current = (await card.getByRole("button", { name: "Enrolment status" }).innerText()).trim();
  test.skip(current !== "Active", `main student is ${current} (re-run)`);

  test.setTimeout(300_000);
  const c0 = await readCounts(page);
  await openStudent(page, MAIN);
  await setStatus(page, enrollmentCard(page, "Guided"), "Completed");
  const c1 = await readCounts(page);
  expect(c1.completed - c0.completed, "Completed this month +1").toBe(1);
  expect(c1.totalActive - c0.totalActive, "Total active -1").toBe(-1);
  expect(c1.guided - c0.guided, "Active Guided -1").toBe(-1);

  await openStudent(page, MAIN);
  await setStatus(page, enrollmentCard(page, "Guided"), "Dropped");
  const c2 = await readCounts(page);
  expect(c2.dropped - c1.dropped, "Dropped this month +1").toBe(1);
  expect(c2.completed - c1.completed, "no longer counted as completed").toBe(-1);

  await openStudent(page, MAIN);
  await setStatus(page, enrollmentCard(page, "Guided"), "Paused");
  const c3 = await readCounts(page);
  expect(c3.dropped - c2.dropped).toBe(-1);
  expect(c3.totalActive - c2.totalActive, "Paused is not active").toBe(0);

  await openStudent(page, MAIN);
  await setStatus(page, enrollmentCard(page, "Guided"), "Completed");
  const c4 = await readCounts(page);
  expect(c4.completed - c3.completed).toBe(1);
});

test("satisfaction 1-10 and recommend 0-10 are validated; a valid score moves the averages (completed students)", async ({ page }) => {
  await openStudent(page, MAIN);
  const status = (await enrollmentCard(page, "Guided").getByRole("button", { name: "Enrolment status" }).innerText()).trim();
  test.skip(status !== "Completed", "needs the main student in Completed (previous test)");
  const scoresCard = page.locator("section.rounded-card", { has: page.getByRole("heading", { name: "Satisfaction & recommend score" }) }).first();
  const form = scoresCard.locator("form");
  const submit = async (sat: string, nps: string) => {
    await form.locator('input[name="satisfactionScore"]').fill(sat);
    await form.locator('input[name="npsScore"]').fill(nps);
    await form.getByRole("button", { name: "Record score" }).click();
  };
  const alert = page.getByRole("alert").first();
  await submit("11", "5");
  await expect(alert).toHaveText("Satisfaction score must be between 1 and 10");
  await submit("0", "5");
  await expect(alert).toHaveText("Satisfaction score must be between 1 and 10");
  await submit("7", "11");
  await expect(alert).toHaveText("Recommend score must be between 0 and 10");
  await expect(scoresCard.locator("p", { hasText: "satisfaction" })).toHaveCount(0);

  await page.goto("/students");
  const satText = await metricText(page, "Avg satisfaction");
  const npsText = await metricText(page, "Avg recommend score");
  const n = Number((await metricDetail(page, "Avg satisfaction"))["Sample size"]);

  await openStudent(page, MAIN);
  const f2 = page.locator("section.rounded-card", { has: page.getByRole("heading", { name: "Satisfaction & recommend score" }) }).first().locator("form");
  await f2.locator('input[name="satisfactionScore"]').fill("8");
  await f2.locator('input[name="npsScore"]').fill("0"); // 0 is a legal NPS
  await f2.getByRole("button", { name: "Record score" }).click();
  await expect(page.getByText(/satisfaction\s+8\/10, would recommend\s+0\/10/)).toBeVisible();

  await page.goto("/students");
  const n2 = Number((await metricDetail(page, "Avg satisfaction"))["Sample size"]);
  expect(n2 - n, "sample size +1").toBe(1);
  const within = (shown: string, added: number, label: string) => {
    const d = Number(shown);
    const lo = shown === "-" ? added : ((d - 0.05) * n + added) / (n + 1);
    const hi = shown === "-" ? added : ((d + 0.05) * n + added) / (n + 1);
    return { lo: lo - 0.05, hi: hi + 0.05, label };
  };
  const s = within(satText, 8, "sat");
  const p = within(npsText, 0, "nps");
  const satAfter = Number(await metricText(page, "Avg satisfaction"));
  const npsAfter = Number(await metricText(page, "Avg recommend score"));
  expect(satAfter).toBeGreaterThanOrEqual(s.lo);
  expect(satAfter).toBeLessThanOrEqual(s.hi);
  expect(npsAfter).toBeGreaterThanOrEqual(p.lo);
  expect(npsAfter).toBeLessThanOrEqual(p.hi);
});

test("PPL-06: lead source options offered on the form that the server rejects (Meta Lead Ad / Landing page)", async ({ page }) => {
  const results: string[] = [];
  for (const src of ["Meta Lead Ad", "Landing page"]) {
    const name = tag(`Source ${src.split(" ")[0]}`);
    const err = await createStudentUI(page, { name, level: "SOLO", enrollmentDate: TODAY, leadSource: src });
    if (err) results.push(`${src}: ${err}`);
    else await deleteStudentUI(page, name);
  }
  expect(results, `PPL-06: every Lead source option shown must be accepted -> ${results.join(" | ")}`).toEqual([]);
});

test("CSV export (all fields) contains the student with every field", async ({ page }) => {
  await gotoStudentsList(page);
  const { name, text } = await downloadText(page, () => page.getByRole("button", { name: "Export all fields" }).click());
  expect(name).toBe("students-full.csv");
  const row = parseCsv(text).find((r) => r.Name === MAIN);
  expect(row, "student present in CSV").toBeTruthy();
  expect(row).toMatchObject({
    Email: FENCE.primary.email,
    "Programme(s)": "GUIDED",
    "Enrollment date": TODAY,
    "Programme end date": addDaysYmd(TODAY, 90),
    "Assigned coach": "Karthick",
    "Lead source": "Ghosted Blueprint",
    Industry: "Mechanical Engineer",
    "Target role": "Design Engineer",
    "Internal notes": `${RUN} internal note`,
  });
  expect(row!["Student ID"]).toMatch(/\S/);
  expect(row!.Status).toMatch(/ACTIVE|COMPLETED|DROPPED|PAUSED/);
  expect(row!["Total paid (INR)"]).toBe("0");
  // PPL-07: the formula-injection guard prefixes every "+CC" phone with an apostrophe in the file.
  expect(row!.Phone, "PPL-07: exported phone must be the stored number, not \"'+91...\"").toBe(FENCE.primary.phone);
});

test.describe("Head (Karthick) on Students", () => {
  test.use({ storageState: authFile("head") });
  test("can view every student but cannot edit profile, status, satisfaction, or add/delete", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto("/students");
    await page.getByRole("tab", { name: /All students & totals/ }).click();
    await expect(page.getByRole("button", { name: "Add student" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export all fields" })).toHaveCount(0);
    await page.getByPlaceholder("Filter students…").fill(MAIN);
    const row = studentRow(page, MAIN);
    test.skip((await row.count()) === 0, "main student not created");
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await row.getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(MAIN);
    await expect(page.getByRole("button", { name: "Edit profile" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enrolment status" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Record score" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Add enrollment (upgrade)" })).toHaveCount(0);
    await expect(page.getByText("Student portal access")).toHaveCount(0);
    w.assertClean();
  });
});
