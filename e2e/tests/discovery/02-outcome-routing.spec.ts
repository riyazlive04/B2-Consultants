/**
 * SOP: "Lead joined? Yes -> Conduct discovery call -> Qualified?" and PRD1 §5.3 outcome entry,
 * through the specialist's own routing panel on My Desk (server/discovery-routing.ts).
 *
 *   Qualified?  Yes -> "Book sales call before closing the discovery call"
 *               No  -> "Update key metrics and pipeline accordingly"
 *
 * Local only (the call must exist on today's calendar). Prod: the read-only check at the bottom
 * opens the panel on any real call without submitting it.
 */
import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import { HAS_DB } from "../../helpers/target";
import { watchErrors, RUN } from "../../helpers/app";
import { openDesk, deskCallRow, recordOutcomeOnDesk, submitRouteModal, pageAs, openSssCalendar, installPopupHandlers } from "../../helpers/discovery-ui";
import {
  seedDiscoveryCall, atMinutesFromNow, minutesLeftTodayIst, leadRow, bookingRow, slotRow, stageHistory, outcomes, journeyRow,
  closeDiscoveryDb, userId, ASMA,
} from "../../helpers/discovery-db";

test.use({ storageState: authFile("asma") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });

test.beforeEach(() => {
  test.skip(!HAS_DB, "local driver only - needs a call seeded on today's calendar");
  test.skip(minutesLeftTodayIst() < 60, "too close to IST midnight");
});

type Case = {
  outcome: "QUALIFIED_FOR_SSS" | "NOT_QUALIFIED_FOR_SSS" | "SENT_TO_WORKSHOP" | "FOLLOW_UP_NEEDED" | "NO_SHOW";
  stage: string;
  booking: string;
};
const CASES: Case[] = [
  { outcome: "QUALIFIED_FOR_SSS", stage: "SSS_BOOKED", booking: "COMPLETED" },
  { outcome: "NOT_QUALIFIED_FOR_SSS", stage: "LOST", booking: "COMPLETED" },
  { outcome: "SENT_TO_WORKSHOP", stage: "SENT_TO_WORKSHOP", booking: "COMPLETED" },
  { outcome: "FOLLOW_UP_NEEDED", stage: "DISCO_COMPLETED", booking: "COMPLETED" },
  { outcome: "NO_SHOW", stage: "NO_SHOW", booking: "NO_SHOW" },
];

for (const c of CASES) {
  test(`routing ${c.outcome}: stage, booking, outcome row and notes move together`, async ({ page }) => {
    const errs = watchErrors(page);
    const call = await seedDiscoveryCall({ label: `Route ${c.outcome}`, startsAt: atMinutesFromNow(-15), confirmed: true, leadStage: "DISCO_BOOKED" });
    const notes = `${RUN} notes to closer for ${c.outcome}`;

    await openDesk(page);
    await expect(deskCallRow(page, call.lead.name)).toBeVisible();
    // Qualified: agree the SSS on the call, as the SOP says ("book the sales call before closing").
    // 3 days out at 11:00 IST, so it is in the future on any run day and outside the 24h window.
    const sss = new Date(Date.now() + 3 * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10) + "T11:00";
    await recordOutcomeOnDesk(page, call.lead.name, c.outcome, { notes, ...(c.outcome === "QUALIFIED_FOR_SSS" ? { sssAt: sss } : {}) });
    await submitRouteModal(page);

    // The row stays on today's list but is closed: "Recorded", no second routing button.
    await page.reload();
    const row = deskCallRow(page, call.lead.name);
    await expect(row).toContainText("Recorded");
    await expect(row.getByRole("button", { name: "Record outcome" }), "a routed call cannot be routed twice").toHaveCount(0);

    const lead = await leadRow(call.lead.id);
    expect(lead.stage, `outcome ${c.outcome} moves the lead`).toBe(c.stage);
    const b = await bookingRow(call.bookingId);
    expect(b.status, "the appointment is settled").toBe(c.booking);
    const o = await outcomes(call.lead.id);
    expect(o).toHaveLength(1);
    expect(o[0].outcome).toBe(c.outcome);
    expect(o[0].notes).toBe(notes);
    expect(o[0].enteredById).toBe(await userId(ASMA));

    const hist = (await stageHistory(call.lead.id)).map((h) => h.toStage);
    expect(hist, "stage change is written to the append-only history").toContain(c.stage);

    if (c.outcome === "NO_SHOW") {
      // Counted in the no-show rate: the metric reads leads REACHING NO_SHOW in stage history.
      expect(hist).toContain("NO_SHOW");
      // stage-rules.ts advertises "A discovery call is recorded as a no-show -> Lead -> No show; the slot is released".
      const slot = await slotRow(call.slotId);
      expect.soft(slot.status, "DSC-10: routing a no-show from the desk does not release the slot (stage-rules.ts claims it does)").toBe("OPEN");
    } else {
      // PRD 5.4 "Calls completed this month" = leads reaching DISCO_COMPLETED; show-up and close rate divide by it.
      // A call that HAPPENED (qualified / not qualified / workshop / follow-up) must be counted as completed.
      expect.soft(hist, `DSC-12: a completed discovery call routed ${c.outcome} never passes DISCO_COMPLETED, so "Calls completed", show-up rate and close rate never count it`).toContain("DISCO_COMPLETED");
    }

    if (c.outcome === "QUALIFIED_FOR_SSS") {
      // SOP: "Book sales call before closing the discovery call". The panel has no SSS date/slot at all,
      // and the journey is never marked Highly Qualified, so the SSS ladder (Steps 19-22) never starts.
      const j = await journeyRow(call.journeyId!);
      expect.soft(o[0].sssDate, "DSC-02: a Qualified outcome was accepted with no SSS date/booking").not.toBeNull();
      expect.soft(j.highlyQualified, "DSC-01: routing Qualified does not mark the journey Highly Qualified").toBe(true);
      expect.soft(j.sssAt, "DSC-01/02: no SSS time recorded, so no SSS confirmation ladder").not.toBeNull();
      // The ladder is armed: the journey leaves AWAITING_DISCO for the SSS confirmation phase.
      expect.soft(j.phase, "DSC-01: the SSS confirmation ladder did not start").toBe("SSS_CONFIRMATION");
    }
    errs.assertClean();
  });
}

test("Qualified route: the panel offers no SSS booking, and the prospect never reaches the SSS calendar", async ({ page, browser }) => {
  const call = await seedDiscoveryCall({ label: "Route qualified SSS handoff", startsAt: atMinutesFromNow(-10), confirmed: true, leadStage: "DISCO_BOOKED" });
  await openDesk(page);
  const dlg = await recordOutcomeOnDesk(page, call.lead.name, "QUALIFIED_FOR_SSS", { notes: `${RUN} qualified handoff` });
  // The claim on the button...
  await expect(dlg).toContainText("A confirmation goes out automatically");
  // ...but nothing on the form asks when the SSS is.
  const sssInputs = dlg.locator("input[type=date], input[type=datetime-local], input[name*=sss i]");
  expect.soft(await sssInputs.count(), "DSC-02: routing panel has no SSS date/slot field - a Qualified call can be closed without booking the sales call").toBeGreaterThan(0);
  await submitRouteModal(page);

  // Admin (the SSS owner) looks for the prospect under "Needs an SSS time".
  const { ctx, page: admin } = await pageAs(browser, "admin");
  try {
    await openSssCalendar(admin);
    const needs = admin.locator("div.rounded-card").filter({ hasText: /Needs an SSS time/ });
    expect.soft(await needs.getByText(call.lead.name).count(), "DSC-01: a prospect routed Qualified never appears on the SSS calendar's 'Needs an SSS time' list").toBeGreaterThan(0);
  } finally {
    await ctx.close();
  }
  // Nothing in the app UI can set Highly Qualified + SSS time on the journey (setHighlyQualified is unused).
  await page.goto("/outreach");
  expect.soft(await page.getByText(/Highly Qualified/i).count(), "DSC-01: no Highly Qualified control on the Outreach screen").toBeGreaterThan(0);
});

test("Highly qualified tick: the desk panel accepts it from a USER without outreach.qualify, the PRD form refuses it", async ({ page }) => {
  const call = await seedDiscoveryCall({ label: "Route HQ capability", startsAt: atMinutesFromNow(-12), confirmed: true, leadStage: "DISCO_BOOKED" });
  await openDesk(page);
  await recordOutcomeOnDesk(page, call.lead.name, "FOLLOW_UP_NEEDED", { highlyQualified: true });
  await submitRouteModal(page);
  await expect.poll(async () => (await outcomes(call.lead.id)).length, { timeout: 15_000 }).toBe(1);
  const deskHq = (await outcomes(call.lead.id))[0].highlyQualified;
  expect(deskHq, "the desk stored the Highly Qualified tick").toBe(true);

  // Same user, same flag, the Pipeline -> Discovery call outcomes form (PRD 5.3).
  await installPopupHandlers(page);
  await page.goto("/pipeline");
  await page.getByRole("tab", { name: "Discovery call outcomes" }).click();
  const form = page.locator("form").filter({ has: page.getByText("SSS date (if booked)") });
  await form.getByRole("button", { name: /\(/ }).first().click();
  await page.getByRole("option", { name: new RegExp(call.lead.name) }).click();
  await form.locator("label").filter({ hasText: /^Highly qualified$/ }).click();
  await form.getByRole("button", { name: "Add outcome" }).click();
  await expect(form, "the PRD form refuses the flag for a USER without outreach.qualify").toContainText(/don't have permission to set highly qualified/i);
  expect((await outcomes(call.lead.id)).length).toBe(1);
  expect.soft(deskHq, "DSC-19: the Highly Qualified guard (outreach.qualify) is enforced on the PRD form but bypassed by the desk routing panel").toBe(false);
});
