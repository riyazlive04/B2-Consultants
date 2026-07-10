/**
 * Reward rules — PURE. "When X happens, this person has earned Y."
 *
 * The founder writes rules (streak → ₹2,000; 5 deals in a month → ₹5,000). This
 * module decides WHO qualified and WHEN, from the same derived history the Arena
 * scores. It never touches money: the server copies the rule's amounts onto the
 * grant and stamps an FX rate, exactly like every other money row in the app.
 *
 * IDEMPOTENCE is the whole design. Every qualification carries a `periodKey`, and
 * (ruleId, teamProfileId, periodKey) is unique in the database. Re-running the
 * evaluator over all of history — which is what happens on every scan, because
 * nothing is cached — re-derives the same keys and inserts nothing new. That is
 * what lets a founder edit a rule and rescan without double-paying anyone, and
 * what lets a grant they already declined stay declined.
 *
 * The periodKey also encodes how often a rule can pay:
 *   BADGE_EARNED    → once per badge          ("badge-first-win")
 *   LEVEL_REACHED   → once per level          ("level-5")
 *   GOAL_MET        → once per goal           ("goal-<id>")
 *   STREAK_DAYS     → once per qualifying run ("run-2026-03-14")
 *   QUEST_COMPLETED → once per week           ("2026-03-09")
 *   XP / METRIC     → once per window         ("all" | "2026-03" | "2026-03-09")
 */

import {
  monthKeyOf,
  streakRuns,
  weekStartKey,
  type CountableMetric,
  type Increment,
  type PlayerGame,
  type XpEvent,
} from "./gamification";
import type { AppRole } from "./sections";
import type { GoalProgress } from "./goals";

// ───────────────────────────── triggers ─────────────────────────────

/** ALL = lifetime running total. MONTH / WEEK reset, so the rule can pay again. */
export type RewardWindow = "ALL" | "MONTH" | "WEEK";
export const REWARD_WINDOWS: readonly RewardWindow[] = ["ALL", "MONTH", "WEEK"];

export const REWARD_WINDOW_LABELS: Record<RewardWindow, string> = {
  ALL: "All time",
  MONTH: "Per calendar month",
  WEEK: "Per week (Mon–Sun)",
};

export type RewardTrigger =
  | { kind: "STREAK_DAYS"; days: number }
  | { kind: "LEVEL_REACHED"; level: number }
  | { kind: "BADGE_EARNED"; badgeKey: string }
  | { kind: "QUEST_COMPLETED"; questKey: string }
  | { kind: "XP_THRESHOLD"; xp: number; window: RewardWindow }
  | { kind: "METRIC_THRESHOLD"; metric: CountableMetric; target: number; window: RewardWindow }
  | { kind: "GOAL_MET"; goalId: string };

export type RewardTriggerKind = RewardTrigger["kind"];

export const REWARD_TRIGGER_KINDS: readonly RewardTriggerKind[] = [
  "STREAK_DAYS", "LEVEL_REACHED", "BADGE_EARNED", "QUEST_COMPLETED",
  "XP_THRESHOLD", "METRIC_THRESHOLD", "GOAL_MET",
];

export const REWARD_TRIGGER_LABELS: Record<RewardTriggerKind, string> = {
  STREAK_DAYS: "Reaches a logging streak",
  LEVEL_REACHED: "Reaches a level",
  BADGE_EARNED: "Earns a badge",
  QUEST_COMPLETED: "Completes a weekly quest",
  XP_THRESHOLD: "Earns enough XP",
  METRIC_THRESHOLD: "Hits a metric target",
  GOAL_MET: "A goal is met",
};

/** What the person gets. PERK carries no money — it's a thing, not a payout. */
export type RewardKind = "BONUS" | "COMMISSION" | "PERK";
export const REWARD_KINDS: readonly RewardKind[] = ["BONUS", "COMMISSION", "PERK"];

export type RewardRule = {
  id: string;
  name: string;
  description: string;
  kind: RewardKind;
  active: boolean;
  trigger: RewardTrigger;
  /** empty = every role plays */
  roles: AppRole[];
};

/** One person, one rule, one period — the unit the founder approves. */
export type Qualification = {
  ruleId: string;
  userId: string;
  periodKey: string;
  qualifiedOn: string; // YYYY-MM-DD
  reason: string;
};

export type RewardPlayer = PlayerGame & { role: AppRole };

// ───────────────────────────── bucketing helpers ─────────────────────────────

const bucketKey = (dateKey: string, window: RewardWindow): string =>
  window === "ALL" ? "all" : window === "MONTH" ? monthKeyOf(dateKey) : weekStartKey(dateKey);

/**
 * First date each bucket's running total reaches `target`.
 * For ALL there is one bucket; for MONTH/WEEK the total resets per bucket, which is
 * precisely what "5 deals in a month" means.
 */
function crossings(
  increments: Increment[],
  target: number,
  window: RewardWindow,
): Array<{ periodKey: string; dateKey: string; total: number }> {
  if (target <= 0) return [];
  const sums = new Map<string, number>();
  const hits: Array<{ periodKey: string; dateKey: string; total: number }> = [];
  for (const inc of [...increments].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
    const key = bucketKey(inc.dateKey, window);
    const before = sums.get(key) ?? 0;
    const after = before + inc.n;
    sums.set(key, after);
    if (before < target && after >= target) hits.push({ periodKey: key, dateKey: inc.dateKey, total: after });
  }
  return hits;
}

/** XP events collapsed into a dated increment series, so XP thresholds reuse `crossings`. */
const xpIncrements = (events: XpEvent[]): Increment[] =>
  events.map((e) => ({ dateKey: e.dateKey, n: e.xp }));

const fmt = (n: number) => n.toLocaleString("en-IN");

// ───────────────────────────── the evaluator ─────────────────────────────

export type EvaluateInput = {
  todayKey: string;
  players: RewardPlayer[];
  rules: RewardRule[];
  goals: GoalProgress[];
};

/**
 * Every qualification that has EVER happened, for every active rule. The caller
 * inserts what's missing; the unique key makes re-inserts no-ops. Deliberately not
 * incremental — a full re-derivation is cheap at this team size and can't drift.
 */
export function evaluateRewards({ todayKey, players, rules, goals }: EvaluateInput): Qualification[] {
  const out: Qualification[] = [];
  const goalById = new Map(goals.map((g) => [g.goal.id, g]));

  for (const rule of rules) {
    if (!rule.active) continue;
    const eligible = players.filter((p) => rule.roles.length === 0 || rule.roles.includes(p.role));

    for (const p of eligible) {
      for (const q of qualificationsFor(rule, p, goalById, todayKey)) out.push(q);
    }
  }
  return out;
}

function qualificationsFor(
  rule: RewardRule,
  p: RewardPlayer,
  goalById: Map<string, GoalProgress>,
  todayKey: string,
): Qualification[] {
  const make = (periodKey: string, qualifiedOn: string, reason: string): Qualification => ({
    ruleId: rule.id, userId: p.userId, periodKey, qualifiedOn, reason,
  });
  const t = rule.trigger;

  switch (t.kind) {
    case "STREAK_DAYS": {
      // One grant per run that got there — a second 30-day streak earns it again.
      if (t.days <= 0) return [];
      return streakRuns(p.logDays)
        .filter((run) => run.length >= t.days)
        .map((run) => {
          const on = run[t.days - 1];
          return make(`run-${on}`, on, `Reached a ${t.days}-day logging streak`);
        });
    }

    case "LEVEL_REACHED": {
      const up = p.levelUps.find((l) => l.level >= t.level);
      return up ? [make(`level-${t.level}`, up.dateKey, `Reached level ${t.level}`)] : [];
    }

    case "BADGE_EARNED": {
      const badge = p.badges.find((b) => b.key === t.badgeKey);
      return badge?.unlockedAt
        ? [make(`badge-${t.badgeKey}`, badge.unlockedAt, `Earned the ${badge.icon} ${badge.name} badge`)]
        : [];
    }

    case "QUEST_COMPLETED": {
      // Quest events are stamped on the last log of the week they were completed.
      return p.events
        .filter((e) => e.kind === "quest" && e.refKey === t.questKey)
        .map((e) => make(weekStartKey(e.dateKey), e.dateKey, e.label.replace("Quest complete · ", "Completed quest ")));
    }

    case "XP_THRESHOLD": {
      return crossings(xpIncrements(p.events), t.xp, t.window).map((c) =>
        make(c.periodKey, c.dateKey, `Earned ${fmt(t.xp)} XP (${windowPhrase(t.window)})`),
      );
    }

    case "METRIC_THRESHOLD": {
      const series = p.counters[t.metric] ?? [];
      return crossings(series, t.target, t.window).map((c) =>
        make(c.periodKey, c.dateKey, `Hit ${fmt(t.target)} · ${t.metric} (${windowPhrase(t.window)})`),
      );
    }

    case "GOAL_MET": {
      const g = goalById.get(t.goalId);
      if (!g || !g.met) return [];
      // A user-scoped goal only pays the person it was set for.
      if (g.goal.scope === "USER" && g.goal.userId !== p.userId) return [];
      return [make(`goal-${t.goalId}`, g.metOn ?? todayKey, `Goal met: ${g.goal.name}`)];
    }
  }
}

const windowPhrase = (w: RewardWindow) =>
  w === "ALL" ? "all time" : w === "MONTH" ? "in a month" : "in a week";

/** Human summary of a trigger, for the rules table and the grant ledger. */
export function describeTrigger(t: RewardTrigger): string {
  switch (t.kind) {
    case "STREAK_DAYS": return `${t.days}-day logging streak`;
    case "LEVEL_REACHED": return `Reaches level ${t.level}`;
    case "BADGE_EARNED": return `Earns badge "${t.badgeKey}"`;
    case "QUEST_COMPLETED": return `Completes quest "${t.questKey}"`;
    case "XP_THRESHOLD": return `${fmt(t.xp)} XP ${windowPhrase(t.window)}`;
    case "METRIC_THRESHOLD": return `${fmt(t.target)} × ${t.metric} ${windowPhrase(t.window)}`;
    case "GOAL_MET": return `A goal is met`;
  }
}
