import "server-only";
import { prisma } from "@/lib/prisma";
import {
  activeJourneyWhere,
  futureSlotWhere,
  futureSssWhere,
  openLeadWhere,
  openOpportunityWhere,
  openTaskWhere,
  ownedCompanyWhere,
} from "@/lib/termination-policy";

/**
 * Offboarding a team member: what they still hold, and what moves.
 *
 * ══ THE RULE THAT GOVERNS EVERYTHING HERE ═══════════════════════════════════════
 *
 *   MIGRATE FORWARD-LOOKING OWNERSHIP. NEVER REWRITE HISTORICAL ATTRIBUTION.
 *
 * Commission is derived at READ time (`commission-metrics.ts`) from `Lead.assignedToId`, the
 * latest `DiscoveryOutcome.enteredById` and `Enrollment.closerId`. So reassigning leads wholesale
 * would retroactively re-attribute PAST commission - taking earnings off the person who left and
 * crediting them to someone who never did the work. That is not a display bug; it is money.
 *
 * Restricting migration to OPEN leads is what makes this safe: nothing has been paid on them yet,
 * so moving them decides who earns from here, which is exactly right. A WON lead keeps its owner
 * forever.
 *
 * The same reasoning applies to every category below - the question is never "does this row point
 * at them" but "is this a claim about the past, or a job still to be done".
 *
 * ══ WHAT IS DELIBERATELY LEFT ALONE ═════════════════════════════════════════════
 * `CallLog.userId`, `DiscoveryOutcome.enteredById`, `LeadStageHistory`, `ActivityLog`,
 * `AuditEntry`, `Income/Expense.enteredById`, `TelecallerPayout`, `Enrollment.closerId` on closed
 * deals, `WhatsAppMessage.sentById`, `Agreement.issuedById`, `DailyLog`, `OKR`, `Goal` and
 * `RewardGrant`. Every one is a record of something that happened. Three of them additionally
 * carry unique constraints that make naive reassignment impossible anyway - `RewardGrant`'s
 * `@@unique([ruleId, teamProfileId, periodKey])`, `DailyLog`'s `@@unique([userId, date])`, and
 * OKR's three-per-person-per-month rule - which is a good sign the line is drawn in the right
 * place: you cannot merge two people's history because two people's history is not one person's.
 */

/** One kind of work a departing person holds. */
export type OwnershipCategory = {
  key: string;
  /** Shown in the dialog. */
  label: string;
  /** Why this moves - the founder is deciding, so they get the reason. */
  detail: string;
  count: number;
};

export type OwnershipInventory = {
  categories: OwnershipCategory[];
  /** Sum across categories - the headline "N things need a new owner". */
  total: number;
};

/** What this person still holds, as counts, for the confirm step. */
export async function getOwnershipInventory(userId: string, now = new Date()): Promise<OwnershipInventory> {
  const [leads, slots, sss, tasks, opportunities, journeys, companies] = await Promise.all([
    prisma.lead.count({ where: openLeadWhere(userId) }),
    prisma.appointmentSlot.count({ where: futureSlotWhere(userId, now) }),
    prisma.sssSlot.count({ where: futureSssWhere(userId, now) }),
    prisma.contactTask.count({ where: openTaskWhere(userId) }),
    prisma.opportunity.count({ where: openOpportunityWhere(userId) }),
    prisma.outreachJourney.count({ where: activeJourneyWhere(userId) }),
    prisma.company.count({ where: ownedCompanyWhere(userId) }),
  ]);

  const categories: OwnershipCategory[] = [
    { key: "leads", label: "Open leads", detail: "Not yet won or lost, so nobody has been paid on them.", count: leads },
    { key: "slots", label: "Future discovery slots", detail: "Calls still to happen in their calendar.", count: slots },
    { key: "sss", label: "Future SSS slots", detail: "Sales calls still to happen.", count: sss },
    { key: "tasks", label: "Open tasks", detail: "Anything not yet done.", count: tasks },
    { key: "opportunities", label: "Open opportunities", detail: "Deals still in play.", count: opportunities },
    { key: "journeys", label: "Active outreach journeys", detail: "Prospects mid-conversation on the SOP ladder.", count: journeys },
    { key: "companies", label: "Companies owned", detail: "Account ownership in the CRM.", count: companies },
  ];

  return { categories, total: categories.reduce((s, c) => s + c.count, 0) };
}

export type MigrationResult = Record<string, number>;

/**
 * Where a departing person's OPEN LEADS go.
 *
 *   "successor" - onto the named replacement, the original behaviour.
 *   "pool"      - back to unassigned, to be handed out from Pipeline → Leads → Hand out leads.
 *
 * ── Why "ownerless" is the right answer sometimes ────────────────────────────────
 * This module's dialog is built on "never leave work ownerless", and that rule is still right for
 * slots, tasks, opportunities and companies: each is one commitment to one person, and a calendar
 * slot nobody owns is a call nobody turns up to.
 *
 * Leads are different, and the difference is VOLUME. When the person leaving carried 80% of the
 * first-call rotation, "hand it to the successor" moves thousands of leads onto one desk in a
 * single transaction. Nothing about that queue is workable, and a lead buried at position 3,000
 * of someone else's backlog is not more owned than an unassigned one - it is less, because it now
 * LOOKS handled. The unassigned pool is the honest state: visible, counted, and the one thing the
 * hand-out flow and the auto-assign rate are built to drain at a pace the team can absorb.
 *
 * The distinction that makes this safe is that the pool is a PLACE, whereas a lead stranded on a
 * deactivated login is a leak. Nothing here can produce the second.
 */
export type LeadDestination = "successor" | "pool";

/**
 * Move the forward-looking work to the successor, in ONE transaction.
 *
 * All-or-nothing on purpose: a partial migration would leave some of a departed person's queue
 * with them and some with their replacement, and nothing on screen would say which. Recovering
 * from that by hand means knowing what the first attempt managed, which nobody would.
 *
 * Returns per-category counts so the audit entry can state exactly what moved rather than
 * "reassigned their work".
 */
export async function migrateOwnership(
  fromUserId: string,
  toUserId: string | null,
  leadDestination: LeadDestination = "successor",
  now = new Date(),
): Promise<MigrationResult> {
  // Leads are the only category with a destination that is not a person. Everything else is a
  // commitment one human owes, so with no successor there is nothing to move - and the caller
  // guarantees those categories are empty before allowing that combination.
  if (!toUserId && leadDestination !== "pool") {
    throw new Error("migrateOwnership needs a successor unless leads are released to the pool");
  }

  return prisma.$transaction(async (tx) => {
    const none = { count: 0 };
    const [leads, slots, sss, tasks, opportunities, companies] = await Promise.all([
      // `null` releases the lead to the unassigned pool - see `LeadDestination`.
      tx.lead.updateMany({
        where: openLeadWhere(fromUserId),
        data: { assignedToId: leadDestination === "pool" ? null : toUserId },
      }),
      toUserId ? tx.appointmentSlot.updateMany({ where: futureSlotWhere(fromUserId, now), data: { assignedToId: toUserId } }) : none,
      toUserId ? tx.sssSlot.updateMany({ where: futureSssWhere(fromUserId, now), data: { ownerId: toUserId } }) : none,
      toUserId ? tx.contactTask.updateMany({ where: openTaskWhere(fromUserId), data: { assignedToId: toUserId } }) : none,
      toUserId ? tx.opportunity.updateMany({ where: openOpportunityWhere(fromUserId), data: { assignedToId: toUserId } }) : none,
      toUserId ? tx.company.updateMany({ where: ownedCompanyWhere(fromUserId), data: { ownerId: toUserId } }) : none,
    ]);

    // The two journey roles are separate columns, so they need separate updates - a single
    // `OR` where-clause cannot say WHICH column to rewrite.
    const touchpoints = toUserId
      ? await tx.outreachJourney.updateMany({
          where: { ...activeJourneyWhere(fromUserId), respTouchpointId: fromUserId },
          data: { respTouchpointId: toUserId },
        })
      : none;
    const discos = toUserId
      ? await tx.outreachJourney.updateMany({
          where: { ...activeJourneyWhere(fromUserId), respDiscoId: fromUserId },
          data: { respDiscoId: toUserId },
        })
      : none;

    return {
      // Two different keys on purpose: the activity log prints these verbatim, and "12 leads" next
      // to a successor's name would read as though someone now owns them when nobody does.
      ...(leadDestination === "pool"
        ? { "leads released to the pool": leads.count }
        : { leads: leads.count }),
      slots: slots.count,
      sss: sss.count,
      tasks: tasks.count,
      opportunities: opportunities.count,
      companies: companies.count,
      journeys: touchpoints.count + discos.count,
    };
  });
}
