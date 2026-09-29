import { test, expect, Page } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { watchErrors } from "../../helpers/app";
import { stableRun } from "../../helpers/people-data";
import { assertFenced, FENCE, HAS_DB, IS_PROD, recordCreated } from "../../helpers/target";
import { one } from "../../helpers/db";
import { chooseOption, dmy, openTab, setDate } from "../../helpers/people-ui";

/**
 * PRD2 §3.1 Team member profiles + org chart.
 * Creates one TeamProfile (no login linked - the email is the fenced support address).
 * TeamProfiles cannot be deleted in the app; cleanup offboards it (moves to "Former team members").
 */
test.use({ storageState: authFile("admin") });
const RUN = stableRun("profiles");
const tag = (s: string) => `${RUN} ${s}`;

const NAME = tag("Profile Coach");
const EDITED = tag("Profile Coach Edited");

async function openOrgChart(page: Page) {
  await page.goto("/people");
  await openTab(page, /Team & org chart/);
  await expect(page.getByRole("heading", { name: "Org chart" })).toBeVisible();
}
const card = (page: Page, name: string) =>
  page.locator("div.w-64", { has: page.locator("p.font-display", { hasText: new RegExp(`^${name}$`) }) });

test("admin creates a team profile with every PRD field", async ({ page }) => {
  const w = watchErrors(page);
  await openOrgChart(page);
  await page.getByRole("button", { name: "Add team member" }).click();
  const form = page.locator("form", { has: page.locator('input[name="roleTitle"]') });
  await form.locator('input[name="fullName"]').fill(NAME);
  await form.locator('input[name="roleTitle"]').fill("Program Delivery Coach");
  await chooseOption(page, form.locator('select[name="dashboardRole"]'), "User");
  await form.locator('input[name="email"]').fill(assertFenced(FENCE.primary.email));
  await form.locator('input[name="phone"]').fill(assertFenced(FENCE.primary.phone));
  await setDate(form.locator('input[name="dateJoined"]'), "2024-02-29");
  await chooseOption(page, form.locator('select[name="status"]'), "On leave");
  await chooseOption(page, form.locator('select[name="logVariant"]'), "Program Delivery Coach");
  await form.locator('textarea[name="keyResponsibilities"]').fill(`${RUN} runs coaching sessions and reviews assignments`);
  await form.getByRole("button", { name: "Create profile" }).click();

  const c = card(page, NAME);
  await expect(c).toBeVisible();
  await expect(c).toContainText("Program Delivery Coach");
  await expect(c).toContainText(FENCE.primary.email);
  // Date joined must not shift a day (leap day, IST browser).
  await expect(c).toContainText(`Joined ${dmy("2024-02-29")}`);
  await expect(c.getByText("On leave")).toBeVisible();
  await expect(c).toContainText("runs coaching sessions");

  if (HAS_DB) {
    const row = await one(
      `select id, "dateJoined"::text dj, status, phone, "dashboardRole", "logVariant", "userId" from team_profile where "fullName"=$1`, [NAME]);
    expect(row.dj).toBe("2024-02-29");
    expect(row.status).toBe("ON_LEAVE");
    expect(row.phone).toBe(FENCE.primary.phone);
    expect(row.logVariant).toBe("DELIVERY_COACH");
    recordCreated("people", { kind: "TeamProfile", id: row.id, label: NAME, cleanup: "People > Team & org chart > Offboard (profiles cannot be deleted; stays under Former team members)" });
  } else {
    recordCreated("people", { kind: "TeamProfile", label: NAME, cleanup: "People > Team & org chart > Offboard (profiles cannot be deleted; stays under Former team members)" });
  }
  w.assertClean();
});

test("admin edits the profile: name, status Inactive, date joined persists across timezones", async ({ page }) => {
  await openOrgChart(page);
  await card(page, NAME).getByRole("button", { name: "Edit" }).click();
  const form = page.locator("form", { has: page.locator('input[name="roleTitle"]') });
  await expect(form.locator('input[name="fullName"]')).toHaveValue(NAME);
  // the edit form must round-trip the stored date unchanged
  await expect(form.locator('input[name="dateJoined"]')).toHaveValue("2024-02-29");
  await form.locator('input[name="fullName"]').fill(EDITED);
  await chooseOption(page, form.locator('select[name="status"]'), "Inactive");
  await form.getByRole("button", { name: "Save profile" }).click();
  const c = card(page, EDITED);
  await expect(c).toBeVisible();
  await expect(c.getByText("Inactive")).toBeVisible();
  await expect(c).toContainText(`Joined ${dmy("2024-02-29")}`);
  recordCreated("people", { kind: "TeamProfile(rename)", label: EDITED, cleanup: "same profile as above, renamed" });

  // Back to Active so the org-chart order test sees a normal card.
  await c.getByRole("button", { name: "Edit" }).click();
  await chooseOption(page, form.locator('select[name="status"]'), "Active");
  await form.getByRole("button", { name: "Save profile" }).click();
  await expect(card(page, EDITED).getByText("Inactive")).toHaveCount(0);
});

test.describe("date joined under Europe/Berlin browser", () => {
  test.use({ timezoneId: "Europe/Berlin" });
  test("card and edit form show the same calendar date", async ({ page }) => {
    await openOrgChart(page);
    const c = card(page, EDITED);
    await expect(c).toContainText(`Joined ${dmy("2024-02-29")}`);
    await c.getByRole("button", { name: "Edit" }).click();
    const form = page.locator("form", { has: page.locator('input[name="roleTitle"]') });
    await expect(form.locator('input[name="dateJoined"]')).toHaveValue("2024-02-29");
  });
});

test("org chart: Admin on top, team below; Move left swaps the new card with its visible neighbour", async ({ page }) => {
  await openOrgChart(page);
  const rows = page.locator("section div.flex.flex-col.items-center > div.flex.flex-wrap");
  const topNames = await rows.nth(0).locator("p.font-display").allInnerTexts();
  const teamNames = await rows.nth(1).locator("p.font-display").allInnerTexts();
  expect(topNames.length, "an Admin card sits in the top row").toBeGreaterThan(0);
  // every top-row card is an Admin (Ameen); the new profile (role User) is in the team row
  expect(teamNames).toContain(EDITED);
  expect(topNames).not.toContain(EDITED);

  const idx = teamNames.indexOf(EDITED);
  test.skip(idx === 0, "new card is already first - nothing to swap with");
  const neighbour = teamNames[idx - 1];
  await card(page, EDITED).getByRole("button", { name: "Move left" }).click();
  await expect
    .poll(async () => (await rows.nth(1).locator("p.font-display").allInnerTexts()).indexOf(EDITED), {
      message: "after Move left the card should move one place left in the visible team row",
      timeout: 15_000,
    })
    .toBe(idx - 1);
  const after = await rows.nth(1).locator("p.font-display").allInnerTexts();
  expect(after[idx]).toBe(neighbour);

  // Move it back so the real team keeps its order.
  await card(page, EDITED).getByRole("button", { name: "Move right" }).click();
  await expect
    .poll(async () => (await rows.nth(1).locator("p.font-display").allInnerTexts()).indexOf(EDITED), { timeout: 15_000 })
    .toBe(idx);
});

test("PPL-03: Move left on the FIRST team card does nothing visible but still rewrites order (swaps with the hidden Admin)", async ({ page }) => {
  test.skip(IS_PROD, "mutates the real org-chart order; local only");
  test.skip(!HAS_DB, "needs the DB to see the hidden reorder");
  await openOrgChart(page);
  const rows = page.locator("section div.flex.flex-col.items-center > div.flex.flex-wrap");
  const teamNames = await rows.nth(1).locator("p.font-display").allInnerTexts();
  const first = teamNames[0];
  const before = await one(`select "fullName" from team_profile order by "orderIndex" asc, id asc limit 1`);
  await card(page, first).getByRole("button", { name: "Move left" }).click();
  await page.waitForTimeout(2500);
  const afterNames = await rows.nth(1).locator("p.font-display").allInnerTexts();
  const afterDb = await one(`select "fullName" from team_profile order by "orderIndex" asc, id asc limit 1`);
  // restore regardless of outcome
  await card(page, first).getByRole("button", { name: "Move right" }).click();
  await page.waitForTimeout(2500);
  expect(afterNames, "visible team row is unchanged").toEqual(teamNames);
  // Finding: the click is a silent no-op for the user yet swaps orderIndex with the Admin card.
  test.info().annotations.push({ type: "PPL-03", description: `db first before=${before.fullName} after=${afterDb.fullName}` });
  expect.soft(afterDb.fullName, "PPL-03: a no-op click should not rewrite stored order").toBe(before.fullName);
});
