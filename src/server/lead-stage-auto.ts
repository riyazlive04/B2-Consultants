import "server-only";
import type { LeadStage, WhatsAppKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncDefaultOpportunity } from "./opportunity-sync";

/**
 * Which WhatsApp touchpoints mean "this prospect has now been messaged" for the board.
 *
 * "WhatsApp Sent" is the Fresh Optins column's exit: the SOP intro (Step 3) reached the
 * prospect. Only the kinds that ARE that first contact are listed - a booking confirmation or a
 * payment reminder says nothing about where a fresh opt-in is in the funnel, and listing them
 * would drag a lead forward on the wrong signal.
 */
const STAGE_ON_SENT: Partial<Record<WhatsAppKind, { to: LeadStage; from: readonly LeadStage[] }>> = {
  SOP_INTRO: { to: "WHATSAPP_SENT", from: ["NEW_LEAD"] },
  DISCO_REMINDER: { to: "WHATSAPP_SENT", from: ["NEW_LEAD"] },
};

/**
 * Called by `sendWhatsApp` after a message actually went out to a lead. One hook for every
 * sender - the automation workflow, a manual send from the pipeline, the SOP engine - so the
 * card moves the same way regardless of which path sent the intro. Before this, only the SOP
 * engine's own step-marking advanced the stage, and an intro sent by a workflow left the lead
 * sitting in Fresh Optins with the message genuinely delivered.
 */
export async function advanceLeadStageForWhatsApp(leadId: string, kind: WhatsAppKind): Promise<boolean> {
  const rule = STAGE_ON_SENT[kind];
  if (!rule) return false;
  return advanceLeadStage(leadId, rule.to, rule.from);
}

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
