import "server-only";
import type { LeadStage, Prisma, WhatsAppKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncDefaultOpportunity } from "./opportunity-sync";
import { pickFirstCaller } from "./assignment";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

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
  // The New Lead stage message is the intro for anyone whose SOP intro already went out in an
  // earlier cycle (a returning or restored lead): each SOP step sends once per lead, ever.
  STAGE_NEW_LEAD: { to: "WHATSAPP_SENT", from: ["NEW_LEAD"] },
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
  const moved = await advanceLeadStage(leadId, rule.to, rule.from);
  // "WhatsApp Sent" is the point a human takes over (SOP Step 4/5: the first call), so the lead
  // MUST have a caller by now. Capture already assigns one through the 80/20 rotation; this is
  // the safety net for a lead that arrived while the rotation was empty or everyone was capped.
  if (rule.to === "WHATSAPP_SENT") await ensureLeadOwner(leadId);
  return moved;
}

/**
 * The prospect has CONFIRMED they will attend - move them to "Pre-Qualified & Confirmed".
 *
 * ── The distinction this exists to record (founder, 27/08/2026) ──────────────────
 *   "BANT only pre-qualifies but the lead have to manually confirm over the WhatsApp message
 *    reply or confirm over the call (by telecaller) or over the email, then they have to be
 *    moved to this (Pre-Qualified & Confirmed) stage."
 *
 * So there are two different facts and two different columns:
 *   Discovery Call Booked      - a slot is held, and BANT has scored them automatically.
 *   Pre-Qualified & Confirmed  - a HUMAN said yes. Scoring cannot produce this; only the
 *                                prospect can, on whichever channel they happen to answer on.
 *
 * ── Why it is one function and not four ─────────────────────────────────────────
 * Four places already recorded a confirmation - the WATI reply webhook, a telecaller logging a
 * verbal yes on a Step 16 call, a specialist ticking the Key Metrics column, and the Bookings
 * confirm loop - and not one of them moved the card. That is why the board reads 3 in Discovery
 * Call Booked and 0 in Pre-Qualified & Confirmed: the column had no writer at all.
 *
 * Adding the move at each site separately would leave the same gap open for the fifth channel.
 * This is the one place the rule lives, exactly as `advanceLeadStageForWhatsApp` above is the one
 * place the "a sent intro moves the card" rule lives.
 *
 * ── The `from` whitelist ────────────────────────────────────────────────────────
 * Confirmation is evidence about the EARLY funnel, so it may only pull a lead forward from there.
 * A prospect already at DISCO_COMPLETED or SSS_BOOKED has overtaken this signal and is left alone
 * (`advanceLeadStage` enforces it). DISCO_NOT_BOOKED is included on purpose: the auto-cancel
 * ladders and the call-back close-out both file leads there, and someone who then answers is
 * plainly still live - a confirmation should be able to bring them back.
 *
 * Returns whether the card actually moved, so the caller can log it honestly.
 */
/**
 * Mark this lead's upcoming discovery booking as confirmed, whatever channel the answer
 * arrived on. Idempotent and narrow by design:
 *
 *  - only a BOOKED booking that still holds a slot in the FUTURE. A past call is history,
 *    and confirming it would reopen nothing;
 *  - only one that is not already confirmed, so a second yes does not move the timestamp;
 *  - `updateMany` with the full condition set, so the guard is in the database rather than
 *    in a read-then-write that two replies could interleave on.
 *
 * Returns whether a booking was actually stamped, for callers that want to log it.
 */
export async function confirmLiveBookingForLead(leadId: string): Promise<boolean> {
  const res = await prisma.bookingRequest.updateMany({
    where: {
      leadId,
      status: "BOOKED",
      confirmedAt: null,
      slot: { is: { startsAt: { gt: new Date() } } },
    },
    data: { confirmedAt: new Date() },
  });
  return res.count > 0;
}

export async function markDiscoveryConfirmed(
  leadId: string,
  channel: "whatsapp" | "call" | "email" | "manual",
): Promise<boolean> {
  /**
   * ── Stamp the BOOKING, not just the board ───────────────────────────────────────
   * `BookingRequest.confirmedAt` is the one field the auto-cancel engine reads: its
   * candidate query is `confirmedAt: null`, and it consults nothing else. Only the WATI
   * webhook was setting it. A verbal yes on a Step-16 confirmation call, and a yes
   * detected from an email reply, both moved the card and set `whatsappConfirmed` on the
   * journey - and left the booking looking unanswered.
   *
   * So two of the three confirmation channels the founder built were invisible to the
   * engine that acts on confirmation, and arming the loop would have released the slot of
   * a prospect who had already told a telecaller they were coming - then messaged them to
   * say their call was cancelled for not replying.
   *
   * Stamped HERE because this is the one function every channel already calls, so a
   * channel added later cannot forget it. Above the `moved` check on purpose: a lead
   * already sitting in DISCO_BOOKED returns false from that check, and their booking would
   * otherwise never be stamped at all.
   */
  await confirmLiveBookingForLead(leadId);

  const moved = await advanceLeadStage(leadId, "DISCO_BOOKED", [
    "NEW_LEAD",
    "WHATSAPP_SENT",
    "STRATEGY_CALL_BOOKED",
    "DISCO_NOT_BOOKED",
  ]);
  if (!moved) return false;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } });
  await logSystemActivity(SYSTEM_ACTORS.outreach, {
    action: "lead.stage.change",
    section: "pipeline",
    entityType: "Lead",
    entityId: leadId,
    // The CHANNEL is in the sentence, not just the meta. "Confirmed" and "confirmed by replying
    // to the WhatsApp" are different amounts of evidence, and the person auditing a slot that was
    // held for someone who never turned up needs to know which one they are looking at.
    summary: `${lead?.name ?? "A lead"} confirmed their discovery call ${CONFIRM_CHANNEL[channel]} - moved to Pre-Qualified & Confirmed`,
    meta: { channel, toStage: "DISCO_BOOKED" },
  });
  return true;
}

const CONFIRM_CHANNEL: Record<"whatsapp" | "call" | "email" | "manual", string> = {
  whatsapp: "by replying to the WhatsApp",
  call: "on a call with the telecaller",
  email: "by replying to the email",
  manual: "(recorded by a specialist)",
};

/**
 * Give an unowned lead a caller through the first-call rotation (Nilofer 80 / Asma 20 as
 * configured) and put that owner on its board card. No-op when the lead already has an owner -
 * a manual reassignment is never overridden - or when no rotation is configured.
 */
export async function ensureLeadOwner(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { name: true, stage: true, assignedToId: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt || lead.assignedToId) return false;
  const ownerId = await pickFirstCaller().catch(() => null);
  if (!ownerId) return false;

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { assignedToId: ownerId } });
    // Same stage, same column - this only carries the new owner onto the card.
    await syncDefaultOpportunity(tx, leadId, lead.stage);
  });
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
  await logSystemActivity(SYSTEM_ACTORS.outreach, {
    action: "lead.assign",
    section: "pipeline",
    entityType: "Lead",
    entityId: leadId,
    summary: `Assigned ${lead.name} to ${owner?.name ?? "a caller"} by the first-call rotation`,
    meta: { assignedToId: ownerId, trigger: "WHATSAPP_SENT" },
  });
  return true;
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

  // `changedById` is left null on purpose - this is the SYSTEM moving the lead, and attributing
  // it to whoever happened to trigger the send would put it on their gamification scoreboard.
  await prisma.$transaction((tx) => writeLeadStage(tx, { leadId, from: lead.stage, to }));
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────────────────
   THE ONE WAY Lead.stage IS WRITTEN
   ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Move a lead's stage, inside a caller's transaction.
 *
 * ── The structural problem this closes (P4) ─────────────────────────────────────────────
 * One deal has two status fields: `Lead.stage` and `Opportunity.stageId`, kept in step by
 * application code. Seventeen sites across twelve modules write `Lead.stage`, and each one had to
 * remember THREE things:
 *
 *   1. update the column
 *   2. write a `LeadStageHistory` row - the pipeline's stage metrics read history, not the current
 *      column, so a stage change with no history row is invisible to every report that matters
 *   3. move the card on the Opportunity board
 *
 * Fifteen of the seventeen remembered all three. Two did not, and both were the same bug in two
 * places: `booking-automation.ts` and `outreach.ts` released an unconfirmed booking and sent the
 * lead back to `DISCO_NOT_BOOKED` without touching the board - so the card sat in "Discovery Call
 * Booked" claiming a call that had just been cancelled. Both files carry a comment explaining that
 * they fixed exactly this failure for the stage column, and neither carried it through to the card.
 *
 * Doing all three in one place is the fix. Forgetting is no longer possible, because there is
 * nothing left to forget - and `lead-stage-writers.test.ts` fails if a new direct write appears.
 *
 * ── Why it takes a `tx` rather than opening its own ─────────────────────────────────────
 * Every caller is already inside a transaction that is doing something else at the same time:
 * cancelling a booking, releasing a slot, logging a call. The stage change has to commit or roll
 * back WITH that work - a released slot whose lead stayed in "Booked" is precisely the drift
 * this exists to prevent.
 *
 * `changedById` is the person who did it, or `null` for the system. Null matters: attributing an
 * engine's move to whoever happened to trigger it would put it on their gamification scoreboard.
 */
export async function writeLeadStage(
  tx: Prisma.TransactionClient,
  args: {
    leadId: string;
    /** The stage being left. Recorded in history, so it must be the value actually in the row. */
    from: LeadStage | null;
    to: LeadStage;
    changedById?: string | null;
  },
): Promise<void> {
  const { leadId, from, to, changedById = null } = args;
  await tx.lead.update({ where: { id: leadId }, data: { stage: to } });
  await tx.leadStageHistory.create({
    data: { leadId, fromStage: from, toStage: to, changedById },
  });
  await syncDefaultOpportunity(tx, leadId, to);
}
