import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun } from "../../helpers/people-data";
import { istNow, metricDetail } from "../../helpers/people-ui";
import { createStudentUI, deleteStudentUI, gotoStudentsList, studentRow } from "../../helpers/people-students";

/**
 * PRD3 §6 "Enrollments in Funnel: auto-pull from Student enrollment records" and §3.4 Ghosted Blueprint
 * lead-source tag. Creates one Guided student tagged Ghosted Blueprint (enrolled today) and deletes it
 * again at the end of the test. Never saves a weekly funnel snapshot (that would alter real funnel data).
 */
test.use({ storageState: authFile("admin") });
const RUN = stableRun("funnel");
const NAME = `${RUN} Funnel Guided GB`;
const TODAY = istNow().ymd;

async function readFunnel(page: Page) {
  await page.goto("/funnel");
  const hint = async (label: string) => {
    const field = page.locator("div.block", { has: page.locator("label", { hasText: label }) }).first();
    const t = await field.locator("p").first().innerText();
    return Number(t.replace(/^auto:\s*/, ""));
  };
  const enrolledBlock = page.locator("div.rounded-field", { hasText: "5. Enrolled (paid)" }).first();
  const enrolledFunnel = Number((await enrolledBlock.locator("span").last().innerText()).replace(/[^\d]/g, ""));
  const gbEnrol = await metricDetail(page, "→ Enrolment");
  const gbGuided = await metricDetail(page, "→ Guided specifically");
  return {
    autoGuided: await hint("Enrolments - Guided"),
    autoSolo: await hint("Enrolments - Solo"),
    enrolledFunnel,
    gbEnrolled: Number(gbEnrol["Enrolled (any level)"].replace(/[^\d]/g, "")),
    gbGuided: Number(gbGuided["Enrolled in Guided"].replace(/[^\d]/g, "")),
  };
}

test("Ghosted Blueprint is a lead-source option on student creation", async ({ page }) => {
  await gotoStudentsList(page);
  await page.getByRole("button", { name: "Add student" }).click();
  const dlg = page.getByRole("dialog", { name: /New student/ });
  await dlg.locator('select[name="leadSource"]').locator("xpath=following-sibling::button[1]").click();
  await expect(page.getByRole("option", { name: "Ghosted Blueprint", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a new Guided student tagged Ghosted Blueprint flows into the funnel", async ({ page }) => {
  test.setTimeout(300_000);
  const w = watchErrors(page);
  const before = await readFunnel(page);
  expect(await createStudentUI(page, { name: NAME, level: "GUIDED", enrollmentDate: TODAY, leadSource: "Ghosted Blueprint" })).toBeNull();
  let after;
  try {
    after = await readFunnel(page);
  } finally {
    await deleteStudentUI(page, NAME);
  }
  // Auto-pull pre-fill for this week and the Ghosted Blueprint tracker react immediately.
  expect(after.autoGuided - before.autoGuided, "weekly snapshot pre-fill 'auto: N' for Guided +1").toBe(1);
  expect(after.autoSolo - before.autoSolo).toBe(0);
  expect(after.gbEnrolled - before.gbEnrolled, "Ghosted Blueprint enrolled +1").toBe(1);
  expect(after.gbGuided - before.gbGuided, "Ghosted Blueprint -> Guided +1").toBe(1);
  // PRD3 §6: "New student added in Phase 2 = enrollment counted in Phase 3 funnel" (auto-pull).
  expect(after.enrolledFunnel - before.enrolledFunnel,
    "PPL-12: funnel 'Enrolled (paid)' this month did not move - it only counts saved weekly snapshots, so a new student is not counted until Admin re-saves the week").toBe(1);
  w.assertClean();
});
