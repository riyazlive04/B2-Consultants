/**
 * Which address a returning prospect should be written to.
 *
 * ── The bug this exists to fix ───────────────────────────────────────────────────
 * Intake has always resolved a repeat opt-in onto the Lead row we already had, which is right -
 * one person, one record. What it did with the contact details was `existing.email ?? input.email`:
 * fill blanks only. So the FIRST address someone ever typed became permanent, and every address
 * after it was read, parsed, validated and thrown away.
 *
 * That is invisible until it matters. Someone opts in with a college address in March, comes back
 * in September from their work address, and every email the system sends - the booking
 * confirmation, the reminder, the agreement - goes to the mailbox they have stopped reading. It
 * does not bounce. Nothing is logged. They simply never hear from us, and from the desk it looks
 * like a prospect who went quiet.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────
 * NEWEST WINS, and nothing is forgotten. The address someone typed most recently is the one they
 * are watching, so it becomes primary; every address they have ever used is kept beside it, which
 * is what lets intake still recognise them when they come back on the older one, and what lets the
 * desk see they were reached at a different address before.
 *
 * The fill-blanks contract still holds where it was actually meant: a webhook REDELIVERING one
 * submission must not overwrite a human's correction. That is a different code path (same source,
 * same external id) and it stays as it was. This is the other case - a person deliberately
 * submitting a form again, today, with an address they chose.
 */

import { normalizeEmail } from "./outreach-engine";

export type EmailPlan = {
  /** What `Lead.email` should be after this capture. Never null once we have ever had one. */
  primary: string | null;
  /**
   * The addresses to record against this lead - the submitted one, plus the previous primary
   * when it was about to be displaced and is not already on file. Empty when there is nothing
   * new to record.
   */
  record: string[];
  /** True when the primary address actually moved, so callers can log it and tell the desk. */
  changed: boolean;
};

/**
 * `known` is every address already on file for this lead (any order, any case). Passing it lets
 * the plan avoid re-recording an address we have seen before, so `timesSeen` is bumped by the
 * caller rather than a duplicate row being written.
 */
export function planEmailUpdate(input: {
  currentPrimary: string | null | undefined;
  submitted: string | null | undefined;
  known?: readonly string[];
}): EmailPlan {
  const current = normalizeEmail(input.currentPrimary);
  const submitted = normalizeEmail(input.submitted);
  const knownKeys = new Set(
    (input.known ?? []).map((e) => normalizeEmail(e)).filter((e): e is string => !!e),
  );

  // Nothing usable arrived. A blank box on a later form is not a request to be unreachable - it
  // is almost always a form that simply did not ask - so the address we have is left alone.
  if (!submitted) return { primary: input.currentPrimary ?? null, record: [], changed: false };

  // Same mailbox as the one on file: still worth recording the sighting (the caller bumps
  // lastSeenAt), but nothing moves.
  if (current === submitted) {
    return {
      primary: input.currentPrimary ?? null,
      record: knownKeys.has(submitted) ? [] : [submitted],
      changed: false,
    };
  }

  // A different address, typed just now. It becomes primary, and the one it displaces is kept -
  // that is the difference between changing an address and losing one. Both are filtered against
  // what is already on file, so coming back on an older address bumps its row instead of adding
  // a second one.
  const record = [submitted, current]
    .filter((e): e is string => !!e && !knownKeys.has(e))
    .filter((e, i, all) => all.indexOf(e) === i);
  return { primary: submitted, record, changed: current !== null };
}
