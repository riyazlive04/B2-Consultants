/**
 * One-off production repair for the "form captures land in a deleted column" bug.
 *
 * Two writes, both narrow:
 *   1. Any Form whose settings.stageId names a soft-deleted (or missing) stage is repointed at the
 *      live column that the app's own routing would pick for a NEW_LEAD lead - `boardColumnFor`,
 *      the same function opportunity-sync uses - so the form and the automatic path agree.
 *   2. Any live Opportunity stranded in a soft-deleted stage of a live pipeline is moved to that
 *      same live column, appended at the end, with the status the column implies.
 *
 * The code guard in forms-actions.ts stops NEW cards being written into a deleted stage; this
 * clears the ones already stranded. Idempotent - a second run finds nothing to do.
 *
 * Run:  npx tsx scripts/fix-deleted-stage-cards.ts --force
 */
import { PrismaClient, type LeadStage } from "@prisma/client";
import { boardColumnFor, columnStageFor } from "../src/lib/pipeline-stages";
import { statusForLegacyStage } from "../src/lib/opportunity-status";

const prisma = new PrismaClient();

if (!process.argv.includes("--force")) {
  console.error("Refusing to run without --force (this writes to whatever DATABASE_URL points at).");
  process.exit(1);
}

/** The live column a lead in `stage` belongs in, on the pipeline the stranded row already sits on. */
async function liveColumnFor(pipelineId: string, stage: LeadStage) {
  const col = boardColumnFor(stage, null);
  return prisma.pipelineStage.findFirst({
    where: { pipelineId, deletedAt: null, legacyStage: col.legacyStage, paymentPlan: col.paymentPlan },
    orderBy: { position: "asc" },
    select: { id: true, name: true },
  });
}

async function main() {
  // ── 1. Forms pointing at a dead column ───────────────────────────────────────
  const forms = await prisma.form.findMany({ select: { id: true, name: true, slug: true, settings: true } });
  for (const f of forms) {
    const s = (f.settings ?? {}) as Record<string, unknown>;
    if (!s.createOpportunity || !s.stageId || !s.pipelineId) continue;

    const live = await prisma.pipelineStage.findFirst({
      where: { id: String(s.stageId), deletedAt: null, pipeline: { deletedAt: null } },
      select: { id: true },
    });
    if (live) {
      console.log(`form "${f.slug}": stage is live - left alone`);
      continue;
    }

    const target = await liveColumnFor(String(s.pipelineId), "NEW_LEAD");
    if (!target) {
      console.log(`form "${f.slug}": stage is DEAD and no live column found - needs a manual choice`);
      continue;
    }
    await prisma.form.update({
      where: { id: f.id },
      data: { settings: { ...s, stageId: target.id } as never },
    });
    console.log(`form "${f.slug}": stageId ${String(s.stageId)} (deleted) -> ${target.id} ("${target.name}")`);
  }

  // ── 2. Cards stranded in a dead column ───────────────────────────────────────
  const stranded = await prisma.opportunity.findMany({
    where: { deletedAt: null, stage: { deletedAt: { not: null } }, pipeline: { deletedAt: null } },
    select: { id: true, name: true, pipelineId: true, stageId: true, lead: { select: { stage: true } } },
  });
  console.log(`\nstranded cards: ${stranded.length}`);

  for (const o of stranded) {
    // The LEAD's stage decides the column, not the dead stage's - the lead is the source of truth
    // about where this person actually is; the dead column only says where the card got parked.
    const leadStage = o.lead?.stage ?? "NEW_LEAD";
    const target = await liveColumnFor(o.pipelineId, leadStage);
    if (!target) {
      console.log(`  "${o.name}" (${o.id}): no live column for ${leadStage} - skipped`);
      continue;
    }
    const max = await prisma.opportunity.aggregate({ where: { stageId: target.id }, _max: { position: true } });
    await prisma.opportunity.update({
      where: { id: o.id },
      data: {
        stageId: target.id,
        status: statusForLegacyStage(columnStageFor(leadStage)),
        position: (max._max.position ?? -1) + 1,
      },
    });
    console.log(`  "${o.name}" (${o.id}): lead stage ${leadStage} -> "${target.name}" (${target.id})`);
  }
}

main().finally(() => prisma.$disconnect());
