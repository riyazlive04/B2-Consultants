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
 * Where a Level 1 conversation can leave a lead — the stages the SETTER is allowed to choose
 * when logging a call.
 *
 * ── Why a short list rather than the whole enum ──────────────────────────────────
 * `stageAfterCall` refuses to guess what "spoke to them" meant, which is right — but it left
 * the specialist with no way to say what it meant either, so the card stayed put and the JD's
 * "pipeline updated by EOD: 100%" target was measured on the desk while the only control that
 * could move it lived on another screen. This is that control.
 *
 * The list is the Level 1 job, not the funnel. A setter's conversation ends in exactly one of
 * these four places; SSS, proposal, deposit and WON belong to Levels 2 and 3 and are reached by
 * their own actions. Offering all fifteen stages on a call-logging modal is how a lead gets
 * filed under "Deposit paid" by a mis-tap — and a wrongly-advanced card is invisible, whereas a
 * stale one is not.
 *
 * WON and LOST are deliberately absent. LOST is already reachable — it is what "Not interested"
 * and "Wrong number" mean, applied automatically — and WON requires money to have arrived,
 * which no phone call can establish.
 */
export const SETTER_NEXT_STAGES = [
  "DISCO_BOOKED",
  "DISCO_NOT_BOOKED",
  "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP",
] as const;

export type SetterNextStage = (typeof SETTER_NEXT_STAGES)[number];

export function isSetterNextStage(value: string): value is SetterNextStage {
  return (SETTER_NEXT_STAGES as readonly string[]).includes(value);
}

/**
 * The stage a logged call should leave the lead on, given both the outcome and whatever the
 * specialist explicitly chose.
 *
 * ── Precedence, and why it is this way round ─────────────────────────────────────
 * The AUTOMATIC move wins. "Not interested" means the lead is dead whatever is sitting in a
 * select the specialist may not have looked at — and the two outcomes that move automatically
 * are exactly the two with only one possible meaning. Letting a stale dropdown value override
 * them would resurrect a lead the specialist had just closed.
 *
 * An explicit choice only applies where the app had no opinion, which is the case this exists
 * for. It is still bounded: `isSetterNextStage` rejects anything outside the Level 1 list, and
 * the terminal guard means a WON or LOST lead cannot be dragged back by logging a call against
 * it — the same protection `stageAfterCall` already gives.
 */
export function resolveStageAfterCall(
  current: LeadStage,
  outcome: string,
  chosen: string | null | undefined,
): LeadStage | null {
  const automatic = stageAfterCall(current, outcome);
  if (automatic) return automatic;
  if (TERMINAL_STAGES.has(current)) return null;
  if (!chosen || !isSetterNextStage(chosen)) return null;
  return chosen === current ? null : chosen;
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
