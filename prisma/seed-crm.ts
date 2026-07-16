/**
 * Synamate CRM parity — Phase 1 seed (SYNAMATE_CLONE_SPEC §5).
 *
 * 1. Creates the default "Sales" pipeline whose stages mirror the LeadStage enum in order,
 *    each stage carrying `legacyStage` so a board move can write-through to Lead.stage.
 * 2. Backfills one Opportunity per Lead that doesn't have one yet, placed in the stage whose
 *    `legacyStage` matches the lead's current stage.
 *
 * Idempotent: re-running adds only what's missing (stages by name, opportunities for leads
 * that still have none). Run with:  npm run db:crm
 */

import { PrismaClient, type LeadStage, type OpportunityStatus } from "@prisma/client";
import { getTodayInrPerEur } from "../src/lib/fx";

const prisma = new PrismaClient();

// LeadStage enum order → human label. Terminal stages (WON/LOST/NO_SHOW) stay as columns so
// the board can express them and write-through Lead.stage.
const STAGE_ORDER: { stage: LeadStage; label: string }[] = [
  { stage: "NEW_LEAD", label: "New Lead" },
  { stage: "DISCO_BOOKED", label: "Discovery Booked" },
  { stage: "DISCO_NOT_BOOKED", label: "Discovery Not Booked" },
  { stage: "DISCO_COMPLETED", label: "Discovery Completed" },
  { stage: "SSS_BOOKED", label: "Strategy Session Booked" },
  { stage: "SSS_COMPLETED", label: "Strategy Session Completed" },
  { stage: "PROPOSAL_SENT", label: "Proposal Sent" },
  { stage: "SENT_TO_WORKSHOP", label: "Sent to Workshop" },
  { stage: "WORKSHOP_FOLLOWUP", label: "Workshop Follow-up" },
  { stage: "OFFER_FOLLOWUP", label: "Offer Follow-up" },
  { stage: "DEPOSIT_FOLLOWUP", label: "Deposit Follow-up" },
  { stage: "DEPOSIT_PAID", label: "Deposit Paid" },
  { stage: "WON", label: "Won" },
  { stage: "LOST", label: "Lost" },
  { stage: "NO_SHOW", label: "No Show" },
];

function statusForStage(stage: LeadStage): OpportunityStatus {
  if (stage === "WON") return "WON";
  if (stage === "LOST") return "LOST";
  if (stage === "NO_SHOW") return "ABANDONED";
  return "OPEN";
}

async function main() {
  const fx = await getTodayInrPerEur();

  // 1. Default pipeline
  let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { name: "Sales", isDefault: true, position: 0 },
    });
    console.log(`Created default pipeline "${pipeline.name}" (${pipeline.id}).`);
  } else {
    console.log(`Default pipeline "${pipeline.name}" already exists (${pipeline.id}).`);
  }

  // 2. Stages (create any missing, by name, preserving order)
  const existing = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id } });
  const byName = new Map(existing.map((s) => [s.name, s]));
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const { stage, label } = STAGE_ORDER[i];
    if (!byName.has(label)) {
      const created = await prisma.pipelineStage.create({
        data: { pipelineId: pipeline.id, name: label, position: i, legacyStage: stage },
      });
      byName.set(label, created);
      console.log(`  + stage ${label}`);
    }
  }
  // Map legacyStage → stageId for backfill
  const allStages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id } });
  const stageIdByLegacy = new Map<LeadStage, string>();
  for (const s of allStages) if (s.legacyStage) stageIdByLegacy.set(s.legacyStage, s.id);

  // 3. Backfill opportunities for leads that have none
  const BATCH = 500;
  let created = 0;
  let cursor: string | undefined;
  // Track a running position per stage so cards land in a stable order.
  const posByStage = new Map<string, number>();

  for (;;) {
    const leads = await prisma.lead.findMany({
      where: { opportunities: { none: {} } },
      select: { id: true, name: true, stage: true, leadSource: true, assignedToId: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (leads.length === 0) break;
    cursor = leads[leads.length - 1].id;

    const data = leads.map((l) => {
      const stageId = stageIdByLegacy.get(l.stage)!;
      const pos = posByStage.get(stageId) ?? 0;
      posByStage.set(stageId, pos + 1);
      return {
        leadId: l.id,
        pipelineId: pipeline!.id,
        stageId,
        name: l.name,
        status: statusForStage(l.stage),
        valueInrMinor: BigInt(0),
        valueEurMinor: BigInt(0),
        fxRateUsed: fx.rate,
        source: l.leadSource,
        assignedToId: l.assignedToId,
        position: pos,
        wonAt: l.stage === "WON" ? new Date() : null,
      };
    });
    await prisma.opportunity.createMany({ data });
    created += data.length;
    console.log(`  backfilled ${created} opportunities...`);
    if (leads.length < BATCH) break;
  }

  console.log(`Done. Pipeline "${pipeline.name}" with ${allStages.length} stages; ${created} opportunities backfilled.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
