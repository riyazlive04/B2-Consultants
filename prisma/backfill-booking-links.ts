/**
 * Link BookingRequest rows that never got a `leadId`, and derive the Qualified verdict they
 * should have carried.
 *
 * WHY: a prospect who booked directly on the public form used to stay unlinked from their lead.
 * The ONLY thing that joined the two was the outreach engine's Step 10 cross-check, and that
 * engine ships off - so a booked prospect's BANT score never reached the Qualified verdict
 * (Step 11) or Key Metrics (Step 12). `submitBooking` now links synchronously, but rows created
 * before that fix are still orphaned, and this is how they get repaired.
 *
 * TWO THINGS IT WILL NOT DO, both deliberate:
 *
 *  1. **It never creates a Lead.** An orphaned booking with no matching lead means the person's
 *     record is genuinely absent; inventing one to satisfy a foreign key would put a fabricated
 *     human into the CRM and into every funnel count downstream. Those rows are reported for a
 *     person to look at, and left alone.
 *  2. **It never overwrites an existing link or a human's verdict.** Same guards as the live
 *     path: link only where `leadId`/`bookingId` is null, and set Qualified only where a human
 *     has not already recorded one.
 *
 * Matching uses `normalizeWhatsappNumber` - the same rule `upsertIntakeLead` dedupes on - so a
 * booking and a lead written as "+91 98765 43210" and "919876543210" are recognised as one
 * person. Email is a fallback, never a primary: two family members share an inbox more often
 * than they share a mobile.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx tsx prisma/backfill-booking-links.ts            # report only
 *   npx tsx prisma/backfill-booking-links.ts --apply    # link them
 */

import { PrismaClient } from "@prisma/client";
import { normalizeWhatsappNumber } from "../src/lib/phone";
import { qualifiedFromBant } from "../src/lib/outreach-sop";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/**
 * Rows seeded by `prisma/demo-data.ts` - recognisable by their @example.com addresses.
 *
 * They matter because as of 29 Jul 2026 they are the ONLY orphaned bookings in production: all
 * three carry a null `bantAvg`, no matching lead exists for any of them, and two share a
 * creation timestamp to the millisecond. Linking them would mean inventing three people. They
 * are called out separately so "3 orphans" is never mistaken for three lost prospects.
 */
const isDemoRow = (email: string | null) => !!email && /@example\.(com|org|net)$/i.test(email);

type Report = { id: string; name: string; what: string };

async function main() {
  const orphans = await prisma.bookingRequest.findMany({
    where: { leadId: null },
    select: {
      id: true, name: true, email: true, phone: true, whatsapp: true,
      status: true, bantAvg: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n${orphans.length} booking request(s) with no leadId.\n`);
  if (!orphans.length) return;

  const linked: Report[] = [];
  const demo: Report[] = [];
  const unmatched: Report[] = [];

  for (const b of orphans) {
    if (isDemoRow(b.email)) {
      demo.push({ id: b.id, name: b.name, what: `demo fixture (${b.email}) - not a real prospect` });
      continue;
    }

    const lead = await findLead(b.phone, b.whatsapp, b.email);
    if (!lead) {
      unmatched.push({
        id: b.id,
        name: b.name,
        what: `no lead matches ${b.phone ?? "-"} / ${b.email ?? "-"} - needs a human`,
      });
      continue;
    }

    // The verdict this booking should have produced at intake, from the same pure function the
    // engine and the live booking path both use.
    const verdict = b.bantAvg === null ? null : qualifiedFromBant(b.bantAvg);
    const note = verdict ? `link → ${lead.id}, qualified ${verdict} (BANT ${b.bantAvg})` : `link → ${lead.id} (no BANT recorded)`;
    linked.push({ id: b.id, name: b.name, what: note });

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: a concurrent booking submit may have linked it since.
      const fresh = await tx.bookingRequest.findUnique({ where: { id: b.id }, select: { leadId: true } });
      if (fresh?.leadId) return;
      await tx.bookingRequest.update({ where: { id: b.id }, data: { leadId: lead.id } });

      const journey = await tx.outreachJourney.findUnique({
        where: { leadId: lead.id },
        select: { id: true, bookingId: true, qualified: true },
      });
      if (!journey || journey.bookingId !== null) return;
      await tx.outreachJourney.update({
        where: { id: journey.id },
        data: {
          bookingId: b.id,
          ...(journey.qualified === null && verdict
            ? { qualified: verdict, qualifiedAt: new Date(), bantScoreAtQual: b.bantAvg }
            : {}),
        },
      });
    });
  }

  const show = (title: string, rows: Report[]) => {
    if (!rows.length) return;
    console.log(`${title} (${rows.length})`);
    for (const r of rows) console.log(`  · ${r.name} - ${r.what}`);
    console.log("");
  };

  show(APPLY ? "LINKED" : "WOULD LINK", linked);
  show("SKIPPED - demo data", demo);
  show("SKIPPED - no matching lead", unmatched);

  if (!APPLY && linked.length) console.log("Dry run. Re-run with --apply to write.\n");
  if (demo.length) {
    console.log(
      `${demo.length} of these are seeded demo rows sitting in this database. They are not\n` +
        `prospects, and they are counted by every booking metric on the dashboard. Deleting them\n` +
        `is a separate, destructive call - this script will not do it.\n`,
    );
  }
}

/** Phone first (normalised, then raw), email only as a fallback. */
async function findLead(phone: string | null, whatsapp: string | null, email: string | null) {
  const select = { id: true, name: true } as const;

  for (const raw of [phone, whatsapp]) {
    if (!raw) continue;
    const normalized = normalizeWhatsappNumber(raw);
    if (normalized) {
      // The stored `phone` is free-form, so compare on the last 10 digits - the same trick
      // `findLeadByNormalizedPhone` uses to survive "+91 " prefixes and leading zeros.
      const tail = normalized.slice(-10);
      const hit = await prisma.lead.findFirst({ where: { phone: { contains: tail } }, select });
      if (hit) return hit;
    }
    const exact = await prisma.lead.findFirst({ where: { phone: raw }, select });
    if (exact) return exact;
  }

  if (email) {
    const byEmail = await prisma.lead.findMany({ where: { email }, select, take: 2 });
    // Exactly one match, or it is not evidence of identity.
    if (byEmail.length === 1) return byEmail[0];
  }
  return null;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
