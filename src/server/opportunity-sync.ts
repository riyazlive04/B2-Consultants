import "server-only";
import type { Prisma, LeadStage, PaymentPlan } from "@prisma/client";
import { statusForLegacyStage } from "@/lib/opportunity-status";
import { boardColumnFor, columnStageFor } from "@/lib/pipeline-stages";

/**
 * Which column on the default board a lead belongs in.
 *
 * Not a plain `legacyStage` lookup, because the board mirrors Synamate's twelve columns rather
 * than the fifteen `LeadStage` values (`lib/pipeline-stages.ts`):
 *
 *   - Four stages have no column of their own (NEW_LEAD, DISCO_NOT_BOOKED, DISCO_COMPLETED,
 *     PROPOSAL_SENT). Matching on `legacyStage` alone found nothing for them, and both callers
 *     below no-op on "no column" - so a brand-new lead would never have reached the board at all.
 *   - WON has TWO columns, Split Pay and Full pay. `findFirst` on `legacyStage: "WON"` returns
 *     whichever the database hands back first, so the same win could land in either column on
 *     different runs. The lead's payment plan decides it.
 *
 * The fallback exists for a board an Admin has edited: if the exact column is gone, any column
 * bridged to the same stage will do, and only then do we give up.
 */
async function defaultBoardStage(
  tx: Prisma.TransactionClient,
  stage: LeadStage,
  paymentPlan: PaymentPlan | null,
): Promise<{ id: string; pipelineId: string } | null> {
  const col = boardColumnFor(stage, paymentPlan);
  const onDefaultBoard = { pipeline: { isDefault: true, deletedAt: null }, deletedAt: null };
  const select = { id: true, pipelineId: true };
  return (
    (await tx.pipelineStage.findFirst({
      where: { ...onDefaultBoard, legacyStage: col.legacyStage, paymentPlan: col.paymentPlan },
      select,
    })) ??
    (await tx.pipelineStage.findFirst({
      where: { ...onDefaultBoard, legacyStage: col.legacyStage },
      orderBy: { position: "asc" },
      select,
    }))
  );
}

/**
 * Keep the default Opportunity board in step with a lead's stage.
 *
 * Lives in its own module rather than inside `pipeline-actions.ts` because more than one
 * `"use server"` file needs it (pipeline edits, and now call logging - Error Log L4), and a
 * `"use server"` module may only export async server actions: exporting a shared helper from
 * one action file to another is a build error, and copying it would leave two rules to drift.
 *
 * The lead→opportunity direction; the mirror of `opportunities-actions.moveOpportunity`, and
 * the two share `statusForLegacyStage` so a stage means the same thing whichever end moved.
 *
 * No-ops when the lead has no opportunity, or when no default-pipeline column is bridged to
 * this stage. Custom pipelines are a separate view and are deliberately left untouched.
 */
/**
 * Put a lead on the default Opportunity board, if it isn't already.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────────
 * NOTHING created an opportunity from an inbound lead. There were exactly two creation sites in
 * the whole codebase - a native Form submission with `createOpportunity` explicitly toggled on,
 * and the board's own "Add card" button - so every lead that arrived by webhook (Pabbly, Meta,
 * FlexiFunnels) or was typed into the Pipeline screen never reached the board at all. And
 * `syncDefaultOpportunity` below only ever MOVES a card that already exists (`if (!opps.length)
 * return`), so the stage sync could never rescue them either.
 *
 * On 4 Aug 2026 production held 23,545 leads and ONE opportunity. That is the entire content of
 * the "new leads are not coming in the opportunity section" report.
 *
 * ── Contract ────────────────────────────────────────────────────────────────────
 * Idempotent: a lead that already has a card on the default pipeline is left exactly as it is,
 * wherever that card currently sits. So this is safe to call from every creation path and safe
 * to run repeatedly over history as a backfill.
 *
 * No-ops (rather than throwing) when there is no default pipeline, or no column bridged to the
 * lead's stage. Lead capture must never fail because the board is misconfigured - a lead that
 * arrives without a card is recoverable, a lead that does not arrive is not.
 *
 * Custom pipelines are deliberately untouched: they are separate processes, and auto-filing
 * every inbound lead into someone's hand-built board would be a surprise, not a feature.
 */
export async function ensureDefaultOpportunity(
  tx: Prisma.TransactionClient,
  leadId: string,
): Promise<void> {
  const existing = await tx.opportunity.count({
    where: { leadId, pipeline: { isDefault: true, deletedAt: null } },
  });
  if (existing > 0) return;

  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    select: { name: true, stage: true, paymentPlan: true, leadSource: true, assignedToId: true, deletedAt: true },
  });
  // An archived lead has no business appearing on a live board.
  if (!lead || lead.deletedAt) return;

  const target = await defaultBoardStage(tx, lead.stage, lead.paymentPlan);
  if (!target) return;

  const max = await tx.opportunity.aggregate({ where: { stageId: target.id }, _max: { position: true } });
  await tx.opportunity.create({
    data: {
      leadId,
      pipelineId: target.pipelineId,
      stageId: target.id,
      name: lead.name,
      // The COLUMN's stage, not the lead's: a DISCO_NOT_BOOKED lead is filed into
      // Cancelled/Unqualified, and a card in a closed column that still reported OPEN would show
      // up under the board's Open filter inside a closed column.
      status: statusForLegacyStage(columnStageFor(lead.stage)),
      // Value is unknown at capture - a lead has not been quoted anything yet. Zero is the
      // honest figure and keeps the pipeline-value total truthful; guessing an average deal size
      // here would inflate every forecast on the board by the number of raw leads.
      valueInrMinor: 0n,
      valueEurMinor: 0n,
      // Zero rate, not today's: nothing has been quoted, so there is no amount to convert and
      // stamping a live FX rate on a zero would imply a valuation that was never made.
      fxRateUsed: 0,
      // The lead's ORIGIN (Instagram, referral, …) - `Opportunity.source` is a LeadSource, not
      // the capture pipe. Carrying it here is what lets the board be read by channel.
      source: lead.leadSource,
      assignedToId: lead.assignedToId,
      position: (max._max.position ?? -1) + 1,
    },
  });
}

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
  // Which of the two won columns a win goes to is the lead's payment plan, so it has to be read
  // - the caller only tells us the stage. Cheap: one column, and only when a card exists.
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { paymentPlan: true } });
  const target = await defaultBoardStage(tx, newStage, lead?.paymentPlan ?? null);
  if (!target) return;
  const status = statusForLegacyStage(columnStageFor(newStage));
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
