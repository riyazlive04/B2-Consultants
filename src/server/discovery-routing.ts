"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { istToday, parseDateInput, ymdInZone, IST_ZONE } from "@/lib/dates";
import { stageAfterDiscovery } from "@/lib/call-outcome";
import { formatDateTimeInZone } from "@/lib/format";
import { logActivity } from "./activity-log";
import { refreshJourney } from "./outreach";
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
  /** SOP: "book the sales call before closing the discovery call". IST wall-clock, as typed. */
  sssAt: z.string().optional().or(z.literal("")),
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
  /** The SOP's "Qualified? Yes" branch - the one route that hands the prospect to Level 3. */
  const routesToLevel3 = d.outcome === "QUALIFIED_FOR_SSS";

  /**
   * The Success Strategy Session the specialist agreed on the call.
   *
   * A datetime-local carries no zone and the specialist types IST, so the fixed +05:30 offset is
   * exact (India has no DST) - the same conversion `setHighlyQualified` and `setContactedAt` do.
   * Optional on purpose: a specialist who could not pin a time still routes the prospect, who then
   * waits on the SSS calendar's "Needs an SSS time" list. No time means no ladder, which is the
   * right way round - the reminders name a date, and inventing one is worse than sending nothing.
   */
  let sssAt: Date | null = null;
  if (routesToLevel3 && d.sssAt) {
    const when = new Date(`${d.sssAt}:00+05:30`);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "That isn't a valid SSS date/time" };
    // A session in the past would arm the whole ladder at once and tell the prospect their
    // Success Strategy Session "is scheduled for" a date that has already gone.
    if (when.getTime() <= Date.now()) return { ok: false, error: "Pick an SSS date/time in the future" };
    sssAt = when;
  }

  // The journey is what the SOP engine runs on. It may not exist - a lead imported straight into
  // a booking never had one - and that is not a reason to refuse the outcome.
  const journey = routesToLevel3
    ? await prisma.outreachJourney.findUnique({ where: { leadId: d.leadId }, select: { id: true } })
    : null;

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
        // The PRD column is a date, and it must be the IST calendar day the session falls on -
        // handing it the raw instant would file an early-morning IST session under the day before.
        sssDate: sssAt ? parseDateInput(ymdInZone(sssAt, IST_ZONE)) : null,
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

    /**
     * ── SOP Step 18: the hand-off to Level 3. ──
     *
     * Routing a call "Ready - route to Level 3" IS the Highly Qualified verdict, and until now it
     * was recorded nowhere the engine could see: `highlyQualified` and `sssAt` stayed null, so
     * SOP Steps 19-22 (the 24h/12h/6h reminders and the 3h confirmation call before the Success
     * Strategy Session) could not run for anybody, and the prospect never reached the SSS
     * calendar's "Needs an SSS time" list either.
     *
     * Driven by the ROUTE, not by the "Highly qualified" tick on the same form. The tick feeds a
     * PRD metric and is writable by any specialist; the journey flag is what decides whether real
     * messages go out, and hanging it off the tick would quietly widen who can start a ladder.
     */
    if (journey) {
      await tx.outreachJourney.update({
        where: { id: journey.id },
        data: { highlyQualified: true, highlyQualifiedAt: new Date(), ...(sssAt ? { sssAt } : {}) },
      });
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

  // Re-plan immediately so Step 19 is waiting in the queue when the specialist gets there,
  // rather than up to a cron tick later - the first SSS reminder is due 24h before the session,
  // and a session booked for tomorrow morning cannot afford the wait.
  if (journey) await refreshJourney(journey.id).catch(() => undefined);

  await logActivity(session, {
    action: "discovery.route",
    section: "pipeline",
    entityType: "DiscoveryOutcome",
    entityId: outcomeRow.id,
    summary: `Discovery call with ${lead.name} - ${OUTCOME_LABELS[d.outcome] ?? d.outcome}${
      sssAt ? ` - SSS on ${formatDateTimeInZone(sssAt, IST_ZONE)} IST` : ""
    }`,
    meta: { outcome: d.outcome, leadId: d.leadId, stage: nextStage, sssAt: sssAt?.toISOString() ?? null },
  });

  revalidatePath("/my-desk");
  revalidatePath("/pipeline");
  // Bookings carries the SSS calendar and its "Needs an SSS time" list; Outreach carries the
  // queue the SSS ladder's steps now appear in.
  revalidatePath("/bookings");
  if (journey) revalidatePath("/outreach");
  return { ok: true };
}
