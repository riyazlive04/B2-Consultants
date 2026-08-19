/**
 * Shape the default board's columns into the twelve live Synamate stages, and re-file the cards.
 *
 * The columns ONLY. Unlike `npm run db:crm`, this never creates opportunities - so it is the safe
 * thing to run against production when the board has drifted from Synamate, without also filing
 * twenty thousand leads onto it as a side effect.
 *
 * Idempotent (see `server/pipeline-reshape.applySynamateStages`): a second run reports the same
 * board and writes nothing.
 *
 *   npm run db:pipeline-sync -- --dry-run    # print the current columns, change nothing
 *   npm run db:pipeline-sync                 # apply
 *
 * `--conditions=react-server` is REQUIRED (the npm script supplies it) - this imports a
 * `server-only` module, which plain tsx refuses to load.
 *
 * Reads DATABASE_URL from the environment - CHECK WHICH DATABASE THAT IS before running.
 */

import { PrismaClient } from "@prisma/client";
import { SYNAMATE_STAGES } from "../src/lib/pipeline-stages";
import { applySynamateStages } from "../src/server/pipeline-reshape";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");

  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!pipeline) {
    console.error("No default pipeline exists. Run `npm run db:crm` first.");
    process.exit(1);
  }

  const before = await prisma.pipelineStage.findMany({
    where: { pipelineId: pipeline.id, deletedAt: null },
    orderBy: { position: "asc" },
    select: { name: true, legacyStage: true, paymentPlan: true, _count: { select: { opps: true } } },
  });

  console.log(`Default pipeline: ${pipeline.name}\n`);
  console.log(`Current columns (${before.length}):`);
  for (const s of before) {
    console.log(`  ${s.name.padEnd(34)} ${String(s.legacyStage ?? "- unmapped -").padEnd(20)} ${s.paymentPlan ?? ""}  (${s._count.opps} cards)`);
  }

  if (dryRun) {
    console.log(`\nTarget columns (${SYNAMATE_STAGES.length}):`);
    SYNAMATE_STAGES.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.name}`));
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const report = await applySynamateStages(prisma, pipeline.id);
  console.log("");
  for (const r of report.renamed) console.log(`  ~ renamed "${r.from}" → "${r.to}"`);
  for (const n of report.created) console.log(`  + created "${n}"`);
  for (const n of report.removed) console.log(`  - removed "${n}" (not a Synamate column)`);
  console.log(`\nDone. ${report.refiled} card(s) re-filed. The board now has ${SYNAMATE_STAGES.length} columns.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
