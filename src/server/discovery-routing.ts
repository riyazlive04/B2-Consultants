"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { istToday } from "@/lib/dates";
import { stageAfterDiscovery } from "@/lib/call-outcome";
import { logActivity } from "./activity-log";
import { syncDefaultOpportunity } from "./opportunity-sync";
import type { ActionResult } from "./finance-actions";

/**
 * The Discovery Specialist's routing panel (rebuild spec §7).
 *
 * One action records the whole result of a discovery call: the outcome, the BANT reading,
 * the lead's new stage, and the booking's settled status. They move together in a single
 * transaction because a half-recorded call is exactly the state the dashboards cannot
 * describe - an outcome with a stale stage is what made "pipeline updated: 100%"
 * unreachable, and a stage with no outcome breaks the conversion metrics.
 *
 * Distinct from `pipeline-actions.createOutcome`, which is the Admin's full data-entry form
 * over any lead on any date. This one is the specialist's own post-call action on TODAY's
 * call, and it is the only path that also moves the pipeline.
 */

const ROUTE_OUTCOMES = [
  "QUALIFIED_FOR_SSS",
  "NOT_QUALIFIED_FOR_SSS",
  "SENT_TO_WORKSHOP",
  "FOLLOW_UP_NEEDED",
  "NO_SHOW",
] as const;

const routeSchema = z.object({
  leadId: z.string().min(1),
  bookingId: z.string().optional().or(z.literal("")),
  outcome: z.enum(ROUTE_OUTCOMES),
  highlyQualified: z.string().optional(),
  bantBudget: z.string().optional(),
  bantAuthority: z.string().optional(),
  bantNeed: z.string().optional(),
  bantTimeline: z.string().optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

const OUTCOME_LABELS: Record<string, string> = {
  QUALIFIED_FOR_SSS: "routed to Level 3",
  NOT_QUALIFIED_FOR_SSS: "not qualified",
  SENT_TO_WORKSHOP: "sent to workshop",
  FOLLOW_UP_NEEDED: "follow-up needed",
  NO_SHOW: "no show",
};

/** The booking status a routing decision settles the appointment at. */
function bookingStatusFor(outcome: string): "COMPLETED" | "NO_SHOW" {
  return outcome === "NO_SHOW" ? "NO_SHOW" : "COMPLETED";
}

export async function routeDiscoveryCall(form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = routeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  }
  const d = parsed.data;

  const lead = await prisma.lead.findUnique({
    where: { id: d.leadId },
    select: { id: true, name: true, stage: true },
  });
  if (!lead) return { ok: false, error: "Lead not found" };

  const nextStage = stageAfterDiscovery(d.outcome);
  const on = (v: string | undefined) => v === "on";

  const outcomeRow = await prisma.$transaction(async (tx) => {
    const created = await tx.discoveryOutcome.create({
      data: {
        leadId: d.leadId,
        callDate: istToday(),
        outcome: d.outcome,
        highlyQualified: on(d.highlyQualified),
        bantBudget: on(d.bantBudget),
        bantAuthority: on(d.bantAuthority),
        bantNeed: on(d.bantNeed),
        bantTimeline: on(d.bantTimeline),
        notes: d.notes || null,
        enteredById: session.user.id,
      },
    });

    if (nextStage && nextStage !== lead.stage) {
      await tx.lead.update({ where: { id: d.leadId }, data: { stage: nextStage } });
      await tx.leadStageHistory.create({
        data: { leadId: d.leadId, fromStage: lead.stage, toStage: nextStage, changedById: session.user.id },
      });
      await syncDefaultOpportunity(tx, d.leadId, nextStage);
    }

    // Settle the appointment so it leaves the chase list and lands in the show-rate
    // denominator with a real verdict rather than sitting at BOOKED for ever.
    if (d.bookingId) {
      await tx.bookingRequest.updateMany({
        where: { id: d.bookingId },
        data: { status: bookingStatusFor(d.outcome) },
      });
    }

    return created;
  });

  await logActivity(session, {
    action: "discovery.route",
    section: "pipeline",
    entityType: "DiscoveryOutcome",
    entityId: outcomeRow.id,
    summary: `Discovery call with ${lead.name} - ${OUTCOME_LABELS[d.outcome] ?? d.outcome}`,
    meta: { outcome: d.outcome, leadId: d.leadId, stage: nextStage },
  });

  revalidatePath("/my-desk");
  revalidatePath("/pipeline");
  revalidatePath("/bookings");
  return { ok: true };
}
