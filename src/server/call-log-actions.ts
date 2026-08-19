"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { logActivity } from "./activity-log";
import { resolveStageAfterCall } from "@/lib/call-outcome";
import { clampCalledAt } from "@/lib/offline-calls";
import { syncDefaultOpportunity } from "./opportunity-sync";
import type { ActionResult } from "./finance-actions";

/**
 * Per-dial call logging - the fact behind the telecaller desk.
 *
 * Before this, "calls made" existed only as a DailyLog number the telecaller typed in at the
 * end of the day: an aggregate, self-reported, and unlinked to any lead. Nothing recorded that
 * a specific person rang a specific number, so "which of my leads still need a call today?"
 * had no answer. Each row here is one dial.
 *
 * Append-only, like DailyLog: a mis-logged call is corrected by logging another, never by
 * editing history - the counts a bonus is paid on must not be silently rewritable. Deletion is
 * Admin-only and exists for genuine mistakes (a test row, a double-tap), not for tidying.
 *
 * Gate: `pipeline` - the section Asma/Nilofer already have for lead work. A telecaller can log
 * a call against any lead they can see; the row stamps who they are from the session, never
 * from the form, so a call can't be logged in someone else's name.
 */

const CALL_OUTCOMES = [
  "SPOKE", "NO_ANSWER", "BUSY", "CALLBACK", "WRONG_NUMBER", "NOT_INTERESTED",
] as const;

const callSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /**
   * Where the conversation left the lead, when the specialist says so.
   *
   * Optional and permissive here on purpose: an empty string is the "leave it where it is"
   * default the form posts, and an unrecognised value is rejected downstream by
   * `resolveStageAfterCall` rather than failing the whole call log. Losing the RECORD of a call
   * because a stage select disagreed would be a strictly worse outcome than not moving the card.
   */
  nextStage: z.string().trim().max(40).optional().or(z.literal("")),
  /**
   * When the Call button was pressed, as the device saw it (ISO). The outcome form opens as the
   * call ends, so without this the logged time would be the END of the conversation plus however
   * long the notes took - and speed-to-lead would measure typing speed. Optional: the desks'
   * "Log outcome" button (no dial) posts nothing and gets the server clock. Clamped server-side
   * exactly like an offline replay - it can never sit in the future or reach back past the queue
   * age, so it cannot be used to flatter the five-minute number.
   */
  calledAt: z.string().trim().optional().or(z.literal("")),
});

const OUTCOME_LABELS: Record<string, string> = {
  SPOKE: "spoke to them",
  NO_ANSWER: "no answer",
  BUSY: "busy",
  CALLBACK: "asked to call back",
  WRONG_NUMBER: "wrong number",
  NOT_INTERESTED: "not interested",
};

function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Log one dial against a lead. `calledAt` is server-stamped - never trusted from the client. */
export async function logCall(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = callSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, stage: true } });
  if (!lead) return { ok: false, error: "Lead not found" };

  // Error Log L4: logging an outcome left the board untouched. Unambiguous outcomes move the
  // card by themselves; for everything else the specialist can now say where the conversation
  // landed, on this same form. See lib/call-outcome.ts for why SPOKE cannot be inferred, and
  // why the automatic move takes precedence over the select.
  const nextStage = resolveStageAfterCall(lead.stage, d.outcome, d.nextStage);

  // The dial instant, if the client sent one and it parses; otherwise now. See the schema note.
  const receivedAt = new Date();
  const claimed = d.calledAt ? new Date(d.calledAt) : null;
  const calledAt =
    claimed && !Number.isNaN(claimed.getTime()) ? clampCalledAt(claimed, receivedAt).calledAt : receivedAt;

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.callLog.create({
      data: {
        leadId,
        userId: session.user.id,
        outcome: d.outcome,
        notes: d.notes || null,
        calledAt,
      },
    });
    // Keep speed-to-lead honest: the first connected conversation IS first contact. Mirrors
    // markLeadContacted's rule - only the first one counts, so a later call can't reset the
    // clock and flatter the speed metric. Only SPOKE qualifies: a no-answer isn't contact.
    if (d.outcome === "SPOKE") {
      await tx.lead.updateMany({
        where: { id: leadId, contactedAt: null },
        data: { contactedAt: calledAt },
      });
    }
    // The stage move rides in the SAME transaction as the call log: a logged call that
    // failed to move the card is the bug being fixed, and two separate writes would just
    // reintroduce it under a narrower race.
    if (nextStage && nextStage !== lead.stage) {
      await tx.lead.update({ where: { id: leadId }, data: { stage: nextStage } });
      await tx.leadStageHistory.create({
        data: { leadId, fromStage: lead.stage, toStage: nextStage, changedById: session.user.id },
      });
      // Without this the Opportunities board keeps showing the deal in its old column -
      // the same drift every other stage-writing path calls this to avoid.
      await syncDefaultOpportunity(tx, leadId, nextStage);
    }
    return created;
  });

  await logActivity(session, {
    action: "call.log",
    section: "pipeline",
    entityType: "CallLog",
    entityId: row.id,
    // The stage move is named in the summary, not just the meta: this is the one action that
    // both records a call AND moves a card, and the founder's activity feed should not make
    // someone open the row to find out which happened.
    summary: nextStage
      ? `Logged a call with ${lead.name} - ${outcomeLabel(d.outcome)}, moved to ${LEAD_STAGE_LABELS[nextStage] ?? nextStage}`
      : `Logged a call with ${lead.name} - ${outcomeLabel(d.outcome)}`,
    meta: { outcome: d.outcome, leadId, ...(nextStage ? { toStage: nextStage } : {}) },
  });

  revalidatePath("/my-desk");
  revalidatePath("/pipeline");
  // The board colours its cards by the first call, so it has to hear about this one.
  revalidatePath("/opportunities");
  return { ok: true };
}

/** Remove a mis-logged call. Admin-only: history the team is paid on isn't self-serve editable. */
export async function deleteCallLog(id: string): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  if (session.role !== "ADMIN") {
    return { ok: false, error: "Only an admin can remove a logged call - log a correcting call instead." };
  }
  const removed = await prisma.callLog
    .delete({ where: { id }, include: { lead: { select: { name: true } } } })
    .catch(() => undefined);
  if (removed) {
    await logActivity(session, {
      action: "call.delete",
      section: "pipeline",
      entityType: "CallLog",
      entityId: removed.id,
      summary: `Removed a logged call with ${removed.lead.name} - ${outcomeLabel(removed.outcome)}`,
      meta: { outcome: removed.outcome, leadId: removed.leadId },
    });
  }
  revalidatePath("/my-desk");
  revalidatePath("/pipeline");
  return { ok: true };
}
