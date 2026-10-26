/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  A CLASS THAT IS NOT HAPPENING  (issue C3)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `ClassSession.status` is new. Before it, a class could only be RE-TIMED or DELETED, and
 * `deleteBatchSession` refuses deletion once a register exists ("that class has a register
 * against it - it can't be deleted"). Between those two the common real event had nowhere to go:
 *
 *   · Called off BEFORE the register. Delete worked, the row vanished, every student's timetable
 *     silently lost a class, and nobody was told - absence notices fire on PUBLISH, not on
 *     removal.
 *   · Called off AFTER the window was opened. Three students had already checked in, so the row
 *     is undeletable AND unmarkable-as-cancelled. The ones who did not check in sit unmarked for
 *     a class that never happened, the cohort's attendance rate drops for it, and §3.3's "every
 *     live session is recorded" promise has nothing behind it.
 *
 * ── WHY A SHARED `where` FRAGMENT AND NOT A PRISMA MIDDLEWARE ───────────────────────────────
 * Sixteen server modules read `class_session`. Writing `status: "SCHEDULED"` into each of them by
 * hand is how `Enrollment.status` ended up being honoured by some call sites and ignored by
 * others - "a cohort that lost two students still read as full, and the student who dropped was
 * still on next Saturday's register" (see lib/enrollment-lifecycle.ts).
 *
 * So the filter is named ONCE here and spread, which is the same discipline `lib/soft-delete.ts`
 * uses for the archive and for the same stated reason: explicit per query, no middleware, but
 * one definition of what the filter IS. A middleware would be worse than either - it would hide
 * the rule from the one screen that must NOT apply it, which is the cohort timetable, where a
 * cancelled class has to stay visible and struck through.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────
 * A cancelled or postponed class:
 *   · is NOT in any attendance denominator (it never happened - counting it punishes students
 *     for our decision, which is the same mistake `isCounted` exists to stop for EXCUSED)
 *   · opens no register and accepts no check-in
 *   · shows no join link and sends no reminder
 *   · still appears on the cohort timetable and the student's own, labelled, because "your
 *     Saturday class is off" is information and a vanished row is not
 *
 * Pure and dependency-free, like lib/attendance-window.ts and lib/enrollment-lifecycle.ts beside
 * it. These rules decide whether somebody is recorded absent, so they have to be arguable and
 * checkable without a database.
 */

/** `SessionStatus` in the schema. Spelled out so this file stays free of Prisma. */
export const SESSION_STATUSES = ["SCHEDULED", "CANCELLED", "POSTPONED"] as const;
export type SessionStatusValue = (typeof SESSION_STATUSES)[number];

/**
 * Spread into the `where` of any read that answers "what is ON".
 *
 * Registers, reminders, attendance rates, the student's next class, the join link, the
 * teaching desk, the unmarked-register nudge. Everything except the two timetables.
 */
export const SESSION_ON = { status: "SCHEDULED" } as const;

/** The complement - used by the "called off" list on a cohort page. */
export const SESSION_OFF = { status: { in: ["CANCELLED", "POSTPONED"] } } as const;

/** Did this class actually happen (or is it going to)? */
export function sessionIsOn(status: SessionStatusValue | string): boolean {
  return status === "SCHEDULED";
}

/**
 * Is this class called off for good, as opposed to waiting for a new date?
 *
 * The distinction is deliberately kept, because the two lead to different things to say: a
 * student should stop waiting for a CANCELLED class and should keep an eye out for a POSTPONED
 * one. Nothing in the app treats them differently for attendance - neither happened.
 */
export function sessionIsCancelled(status: SessionStatusValue | string): boolean {
  return status === "CANCELLED";
}

export function sessionIsPostponed(status: SessionStatusValue | string): boolean {
  return status === "POSTPONED";
}

/** The label a student and a coach both see on a called-off class. */
export function sessionStatusLabel(status: SessionStatusValue | string): string | null {
  if (status === "CANCELLED") return "Cancelled";
  if (status === "POSTPONED") return "Postponed";
  return null;
}

/**
 * May this class be cancelled at all?
 *
 * Only a class that is currently ON, and only a class that has not already finished. Cancelling
 * a class that ran last Tuesday is not a cancellation, it is a falsification of the register -
 * and the students who were marked PRESENT at it would silently lose the attendance they earned.
 * A past class that genuinely did not run is corrected by marking the register, not by this.
 *
 * `graceMs` lets a class be called off while it is notionally in progress - a tutor whose
 * internet dies ten minutes in needs this, and the alternative is a class with three check-ins
 * and no teaching. Past the grace, it is history.
 */
export function canCancelSession(
  session: { status: SessionStatusValue | string; startsAt: Date; durationMins: number | null },
  now: Date,
  graceMs: number = 2 * 60 * 60 * 1000,
): { ok: true } | { ok: false; reason: string } {
  if (!sessionIsOn(session.status)) {
    return { ok: false, reason: `This class is already marked ${sessionStatusLabel(session.status)?.toLowerCase()}.` };
  }
  const endsAt = session.startsAt.getTime() + (session.durationMins ?? 90) * 60_000;
  if (now.getTime() > endsAt + graceMs) {
    return {
      ok: false,
      reason: "That class has already finished - mark the register instead of cancelling it.",
    };
  }
  return { ok: true };
}
