/**
 * One-off, idempotent: give Asma's discovery bookings their own confirmation page.
 *
 * Both `disco-with-asma` and `disco-with-ameen` redirected to the single `congrats` step, whose
 * copy and photo are Ameen's. So a prospect who booked Asma's calendar was told their call with
 * AMEEN was confirmed - the booking itself was correct (verified: the block's bookingOwner is
 * Asma, and the slot was hers), only the page lied.
 *
 * This clones `congrats` to `congrats-asma`, swaps the name in the copy, drops Ameen's photo, and
 * repoints the Asma booking block. The photo is REMOVED rather than reused or guessed: we hold no
 * picture of Asma anywhere in the system, and leaving Ameen's face on her confirmation page is the
 * bug, not a smaller version of it. Add hers in the page builder.
 *
 *   npx tsx scripts/add-congrats-per-owner.ts [--apply]
 *
 * Without --apply it prints what it would do and writes nothing.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Node = { id?: string; type?: string; html?: string; children?: Node[]; bookingRedirectUrl?: string; [k: string]: unknown };

const ASMA_SLUG = "congrats-asma";

/** Drop the photo column, and rewrite the body copy from Ameen to Asma. */
function asmaVersion(nodes: Node[]): Node[] {
  return nodes
    .filter((n) => n.id !== "congrats-col-photo")
    .map((n) => ({
      ...n,
      ...(n.id ? { id: `${n.id}-asma` } : {}),
      ...(typeof n.html === "string" ? { html: n.html.replaceAll("Ameen", "Asma") } : {}),
      ...(n.children ? { children: asmaVersion(n.children) } : {}),
    }));
}

function repointBooking(nodes: Node[]): Node[] {
  return nodes.map((n) => ({
    ...n,
    ...(n.type === "booking" && n.id === "asma-cal"
      ? { bookingRedirectUrl: `/p/vsl-funnel/${ASMA_SLUG}` }
      : {}),
    ...(n.children ? { children: repointBooking(n.children) } : {}),
  }));
}

async function main() {
  const funnel = await prisma.funnel.findFirst({
    where: { slug: "vsl-funnel" },
    select: { id: true, steps: { select: { id: true, slug: true, name: true, position: true, blocks: true, seoTitle: true, seoDescription: true } } },
  });
  if (!funnel) throw new Error("No vsl-funnel");

  const congrats = funnel.steps.find((s) => s.slug === "congrats");
  const asmaStep = funnel.steps.find((s) => s.slug === "disco-with-asma");
  if (!congrats || !asmaStep) throw new Error("Expected congrats and disco-with-asma steps");

  const existing = funnel.steps.find((s) => s.slug === ASMA_SLUG);
  const blocks = asmaVersion(congrats.blocks as unknown as Node[]);

  if (existing) {
    console.log(`· ${ASMA_SLUG} already exists - refreshing its blocks`);
    if (APPLY) await prisma.funnelStep.update({ where: { id: existing.id }, data: { blocks: blocks as never } });
  } else {
    const position = Math.max(...funnel.steps.map((s) => s.position)) + 1;
    console.log(`+ create step ${ASMA_SLUG} at position ${position}`);
    if (APPLY) {
      await prisma.funnelStep.create({
        data: {
          funnelId: funnel.id,
          name: "Congrats (Asma)",
          slug: ASMA_SLUG,
          position,
          blocks: blocks as never,
          seoTitle: congrats.seoTitle,
          seoDescription: congrats.seoDescription,
        },
      });
    }
  }

  const repointed = repointBooking(asmaStep.blocks as unknown as Node[]);
  console.log(`~ repoint asma-cal redirect -> /p/vsl-funnel/${ASMA_SLUG}`);
  if (APPLY) await prisma.funnelStep.update({ where: { id: asmaStep.id }, data: { blocks: repointed as never } });

  console.log(APPLY ? "\nApplied." : "\nDry run - re-run with --apply to write.");
}

main().finally(() => prisma.$disconnect());
