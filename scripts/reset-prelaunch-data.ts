/**
 * Pre-launch data reset. DESTRUCTIVE - exports first, then deletes.
 *
 * The system is not live. Synamate's real book of business will be migrated at go-live, so
 * everything currently in these tables is test traffic from building the thing, and it must not
 * be walked down the SOP ladder - messaging a real number that was typed in during a test is the
 * exact failure this clears.
 *
 * KEEPS the Riyaz lead and its one live opportunity card, which is the fixture we test against.
 *
 * DOES NOT TOUCH, deliberately:
 *   · appointmentSlot   - Ameen's and Asma's published availability, not lead data. Clearing it
 *                         would empty the public booking calendar.
 *   · student / enrollment / agreement / payments - real customers and real money. None of them
 *                         is linked to a lead, so no cascade reaches them.
 *   · anything outside this database. Synamate, WATI and Pabbly are untouched by definition.
 *
 *   npx tsx scripts/reset-prelaunch-data.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const KEEP_LEAD_EMAIL = "riyaz.livechat@gmail.com";

async function main() {
  const keep = await prisma.lead.findFirst({ where: { email: KEEP_LEAD_EMAIL }, select: { id: true, name: true } });
  if (!keep) throw new Error(`Refusing to run: no lead with ${KEEP_LEAD_EMAIL} to keep`);
  console.log(`KEEPING lead ${keep.name} [${keep.id}] and its live opportunity\n`);

  const doomedLeads = await prisma.lead.findMany({ where: { id: { not: keep.id } }, select: { id: true, name: true } });
  const doomedOpps = await prisma.opportunity.findMany({
    where: { OR: [{ leadId: { not: keep.id } }, { leadId: keep.id, deletedAt: { not: null } }] },
    select: { id: true, name: true, deletedAt: true },
  });
  const doomedBookings = await prisma.bookingRequest.findMany({
    where: { OR: [{ leadId: null }, { leadId: { not: keep.id } }] },
    select: { id: true, name: true, slotId: true },
  });

  const waCount = await prisma.whatsAppMessage.count();
  const msgCount = await prisma.message.count();

  console.log(`leads to delete .......... ${doomedLeads.length}  ${doomedLeads.map((l) => l.name).join(", ")}`);
  console.log(`opportunities to delete .. ${doomedOpps.length}  (archived duplicates + other leads')`);
  console.log(`bookings to delete ....... ${doomedBookings.length}  (their slots are freed back to OPEN)`);
  console.log(`whatsapp messages ........ ${waCount}  (all)`);
  console.log(`email message log ........ ${msgCount}  (all)`);

  // The export is the whole safety net, so it is written BEFORE anything is deleted and the
  // script stops if it cannot be written.
  const dump = {
    exportedAt: new Date().toISOString(),
    keptLeadId: keep.id,
    leads: await prisma.lead.findMany({ where: { id: { in: doomedLeads.map((l) => l.id) } } }),
    opportunities: await prisma.opportunity.findMany({ where: { id: { in: doomedOpps.map((o) => o.id) } } }),
    bookings: await prisma.bookingRequest.findMany({ where: { id: { in: doomedBookings.map((b) => b.id) } } }),
    whatsAppMessages: await prisma.whatsAppMessage.findMany(),
    messages: await prisma.message.findMany(),
  };
  const path = `prelaunch-reset-backup-${dump.exportedAt.slice(0, 10)}.json`;
  writeFileSync(path, JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
  console.log(`\nExported everything above to ${path}`);

  if (!APPLY) return console.log("\nDry run - nothing deleted. Re-run with --apply.");

  await prisma.$transaction(async (tx) => {
    await tx.whatsAppMessage.deleteMany({});
    await tx.message.deleteMany({});
    // Free the slot before the booking that holds it disappears, or the calendar keeps showing a
    // slot as taken by a booking that no longer exists.
    const slotIds = doomedBookings.map((b) => b.slotId).filter((s): s is string => Boolean(s));
    if (slotIds.length) await tx.appointmentSlot.updateMany({ where: { id: { in: slotIds } }, data: { status: "OPEN" } });
    await tx.bookingRequest.deleteMany({ where: { id: { in: doomedBookings.map((b) => b.id) } } });
    await tx.opportunity.deleteMany({ where: { id: { in: doomedOpps.map((o) => o.id) } } });
    // Lead last - the cascade takes its journey, consent, stage history, notes and call logs.
    await tx.lead.deleteMany({ where: { id: { in: doomedLeads.map((l) => l.id) } } });
  });
  console.log("\nApplied.");
}

main().finally(() => prisma.$disconnect());
