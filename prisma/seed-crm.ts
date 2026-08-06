/**
 * Synamate CRM parity — pipeline seed.
 *
 * 1. Creates the default "Sales" pipeline if it doesn't exist.
 * 2. Shapes its columns into the twelve live Synamate stages (`lib/pipeline-stages.ts`) and
 *    re-files any card that is in the wrong one — `server/pipeline-reshape.applySynamateStages`,
 *    the same code the `db:pipeline-sync` CLI and the board's "Restore the Synamate columns"
 *    button run, so a fresh database and a live one can never end up with different boards.
 * 3. Backfills one Opportunity per Lead that doesn't have one yet.
 *
 * Idempotent: re-running renames columns back if someone changed them, adds only the missing
 * opportunities, and writes nothing else. Run with:  npm run db:crm
 */

import { PrismaClient } from "@prisma/client";
import { getTodayInrPerEur } from "../src/lib/fx";
import { boardColumnFor } from "../src/lib/pipeline-stages";
import { statusForLegacyStage } from "../src/lib/opportunity-status";
import { applySynamateStages } from "../src/server/pipeline-reshape";

const prisma = new PrismaClient();

async function main() {
  const fx = await getTodayInrPerEur();

  // 1. Default pipeline
  let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true, deletedAt: null } });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({ data: { name: "Sales", isDefault: true, position: 0 } });
    console.log(`Created default pipeline "${pipeline.name}" (${pipeline.id}).`);
  } else {
    console.log(`Default pipeline "${pipeline.name}" already exists (${pipeline.id}).`);
  }

  // 2. The twelve Synamate columns
  const report = await applySynamateStages(prisma, pipeline.id);
  for (const r of report.renamed) console.log(`  ~ renamed "${r.from}" → "${r.to}"`);
  for (const n of report.created) console.log(`  + ${n}`);
  for (const n of report.removed) console.log(`  - removed "${n}" (not a Synamate column)`);
  if (report.refiled) console.log(`  → re-filed ${report.refiled} card(s) into the right column`);

  // Column lookup for the backfill below, keyed the way `boardColumnFor` answers.
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: pipeline.id, deletedAt: null },
    select: { id: true, legacyStage: true, paymentPlan: true },
  });
  const stageIdFor = (stage: Parameters<typeof boardColumnFor>[0], plan: Parameters<typeof boardColumnFor>[1]) => {
    const col = boardColumnFor(stage, plan);
    return stages.find((s) => s.legacyStage === col.legacyStage && s.paymentPlan === col.paymentPlan)?.id;
  };

  // 3. Backfill opportunities for leads that have none
  const BATCH = 500;
  let created = 0;
  let cursor: string | undefined;
  // Track a running position per stage so cards land in a stable order.
  const posByStage = new Map<string, number>();

  for (;;) {
    const leads = await prisma.lead.findMany({
      where: { opportunities: { none: {} } },
      select: { id: true, name: true, stage: true, paymentPlan: true, leadSource: true, assignedToId: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (leads.length === 0) break;
    cursor = leads[leads.length - 1].id;

    const data = leads.flatMap((l) => {
      const stageId = stageIdFor(l.stage, l.paymentPlan);
      // No column for this lead's stage means the board has been edited past what the mapping
      // covers. Skip the lead rather than throw — a missing card is recoverable by re-running.
      if (!stageId) return [];
      const pos = posByStage.get(stageId) ?? 0;
      posByStage.set(stageId, pos + 1);
      return [{
        leadId: l.id,
        pipelineId: pipeline!.id,
        stageId,
        name: l.name,
        status: statusForLegacyStage(boardColumnFor(l.stage, l.paymentPlan).legacyStage),
        valueInrMinor: BigInt(0),
        valueEurMinor: BigInt(0),
        fxRateUsed: fx.rate,
        source: l.leadSource,
        assignedToId: l.assignedToId,
        position: pos,
        wonAt: l.stage === "WON" ? new Date() : null,
      }];
    });
    if (data.length) await prisma.opportunity.createMany({ data });
    created += data.length;
    console.log(`  backfilled ${created} opportunities...`);
    if (leads.length < BATCH) break;
  }

  console.log(`Done. Pipeline "${pipeline.name}" with ${stages.length} stages; ${created} opportunities backfilled.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
