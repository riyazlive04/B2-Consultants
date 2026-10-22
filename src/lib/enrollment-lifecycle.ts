/**
 * THE ENROLMENT LIFECYCLE - who is still being taught, who holds a seat, and who walked away.
 *
 * ── What this file exists to fix ────────────────────────────────────────────────────────
 * `Enrollment.status` has had four values since the beginning (`StudentStatus`: ACTIVE,
 * COMPLETED, DROPPED, PAUSED) and this codebase deliberately has NO Prisma middleware filtering
 * on it - every call site filters explicitly, the same discipline as the soft-delete archive.
 * The consequence is the one you would predict: twenty-one server files read enrolments, most
 * write `status: "ACTIVE"`, and the handful that do not kept counting a student who left as
 * though nothing had happened. A cohort that lost two students still read as full, and the
 * student who dropped was still on next Saturday's register.
 *
 * So the decision is made ONCE, here, with a name - and the call sites ask the question instead
 * of each re-deciding what four enum values mean.
 *
 * ── The discontinue button the founders asked for (@37:54-39:42) ────────────────────────
 * DROPPED is that button. It did not need a new enum value; what it needed was a reason, a
 * surface the coach can reach, and the audit below. The reason vocabulary is founder-editable
 * (`StudentLifecycleConfig`) because "why students leave" is a business question whose answer
 * changes, and a free-text box alone produces thirty spellings of the same three reasons.
 *
 * ── The invariant that matters most ─────────────────────────────────────────────────────
 * DISCONTINUING IS NOT A REFUND. §8 of the agreement is explicit that withdrawal earns no
 * refund, so a student who walks away still owes the instalments they signed for. No function
 * in this file is reachable from revenue recognition, instalment settlement or the dunning
 * ladder, and `enrollment-lifecycle.test.ts` asserts that none of those files reads enrolment
 * status at all. If that test ever fails, read it before "fixing" it: it is the thing standing
 * between a coach pressing Discontinue and a receivable quietly disappearing.
 *
 * Pure and dependency-free, like lib/attendance.ts beside it.
 */

/** `StudentStatus` in the schema. Spelled out here so this file stays free of Prisma. */
export const ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED", "DROPPED", "PAUSED"] as const;
export type EnrollmentStatusValue = (typeof ENROLLMENT_STATUSES)[number];

/** The one that means "discontinued" - named, so no call site has to spell the string. */
export const DISCONTINUED_STATUS: EnrollmentStatusValue = "DROPPED";

/**
 * Has this enrolment ENDED?
 *
 * COMPLETED and DROPPED both end it, and lumping them together is right for the two questions
 * below: a graduate and a leaver are equally not in next week's class and equally not occupying
 * a seat in a running cohort. They are of course completely different for every OTHER question
 * (one is the outcome the business sells, the other is churn), which is why this predicate is
 * narrow and `isDiscontinued` is separate.
 *
 * PAUSED is deliberately NOT here. A paused student is coming back: their seat is theirs, and
 * they stay on the register so the coach marks them EXCUSED rather than having them silently
 * vanish from the cohort.
 */
export function hasLeft(status: EnrollmentStatusValue | string): boolean {
  return status === "DROPPED" || status === "COMPLETED";
}

/** Did the student walk away, as opposed to finishing? The churn half of `hasLeft`. */
export function isDiscontinued(status: EnrollmentStatusValue | string): boolean {
  return status === DISCONTINUED_STATUS;
}

/**
 * Does this enrolment take up one of a cohort's `targetStrength` seats?
 *
 * The capacity band on every batch screen reads this. Before it existed, `filled` was a raw
 * relation count, so a cohort of ten that lost two read as ten of ten - full - and nobody could
 * seat the replacements the founders had already sold to.
 */
export function occupiesSeat(status: EnrollmentStatusValue | string): boolean {
  return !hasLeft(status);
}

/** The Prisma filter for "seated", in one place so the twenty-one call sites cannot drift. */
export const SEATED_STATUSES: readonly EnrollmentStatusValue[] = ENROLLMENT_STATUSES.filter(
  (s) => occupiesSeat(s),
);

/**
 * Should this student be on the register for a given class?
 *
 * The subtlety is `hasMark`, and it is the whole reason this is a function rather than a filter
 * in a query. A student who dropped in week six ATTENDED weeks one to five, and those registers
 * are a record: filtering them out of the roster would remove their marks from the sheet, which
 * would quietly change a taught class's attendance history and the "register complete" count
 * along with it. So the rule is: a departed student stays on any register that already has a
 * mark for them, and comes off the ones that do not - which is exactly the future.
 */
export function belongsOnRegister(
  status: EnrollmentStatusValue | string,
  hasMark: boolean,
): boolean {
  return hasMark || !hasLeft(status);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * WHY A STUDENT LEFT
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The reasons shipped out of the box - the ones the founders named on the call, plus the two
 * that any coaching business has. Founder-editable; this is only what an empty config reads as.
 *
 * `OTHER` is not in the list because it is not a reason. It is the escape hatch, and it comes
 * with the free-text note - a vocabulary with no escape hatch gets one anyway, in the shape of
 * everybody picking the nearest wrong option.
 */
export const DEFAULT_DISCONTINUE_REASONS: readonly string[] = [
  "Found a job elsewhere",
  "Financial difficulty",
  "Personal or family reasons",
  "Not enough time",
  "Unhappy with the programme",
  "Moved country or visa issue",
  "Unresponsive - no contact",
];

/** The sentinel the picker submits for a reason not on the list. Not a stored reason. */
export const OTHER_REASON = "OTHER";

export type DiscontinueDecision = {
  /** The reason as it will be stored - a vocabulary entry, or the free text behind OTHER. */
  reason: string;
  /** The coach's note. Required when the reason is OTHER, optional otherwise. */
  note: string | null;
};

/**
 * Validate a discontinue reason against the configured vocabulary.
 *
 * Returns the decision or an error STRING rather than throwing: the caller is a server action
 * whose job is to hand the message back to the coach who is standing on the screen, and an
 * exception there becomes "something went wrong".
 *
 * A reason is REQUIRED. That is the point of the whole feature - a discontinue button with an
 * optional reason produces a churn report of nulls, and the founders asked for the breakdown
 * (@39:42) in the same breath as the button.
 */
export function decideDiscontinue(
  input: { reason: string; note?: string | null },
  vocabulary: readonly string[],
): { ok: true; decision: DiscontinueDecision } | { ok: false; error: string } {
  const reason = input.reason.trim();
  const note = (input.note ?? "").trim();

  if (!reason) return { ok: false, error: "Pick why this student is stopping" };

  if (reason === OTHER_REASON) {
    if (!note) return { ok: false, error: "Say what the reason was" };
    return { ok: true, decision: { reason: note.slice(0, 120), note: note || null } };
  }

  /**
   * An off-list reason is refused rather than stored.
   *
   * The vocabulary is editable, so a reason CAN legitimately disappear from it - but that is a
   * decision taken in the Console, and accepting whatever arrives in the form field would make
   * the breakdown unaggregatable by the same back door the free-text box was built to close.
   * Existing rows keep whatever they were given; this only governs new ones.
   */
  if (!vocabulary.includes(reason)) {
    return { ok: false, error: "That reason is no longer on the list - pick another" };
  }

  return { ok: true, decision: { reason, note: note || null } };
}

export type ReasonTally = { reason: string; count: number; pct: number };

/**
 * The churn breakdown (@39:42): which reasons, how many, what share.
 *
 * Sorted by count and then alphabetically, so the order is stable between reads - a table that
 * reshuffles two equal rows on every refresh looks like data changing when nothing has.
 *
 * Rows with no reason are tallied as "Not recorded" rather than dropped. Every enrolment
 * dropped before this feature existed is one of those, and a breakdown that silently excluded
 * them would overstate the share of whichever reason happened to be recorded first.
 */
export function tallyReasons(
  rows: readonly { reason: string | null }[],
  unrecordedLabel = "Not recorded",
): ReasonTally[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.reason?.trim() || unrecordedLabel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = rows.length;
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      pct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
