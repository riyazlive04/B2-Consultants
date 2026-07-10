/**
 * Goals — PURE. What the founder is steering the team towards.
 *
 * A goal is (metric, target, window, who). Progress is DERIVED from the same
 * append-only history the Arena scores, so a goal can never disagree with the
 * leaderboard, and back-dating a goal immediately shows how you'd have done.
 *
 * The metric vocabulary is deliberately shared with badges and reward rules
 * (see COUNTABLE_METRICS in gamification.ts): the founder learns "deals won"
 * once, and it means the same thing whether they're setting a target, minting
 * a badge, or paying a bonus.
 */

import {
  COUNTABLE_METRICS,
  EMPLOYEE_METRIC_LABELS,
  type CountableMetric,
  type Increment,
} from "./gamification";

export type GoalMetric = CountableMetric | "xp" | "revenueInr";

export const GOAL_METRICS: readonly GoalMetric[] = [...COUNTABLE_METRICS, "xp", "revenueInr"];

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  ...EMPLOYEE_METRIC_LABELS,
  xp: "XP earned",
  revenueInr: "Revenue (₹, aggregate)",
} as Record<GoalMetric, string>;

/** Company goals are judged on the team's combined total; user goals on one person's. */
export type GoalScope = "COMPANY" | "USER";
export type GoalPeriod = "MONTH" | "QUARTER" | "YEAR";

export type Goal = {
  id: string;
  name: string;
  metric: GoalMetric;
  scope: GoalScope;
  /** set when scope is USER. `userId` is how the engine matches a player; `teamProfileId`
   *  is how the console addresses a person. They differ, and a profile can have no login. */
  userId: string | null;
  teamProfileId: string | null;
  period: GoalPeriod;
  /** YYYY-MM-DD — the first day of the period */
  periodStart: string;
  targetValue: number;
  active: boolean;
};

/** Half-open window [start, end) as date keys, so a day belongs to exactly one period. */
export function goalWindow(period: GoalPeriod, periodStart: string): { start: string; end: string } {
  const [y, m, d] = periodStart.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start);
  if (period === "MONTH") end.setUTCMonth(end.getUTCMonth() + 1);
  else if (period === "QUARTER") end.setUTCMonth(end.getUTCMonth() + 3);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function inWindow(dateKey: string, w: { start: string; end: string }): boolean {
  return dateKey >= w.start && dateKey < w.end;
}

/**
 * Total inside the goal's window, plus the day the target was crossed.
 * Increments outside [start, end) are ignored, so a July goal can't be met by June's work.
 */
export function computeGoalActual(
  increments: Increment[],
  goal: Goal,
): { actual: number; metOn: string | null } {
  const w = goalWindow(goal.period, goal.periodStart);
  let actual = 0;
  let metOn: string | null = null;
  for (const inc of [...increments].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
    if (!inWindow(inc.dateKey, w)) continue;
    actual += inc.n;
    if (metOn === null && goal.targetValue > 0 && actual >= goal.targetValue) metOn = inc.dateKey;
  }
  return { actual, metOn };
}

export type GoalProgress = {
  goal: Goal;
  actual: number;
  pct: number; // 0-100, clamped
  met: boolean;
  /** the day the target was crossed, if it was */
  metOn: string | null;
  /** false once the window has closed */
  open: boolean;
};

export function goalProgress(goal: Goal, actual: number, metOn: string | null, todayKey: string): GoalProgress {
  const w = goalWindow(goal.period, goal.periodStart);
  const pct = goal.targetValue > 0 ? Math.max(0, Math.min(100, (actual / goal.targetValue) * 100)) : 0;
  return {
    goal,
    actual,
    pct,
    met: goal.targetValue > 0 && actual >= goal.targetValue,
    metOn,
    open: todayKey < w.end,
  };
}

/** Label a period for the UI: "Jul 2026", "Q3 2026", "2026". */
export function periodLabel(period: GoalPeriod, periodStart: string): string {
  const d = new Date(`${periodStart}T00:00:00Z`);
  const year = d.getUTCFullYear();
  if (period === "YEAR") return String(year);
  if (period === "QUARTER") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${year}`;
  return `${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${year}`;
}
