/**
 * Remove the seeded demo bookings — and the slot batch they came in with — from a live database.
 *
 * WHY: `prisma/demo-data.ts` was run against production at some point. On 29 Jul 2026 the result
 * was that **every** `BookingRequest` (3) and **every** `AppointmentSlot` (15) in production was
 * fixture data: `@example.com` addresses, phone numbers ending 44201/2/3, and a single shared
 * creation timestamp of 2026-07-09T10:46. Every booking metric on the dashboard was counting them,
 * and the "3 orphaned bookings needing a backfill" in the audit were these.
 *
 * WHY THE SLOTS TOO. Two of the three bookings hold their slot in `BOOKED`. Deleting a booking
 * alone leaves its slot claimed by nothing — an orphan that can never be booked and never frees
 * itself. The batch is one seed run, all of it now in the past, so it goes as a unit.
 *
 * SCOPE, deliberately narrow. It touches ONLY `BookingRequest` and `AppointmentSlot`, and only
 * rows it can positively identify as fixtures. It does not touch demo Leads or demo Students —
 * students carry enrolments and money, and removing them would move financial figures, which is a
 * separate decision that deserves its own look. Those are reported at the end, not deleted.
 *
 * DRY RUN BY DEFAULT.
 *
 *   npx tsx prisma/purge-demo-bookings.ts            # show what would go
 *   npx tsx prisma/purge-demo-bookings.ts --apply    # delete it
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** The seed run's fingerprint: fixture email domains, and the batch's shared creation minute. */
const DEMO_EMAIL = { endsWith: "@example.com" } as const;

function announceTarget(): void {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/:]+)/)?.[1] ?? "unknown";
  console.log(`\nDatabase: ${host}${/localhost|127\.0\.0\.1/.test(host) ? "   (local)" : "   ← LIVE"}`);
}

async function main() {
  announceTarget();

  const bookings = await prisma.bookingRequest.findMany({
    where: { email: DEMO_EMAIL },
    select: { id: true, name: true, email: true, status: true, slotId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (!bookings.length) {
    console.log("\nNo demo bookings found. Nothing to do.\n");
    return;
  }

  /**
   * Slots from the same seed batch, identified by sharing a creation MINUTE with a demo booking.
   * Anything created outside that window is somebody's real calendar and is left strictly alone —
   * this is why the batch window is derived from the data rather than hardcoded to a date.
   */
  const batchStart = new Date(Math.min(...bookings.map((b) => b.createdAt.getTime())));
  const batchEnd = new Date(Math.max(...bookings.map((b) => b.createdAt.getTime())) + 60_000);
  const slots = await prisma.appointmentSlot.findMany({
    where: { createdAt: { gte: new Date(batchStart.getTime() - 60_000), lte: batchEnd } },
    select: { id: true, startsAt: true, status: true },
    orderBy: { startsAt: "asc" },
  });

  const now = new Date();
  const future = slots.filter((s) => s.startsAt > now);
  const total = await prisma.appointmentSlot.count();

  console.log(`\nBOOKINGS TO DELETE (${bookings.length})`);
  for (const b of bookings) console.log(`  · ${b.name} — ${b.email} — ${b.status}${b.slotId ? " — holds a slot" : ""}`);

  console.log(`\nSLOTS FROM THE SAME SEED BATCH (${slots.length} of ${total} in the database)`);
  console.log(`  created between ${batchStart.toISOString()} and ${batchEnd.toISOString()}`);
  console.log(`  earliest ${slots[0]?.startsAt.toISOString().slice(0, 16)} · latest ${slots.at(-1)?.startsAt.toISOString().slice(0, 16)}`);
  console.log(`  ${future.length} of them are in the future`);

  if (future.length) {
    console.log(`\n  !! ${future.length} slot(s) are in the FUTURE — a prospect could be holding one.`);
    console.log(`     Refusing to delete the batch. Check these by hand first.`);
    return;
  }

  // Anything pointing at these rows must be gone (or nulled) before they can go.
  const [waMsgs, journeys] = await Promise.all([
    prisma.whatsAppMessage.count({ where: { bookingRequestId: { in: bookings.map((b) => b.id) } } }),
    prisma.outreachJourney.count({ where: { bookingId: { in: bookings.map((b) => b.id) } } }),
  ]);
  console.log(`\nREFERENCES  whatsapp messages: ${waMsgs} · outreach journeys: ${journeys}`);
  if (waMsgs || journeys) {
    console.log("  Both are onDelete: SetNull, so they survive as history with the link cleared.");
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing deleted. Re-run with --apply.\n`);
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Bookings first: `BookingRequest.slotId` is SetNull, so deleting a slot out from under a
    // live booking would silently detach it rather than fail. Order makes that impossible.
    const b = await tx.bookingRequest.deleteMany({ where: { id: { in: bookings.map((x) => x.id) } } });
    const s = await tx.appointmentSlot.deleteMany({ where: { id: { in: slots.map((x) => x.id) } } });
    return { bookings: b.count, slots: s.count };
  });

  console.log(`\nDeleted ${result.bookings} booking(s) and ${result.slots} slot(s).`);
  console.log(`Remaining: ${await prisma.bookingRequest.count()} bookings · ${await prisma.appointmentSlot.count()} slots.`);

  const [demoLeads, demoStudents] = await Promise.all([
    prisma.lead.count({ where: { email: DEMO_EMAIL } }),
    prisma.student.count({ where: { email: DEMO_EMAIL } }),
  ]);
  console.log(
    `\nSTILL PRESENT, not touched by this script: ${demoLeads} demo lead(s) and ${demoStudents} demo student(s).\n` +
      `Students carry enrolments and payments, so removing them would move financial figures —\n` +
      `that needs its own look rather than riding along with a booking cleanup.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
