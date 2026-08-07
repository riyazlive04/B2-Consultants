/**
 * One-off production repair for the "deleted from the board, still on the desk" bug.
 *
 * Until `deleteOpportunity` archived the lead alongside the card, deleting a card on the
 * Opportunities board archived the `Opportunity` row and nothing else. The `Lead` stayed active
 * and stayed assigned, so it kept appearing on its owner's My Desk queue and in the Pipeline
 * list — the person had been "deleted" everywhere except the two screens that matter.
 *
 * This archives the leads already stranded that way. The signature is exact:
 *
 *   • the lead is ACTIVE (`deletedAt: null`), and
 *   • it has at least one ARCHIVED opportunity — so somebody did delete its card, and
 *   • it has NO live opportunity on any pipeline — so it is off every board, not merely
 *     cleared from one custom process.
 *
 * A lead that never had a card is untouched: it was never deleted from anywhere, and the
 * absence of a card is not a deletion. That is the whole reason for the middle condition.
 *
 * Each lead is stamped with the `deletedAt` of its own most recent archived card, not with
 * "now" — that is the instant the person was actually deleted, it is what the retention sweep
 * should age from, and matching instants is what lets `restoreOpportunity` put the pair back
 * together from the Archived tab.
 *
 * Idempotent — a second run finds nothing to do.
 *
 * Dry run:  npx tsx scripts/archive-leads-stranded-by-board-delete.ts
 * Apply:    npx tsx scripts/archive-leads-stranded-by-board-delete.ts --force
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--force");

async function main() {
  const stranded = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      opportunities: {
        some: { deletedAt: { not: null } }, // a card WAS deleted
        none: { deletedAt: null }, // and none is left live, on any pipeline
      },
    },
    select: {
      id: true,
      name: true,
      stage: true,
      assignedTo: { select: { name: true } },
      opportunities: {
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 1,
        select: { id: true, deletedAt: true, deletedById: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!stranded.length) {
    console.log("Nothing stranded — no active lead is off every board.");
    return;
  }

  console.log(`${stranded.length} active lead(s) whose every board card is deleted:\n`);
  for (const l of stranded) {
    const card = l.opportunities[0];
    console.log(
      `  ${l.name.padEnd(28)} ${l.stage.padEnd(20)} owner=${(l.assignedTo?.name ?? "—").padEnd(12)}` +
        ` deleted ${card?.deletedAt?.toISOString() ?? "?"}`,
    );
  }

  if (!APPLY) {
    console.log(`\nDry run. Re-run with --force to archive these ${stranded.length} lead(s).`);
    return;
  }

  let done = 0;
  for (const l of stranded) {
    const card = l.opportunities[0];
    if (!card?.deletedAt) continue;
    await prisma.lead.update({
      where: { id: l.id },
      data: { deletedAt: card.deletedAt, deletedById: card.deletedById },
    });
    done++;
  }
  console.log(`\nArchived ${done} lead(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
