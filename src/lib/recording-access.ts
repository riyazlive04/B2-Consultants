/**
 * HOW LONG A RECORDING STAYS VISIBLE, and whether a student who missed the class has caught up.
 *
 * ── Two founder asks, one module, because they are one loop ─────────────────────────────
 * "The head coach or the tutor decide how long the recordings will be able to be seen" and
 * "a section for when they are not watching the recordings within 24 hours" are the same
 * mechanism read from two ends. A catch-up deadline only means something if the recording is
 * still there, and an access window only means something if somebody is watching whether it
 * gets used. Splitting them across two files would have let the deadline outlive the window -
 * a list nagging a student about a video they can no longer open.
 *
 * ── What changed about recordings ───────────────────────────────────────────────────────
 * `GnRecordingWatch` used to carry the comment "recordings are lifetime, so this is progress,
 * not access control". That is no longer true: `GnRecording.availableUntil` is access control.
 * Null still means lifetime, which is both the old behaviour and the right default for a
 * cohort nobody has made a decision about.
 *
 * Pure and dependency-free, like lib/attendance-window.ts beside it. These rules decide whether
 * a student is told off for not watching something, so they have to be checkable without a
 * database.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The access lengths a tutor may choose, in days. `0` is "no limit" and is deliberately in the
 * list rather than a separate checkbox - it is one of the answers to "how long", not a different
 * question, and a cohort whose coach wants lifetime access should be able to say so in the same
 * press as a cohort whose coach wants a week.
 */
export const RECORDING_ACCESS_DAY_CHOICES = [7, 14, 30, 60, 90, 0] as const;

/** Upper bound on a stored window, so a typo cannot create a 300-year one. */
export const MAX_RECORDING_ACCESS_DAYS = 3650;

/**
 * When a recording posted now should stop being visible.
 *
 * Returns an ABSOLUTE instant rather than storing the number of days, and that is the whole
 * design: a student who was promised a recording until 5 November must still have it on 4
 * November after somebody shortens the default to seven days. Storing the days and computing
 * the expiry at read time would silently re-date every recording ever posted.
 */
export function expiryFor(postedAt: Date, days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const capped = Math.min(MAX_RECORDING_ACCESS_DAYS, Math.round(days));
  return new Date(postedAt.getTime() + capped * DAY);
}

export type RecordingAccessState = "UNLIMITED" | "OPEN" | "EXPIRED";

export function recordingState(availableUntil: Date | null, now: Date): RecordingAccessState {
  if (!availableUntil) return "UNLIMITED";
  return now.getTime() <= availableUntil.getTime() ? "OPEN" : "EXPIRED";
}

/** May a student open this recording right now? */
export function isRecordingAvailable(availableUntil: Date | null, now: Date): boolean {
  return recordingState(availableUntil, now) !== "EXPIRED";
}

/**
 * Whole days left, rounded UP, or null for no limit.
 *
 * Up, not down: a window with eleven hours left reads "1 day left" rather than "0 days left",
 * because the student can still watch it today and a zero would tell them they cannot.
 */
export function daysLeft(availableUntil: Date | null, now: Date): number | null {
  if (!availableUntil) return null;
  const ms = availableUntil.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY);
}

/** "No time limit" / "3 days left" / "Last day" / "No longer available". */
export function accessLabel(availableUntil: Date | null, now: Date): string {
  const state = recordingState(availableUntil, now);
  if (state === "UNLIMITED") return "No time limit";
  if (state === "EXPIRED") return "No longer available";
  const left = daysLeft(availableUntil, now)!;
  if (left <= 1) return "Last day to watch";
  return `${left} days left to watch`;
}

/**
 * Where a student who missed a class stands on catching up.
 *
 * ── Why five states and not a boolean ──────────────────────────────────────────────────
 * The coach's list exists to be acted on, and each of these needs a different action - or
 * none:
 *
 *   · `NO_RECORDING` - the student cannot catch up because nobody posted the video. This is
 *     the COACH's chore, not the student's, and it is the one case where a list of "students
 *     who have not watched" would be blaming the wrong person. Agreement §3.3 promises the
 *     recording, so this is a broken promise rather than a lazy student.
 *   · `IN_GRACE` - absent, recording is up, but the catch-up window has not run out yet.
 *     Chasing someone four hours after a class they told nobody they would miss is noise.
 *   · `OVERDUE` - the thing the founders asked for: absent, recording available, grace gone.
 *   · `WINDOW_CLOSED` - absent, never watched, and the recording's own access window has now
 *     expired. Nagging is pointless; the coach needs to know the catch-up did not happen and
 *     can no longer happen.
 *   · `CAUGHT_UP` - watched it. Nothing to do.
 */
export type CatchUpState = "CAUGHT_UP" | "NO_RECORDING" | "IN_GRACE" | "OVERDUE" | "WINDOW_CLOSED";

export function catchUpState(
  args: {
    /** When the recording was posted. Null = no recording exists for that class. */
    recordingPostedAt: Date | null;
    availableUntil: Date | null;
    /** From `resolveWatchTruth` - the tracked percentage wins over a self-reported tick. */
    watchComplete: boolean;
    /** How long after the recording goes up a student still has before this counts as late. */
    graceHours: number;
  },
  now: Date,
): CatchUpState {
  // Watched beats everything, including an expired window - the catch-up happened.
  if (args.watchComplete) return "CAUGHT_UP";
  if (!args.recordingPostedAt) return "NO_RECORDING";
  if (!isRecordingAvailable(args.availableUntil, now)) return "WINDOW_CLOSED";

  const grace = Math.max(0, args.graceHours) * HOUR;
  return now.getTime() - args.recordingPostedAt.getTime() >= grace ? "OVERDUE" : "IN_GRACE";
}

/** Whole hours since the recording went up - the "24 hours and counting" number on the list. */
export function hoursSince(postedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / HOUR));
}

/**
 * Does this state belong on the coach's follow-up list?
 *
 * `IN_GRACE` and `CAUGHT_UP` do not - the first is not yet a problem and the second never will
 * be. The other three all do, including `NO_RECORDING`, because a missing recording is the most
 * actionable row on the list and the only one the coach can fix themselves.
 */
export function needsFollowUp(state: CatchUpState): boolean {
  return state === "OVERDUE" || state === "WINDOW_CLOSED" || state === "NO_RECORDING";
}

/** Worst first - the order the coach's list is worked from the top in. */
export const CATCH_UP_RANK: Record<CatchUpState, number> = {
  WINDOW_CLOSED: 0,
  NO_RECORDING: 1,
  OVERDUE: 2,
  IN_GRACE: 3,
  CAUGHT_UP: 4,
};
