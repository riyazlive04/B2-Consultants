/**
 * THE ATTENDANCE WINDOW - pure rules for "is the register open, and who may see it".
 *
 * ── The gap this closes ─────────────────────────────────────────────────────────────────
 * Attendance already existed as a REGISTER: a tutor opened a sheet after the class and ticked
 * eight boxes. That works, and it is also the single most skippable chore in the app - a form
 * with no deadline, filled in from memory, for data nobody is waiting on. The result is the
 * data we actually have, which is almost none.
 *
 * So the register learns two switches, both held by the person standing in front of the class:
 *
 *   · OPEN IT. For a bounded number of minutes the students in that cohort - and only that
 *     cohort - see a live "I'm here" button with a countdown. The register fills itself from
 *     the room while the tutor is still teaching, and the tutor's job shrinks to correcting
 *     the two names that did not check in.
 *   · PUBLISH IT. Separately, and afterwards, the tutor decides whether the students may see
 *     the finished marks. Those are two different decisions - "take the register now" and
 *     "you may read the verdict" - and a tutor who mis-tapped a row needs the second to be
 *     able to come later than the first.
 *
 * ── Why these are pure functions in lib/ ────────────────────────────────────────────────
 * Four callers have to agree about the same instant: the tutor's board, the student's
 * dashboard, the student's classroom, and the check-in action that writes the row. If any of
 * them disagreed about whether the window is open, a student would see a button that the
 * server then refuses - which is worse than showing no button at all. Pure and
 * dependency-free, like lib/attendance.ts beside it and for the same reason: these rules
 * decide whether somebody is recorded absent, so they have to be arguable and checkable
 * without a database.
 */

const MIN = 60_000;

/** The stored shape of a window. Both null until a tutor opens it for the first time. */
export type AttendanceWindow = {
  /** When the register was opened. Null = it has never been opened. */
  opensAt: Date | null;
  /** When it stops accepting check-ins. Always written alongside `opensAt`. */
  closesAt: Date | null;
};

/**
 * NEVER_OPENED is a real state and not a failure one - it is the honest answer for the many
 * sessions a tutor marks the old way, after the fact, without ever opening a window. It has to
 * stay distinguishable from CLOSED, because "nobody was ever able to check in" and "the window
 * ran out" lead to different things to say on screen.
 */
export type WindowState = "NEVER_OPENED" | "OPEN" | "CLOSED";

/** Bounds on how long a window may run. A register left open all week is not a register. */
export const MIN_WINDOW_MINUTES = 1;
export const MAX_WINDOW_MINUTES = 240;

/**
 * Is this register accepting check-ins right now?
 *
 * Only the CLOSING edge is tested. Opening is always immediate - there is no UI for scheduling
 * a window and `opensAt` is written as `now` - so a lower bound could only ever misfire on
 * clock skew, and the direction it would misfire is "refuse the student who is sitting in the
 * class". Closing early is done by moving `closesAt` back to now, which is why that is the
 * edge carrying the meaning.
 */
export function windowState(w: AttendanceWindow, now: Date): WindowState {
  if (!w.opensAt || !w.closesAt) return "NEVER_OPENED";
  return now.getTime() <= w.closesAt.getTime() ? "OPEN" : "CLOSED";
}

export function isCheckInOpen(w: AttendanceWindow, now: Date): boolean {
  return windowState(w, now) === "OPEN";
}

/** Milliseconds left on an open window; 0 for anything not open. */
export function remainingMs(w: AttendanceWindow, now: Date): number {
  if (!isCheckInOpen(w, now)) return 0;
  return Math.max(0, w.closesAt!.getTime() - now.getTime());
}

/** When a window opened at `opensAt` would close. Minutes are clamped, never trusted. */
export function windowEnd(opensAt: Date, minutes: number): Date {
  const clamped = Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, Math.round(minutes)));
  return new Date(opensAt.getTime() + clamped * MIN);
}

/**
 * "4:31" / "0:09" - the countdown on the student's button.
 *
 * mm:ss rather than "4 minutes left", because this number is the reason to press the button in
 * the next few seconds and a rounded minute hides exactly the moment that matters. Rolls up to
 * h:mm:ss past the hour, since a window may legitimately run the length of a long class.
 */
export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + two(m) + ":" + two(s) : m + ":" + two(s);
}

/**
 * PRESENT or LATE for a student checking in right now.
 *
 * ── Lateness is measured from the later of two clocks ───────────────────────────────────
 * `max(classStart, windowOpen)`, and both halves of that are load-bearing:
 *
 *   · Not from the window alone. A tutor who opens the register ten minutes early - the
 *     sensible thing, so arrivals can tick themselves off as they join - would otherwise have
 *     every student who checks in at the stroke of the hour marked LATE for a class that had
 *     not yet begun.
 *   · Not from the class start alone. A tutor who forgets until twenty minutes in would
 *     otherwise mark the entire room LATE for the tutor's own delay.
 *
 * So you cannot be late before the class begins, and you cannot be late before anybody was
 * taking the register. LATE still counts as attended (`isAttended` in lib/attendance.ts) - it
 * is a punctuality fact, not a no-show.
 */
export function selfMarkFor(
  args: { opensAt: Date; classStartsAt: Date; graceMinutes: number },
  now: Date,
): "PRESENT" | "LATE" {
  const anchor = Math.max(args.opensAt.getTime(), args.classStartsAt.getTime());
  const grace = Math.max(0, args.graceMinutes) * MIN;
  return now.getTime() <= anchor + grace ? "PRESENT" : "LATE";
}

/**
 * May this student read the tutor's verdict on this class?
 *
 * ── Why a student always sees their OWN check-in, published or not ───────────────────────
 * `mySource` is the fork. A student who pressed "I'm here" performed an action and has to see
 * that it landed - a button that produces no visible change is a button people press four
 * times and then stop trusting. What the publish switch governs is the TUTOR'S verdict: the
 * corrected register, with its absences and its excuses, which a tutor may legitimately want
 * to fix before the cohort reads it.
 *
 * `publishRequired` is the founder's switch (Console → Attendance). Turned off, a mark is
 * visible as soon as it exists, which is how this behaved before windows existed - kept as an
 * option so that a cohort already reading its attendance does not need a tutor to learn a new
 * button before the page works again.
 */
export function studentMaySeeMark(args: {
  publishedAt: Date | null;
  mySource: "TUTOR" | "SELF" | null;
  publishRequired: boolean;
}): boolean {
  if (args.mySource === "SELF") return true;
  if (!args.publishRequired) return true;
  return args.publishedAt !== null;
}

/** "Open · 4:31 left" / "Closed" / "Not opened" - the one-line state used on both boards. */
export function windowLabel(w: AttendanceWindow, now: Date): string {
  const state = windowState(w, now);
  if (state === "NEVER_OPENED") return "Not opened";
  if (state === "CLOSED") return "Closed";
  return "Open · " + countdownLabel(remainingMs(w, now)) + " left";
}
