import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { IS_PROD } from "../../helpers/outreach";
import { one } from "../../helpers/db";

/**
 * PRD3 §6: "Calls completed in Funnel - auto-pull from Pipeline. If Pipeline data is updated, Funnel numbers
 * update automatically." 07 saved this week's snapshot and recorded the pre-fill; 08 then moved a lead to
 * DISCO_COMPLETED ("call done") through the Pipeline. Local only.
 */
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });
const FILE = "reports/outreach-funnel-state.json";

test("OUT-22: a Pipeline 'call completed' after the week was saved flows into the Funnel's Discovery call number", async ({ page }) => {
  test.skip(IS_PROD || !fs.existsSync(FILE), "needs 07 + 08 from this run (local)");
  const st = JSON.parse(fs.readFileSync(FILE, "utf8"));
  test.skip(st.autoCallsBefore === undefined, "07 baseline missing");
  await page.goto("/funnel");
  const form = page.locator("form").filter({ hasText: "Weekly snapshot" });
  const autoNow = Number((await form.getByText(/auto: \d+/).nth(1).innerText()).match(/auto: (\d+)/)![1]);
  expect(autoNow, "the pre-fill (live pipeline pull) sees the new completed call").toBeGreaterThanOrEqual(st.autoCallsBefore + 1);
  const card = page.locator("div").filter({ has: page.getByRole("heading", { name: /^This month - / }) }).filter({ hasText: "5. Enrolled (paid)" }).last();
  const text = await card.innerText();
  const funnelCalls = Number(text.match(/3\. Discovery call\s*\n?\s*([\d,]+)/)![1].replace(/,/g, ""));
  test.info().annotations.push({ type: "evidence", description: `prefill before=${st.autoCallsBefore} now=${autoNow}; funnel month calls before=${st.monthCallsBefore} now=${funnelCalls}` });
  // OUT-22 - getFunnelOverview sums WeeklyFunnelSnapshot.callsCompleted (funnel-metrics.ts:127-137); the
  // pipeline is only read to PRE-FILL an unsaved form (getWeekAutoPulls). Once a week is saved, pipeline
  // changes never reach the funnel, contrary to PRD3 §6.
  test.fail(true, "OUT-22");
  expect(funnelCalls).toBeGreaterThanOrEqual(st.monthCallsBefore + 1);
  void one;
});
