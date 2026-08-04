/**
 * Backfill: put existing leads onto the default Opportunity board.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────────
 * Nothing ever created an opportunity from an inbound lead (see `ensureDefaultOpportunity`), so
 * on 4 Aug 2026 production held 23,545 leads and ONE card. Wiring the capture paths fixes new
 * leads; this puts the existing ones on the board.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────────
 * CLOSED STAGES ARE SKIPPED. `LOST` alone is 8,092 rows on live, and `WON`/`NO_SHOW` add more.
 * A board is a place to work deals, not an archive: filing 8,000 dead leads into a Lost column
 * would make the board slower, the column caps meaningless, and the "pipeline value" figure no
 * more accurate (closed cards are excluded from it anyway). Those leads keep their history and
 * are still fully readable on Contacts and Pipeline.
 *
 * Idempotent — `ensureDefaultOpportunity` no-ops on a lead that already has a card, so this is
 * safe to re-run, and safe to run while the app is live.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────────
 *   npm run backfill:opps -- --dry-run     # count only, writes nothing
 *   npm run backfill:opps -- --limit 500   # a cautious first slice
 *   npm run backfill:opps                  # all of them
 *
 * `--conditions=react-server` is REQUIRED (the npm script supplies it): this imports
 * `opportunity-sync`, which is marked `server-only`, and plain `tsx` refuses to load it.
 *
 * Reads DATABASE_URL from the environment — CHECK WHICH DATABASE THAT IS before running.
 */

import { PrismaClient, type LeadStage } from "@prisma/client";
import { ensureDefaultOpportunity } from "../src/server/opportunity-sync";

const prisma = new PrismaClient();

/**
 * The stages worth a card: a deal someone could still act on today.
 *
 * Mirrors the board's own idea of "in play". WON is excluded alongside LOST/NO_SHOW — a won deal
 * belongs to Finance and Students, and a Won column filled retroactively from history would
 * misrepresent when those cards were actually won.
 */
const OPEN_STAGES: LeadStage[] = [
  "NEW_LEAD",
  "DISCO_BOOKED",
  "DISCO_NOT_BOOKED",
  "DISCO_COMPLETED",
  "SSS_BOOKED",
  "SSS_COMPLETED",
  "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP",
  "OFFER_FOLLOWUP",
  "DEPOSIT_FOLLOWUP",
];

/** Small batches: each lead costs a few queries, and this runs against a pooled connection. */
const BATCH = 200;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true, deletedAt: null },
    select: { id: true, name: true, stages: { where: { deletedAt: null }, select: { name: true, legacyStage: true } } },
  });
  if (!pipeline) {
    console.error("No default pipeline exists — nothing to backfill into. Create one first.");
    process.exit(1);
  }

  // A stage with no bridged column silently cannot receive cards. Say so up front rather than
  // reporting a mysterious shortfall at the end.
  const bridged = new Set(pipeline.stages.map((s) => s.legacyStage).filter(Boolean));
  const unbridged = OPEN_STAGES.filter((s) => !bridged.has(s));
  console.log(`Default pipeline: ${pipeline.name}`);
  if (unbridged.length) {
    console.warn(
      `  ⚠ No column is bridged to: ${unbridged.join(", ")} — leads in those stages will be SKIPPED.\n` +
        `    Map them at Opportunities → Manage pipeline, then re-run.`,
    );
  }
  const unmappedColumns = pipeline.stages.filter((s) => !s.legacyStage).map((s) => s.name);
  if (unmappedColumns.length) {
    console.warn(
      `  ⚠ Columns with no lead stage mapped: ${unmappedColumns.join(", ")} — a card dropped in one` +
        ` stops syncing to the lead's stage.`,
    );
  }

  const total = await prisma.lead.count({
    where: { deletedAt: null, stage: { in: OPEN_STAGES }, opportunities: { none: {} } },
  });
  console.log(`\n${total.toLocaleString("en-IN")} open-stage leads have no opportunity card.`);
  if (dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  let cursor: string | null = null;
  let done = 0;
  let created = 0;
  let skipped = 0;

  for (;;) {
    if (done >= limit) break;
    const leads: { id: string }[] = await prisma.lead.findMany({
      where: { deletedAt: null, stage: { in: OPEN_STAGES }, opportunities: { none: {} } },
      orderBy: { id: "asc" },
      take: Math.min(BATCH, limit - done),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (!leads.length) break;
    cursor = leads[leads.length - 1]!.id;

    for (const lead of leads) {
      // One transaction PER LEAD, not one for the batch: a single unmappable lead must not roll
      // back 199 good ones, and a long-running transaction over 15,000 rows would hold a pooled
      // connection open for minutes.
      const before = await prisma.opportunity.count({ where: { leadId: lead.id } });
      await prisma.$transaction((tx) => ensureDefaultOpportunity(tx, lead.id));
      const after = await prisma.opportunity.count({ where: { leadId: lead.id } });
      if (after > before) created++;
      else skipped++;
    }

    done += leads.length;
    console.log(`  … ${done.toLocaleString("en-IN")}/${Math.min(total, limit).toLocaleString("en-IN")} processed`);
  }

  console.log(`\nDone. ${created.toLocaleString("en-IN")} cards created, ${skipped.toLocaleString("en-IN")} skipped (no bridged column, or already had one).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
