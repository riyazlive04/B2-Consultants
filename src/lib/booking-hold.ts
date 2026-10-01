import { MINUTE_MS } from "./duration";
import type { BookingRulesConfig } from "./config-schema";

/**
 * The hold a booked slot is under while we wait for the prospect to reply YES.
 *
 * WHY THIS IS A THING YOU CAN SEE. The slot was always held - a booked slot is `BOOKED` and the
 * public form never offers it to anyone else - but nothing said for how long or until when. On the
 * week calendar an unconfirmed hold and a confirmed call were the same blue card with a different
 * coloured dot, so the one question the confirm-or-cancel loop exists to answer ("is this slot
 * really taken, and when do I get it back if not?") could not be answered by looking at it.
 *
 * Pure on purpose: the engine's own cutoffs live in server/booking-automation.ts and can only be
 * read by running it. These two functions restate the SAME arithmetic so a screen can show the
 * moment before it arrives, and tests can pin it.
 *
 * ONE LIMIT, STATED PLAINLY: a `releaseAt` here assumes the confirm request actually reached them.
 * The engine refuses to count silence as a "no" unless a request was DELIVERED naming the current
 * slot (see lib/call-notice.ts), and that needs the message rows, which these functions do not
 * take. So `releaseAt` is the earliest the slot can come back, not a promise that it will - a
 * request WATI rejected leaves the booking for a human instead.
 */

/** The three answers to "what is this slot waiting on?" plus the loop's own moments. */
export type SlotHold =
  /** They said YES (WhatsApp reply, or an admin marked it). The slot is theirs. */
  | { state: "CONFIRMED" }
  /**
   * We asked and are waiting. `releaseAt` is when the slot comes back if they stay silent, and
   * null when it never will: the loop is off, or the reply grace outlasts the cancel window
   * (a call booked at very short notice), in which case the booking stays for a human to judge.
   */
  | { state: "AWAITING_REPLY"; askedAt: Date; releaseAt: Date | null }
  /** Booked, nobody has been asked yet. `askAt` is when the request goes out (null = never). */
  | { state: "NOT_ASKED"; askAt: Date | null };

type HoldRules = Pick<
  BookingRulesConfig,
  "autoCancelEnabled" | "confirmRequestLeadMinutes" | "autoCancelMinutes" | "confirmReplyGraceMinutes"
>;

export function slotHold(args: {
  slotStartsAt: Date;
  confirmedAt: Date | null;
  confirmSentAt: Date | null;
  rules: HoldRules;
}): SlotHold {
  const { slotStartsAt, confirmedAt, confirmSentAt, rules } = args;
  if (confirmedAt) return { state: "CONFIRMED" };
  if (!confirmSentAt) return { state: "NOT_ASKED", askAt: askAt(slotStartsAt, rules) };
  return { state: "AWAITING_REPLY", askedAt: confirmSentAt, releaseAt: releaseAt(slotStartsAt, confirmSentAt, rules) };
}

/**
 * When the "please reply YES" goes out: the moment the call enters the confirm-request window.
 *
 * Null when no request is coming - the loop is off, or the lead is 0m, which is how you switch
 * asking off without switching the loop off.
 */
export function askAt(slotStartsAt: Date, rules: HoldRules): Date | null {
  if (!rules.autoCancelEnabled || rules.confirmRequestLeadMinutes <= 0) return null;
  return new Date(slotStartsAt.getTime() - rules.confirmRequestLeadMinutes * MINUTE_MS);
}

/**
 * When an unanswered hold is released, mirroring the engine's two conditions: the call must be
 * inside the auto-cancel window AND the reply grace must have run out since we asked. Whichever
 * of those two happens LATER is the moment.
 *
 * Null when the slot is never released automatically:
 *  - the loop is off (`autoCancelEnabled` false), or
 *  - nothing was ever asked, or
 *  - the moment lands at or after the call itself. The engine only touches future slots, so a
 *    request sent 20 minutes before a call with a 30-minute grace can never mature into a cancel.
 *    That is deliberate - it hands the judgement to a person rather than writing the call off.
 */
export function releaseAt(slotStartsAt: Date, confirmSentAt: Date | null, rules: HoldRules): Date | null {
  if (!rules.autoCancelEnabled || !confirmSentAt) return null;
  const windowOpens = slotStartsAt.getTime() - rules.autoCancelMinutes * MINUTE_MS;
  const graceEnds = confirmSentAt.getTime() + rules.confirmReplyGraceMinutes * MINUTE_MS;
  const at = Math.max(windowOpens, graceEnds);
  return at < slotStartsAt.getTime() ? new Date(at) : null;
}

/**
 * What status a released slot should take (Error Log M2).
 *
 * OPEN only when someone could actually book it. The public form refuses anything inside
 * `minNoticeHours`, so releasing a slot that starts within the hour publishes capacity that does
 * not exist - the calendar shows a free slot the booking page will reject. Inside the window it is
 * BLOCKED instead: still not sold, but honestly unusable.
 *
 * Lives here, pure, because all four release paths need it and two of them are in modules that
 * import each other. The auto-cancel engine used to hardcode OPEN and so could publish a phantom
 * slot whenever the cancel window was tighter than the notice window - which minute-granular
 * windows made easy to do (cancel 20m out, 2h notice).
 */
export function releasedSlotStatus(
  startsAt: Date | null,
  minNoticeHours: number,
  now: number = Date.now(),
): "OPEN" | "BLOCKED" {
  if (!startsAt) return "OPEN";
  const hoursUntil = (startsAt.getTime() - now) / 3_600_000;
  return hoursUntil >= minNoticeHours ? "OPEN" : "BLOCKED";
}
