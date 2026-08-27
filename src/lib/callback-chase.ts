/**
 * The call-back chase - "I rang them, they didn't book, ring them again."
 *
 * ── The gap this closes ─────────────────────────────────────────────────────────
 * The L1 desk already listed leads that had opted in and never booked, but the list was a
 * STANDING condition: "has a journey, has no booking". Logging a call changed nothing about
 * that test, so the only thing keeping a just-rung lead off the screen was the global
 * `followUpRestHours` dial - one number shared with old leads and workshop follow-up, and with
 * no notion of how many times anyone had already tried.
 *
 * That left two questions unanswerable from the desk:
 *   • "which of these did I already speak to, and when is it fair to ring back?"
 *   • "how many times do we chase before we accept the answer is no?"
 *
 * This file answers both, as pure arithmetic over the call log. Nothing is stored: a chase
 * round IS a `CallLog` row, so the count cannot drift from what actually happened and there is
 * no second source of truth to repair when someone deletes a mis-logged call.
 *
 * ── The loop, in the founder's words (27/08/2026) ────────────────────────────────
 *   "If the telecallers call and request the optin leads to book the meeting but didnt booked,
 *    then we need a report on each telecaller dashboard showing these people you have already
 *    called but not yet booked the meeting, so you can call back. This should show after 4 hours
 *    of the call and not booked. Then if the telecaller calls again, do not show until next 4
 *    hours. Then show it after 4 hours. Give admin an option to setup how many times these optin
 *    leads should show like this in telecaller dashboard."
 *
 * So `maxCallbacks` counts APPEARANCES on the desk, not dials. A lead that has been spoken to
 * once and never rung again has made zero call-backs and is owed its first; the cap is reached
 * when the desk has asked for a call-back that many times and the prospect still has no booking.
 *
 * Pure and dependency-free on purpose - same stance as `outreach-sla.ts`. The timings are what
 * the team will argue about, so they must be testable without a database.
 */

/** The `CallLogOutcome` values this file reasons about, as plain strings so it stays isomorphic. */
export type CallOutcomeLike = string;

/**
 * Outcomes that END the chase on the spot, whatever the round count says.
 *
 * These are the two dial outcomes with exactly one meaning, and `lib/call-outcome.ts` already
 * moves the lead to LOST when either is logged. Listing them here is what stops this engine
 * then "closing" a lead that is already closed, and - more importantly - stops it ringing back
 * someone who has said no and messaging them a booking nudge.
 */
const REFUSALS = new Set<CallOutcomeLike>(["NOT_INTERESTED", "WRONG_NUMBER"]);

/** The only outcome that opens the chase. See `summariseCalls`. */
const CONNECTED: CallOutcomeLike = "SPOKE";

/**
 * The lead stages a call-back chase may run in - and, identically, the stages the close-out is
 * allowed to move a lead OUT of.
 *
 * ONE list, shared by the desk and the sweep, because the alternative is the two disagreeing
 * about who is in the chase: a lead the desk lists but the sweep will not close sits at
 * "exhausted" forever, and a lead the sweep closes but the desk never listed is a prospect given
 * up on without anybody being asked to ring them.
 *
 * The set is the early funnel and nothing else. A lead sent to a workshop or already booked into
 * a call is being worked by a different part of the process, and telling that prospect "we did
 * not hear back, we are closing your file" would be false.
 *
 * `DISCO_NOT_BOOKED` is in the list even though it is where the chase ENDS: a setter can choose
 * it by hand on the call-log form, and a lead parked there by a human still deserves its
 * call-backs before anyone gives up on it.
 */
export const CHASEABLE_STAGES = ["NEW_LEAD", "WHATSAPP_SENT", "DISCO_NOT_BOOKED"] as const;

export type ChaseableStage = (typeof CHASEABLE_STAGES)[number];

export function isChaseableStage(stage: string): stage is ChaseableStage {
  return (CHASEABLE_STAGES as readonly string[]).includes(stage);
}

export type CallbackChaseConfig = {
  /** Hours a lead rests after a call before it asks to be rung again. */
  gapHours: number;
  /** How many times the desk may ask for a call-back before the chase is given up. */
  maxCallbacks: number;
  /** Whether an exhausted chase closes the lead to Cancelled/Unqualified. */
  closeWhenExhausted: boolean;
  /** Whether the close-out also sends the prospect a WhatsApp. */
  notifyOnClose: boolean;
};

export const DEFAULT_CALLBACK_CHASE: CallbackChaseConfig = {
  gapHours: 4,
  maxCallbacks: 3,
  closeWhenExhausted: true,
  notifyOnClose: true,
};

export type CallbackState =
  /** Never connected, so the SLA queue still owns this lead. Not a call-back yet. */
  | "NOT_STARTED"
  /** Rung recently. Off the list until the gap elapses. */
  | "RESTING"
  /** The gap has elapsed and a call-back is owed. This is what the desk lists. */
  | "DUE"
  /** Every call-back has been made and the prospect still has not booked. */
  | "EXHAUSTED"
  /** They said no, or the number is wrong. The chase is over and the lead is already LOST. */
  | "REFUSED";

export type CallSummary = {
  /** First connected conversation - the instant the chase begins. */
  firstSpokeAt: Date | null;
  /** Most recent dial of any outcome. A call-back that rang out still restarts the gap. */
  lastCallAt: Date | null;
  /** Dials logged AFTER the first connection. Each one answers a call-back the desk asked for. */
  callbacksMade: number;
  /** Outcome of the most recent dial - the refusal test. */
  lastOutcome: CallOutcomeLike | null;
};

export const EMPTY_CALL_SUMMARY: CallSummary = {
  firstSpokeAt: null,
  lastCallAt: null,
  callbacksMade: 0,
  lastOutcome: null,
};

/**
 * Reduce a lead's dials to the four facts the chase needs.
 *
 * Order-independent: the rows are scanned rather than assumed sorted, because offline calls sync
 * out of order (`CallLog.syncedAt`) and a queue flushed after a lost connection can arrive with
 * yesterday's dial behind today's.
 *
 * `callbacksMade` counts dials strictly AFTER the first connection. The pitch call itself is not
 * a call-back - it is the call being called back FROM - so a lead spoken to once is owed its
 * first chase, not its second.
 */
export function summariseCalls(
  calls: readonly { calledAt: Date; outcome: CallOutcomeLike }[],
): CallSummary {
  let firstSpokeAt: Date | null = null;
  let lastCallAt: Date | null = null;
  let lastOutcome: CallOutcomeLike | null = null;

  for (const c of calls) {
    if (c.outcome === CONNECTED && (!firstSpokeAt || c.calledAt < firstSpokeAt)) firstSpokeAt = c.calledAt;
    if (!lastCallAt || c.calledAt > lastCallAt) {
      lastCallAt = c.calledAt;
      lastOutcome = c.outcome;
    }
  }

  // Counted only once the chase has actually started. Dials made BEFORE anyone got through are
  // the SLA queue's business (the lead is still owed a connection), and counting them here would
  // burn a prospect's call-backs on attempts that never reached them.
  const callbacksMade = firstSpokeAt
    ? calls.filter((c) => c.calledAt > firstSpokeAt!).length
    : 0;

  return { firstSpokeAt, lastCallAt, callbacksMade, lastOutcome };
}

export type CallbackVerdict = {
  state: CallbackState;
  /** Call-backs already answered by a dial. */
  callbacksMade: number;
  /** Which call-back this lead is waiting on - `callbacksMade + 1`, capped for display. */
  round: number;
  /** The founder's cap, carried so the desk can render "call-back 2 of 3". */
  maxCallbacks: number;
  lastCallAt: Date | null;
  /**
   * When this lead next appears on the call-back list, or when its chase ran out.
   *
   * Non-null in every state that has a next instant, INCLUDING `EXHAUSTED` - there the instant
   * is when the last gap closed, which is what the close-out sweep tests against. Null only when
   * nothing is pending: never connected, or refused.
   */
  nextDueAt: Date | null;
  /** Milliseconds until `nextDueAt`; negative once elapsed. Zero when there is nothing to wait for. */
  msToNextDue: number;
};

/**
 * Grade one lead's chase.
 *
 * `booked` short-circuits nothing here on purpose - the caller decides what a booking means,
 * because "has a booking" is a join it already has in hand and re-passing it through this
 * signature would make the pure rules depend on a schema shape. Callers must skip booked leads.
 */
export function callbackVerdict(
  summary: CallSummary,
  cfg: CallbackChaseConfig,
  now: Date,
): CallbackVerdict {
  const { firstSpokeAt, lastCallAt, callbacksMade, lastOutcome } = summary;
  const base = {
    callbacksMade,
    round: Math.min(callbacksMade + 1, Math.max(cfg.maxCallbacks, 1)),
    maxCallbacks: cfg.maxCallbacks,
    lastCallAt,
  };

  // Nobody has got through yet. The five-minute / same-day buckets still own this lead, and
  // putting it here as well would list the same person in two work piles.
  if (!firstSpokeAt || !lastCallAt) {
    return { ...base, state: "NOT_STARTED", nextDueAt: null, msToNextDue: 0 };
  }

  // A refusal outranks the clock and the cap. `lib/call-outcome.ts` has already moved the lead
  // to LOST; ringing back or messaging would be contradicting the prospect to their face.
  if (lastOutcome && REFUSALS.has(lastOutcome)) {
    return { ...base, state: "REFUSED", nextDueAt: null, msToNextDue: 0 };
  }

  const nextDueAt = new Date(lastCallAt.getTime() + cfg.gapHours * 3_600_000);
  const msToNextDue = nextDueAt.getTime() - now.getTime();
  const elapsed = msToNextDue <= 0;

  // Still inside the rest window. This is the "do not show until the next 4 hours" half of the
  // rule, and it applies identically whether the chase has rounds left or has just run out -
  // a lead rung two minutes ago is not owed a call-back OR a closing message.
  if (!elapsed) return { ...base, state: "RESTING", nextDueAt, msToNextDue };

  // The gap has closed. Either there is a call-back left in the budget, or there is not.
  const state: CallbackState = callbacksMade >= cfg.maxCallbacks ? "EXHAUSTED" : "DUE";
  return { ...base, state, nextDueAt, msToNextDue };
}

/**
 * How the desk labels a row: "Call-back 2 of 3".
 *
 * A separate function rather than a template in the component because the sweep's activity-log
 * summary says the same thing, and the two drifting would make the feed and the screen disagree
 * about how many chances a prospect was given.
 */
export function callbackRoundLabel(v: Pick<CallbackVerdict, "round" | "maxCallbacks">): string {
  return `Call-back ${v.round} of ${v.maxCallbacks}`;
}

/** Whole hours since a call, for the "last called 6h ago" line. Floors, so 3h59m reads as 3h. */
export function hoursSince(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 3_600_000));
}
