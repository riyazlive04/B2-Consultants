/**
 * Rebuild the VSL funnel's two discovery pages from
 * https://optin.b2consultants.de/discowithasma and /discowithameen.
 *
 * Each page is heading + subheading + a `booking` block scoped to that person's calendar, so
 * "Personalized Discovery Call with Asma" offers Asma's slots and Ameen's offers Ameen's.
 * Ameen's page also carries the "No available slots? No worries!" fallback band above the
 * calendar, exactly as the source does.
 *
 * Idempotent. Run:  npx tsx scripts/build-disco-pages.ts --force
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

if (!process.argv.includes("--force")) {
  console.error("Refusing to run without --force (this writes to whatever DATABASE_URL points at).");
  process.exit(1);
}

const B2_LOGO =
  "https://images.leadconnectorhq.com/image/f_webp/q_80/r_1200/u_https://assets.cdn.filesafe.space/40rq2210I0idDREaOysb/media/671ffbe25c826a6bdee47955.png";

const DESCRIPTION =
  "Please answer the short questionnaire so we have the details needed to help you on our call (takes 2-3 minutes).";

/** Shared chrome for both pages; only the trailing clause of the subheading differs. */
function head(id: string, tail: string) {
  return {
    id: `${id}-hero`,
    type: "section",
    background: "plain",
    style: { padding: [40, 0, 8, 0], maxWidth: 1080 },
    styleMobile: { padding: [24, 0, 4, 0] },
    children: [
      {
        id: `${id}-h1`,
        type: "heading",
        text: "Apply To Work With B² Consultants",
        style: { align: "center", color: "ink", fontSize: 40, fontWeight: 800, lineHeight: 1.2 },
        styleMobile: { fontSize: 26 },
      },
      {
        id: `${id}-sub`,
        type: "text",
        text:
          "Please Select Your Preferred Date & Complete The Application To Reserve Your\n" +
          `Free 20 Min Personalized Discovery Call ${tail} Right Now!`,
        style: { align: "center", color: "ink", fontSize: 19, fontWeight: 700, lineHeight: 1.5 },
        styleMobile: { fontSize: 16 },
      },
    ],
  };
}

/** The calendar band. `bookingOwnerId` is what makes this person's page show this person's times. */
function calendar(id: string, name: string, ownerId: string) {
  return {
    id: `${id}-cal-sec`,
    type: "section",
    background: "plain",
    style: { padding: [24, 0, 64, 0], maxWidth: 1120 },
    styleMobile: { padding: [16, 0, 40, 0] },
    children: [
      {
        id: `${id}-cal`,
        type: "booking",
        bookingOwnerId: ownerId,
        bookingEyebrow: "DISCO",
        label: `Personalized Discovery Call with ${name}`,
        text: DESCRIPTION,
        url: B2_LOGO,
      },
    ],
  };
}

/**
 * Ameen's overflow band. It sits ABOVE the calendar on the source page — the point is to catch
 * someone before they conclude there is nothing available, so putting it underneath would be
 * showing the escape hatch only to people who already scrolled past the problem.
 */
function noSlotsBand(id: string) {
  return {
    id: `${id}-overflow`,
    type: "section",
    background: "plain",
    style: { padding: [8, 0, 8, 0], maxWidth: 1080 },
    children: [
      {
        id: `${id}-overflow-h`,
        type: "text",
        text: "No available slots? No worries!",
        style: { align: "center", color: "#dc2626", fontSize: 21, fontWeight: 700 },
      },
      {
        id: `${id}-overflow-sub`,
        type: "text",
        text: "Click below to book a call with our team at your convenience.",
        style: { align: "center", color: "ink", fontSize: 16 },
      },
      {
        id: `${id}-overflow-cta`,
        type: "button",
        label: "Book a call with Team B2",
        href: "/book",
        variant: "primary",
        style: { align: "center" },
      },
      { id: `${id}-overflow-rule`, type: "divider" },
    ],
  };
}

async function main() {
  // Match on email — a display name is editable and two people can share one.
  const people = await prisma.user.findMany({
    where: { email: { in: ["asma@b2consultants.in", "ameen@b2consultants.in"] } },
    select: { id: true, name: true, email: true },
  });
  const idOf = (email: string) => people.find((p) => p.email === email)?.id;
  const asmaId = idOf("asma@b2consultants.in");
  const ameenId = idOf("ameen@b2consultants.in");
  if (!asmaId || !ameenId) {
    console.error(
      `Missing user: asma=${asmaId ?? "NOT FOUND"} ameen=${ameenId ?? "NOT FOUND"}. ` +
        `Refusing to author a calendar with no owner — it would silently show everyone's slots.`,
    );
    process.exit(1);
  }

  const pages: { slug: string; blocks: unknown[] }[] = [
    {
      slug: "disco-with-asma",
      blocks: [head("asma", "with us"), calendar("asma", "Asma", asmaId)],
    },
    {
      slug: "disco-with-ameen",
      blocks: [head("ameen", "with Ameen"), noSlotsBand("ameen"), calendar("ameen", "Ameen", ameenId)],
    },
  ];

  for (const p of pages) {
    const step = await prisma.funnelStep.findFirst({
      where: { slug: p.slug, funnel: { slug: "vsl-funnel" } },
      select: { id: true },
    });
    if (!step) {
      console.error(`  ! no step "${p.slug}" — skipped`);
      continue;
    }
    await prisma.funnelStep.update({ where: { id: step.id }, data: { blocks: p.blocks as never } });
    console.log(`Rebuilt ${p.slug} [${step.id}]`);
  }

  // Availability is the thing most likely to make these pages look broken, so report it here
  // rather than letting an empty calendar be discovered in the browser.
  for (const [name, id] of [["Asma", asmaId], ["Ameen", ameenId]] as const) {
    const open = await prisma.appointmentSlot.count({
      where: { status: "OPEN", assignedToId: id, startsAt: { gt: new Date() } },
    });
    console.log(`  ${name}: ${open} open future slot(s) assigned`);
  }
  const unassigned = await prisma.appointmentSlot.count({
    where: { status: "OPEN", assignedToId: null, startsAt: { gt: new Date() } },
  });
  console.log(`  unassigned open slots (invisible to both pages): ${unassigned}`);
}

main().finally(() => prisma.$disconnect());
