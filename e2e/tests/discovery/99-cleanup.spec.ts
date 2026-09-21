/**
 * Discovery area cleanup. Runs last (99-).
 *
 *  1. UI (both targets): every discovery booking recorded in reports/created-<target>-discovery.jsonl
 *     that is still Booked is set to Cancelled from Bookings -> Booking requests (Admin).
 *  2. Local only: everything this area seeded (ids start "dsce2e") is closed out in the DB - bookings
 *     cancelled and detached, slots blocked, SSS slots freed + blocked, due SOP steps skipped, journeys
 *     CANCELLED, leads moved to LOST and archived - so no later run or other agent's cron acts on them.
 *
 * Nothing is hard-deleted: lead_stage_history is append-only and the audit trail should survive.
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { HAS_DB, IS_PROD } from "../../helpers/target";
import { bookingsRow, pickOption } from "../../helpers/discovery-ui";
import { dq, closeDiscoveryDb } from "../../helpers/discovery-db";

test.use({ storageState: authFile("admin") });
test.afterAll(async () => { if (HAS_DB) await closeDiscoveryDb(); });

const created = () => {
  const f = `reports/created-${IS_PROD ? "prod" : "local"}-discovery.jsonl`;
  if (!fs.existsSync(f)) return [] as any[];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

test("cancel still-booked discovery bookings through the Bookings UI", async ({ page }) => {
  test.setTimeout(600_000);
  const bookings = created().filter((e) => e.kind === "BookingRequest");
  let targets: { id?: string; label: string }[] = bookings;
  if (HAS_DB) {
    const ids = bookings.map((b) => b.id);
    const live = ids.length ? await dq<{ id: string; name: string }>(`select id, name from booking_request where id = any($1) and status = 'BOOKED'`, [ids]) : [];
    // A handful through the UI is enough to prove the path; the DB sweep below closes the rest.
    targets = live.slice(0, 3).map((r) => ({ id: r.id, label: r.name }));
  }
  await page.goto("/bookings");
  for (const t of targets) {
    const row = await bookingsRow(page, t.label).catch(() => null);
    if (!row) continue;
    const trigger = row.getByRole("button", { name: "Booking status" });
    if ((await trigger.innerText()).trim() !== "Booked") continue;
    await pickOption(page, trigger, "Cancelled");
    await page.waitForTimeout(1500);
    if (HAS_DB && t.id) {
      await expect.poll(async () => (await dq(`select status from booking_request where id = $1`, [t.id]))[0]?.status, { timeout: 20_000 }).toBe("CANCELLED");
    }
  }
});

test("local: close out every seeded discovery row", async () => {
  test.skip(!HAS_DB, "prod has no DB access; bookings were cancelled through the UI above");
  const P = "dsce2e%";
  await dq(`update booking_request set status = 'CANCELLED', "slotId" = null, "updatedAt" = now() at time zone 'utc' where id like $1 and status <> 'CANCELLED'`, [P]);
  await dq(`update appointment_slot set status = 'BLOCKED', "updatedAt" = now() at time zone 'utc' where id like $1`, [P]);
  await dq(`update sss_slot set status = 'BLOCKED', "journeyId" = null, "updatedAt" = now() at time zone 'utc' where id like $1 or "journeyId" like $1`, [P]);
  await dq(`update outreach_step_log set status = 'SKIPPED', "actedAt" = now() at time zone 'utc', note = 'e2e discovery cleanup', "updatedAt" = now() at time zone 'utc' where "journeyId" like $1 and status = 'DUE'`, [P]);
  await dq(`update outreach_journey set phase = 'CANCELLED', "cancelledAt" = coalesce("cancelledAt", now() at time zone 'utc'), "cancelReason" = 'e2e discovery cleanup', "updatedAt" = now() at time zone 'utc' where id like $1`, [P]);
  const open = await dq<{ id: string; stage: string }>(`select id, stage from lead where id like $1 and stage <> 'LOST'`, [P]);
  for (const l of open) {
    await dq(`insert into lead_stage_history (id, "leadId", "fromStage", "toStage", "changedAt") values ($1, $2, $3, 'LOST', now() at time zone 'utc')`, [`${l.id}cl`, l.id, l.stage]);
  }
  await dq(`update lead set stage = 'LOST', "deletedAt" = coalesce("deletedAt", now() at time zone 'utc'), "updatedAt" = now() at time zone 'utc' where id like $1`, [P]);

  const left = await dq(`select
      (select count(*)::int from booking_request where id like $1 and status = 'BOOKED') bookings,
      (select count(*)::int from outreach_step_log where "journeyId" like $1 and status = 'DUE') due_steps,
      (select count(*)::int from lead where id like $1 and "deletedAt" is null) live_leads`, [P]);
  expect(left[0]).toEqual({ bookings: 0, due_steps: 0, live_leads: 0 });
});
