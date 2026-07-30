/**
 * What logging a call outcome does to the lead's stage (Error Log L4).
 *
 * Logging an outcome used to leave the pipeline card exactly where it was, so the board
 * drifted out of date the moment anyone actually worked their list — and the JD's
 * "pipeline updated before end of day: 100%" target was unreachable without doing the same
 * work twice, once as a call log and once as a drag on the board.
 *
 * ADVANCE ONLY WHERE THE OUTCOME IS UNAMBIGUOUS. That is the whole design rule here, and
 * it is why this returns null far more often than not:
 *
 *   • "Not interested" and "Wrong number" have exactly one meaning — the lead is dead.
 *     Nothing else the specialist might have intended fits, so moving it is safe.
 *   • "Spoke to them" does NOT. A conversation can end in a booking, a callback, a
 *     workshop referral or a flat no, and the stage that follows differs for each. Guessing
 *     would silently mis-file leads, which is worse than leaving the card still to be moved:
 *     a stale card is visible, a wrongly-advanced one is not.
 *   • "No answer" / "Busy" / "Callback" are not outcomes at all, they are non-events. The
 *     lead has not moved because nothing happened to it.
 *
 * Pure so the rule can be unit-tested and read without a database — `server/call-log-actions.ts`
 * applies it, and only ever forwards, never rewinds (see `stageAfterCall`'s terminal guard).
 */

import type { LeadStage } from "@prisma/client";

/** Stages that are already finished business — a call outcome must never move these. */
const TERMINAL_STAGES = new Set<LeadStage>(["WON", "LOST"]);

/**
 * The stage a lead should move to after this outcome, or null to leave it alone.
 *
 * `current` matters only to protect terminal stages: a WON lead that gets a courtesy call
 * logged as "not interested" must not be dragged back to LOST, which would corrupt both the
 * conversion count and the commission it was paid on.
 */
export function stageAfterCall(current: LeadStage, outcome: string): LeadStage | null {
  if (TERMINAL_STAGES.has(current)) return null;

  switch (outcome) {
    case "NOT_INTERESTED":
    case "WRONG_NUMBER":
      return "LOST";
    default:
      // SPOKE, NO_ANSWER, BUSY, CALLBACK — the specialist decides. See the note above.
      return null;
  }
}

/**
 * Whether an outcome closes an old lead with a decision, which is what the JD's
 * "30 old leads per day, each closed with interested / not interested" actually counts.
 * A dial that nobody picked up is not a lead worked.
 */
export function closesWithDecision(outcome: string): boolean {
  return outcome === "SPOKE" || outcome === "NOT_INTERESTED";
}

/**
 * The stage a DISCOVERY call outcome moves the lead to (rebuild spec §7's routing panel).
 *
 * Unlike a dial outcome, every one of these IS unambiguous — the Discovery Specialist has
 * just had the whole conversation and is recording where it landed, so there is nothing
 * left to guess. That is why this always returns a stage and `stageAfterCall` mostly does
 * not; the two look similar and mean opposite things.
 *
 * NO_SHOW is the exception that proves it: the prospect never appeared, so the outcome
 * describes the appointment rather than the person, and the lead goes back to being chased.
 */
export function stageAfterDiscovery(outcome: string): LeadStage | null {
  switch (outcome) {
    case "QUALIFIED_FOR_SSS":
      return "SSS_BOOKED";
    case "NOT_QUALIFIED_FOR_SSS":
      return "LOST";
    case "SENT_TO_WORKSHOP":
      return "SENT_TO_WORKSHOP";
    case "NO_SHOW":
      return "NO_SHOW";
    case "FOLLOW_UP_NEEDED":
      return "DISCO_COMPLETED";
    default:
      return null;
  }
}
