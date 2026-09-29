import { test, expect } from "@playwright/test";
import { authFile } from "../../helpers/roles";
import {
  BANT_HIGH, FENCE, HAS_DB, IS_PROD, bookViaPublicPage, bookingsFor, ensureLocalOutreachConfig, eventually,
  hoursUntilDisco, journeyFor, liveLead, makeSlot, optInViaPabbly, pabblyKey, purgePerson, record, tick,
  timeTravel, waMessages,
} from "../../helpers/outreach";
import { one, q } from "../../helpers/db";

/**
 * Two fixes from the "Asma" production case (22/09/2026):
 *
 *  1. One live booking per person. Her number held two live bookings, so she got two booking
 *     confirmations. A second /book submission from someone who already has a live call is now
 *     refused, which sends nothing.
 *  2. The no-show sweep no longer writes off someone who was never told the time. Her call was
 *     moved, the "rescheduled" WhatsApp failed, and two hours after the new slot the sweep marked her
 *     NO_SHOW and the lead LOST. Now an undelivered notice leaves the booking BOOKED and raises a red
 *     flag plus a task for a person instead.
 *
 * Locally every send FAILS by design (OUTBOUND_ALLOWLIST + dummy WATI), so a booking made here has
 * never had a delivered notice - exactly the "never told" case.
 */
test.describe.configure({ mode: "serial", timeout: 360_000 });
test.use({ storageState: authFile("admin"), navigationTimeout: 120_000, actionTimeout: 30_000 });

const P = FENCE.primary;
let leadId = "";
let journeyId = "";

const anon = (browser: any) =>
  browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.77.10.${Math.floor(Math.random() * 200) + 1}` } });

test.beforeAll(async () => {
  test.skip(IS_PROD || !HAS_DB || !pabblyKey(), "local driver only - books real slots and time-travels the journey");
  await ensureLocalOutreachConfig();
});

test("a second booking from the same person is refused, and sends nothing", async ({ browser, request }) => {
  const admin = await browser.newContext({ storageState: authFile("admin") });
  const adminPage = await admin.newPage();
  await purgePerson(adminPage, P.phone);
  await optInViaPabbly(request, { name: P.name, phone: P.phone, email: P.email });
  leadId = (await eventually(() => liveLead(P.phone), "lead")).id;
  record("Lead", "10 one booking", leadId);
  journeyId = (await journeyFor(leadId)).id;
  const first = await makeSlot(adminPage, 3);
  const second = await makeSlot(adminPage, 4);
  await admin.close();

  const c1 = await anon(browser);
  const p1 = await c1.newPage();
  await bookViaPublicPage(p1, { name: P.name, phone: P.phone, email: P.email }, first.dayLabel, first.timeLabel, BANT_HIGH);
  await expect(p1.getByText("You're booked in").first()).toBeVisible();
  await c1.close();
  await eventually(async () => (await bookingsFor(leadId)).find((b) => b.status === "BOOKED"), "first booking");
  const confirmsBefore = (await waMessages(leadId)).filter((m) => m.kind === "BOOKING_CONFIRMATION").length;

  // Same person, a different slot, from a different browser (as a second form fill would be).
  const c2 = await anon(browser);
  const p2 = await c2.newPage();
  await bookViaPublicPage(p2, { name: P.name, phone: P.phone, email: P.email }, second.dayLabel, second.timeLabel, BANT_HIGH);
  await expect(p2.getByText("You already have a Discovery Call booked with us").first()).toBeVisible();
  await expect(p2.getByText("You're booked in")).toHaveCount(0);
  await c2.close();

  const live = (await bookingsFor(leadId)).filter((b) => b.status === "BOOKED");
  expect(live, "still exactly one live booking").toHaveLength(1);
  const secondSlot = await one<{ status: string }>(
    `select status::text from appointment_slot where "startsAt"=$1`,
    [second.startsAt.toISOString().replace("T", " ").replace("Z", "")],
  );
  expect(secondSlot?.status, "the refused slot stays open for someone else").toBe("OPEN");
  const confirmsAfter = (await waMessages(leadId)).filter((m) => m.kind === "BOOKING_CONFIRMATION").length;
  expect(confirmsAfter, "no second booking confirmation").toBe(confirmsBefore);
});

test("the no-show sweep does not write off a prospect who was never told the time", async ({ request }) => {
  const b = (await bookingsFor(leadId)).find((x) => x.status === "BOOKED");
  expect(b, "the live booking from the previous test").toBeTruthy();
  const delivered = await q(
    `select 1 from whatsapp_message where "bookingRequestId"=$1 and status in ('SENT','DELIVERED','READ','REPLIED')`,
    [b!.id],
  );
  expect(delivered, "precondition: nothing about this call was ever delivered (local sends fail by design)").toHaveLength(0);

  // Two hours and five minutes after the call - the moment the sweep used to write it off.
  await timeTravel(journeyId, (await hoursUntilDisco(journeyId)) + 2 + 5 / 60);
  await tick(request);
  await tick(request);

  const after = (await bookingsFor(leadId)).find((x) => x.id === b!.id)!;
  expect(after.status, "booking left for a person, not auto-marked NO_SHOW").toBe("BOOKED");
  expect((await liveLead(P.phone)).stage, "lead not written off").not.toBe("LOST");
  const j = await journeyFor(leadId);
  expect(j.redFlag, "journey flagged red so the queue and Key Metrics show it").toBe(true);
  expect(j.redFlagReason).toMatch(/may not have been told/);
  const tasks = await q<{ status: string }>(
    `select status::text from contact_task where "leadId"=$1 and title like 'Discovery call time passed%'`,
    [leadId],
  );
  expect(tasks, "one open task for a person to follow up").toHaveLength(1);
  expect(tasks[0].status).toBe("OPEN");

  // Another tick must not stack a second task or flip it to NO_SHOW.
  await tick(request);
  const again = await q(`select 1 from contact_task where "leadId"=$1 and title like 'Discovery call time passed%'`, [leadId]);
  expect(again, "raised once per slot").toHaveLength(1);
  expect((await bookingsFor(leadId)).find((x) => x.id === b!.id)!.status).toBe("BOOKED");
});

test.afterAll(async ({ browser }) => {
  if (IS_PROD || !HAS_DB) return;
  const admin = await browser.newContext({ storageState: authFile("admin") });
  await purgePerson(await admin.newPage(), P.phone);
  await admin.close();
});
