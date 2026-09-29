import { expect, Page, Locator } from "@playwright/test";
import { assertFenced, FENCE, HAS_DB, recordCreated } from "./target";
import { one, q } from "./db";
import { chooseOption, confirmDialog, metricNumber, metricText, openTab, setDate } from "./people-ui";

export type NewStudent = {
  name: string;
  level: "SOLO" | "GUIDED" | "ELITE";
  enrollmentDate: string; // YYYY-MM-DD
  leadSource?: string; // visible label e.g. "Ghosted Blueprint"
  email?: boolean; // type the fenced email
  phone?: boolean; // type the fenced phone
  industry?: string;
  targetRole?: string;
  notes?: string;
  sessionsPlanned?: string;
  coach?: "Karthick" | "Ameen";
};

const LEVEL_LABEL = { SOLO: "Solo (lifetime, self-paced)", GUIDED: "Guided (90 days)", ELITE: "Elite (120 days)" } as const;

export async function gotoStudentsList(page: Page) {
  await page.goto("/students");
  await openTab(page, /All students & totals/);
}

/** Fill + submit the Add student modal. Returns the FormError text, or null on success. */
export async function createStudentUI(page: Page, s: NewStudent): Promise<string | null> {
  await gotoStudentsList(page);
  await page.getByRole("button", { name: "Add student" }).click();
  const dlg = page.getByRole("dialog", { name: /New student/ });
  await expect(dlg).toBeVisible();
  const form = dlg.locator("form");
  await form.locator('input[name="fullName"]').fill(s.name);
  if (s.email) await form.locator('input[name="email"]').fill(assertFenced(FENCE.primary.email));
  if (s.phone) await form.locator('input[name="phone"]').fill(assertFenced(FENCE.primary.phone));
  await chooseOption(page, form.locator('select[name="programLevel"]'), LEVEL_LABEL[s.level]);
  await setDate(form.locator('input[name="enrollmentDate"]'), s.enrollmentDate);
  if (s.sessionsPlanned) await form.locator('input[name="totalSessionsPlanned"]').fill(s.sessionsPlanned);
  if (s.coach) await chooseOption(page, form.locator('select[name="assignedCoach"]'), s.coach);
  if (s.leadSource) await chooseOption(page, form.locator('select[name="leadSource"]'), s.leadSource);
  if (s.industry) await form.locator('input[name="industry"]').fill(s.industry);
  if (s.targetRole) await form.locator('input[name="targetRole"]').fill(s.targetRole);
  if (s.notes) await form.locator('textarea[name="internalNotes"]').fill(s.notes);
  await form.getByRole("button", { name: "Create student" }).click();
  const alert = form.getByRole("alert");
  const done = await Promise.race([
    dlg.waitFor({ state: "hidden", timeout: 30_000 }).then(() => "ok" as const),
    alert.waitFor({ state: "visible", timeout: 30_000 }).then(() => "err" as const),
  ]);
  if (done === "err") {
    const msg = (await alert.innerText()).trim();
    await page.keyboard.press("Escape");
    return msg;
  }
  recordCreated("people", {
    kind: "Student",
    label: s.name,
    cleanup: "Students > All students & totals > Delete (hard delete; cascades enrollments, milestone + signal logs)",
  });
  return null;
}

export function studentRow(page: Page, name: string): Locator {
  return page.locator("tbody tr", { has: page.getByRole("link", { name: new RegExp(`^${esc(name)}`) }) }).first();
}
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Filter the list to the name and open the detail page. Returns the student id. */
export async function openStudent(page: Page, name: string): Promise<string> {
  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(name);
  await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 15_000 }).catch(() => {});
  const link = studentRow(page, name).getByRole("link").first();
  await link.click();
  await expect(page).toHaveURL(/\/students\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(name);
  return page.url().split("/").pop()!;
}

export async function deleteStudentUI(page: Page, name: string) {
  await gotoStudentsList(page);
  await page.getByPlaceholder("Filter students…").fill(name);
  const row = studentRow(page, name);
  // the filter is a deferred value - wait for the table to settle on the one row
  await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 15_000 }).catch(() => {});
  if ((await row.count()) === 0) return false;
  await row.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete student");
  await expect(studentRow(page, name)).toHaveCount(0, { timeout: 20_000 });
  return true;
}

/** Set an enrollment's status from the detail page (Admin). `card` = the enrollment Card. */
export async function setStatus(page: Page, card: Locator, label: "Active" | "Completed" | "Dropped" | "Paused") {
  await card.getByRole("button", { name: "Enrolment status" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await confirmDialog(page, "Change status");
  await expect(card.getByRole("button", { name: "Enrolment status" })).toContainText(label, { timeout: 20_000 });
}

/** The enrollment card on the detail page whose title starts with the level label. */
export function enrollmentCard(page: Page, levelLabel: "Solo" | "Guided" | "Elite"): Locator {
  return page.locator("section.rounded-card", { has: page.locator("span.font-display", { hasText: new RegExp(`^${levelLabel} - enrolled`) }) }).first();
}

export type Counts = { totalActive: number; solo: number; guided: number; elite: number; completed: number; dropped: number; allTime: number };
export async function readCounts(page: Page): Promise<Counts> {
  await page.goto("/students");
  const lv = (await metricText(page, "Active by level")).split("·").map((x) => Number(x.trim()));
  return {
    totalActive: await metricNumber(page, "Total active students"),
    solo: lv[0], guided: lv[1], elite: lv[2],
    completed: await metricNumber(page, "Completed this month"),
    dropped: await metricNumber(page, "Dropped this month"),
    allTime: await metricNumber(page, "Enrolled all time"),
  };
}

/** Local only: students created by someone else (not this RUN) since `sinceIso` - to explain concurrent deltas. */
export async function foreignStudentsSince(sinceIso: string, run: string): Promise<number> {
  if (!HAS_DB) return 0;
  const r = await one(`select count(*)::int n from student where "createdAt" >= $1 and "fullName" not like $2`, [sinceIso, `${run}%`]);
  return r.n;
}
export { q };
