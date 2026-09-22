import type { LeadStage, OutreachPhase } from "@prisma/client";

/**
 * What to do when someone who is ALREADY in the database opts in again.
 *
 * The dedupe in `server/lead-intake.ts` is right to keep one row per human - two rows split that
 * person's calls, bookings, owner and commission. But until now the dedupe branches returned the
 * existing row and did nothing else: no owner, no clock, no stage change, not even a bumped
 * `updatedAt`. A prospect who went LOST in June and raised their hand three times this afternoon
 * produced no trace at all, because everything that makes a lead visible - `pickFirstCaller()`
 * and the `OutreachJourney` - only ran on the create path.
 *
 * That is not a small hole: 8,095 of the ~23.5k leads are LOST and 23,430 are unassigned, so most
 * of the base is in exactly the state where a return visit vanishes.
 *
 * This module is the DECISION only, kept pure so it can be tested without a database. The writes
 * live in `lead-intake.ts`, which is server-only.
 */

/**
 * Stages a returning opt-in may re-open.
 *
 * LOST only, deliberately. A lead in any live stage already has a caller working the ladder, and
 * resetting it to NEW_LEAD would yank the lead out from under that person mid-chase. DEPOSIT_PAID
 * and WON are customers, not leads. NEW_LEAD is absent because it needs no stage change - it still
 * picks up the owner and the restarted clock below.
 */
export const REOPENABLE_STAGES: readonly LeadStage[] = ["LOST"];

/**
 * Journey phases meaning "this chase has stopped", and so may have its clock restarted.
 *
 * A journey mid-chase carries its own live deadlines; restarting it would reset a running SLA to
 * zero and flatter the speed-to-lead numbers. COMPLETED is excluded on purpose - that outreach
 * succeeded, and a later opt-in does not undo it.
 */
export const DORMANT_PHASES: readonly OutreachPhase[] = ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ"];

export type ReturningLeadState = {
  stage: LeadStage;
  assignedToId: string | null;
  /** Soft-delete marker. An archived lead is archived on purpose. */
  deletedAt: Date | null;
  /** The lead's existing journey, or null when it has none (pre-SOP rows never got one). */
  journey: { phase: OutreachPhase; bookingId: string | null } | null;
  /** When the lead's stage last changed (latest stage-history row, else when it was created). */
  lastStageChangeAt?: Date | null;
  /** The lead has a BOOKED call still ahead of it - a quiet stage then is a wait, not a stall. */
  hasUpcomingBooking?: boolean;
  /** Injected for tests; defaults to the real clock. */
  now?: Date;
};

/**
 * A lead whose stage has not moved for this long is stale: an opt-in from them is a fresh start,
 * not a nudge to a live chase. Founder's rule, 22/09/2026.
 */
export const STALE_AFTER_DAYS = 14;

/** Customers, not leads - an opt-in never drags them back to the top of the funnel. */
const NEVER_REOPEN: readonly LeadStage[] = ["WON", "DEPOSIT_PAID"];

export type ReturningOptInPlan = {
  /**
   * Un-archive the lead (clear the soft-delete) before anything else.
   *
   * ── Why an archived lead IS resurrected by a fresh opt-in ──────────────────────────────
   * This used to be a hard stop ("somebody chose to archive this"). On 19/08/2026 it produced
   * the worst outcome the dedupe can: a card deleted from the board archived the lead, the same
   * person submitted the form again ninety seconds later, the dedupe matched them to the
   * archived row, the intro WhatsApp went out - and the person was invisible on every board and
   * desk, because every live read filters on `deletedAt`. A human had raised their hand and
   * nobody could see it.
   *
   * The concern the hard stop protected against - a flaky webhook redelivering one old
   * submission and undoing a deliberate archive - is handled on the redelivery branch, which
   * matches on the external record id and never re-opens. A NEW submission is the person, not
   * the webhook, and the person gets a fresh start: live, re-queued, back on the board. If they
   * were archived for cause, an admin re-archives with one click; the reverse mistake is silent.
   */
  restore: boolean;
  /** Move the stage back to NEW_LEAD (and write a stage-history row). */
  reopenStage: boolean;
  /** Run the assignment rotation - the lead currently has no owner. */
  needsOwner: boolean;
  /** Create the journey, or reset its clock to this opt-in. */
  restartJourney: boolean;
  /**
   * True when this opt-in actually put the lead back in front of a caller - i.e. any of the three
   * above. Drives the re-opt-in notification and the webhook's `reopened` flag; when false the
   * caller should still fill blanks, but nothing has changed that anyone needs to hear about.
   */
  reopened: boolean;
};

const INERT: ReturningOptInPlan = {
  restore: false,
  reopenStage: false,
  needsOwner: false,
  restartJourney: false,
  reopened: false,
};

/**
 * Decide what a fresh opt-in should do to an existing lead.
 *
 * One hard stop - the journey carries a booking: they booked, so they are not a cold lead to be
 * re-queued. The caller still fills in blank contact fields, which is why this returns a plan
 * rather than a bare boolean.
 *
 * An ARCHIVED lead is the opposite of a hard stop: it is restored and given the full fresh-start
 * treatment (see `restore` above). Its stage is reset whatever it was - an archived row has no
 * caller mid-chase to yank it away from - and its journey clock restarts from this opt-in.
 */
export function planReturningOptIn(state: ReturningLeadState): ReturningOptInPlan {
  if (state.deletedAt) {
    return {
      restore: true,
      reopenStage: state.stage !== "NEW_LEAD",
      needsOwner: state.assignedToId === null,
      restartJourney: true,
      reopened: true,
    };
  }
  /**
   * STALE: no stage change for STALE_AFTER_DAYS. The same fresh start an archived lead gets - back
   * to New Lead, clock restarted - because nobody has touched this lead in two weeks, so there is
   * no caller mid-chase to yank it away from. It overrides the booking hard stop below, which
   * exists for a CURRENT booking: a no-show from last month is history, not a reason to ignore
   * someone raising their hand today. A call still ahead of them is the one exception.
   */
  const now = state.now ?? new Date();
  const stale =
    !!state.lastStageChangeAt &&
    now.getTime() - state.lastStageChangeAt.getTime() >= STALE_AFTER_DAYS * 24 * 3600_000;
  if (stale && !state.hasUpcomingBooking && !NEVER_REOPEN.includes(state.stage)) {
    return {
      restore: false,
      reopenStage: state.stage !== "NEW_LEAD",
      needsOwner: state.assignedToId === null,
      restartJourney: true,
      reopened: true,
    };
  }

  if (state.journey?.bookingId) return INERT;

  const reopenStage = REOPENABLE_STAGES.includes(state.stage);
  const needsOwner = state.assignedToId === null;
  // No journey at all is the pre-SOP case: those rows predate the ladder, and without a journey the
  // lead is invisible to both the SOP queue and the L1 desk's SLA buckets.
  const restartJourney = state.journey === null || DORMANT_PHASES.includes(state.journey.phase);

  return {
    restore: false,
    reopenStage,
    needsOwner,
    restartJourney,
    reopened: reopenStage || needsOwner || restartJourney,
  };
}
