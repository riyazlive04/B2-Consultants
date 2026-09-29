import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { authFile } from "../../helpers/roles";
import { FENCE, HAS_DB, IS_PROD, bookingsFor, leadsByPhone, purgePerson, setBookingStatusUi } from "../../helpers/outreach";
import { one, q } from "../../helpers/db";

/**
 * Outreach cleanup: removes what the outreach specs created.
 *   - FENCE.primary leads created by these specs (city "E2E-OUT ..." or the tagged manual lead): any BOOKED
 *     booking is cancelled through Bookings, then the lead is archived and permanently deleted via Pipeline.
 *   - OPEN, unbooked slots these specs generated (local).
 *   - This week's funnel snapshot: deleted if the run created it, restored if it existed (local).
 * Deliberately left in place (other agents rely on them): AppSetting outreachConfig / watiConfig test bindings.
 */
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });
test.describe.configure({ mode: "serial", timeout: 300_000 });

test("purge the outreach specs' fenced leads (only ours)", async ({ page }) => {
  if (HAS_DB) {
    const leads = await leadsByPhone(FENCE.primary.phone, true);
    const ours = leads.filter((l) => (l.city ?? "").startsWith("E2E-OUT") || /automated test/.test(l.notes ?? ""));
    const foreign = leads.filter((l) => !ours.includes(l));
    test.info().annotations.push({ type: "cleanup", description: `ours=${ours.length} foreign(left alone)=${foreign.length}` });
    if (foreign.length) {
      for (const l of ours) for (const b of await bookingsFor(l.id)) if (b.status === "BOOKED") await setBookingStatusUi(page, l.name, FENCE.primary.phone, "Cancelled");
      test.skip(true, "another agent holds a lead on this number - not purging by phone");
    }
  }
  await purgePerson(page, FENCE.primary.phone);
});

test("delete generated OPEN slots and restore the funnel snapshot (local)", async () => {
  test.skip(IS_PROD || !HAS_DB);
  const created = fs.existsSync("reports/created-local-outreach.jsonl")
    ? fs.readFileSync("reports/created-local-outreach.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const slotIds = created.filter((c) => c.kind === "AppointmentSlot" && c.id).map((c) => c.id);
  if (slotIds.length) {
    await q(`delete from appointment_slot s where s.id = any($1) and s.status='OPEN'
              and not exists (select 1 from booking_request b where b."slotId"=s.id)`, [slotIds]);
  }
  const f = "reports/outreach-funnel-state.json";
  if (fs.existsSync(f)) {
    const st = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!st.existed || /automated funnel snapshot/.test(st.existed.notes ?? "")) {
      await q(`delete from weekly_funnel_snapshot where "weekStart"=$1::date and notes like '%automated funnel snapshot%'`, [st.weekStart]);
    } else {
      const e = st.existed;
      await q(`update weekly_funnel_snapshot set "awarenessReach"=$2,"leadsCaptured"=$3,"callsCompleted"=$4,"proposalsSent"=$5,
                "enrollmentsSolo"=$6,"enrollmentsGuided"=$7,"enrollmentsElite"=$8,"ghostedDownloads"=$9,"workshopAttendees"=$10,notes=$11
               where "weekStart"=$1::date`,
        [st.weekStart, e.awarenessReach, e.leadsCaptured, e.callsCompleted, e.proposalsSent, e.enrollmentsSolo, e.enrollmentsGuided, e.enrollmentsElite, e.ghostedDownloads, e.workshopAttendees, e.notes]);
    }
    fs.unlinkSync(f);
  }
  expect(await one(`select 1 from weekly_funnel_snapshot where notes like '%automated funnel snapshot%'`)).toBeUndefined();
});
