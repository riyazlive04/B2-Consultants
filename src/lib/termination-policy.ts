import type { Prisma } from "@prisma/client";

/**
 * WHAT MOVES when someone leaves, and what never does.
 *
 * ══ THE RULE ════════════════════════════════════════════════════════════════════
 *
 *   MIGRATE FORWARD-LOOKING OWNERSHIP. NEVER REWRITE HISTORICAL ATTRIBUTION.
 *
 * Commission is derived at READ time (`server/commission-metrics.ts`) from
 * `Lead.assignedToId`, the latest `DiscoveryOutcome.enteredById` and `Enrollment.closerId`. So
 * reassigning leads wholesale would retroactively re-attribute PAST commission — taking earnings
 * off the person who left and crediting someone who never did the work. That is not a display
 * bug; it is money, and it is silent.
 *
 * Restricting migration to OPEN leads is what makes this safe: nothing has been paid on them, so
 * moving them decides who earns from here — which is exactly right. A WON lead keeps its owner
 * for ever.
 *
 * ══ WHY THIS IS A PURE MODULE ═══════════════════════════════════════════════════
 * These predicates ARE the policy. Living in `lib` rather than beside the queries means the
 * boundary between "open work" and "history" can be asserted in the test suite without a
 * database — and this is the boundary most worth asserting in the whole feature.
 *
 * ══ WHAT IS DELIBERATELY ABSENT ═════════════════════════════════════════════════
 * `CallLog`, `DiscoveryOutcome`, `LeadStageHistory`, `ActivityLog`, `AuditEntry`,
 * `Income/Expense.enteredById`, `TelecallerPayout`, `Enrollment.closerId`, `WhatsAppMessage`,
 * `Agreement.issuedById`, `DailyLog`, `OKR`, `Goal`, `RewardGrant`. Each records something that
 * happened. Three of them additionally carry unique constraints that make reassignment
 * impossible anyway — `RewardGrant @@unique([ruleId, teamProfileId, periodKey])`, `DailyLog
 * @@unique([userId, date])`, OKR's three-per-month rule — which is a good sign the line is in the
 * right place: you cannot merge two people's history, because two people's history is not one
 * person's.
 */

/** Stages that are settled business. A settled lead's owner is who earned on it. */
export const SETTLED_LEAD_STAGES = ["WON", "LOST"] as const;

export const openLeadWhere = (userId: string): Prisma.LeadWhereInput => ({
  deletedAt: null,
  assignedToId: userId,
  stage: { notIn: [...SETTLED_LEAD_STAGES] },
});

/**
 * Only slots in the FUTURE. A past slot records a call that did or did not happen; moving it
 * would rewrite whose call it was.
 */
export const futureSlotWhere = (userId: string, now: Date): Prisma.AppointmentSlotWhereInput => ({
  assignedToId: userId,
  startsAt: { gte: now },
});

export const futureSssWhere = (userId: string, now: Date): Prisma.SssSlotWhereInput => ({
  ownerId: userId,
  startsAt: { gte: now },
});

export const openTaskWhere = (userId: string): Prisma.ContactTaskWhereInput => ({
  deletedAt: null,
  assignedToId: userId,
  status: "OPEN",
});

/**
 * ABANDONED is settled too, not just WON/LOST — someone walked away from it, which is a decision
 * that already happened. Handing an abandoned deal to a successor would put work on their board
 * that the business had deliberately stopped doing.
 */
export const openOpportunityWhere = (userId: string): Prisma.OpportunityWhereInput => ({
  deletedAt: null,
  assignedToId: userId,
  status: "OPEN",
});

export const ownedCompanyWhere = (userId: string): Prisma.CompanyWhereInput => ({
  deletedAt: null,
  ownerId: userId,
});

/**
 * Journeys still being worked. A terminal journey is history; an active one is a prospect
 * mid-conversation who needs someone to pick the thread up.
 */
export const TERMINAL_JOURNEY_PHASES = ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] as const;

export const activeJourneyWhere = (userId: string): Prisma.OutreachJourneyWhereInput => ({
  phase: { notIn: [...TERMINAL_JOURNEY_PHASES] },
  OR: [{ respTouchpointId: userId }, { respDiscoId: userId }],
});
