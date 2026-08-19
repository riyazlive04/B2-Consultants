import "server-only";
import type { LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncDefaultOpportunity } from "./opportunity-sync";

/**
 * Move a lead forward because the system observed something, not because a human dragged a card.
 *
 * ── Why `from` is an explicit whitelist and not "any earlier stage" ─────────────────────────────
 * There is no total order over `LeadStage` - the enum's declaration order is not a funnel, and
 * treating it as one would let a late signal drag a booked or won lead backwards. So each caller
 * states the exact stages its signal may advance FROM, and anything else is left alone. A prospect
 * who already booked a call does not go back to "WhatsApp Sent" because the intro finally sent.
 *
 * ── Why the history row and the board sync are not optional ─────────────────────────────────────
 * `leadStageHistory` is append-only and trigger-guarded, and the funnel/aging metrics read it
 * rather than the current column - a stage change written without one is invisible to every report
 * that matters. `syncDefaultOpportunity` then moves the CARD, because the board and `Lead.stage`
 * disagreeing is the failure mode the write-through exists to prevent.
 *
 * Returns whether it actually moved. Never throws for "wrong stage" - that is the normal case.
 */
export async function advanceLeadStage(
  leadId: string,
  to: LeadStage,
  from: readonly LeadStage[],
): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { stage: true, deletedAt: true },
  });
  // An archived lead is not part of the funnel any more; advancing it would resurrect it on the board.
  if (!lead || lead.deletedAt) return false;
  if (lead.stage === to || !from.includes(lead.stage)) return false;

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { stage: to } });
    await tx.leadStageHistory.create({
      // `changedById: null` - this is the system moving the lead, and attributing it to whoever
      // happened to trigger the send would put it on their gamification scoreboard.
      data: { leadId, fromStage: lead.stage, toStage: to },
    });
    await syncDefaultOpportunity(tx, leadId, to);
  });
  return true;
}
