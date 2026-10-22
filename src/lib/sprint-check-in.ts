/**
 * THE WEEKEND SPRINT CHECK-IN - whose move is it?
 *
 * ── The problem this file solves ────────────────────────────────────────────────────────
 * `SprintStatus` is `PENDING | ACHIEVED | MISSED`, and PENDING carries TWO completely different
 * situations:
 *
 *   · the student has not answered yet          → the move is the STUDENT's
 *   · the student answered, prose target, so the arithmetic declined to guess → the COACH's
 *
 * Both ends of the app had already discovered this and each had written its own test for it.
 * `server/notifications.ts` found the coach's queue with `status: "PENDING", actual: { not: null }`;
 * `my-journey/_components/SprintCheckIn.tsx` found the student's with `status === "PENDING" && !w.actual`
 * - twice, in two arms of the same expression, and the first version of that component had it on
 * only ONE of them, which is precisely the bug: a student whose target was prose answered, the
 * week stayed PENDING, the form reopened empty, and submitting again silently overwrote the
 * first answer. Nobody saw either.
 *
 * ── Why DERIVED and not a fourth enum value ────────────────────────────────────────────
 * A `SUBMITTED` status would be a second source of truth for a fact `actual` already states, and
 * the two would be free to disagree - a row at SUBMITTED with a null `actual`, or the reverse,
 * both of which are unreadable. The same reasoning as the agreement engine, which derives eight
 * states from existing columns rather than carrying a status column. It also needs no migration,
 * and therefore cannot be wrong about the rows that already exist.
 *
 * Pure and dependency-free. The Prisma filters below are plain objects, so the one definition
 * serves the queries and the screens alike.
 */

/** Just enough of a `SprintWeek` to say whose move it is. */
export type CheckInWeek = {
  status: string;
  /** What the student said they got done. NULL IS THE SIGNAL - see the file note. */
  actual: string | null;
  /** `@db.Date`, as a YYYY-MM-DD day key. */
  weekStartYmd: string;
  weekEndYmd: string;
};

export type CheckInState =
  /** The week has not started. Not a chore yet, and not nagged about. */
  | "NOT_STARTED"
  /** Open, in its own week, waiting on the student. */
  | "AWAITING_STUDENT"
  /** The week has closed and the student never answered. This is what the ladder chases. */
  | "OVERDUE"
  /** Answered; the coach owes a verdict, because the target was prose. */
  | "AWAITING_COACH"
  /** ACHIEVED or MISSED - the week is closed out. */
  | "JUDGED";

/**
 * Whose move it is, as one value.
 *
 * Compared as IST day KEYS, like every other `@db.Date` comparison in the app, so nothing here
 * flips during the 00:00-05:30 IST window - a week must not become "overdue" at half past
 * midnight and then un-become it.
 */
export function checkInState(week: CheckInWeek, todayYmd: string): CheckInState {
  if (week.status === "ACHIEVED" || week.status === "MISSED") return "JUDGED";
  // Answered but unjudged. Checked BEFORE the dates, because a student who answered early owes
  // nothing whatever the calendar says.
  if (week.actual !== null && week.actual !== "") return "AWAITING_COACH";
  if (week.weekStartYmd > todayYmd) return "NOT_STARTED";
  return week.weekEndYmd < todayYmd ? "OVERDUE" : "AWAITING_STUDENT";
}

/** The student still owes this week an answer - open or overdue. */
export function awaitsStudent(week: CheckInWeek, todayYmd: string): boolean {
  const state = checkInState(week, todayYmd);
  return state === "AWAITING_STUDENT" || state === "OVERDUE";
}

/** The coach owes this week a verdict. */
export function awaitsCoach(week: CheckInWeek, todayYmd: string): boolean {
  return checkInState(week, todayYmd) === "AWAITING_COACH";
}

/**
 * The week to put in front of the student: the current one, else the OLDEST overdue one.
 *
 * Oldest first, deliberately. Asking about last week while the week before is still blank
 * invites a student to skip it permanently, and the oldest gap is also the one the coach's
 * concern streak is counting.
 */
export function nextWeekToAnswer<T extends CheckInWeek>(
  weeks: readonly T[],
  todayYmd: string,
): T | null {
  const open = weeks.filter((w) => checkInState(w, todayYmd) === "AWAITING_STUDENT");
  if (open.length > 0) return open[0];
  const overdue = weeks
    .filter((w) => checkInState(w, todayYmd) === "OVERDUE")
    .sort((a, b) => a.weekEndYmd.localeCompare(b.weekEndYmd));
  return overdue[0] ?? null;
}

/**
 * How many closed weeks in a row the student has left unanswered, counting back from the most
 * recent closed week.
 *
 * ── What this is for ───────────────────────────────────────────────────────────────────
 * The end of the follow-up ladder. A student who has not answered three weekends running is
 * usually gone, and the founders asked for a discontinue decision at that point (@37:54-39:42)
 * - but a HUMAN one. Nothing in the app discontinues anybody; this number is what surfaces the
 * candidate on the coach's desk, where the button is.
 *
 * ── Why it stops at the first answered week ────────────────────────────────────────────
 * "Unanswered in a row" and "unanswered in total" are different facts, and only the first says
 * a student has stopped engaging. A student who missed three weeks in March and has answered
 * every week since is not a discontinue candidate, and a total would say they were, forever.
 *
 * An ACHIEVED or MISSED week counts as answered: the coach judged it, so somebody was there.
 */
export function unansweredStreak(weeks: readonly CheckInWeek[], todayYmd: string): number {
  const closed = weeks
    .filter((w) => w.weekEndYmd < todayYmd)
    .sort((a, b) => b.weekEndYmd.localeCompare(a.weekEndYmd));

  let streak = 0;
  for (const week of closed) {
    if (checkInState(week, todayYmd) !== "OVERDUE") break;
    streak += 1;
  }
  return streak;
}

/**
 * How many unanswered weekends in a row makes a conversation worth having.
 *
 * Three, not two: a student can lose one weekend to a wedding and the next to a cold without
 * anything being wrong, and a desk that cries concern at two would be crying most weeks. Three
 * consecutive is a pattern.
 */
export const CONCERN_STREAK = 3;

export function isConcerning(streak: number): boolean {
  return streak >= CONCERN_STREAK;
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * THE SAME TWO QUESTIONS, AS PRISMA FILTERS
 *
 * Plain objects rather than functions, so a `where` clause can spread them. They are the query
 * form of `awaitsCoach` / `awaitsStudent` above and MUST stay in step with them - which is why
 * they live in the same file as the predicates and are asserted against them in the tests.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/** `...AWAITING_COACH` - answered, unjudged. The coach's review queue. */
export const AWAITING_COACH = { status: "PENDING", actual: { not: null } } as const;

/**
 * `...UNANSWERED` - no answer yet, at any stage.
 *
 * Add the date bound at the call site: `weekEnd: { lt: today }` for the overdue set the ladder
 * chases, or `weekStart: { lte: today }` for every week whose window has opened. The bound is
 * deliberately NOT baked in, because "today" is a value and a constant cannot hold one without
 * being computed at import time - which on a long-running server means a stale day.
 */
export const UNANSWERED = { status: "PENDING", actual: null } as const;
