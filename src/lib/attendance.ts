import { DEFAULT_ATTENDANCE_CONFIG, type AttendanceConfig } from "./config-schema";

/**
 * Attendance — the rules, as pure functions.
 *
 * WHY THIS MODEL DID NOT EXIST AND WHY IT NOW DOES: tutor fees are computed against
 * `batch._count.members + _count.enrollments` — the ROSTER. So the business pays per head
 * enrolled while holding no record of heads present, and two other things were blocked behind
 * that absence: a drop-risk signal derived from behaviour rather than hand-set by a coach, and
 * a no-show rate.
 *
 * Pure and dependency-free on purpose. These thresholds are the numbers that decide whether a
 * student gets chased, so they have to be arguable and checkable without a database — the same
 * reasoning as lib/outreach-sla.ts and lib/tutor-fee.ts.
 */

/** Mirrors Prisma's `AttendanceStatus`, kept local so this file needs no client import. */
export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

export type AttendanceMark = {
  sessionId: string;
  /** When the session STARTED — the ordering key for streaks. Not when it was marked. */
  startsAt: Date;
  status: AttendanceStatus;
};

/**
 * Did this count as attending?
 *
 * LATE counts. A student who joined 20 minutes into a 90-minute class was in the room, and
 * treating that as a no-show would put a punctuality problem into the drop-risk list, where it
 * would drown out the students actually disappearing.
 */
export function isAttended(status: AttendanceStatus): boolean {
  return status === "PRESENT" || status === "LATE";
}

/**
 * Does this session belong in the denominator at all?
 *
 * EXCUSED does not. An excused absence is the system working — the student told someone. Counting
 * it against them punishes exactly the behaviour we want, and it is why the rate below is over
 * "sessions they were expected at", not "sessions that happened".
 */
export function isCounted(status: AttendanceStatus): boolean {
  return status !== "EXCUSED";
}

export type AttendanceSummary = {
  /** Sessions with a mark of any kind. */
  marked: number;
  /** Sessions counting towards the rate (i.e. excluding EXCUSED). */
  counted: number;
  attended: number;
  absent: number;
  late: number;
  excused: number;
  /** attended / counted, 0–1. Null when nothing counts yet — see `signalFor`. */
  rate: number | null;
  /** Consecutive countable sessions missed, most recent first. Excused sessions do not break it. */
  consecutiveMissed: number;
};

/**
 * Summarises one student's marks.
 *
 * `marks` may arrive in any order; this sorts by session start so the streak is computed against
 * the timeline rather than against insertion order.
 */
export function summarise(marks: AttendanceMark[]): AttendanceSummary {
  const ordered = [...marks].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let attended = 0;
  let absent = 0;
  let late = 0;
  let excused = 0;
  let counted = 0;

  for (const m of ordered) {
    if (m.status === "LATE") late++;
    if (m.status === "EXCUSED") {
      excused++;
      continue;
    }
    counted++;
    if (isAttended(m.status)) attended++;
    else absent++;
  }

  // Walk backwards from the most recent session. An EXCUSED session is neither a miss nor a
  // reset — it is skipped, so "away for a wedding, then missed two more" still reads as a
  // two-session streak rather than being silently zeroed by the excused one in the middle.
  let consecutiveMissed = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const status = ordered[i]!.status;
    if (status === "EXCUSED") continue;
    if (isAttended(status)) break;
    consecutiveMissed++;
  }

  return {
    marked: ordered.length,
    counted,
    attended,
    absent,
    late,
    excused,
    rate: counted === 0 ? null : attended / counted,
    consecutiveMissed,
  };
}

/**
 * GREEN / AMBER / RED, or UNKNOWN.
 *
 * UNKNOWN is a real answer and not a failure state. Below `minSessionsForSignal` a rate is noise
 * — one missed class out of one is 0%, which would paint every new student red on their first
 * absence. Saying "we don't know yet" is both true and more useful than a confident wrong colour.
 *
 * The consecutive-miss rule is deliberately SEPARATE from the rate and can turn a student red on
 * its own. A student at 80% who has missed the last three in a row is the one about to drop, and
 * an average is exactly the statistic that cannot see that — it is dominated by the months when
 * things were fine.
 */
export type AttendanceSignal = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

export function signalFor(
  summary: AttendanceSummary,
  config: AttendanceConfig = DEFAULT_ATTENDANCE_CONFIG,
): AttendanceSignal {
  if (summary.counted < config.minSessionsForSignal || summary.rate === null) return "UNKNOWN";
  if (summary.consecutiveMissed >= config.consecutiveMissedForRed) return "RED";

  const pct = summary.rate * 100;
  if (pct < config.redRatePct) return "RED";
  if (pct < config.amberRatePct) return "AMBER";
  return "GREEN";
}

/** Why the signal is what it is — shown beside it, so a colour is never unexplained. */
export function signalReason(
  summary: AttendanceSummary,
  config: AttendanceConfig = DEFAULT_ATTENDANCE_CONFIG,
): string {
  if (summary.counted < config.minSessionsForSignal || summary.rate === null) {
    return `Only ${summary.counted} session${summary.counted === 1 ? "" : "s"} marked — too few to judge`;
  }
  if (summary.consecutiveMissed >= config.consecutiveMissedForRed) {
    return `Missed the last ${summary.consecutiveMissed} sessions in a row`;
  }
  const pct = Math.round(summary.rate * 100);
  if (pct < config.redRatePct) return `${pct}% attendance — below the ${config.redRatePct}% floor`;
  if (pct < config.amberRatePct) return `${pct}% attendance — below the ${config.amberRatePct}% target`;
  return `${pct}% attendance`;
}

/**
 * A batch's no-show rate for one session: the share of expected students who did not attend.
 *
 * Over COUNTED marks, so an excused student neither helps nor hurts the number. A session with
 * no marks at all returns null — "nobody took the register" must not read as "nobody came".
 */
export function noShowRate(statuses: AttendanceStatus[]): number | null {
  const counted = statuses.filter(isCounted);
  if (counted.length === 0) return null;
  const missed = counted.filter((s) => !isAttended(s)).length;
  return missed / counted.length;
}

/**
 * How many of a session's expected students actually attended.
 *
 * This is the number to hold beside `TutorFee.headcount`. The fee is priced off the roster; this
 * says how much of that roster was in the room. The two being different is not a bug to
 * auto-correct — it is the fact the founders need in order to decide whether the fee basis
 * should change, which is a pricing decision and theirs to make.
 */
export function attendedHeadcount(statuses: AttendanceStatus[]): number {
  return statuses.filter(isAttended).length;
}

/** "12 of 15 (80%)" — the one-line form used on session rows and batch summaries. */
export function attendanceLabel(summary: AttendanceSummary): string {
  if (summary.counted === 0) return "Not marked";
  const pct = Math.round((summary.rate ?? 0) * 100);
  return `${summary.attended} of ${summary.counted} (${pct}%)`;
}
