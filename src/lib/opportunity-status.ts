import type { LeadStage, OpportunityStatus } from "@prisma/client";

/**
 * The Opportunity status a bridged (default-pipeline) lead stage implies.
 *
 * Shared by BOTH write-through directions so `/pipeline` (Lead.stage) and `/opportunities`
 * (Opportunity.stageId/status) can never disagree (issue 1.5):
 *   - opportunities-actions.moveOpportunity   — opp board → Lead.stage
 *   - pipeline-actions.syncDefaultOpportunity — Pipeline board → the lead's default opportunity
 *
 * Pure and isomorphic (no "use server"), so a server action can export it — a "use server"
 * module may only export async functions, so the mapping can't live in either actions file.
 */
export function statusForLegacyStage(legacy: LeadStage | null): OpportunityStatus {
  if (legacy === "WON") return "WON";
  if (legacy === "LOST") return "LOST";
  if (legacy === "NO_SHOW") return "ABANDONED";
  return "OPEN";
}
