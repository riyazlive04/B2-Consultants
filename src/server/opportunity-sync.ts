import "server-only";
import type { Prisma, LeadStage } from "@prisma/client";
import { statusForLegacyStage } from "@/lib/opportunity-status";

/**
 * Keep the default Opportunity board in step with a lead's stage.
 *
 * Lives in its own module rather than inside `pipeline-actions.ts` because more than one
 * `"use server"` file needs it (pipeline edits, and now call logging — Error Log L4), and a
 * `"use server"` module may only export async server actions: exporting a shared helper from
 * one action file to another is a build error, and copying it would leave two rules to drift.
 *
 * The lead→opportunity direction; the mirror of `opportunities-actions.moveOpportunity`, and
 * the two share `statusForLegacyStage` so a stage means the same thing whichever end moved.
 *
 * No-ops when the lead has no opportunity, or when no default-pipeline column is bridged to
 * this stage. Custom pipelines are a separate view and are deliberately left untouched.
 */
export async function syncDefaultOpportunity(
  tx: Prisma.TransactionClient,
  leadId: string,
  newStage: LeadStage,
): Promise<void> {
  const opps = await tx.opportunity.findMany({
    where: { leadId, pipeline: { isDefault: true, deletedAt: null } },
    select: { id: true, stageId: true, wonAt: true },
  });
  if (!opps.length) return;
  const target = await tx.pipelineStage.findFirst({
    where: { pipeline: { isDefault: true, deletedAt: null }, legacyStage: newStage, deletedAt: null },
    select: { id: true },
  });
  if (!target) return;
  const status = statusForLegacyStage(newStage);
  const max = await tx.opportunity.aggregate({ where: { stageId: target.id }, _max: { position: true } });
  let pos = (max._max.position ?? -1) + 1;
  for (const o of opps) {
    if (o.stageId === target.id) continue; // already in the right column
    await tx.opportunity.update({
      where: { id: o.id },
      data: {
        stageId: target.id,
        status,
        wonAt: status === "WON" ? o.wonAt ?? new Date() : null,
        position: pos++,
      },
    });
  }
}
