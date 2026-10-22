/**
 * THE WEEKLY PROGRESS REPORT (@33:47) - what the records say, beside what the student said.
 *
 * ── What this is, and what it deliberately is not ──────────────────────────────────────
 * The sprint tracker already shows the coach's target, the student's answer and the verdict,
 * one row per week. The leaderboard already totals a student's measured activity across the
 * whole period. Neither answers the question a coach actually has on the Friday before a call,
 * which is "what did this student DO, week by week, and is it going up or down".
 *
 * So this is the same measured counts the leaderboard reads, bucketed by sprint week and laid
 * beside the target and the actual for that week. It introduces no new fact: every number here
 * is already on some other screen, which is the only way it can be trusted (see the invariant
 * at the top of lib/leaderboard.ts - a board that contradicts the screen owning its number is
 * worse than no board).
 *
 * ── Why it reuses MetricCounts rather than its own shape ───────────────────────────────
 * `MetricCounts` and `LeaderboardMetricKey` come from lib/leaderboard.ts, and the server side
 * of this report buckets the same queries `gatherCounts` runs. A separate vocabulary would have
 * been a second definition of "an application" and "a connection", free to drift from the one
 * the board scores - and then the report and the board would disagree about the same week.
 *
 * ── Why "whose move is it" comes from checkInState ─────────────────────────────────────
 * A week in this report can be unanswered, answered-but-unjudged, judged, or not yet started,
 * and that is exactly the five-way split in lib/sprint-check-in.ts. Re-testing `status ===
 * "PENDING" && !actual` here would be the fourth copy of the test that file was extracted to
 * delete.
 *
 * ── THE RULE THAT MATTERS MOST: null is not zero ───────────────────────────────────────
 * A week in which no register was taken has NO attendance percentage. It is not 0%, and showing
 * it as 0% would tell a coach their student missed a class that nobody marked - which is the
 * coach's own omission reflected back at them as the student's failure. The same reasoning
 * `lib/attendance.ts` applies to its UNKNOWN signal and `student-classroom.ts` to a null mark.
 *
 * Pure and dependency-free, like lib/attendance.ts and lib/leaderboard.ts beside it.
 */

import type { MetricCounts } from "./leaderboard";
import { checkInState, unansweredStreak, type CheckInState } from "./sprint-check-in";

/** One sprint week, with its measured counts already gathered. */
export type WeekInput = {
  id: string;
  weekIndex: number;
  weekStartYmd: string;
  weekEndYmd: string;
  target: string | null;
  actual: string | null;
  status: string;
  note: string | null;
  /** The same counts the leaderboard scores, restricted to this week's days. */
  counts: MetricCounts;
  /** Live classes the timetable actually held in this week. */
  classesHeld: number;
  /**
   * Of those, how many had a register taken AT ALL - by anybody, for anybody.
   *
   * This is what separates "the student missed three classes" from "nobody marked three
   * classes", and it is the whole reason attendance can be null below. It counts marked
   * SESSIONS, not this student's marks: a session with a register that does not mention this
   * student is real evidence of an absence, whereas a session with no register at all is
   * evidence of nothing.
   */
  classesMarked: number;
};

export type WeekAttendance = { attended: number; of: number; pct: number };

export type WeeklyReportRow = {
  id: string;
  weekIndex: number;
  weekStartYmd: string;
  weekEndYmd: string;
  target: string | null;
  actual: string | null;
  note: string | null;
  /** Whose move it is - from the one definition in lib/sprint-check-in.ts. */
  state: CheckInState;
  /** NULL when no register was taken in this week. Never 0% in that case - see the file note. */
  attendance: WeekAttendance | null;
  /** Applications sent plus HR connections accepted - the sprint's input side. */
  outreach: number;
  interviews: number;
  tasksDone: number;
  wins: number;
  /**
   * Outreach against the previous CLOSED week, or null where there is nothing to compare.
   *
   * Null in three separate situations, and collapsing any of them into "level" would be a
   * claim the data does not support: the first week of a sprint (nothing before it), a week
   * that has not closed (still accruing), and a week whose predecessor has not closed either.
   */
  trend: "UP" | "DOWN" | "LEVEL" | null;
  delta: number | null;
};

export type WeeklyReport = {
  rows: WeeklyReportRow[];
  summary: {
    /** Weeks whose window has shut - the only ones any average here is taken over. */
    weeksClosed: number;
    achieved: number;
    missed: number;
    /** Closed weeks the student never answered. */
    unanswered: number;
    /** Answered, waiting on the coach's verdict. */
    awaitingCoach: number;
    /** Consecutive unanswered weekends, counting back - see `unansweredStreak`. */
    unansweredStreak: number;
    totalOutreach: number;
    totalInterviews: number;
    /** Best week by outreach, for the sentence a coach can open a call with. */
    bestWeek: { weekIndex: number; outreach: number } | null;
    /** Across closed weeks that had a register. Null when none did. */
    attendance: WeekAttendance | null;
  };
};

const OUTREACH_FROM: readonly (keyof MetricCounts)[] = ["application_submitted", "hr_connection"];

const n = (counts: MetricCounts, key: keyof MetricCounts): number =>
  Math.max(0, Math.round(counts[key] ?? 0));

function pct(attended: number, of: number): number {
  return of === 0 ? 0 : Math.round((attended / of) * 100);
}

/**
 * The report for one enrolment.
 *
 * `weeks` arrives in whatever order the caller read it; it is sorted by `weekIndex` here,
 * because the trend compares each week with the one before it and an unsorted list would make
 * "the previous week" mean whatever the database happened to return first.
 */
export function buildWeeklyReport(weeks: readonly WeekInput[], todayYmd: string): WeeklyReport {
  const sorted = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex);

  const rows: WeeklyReportRow[] = sorted.map((w) => {
    const state = checkInState(
      { status: w.status, actual: w.actual, weekStartYmd: w.weekStartYmd, weekEndYmd: w.weekEndYmd },
      todayYmd,
    );

    /**
     * The denominator is MARKED classes, not held ones.
     *
     * A week with three classes of which one was marked is "1 of 1" for this student, not "1 of
     * 3" - the other two have no evidence either way, and putting them in the denominator would
     * report a 33% to a coach who simply has two registers outstanding.
     */
    const attended = n(w.counts, "class_attended");
    const attendance: WeekAttendance | null =
      w.classesMarked === 0
        ? null
        : { attended, of: w.classesMarked, pct: pct(attended, w.classesMarked) };

    return {
      id: w.id,
      weekIndex: w.weekIndex,
      weekStartYmd: w.weekStartYmd,
      weekEndYmd: w.weekEndYmd,
      target: w.target,
      actual: w.actual,
      note: w.note,
      state,
      attendance,
      outreach: OUTREACH_FROM.reduce((a, k) => a + n(w.counts, k), 0),
      interviews: n(w.counts, "hr_interview"),
      tasksDone: n(w.counts, "task_completed"),
      wins: n(w.counts, "win"),
      // Filled in on the second pass - a trend needs the row before it, which does not exist yet.
      trend: null,
      delta: null,
    };
  });

  /**
   * Second pass for the trend, over CLOSED weeks only.
   *
   * Comparing a half-finished week against a complete one would show a student who is having a
   * perfectly normal Tuesday as sharply down, every Tuesday - which is the fastest way to teach
   * a coach to ignore the column.
   */
  const closed = (r: WeeklyReportRow) => r.weekEndYmd < todayYmd;
  let previous: WeeklyReportRow | null = null;
  for (const row of rows) {
    if (!closed(row)) continue;
    if (previous) {
      const delta = row.outreach - previous.outreach;
      row.delta = delta;
      row.trend = delta > 0 ? "UP" : delta < 0 ? "DOWN" : "LEVEL";
    }
    previous = row;
  }

  const closedRows = rows.filter(closed);
  const withRegister = closedRows.filter((r) => r.attendance !== null);
  const attendedTotal = withRegister.reduce((a, r) => a + r.attendance!.attended, 0);
  const ofTotal = withRegister.reduce((a, r) => a + r.attendance!.of, 0);

  /**
   * The best week, and why ties go to the EARLIER one.
   *
   * `>` rather than `>=`, so a student whose best fortnight was weeks 2 and 7 is told about
   * week 2. The sentence this exists for is "you did 30 in week 2, what was different then" -
   * and the earlier instance is the one with more weeks after it to learn from.
   */
  const bestWeek = closedRows.reduce<{ weekIndex: number; outreach: number } | null>(
    (best, r) =>
      r.outreach > 0 && (best === null || r.outreach > best.outreach)
        ? { weekIndex: r.weekIndex, outreach: r.outreach }
        : best,
    null,
  );

  return {
    rows,
    summary: {
      weeksClosed: closedRows.length,
      /**
       * Read off the STATUS, not derived from `state`.
       *
       * `checkInState` collapses ACHIEVED and MISSED into one `JUDGED` value, on purpose - for
       * "whose move is it" they are the same answer. Here they are the opposite of each other,
       * so this asks the column that actually distinguishes them.
       */
      achieved: sorted.filter((w) => w.status === "ACHIEVED").length,
      missed: sorted.filter((w) => w.status === "MISSED").length,
      unanswered: closedRows.filter((r) => r.state === "OVERDUE").length,
      awaitingCoach: rows.filter((r) => r.state === "AWAITING_COACH").length,
      unansweredStreak: unansweredStreak(
        sorted.map((w) => ({
          status: w.status,
          actual: w.actual,
          weekStartYmd: w.weekStartYmd,
          weekEndYmd: w.weekEndYmd,
        })),
        todayYmd,
      ),
      totalOutreach: rows.reduce((a, r) => a + r.outreach, 0),
      totalInterviews: rows.reduce((a, r) => a + r.interviews, 0),
      bestWeek,
      attendance: ofTotal === 0 ? null : { attended: attendedTotal, of: ofTotal, pct: pct(attendedTotal, ofTotal) },
    },
  };
}
