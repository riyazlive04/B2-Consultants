import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import type { CountableMetric, Increment } from "@/lib/gamification";
import {
  computeGoalActual,
  goalProgress,
  goalWindow,
  type Goal,
  type GoalMetric,
  type GoalProgress,
} from "@/lib/goals";
import { getTeamGame, type RankedPlayer } from "./gamification";

/**
 * Goal progress, derived. Nothing is stored: every read replays the same history
 * the Arena scores, so a goal's number always agrees with the leaderboard, and a
 * goal created today for last quarter immediately shows how that quarter went.
 */

const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/** Money goals are set in whole rupees; the ledger keeps paise. */
const PAISE_PER_RUPEE = 100;

/** The dated series a goal is measured against, for one player or the whole team. */
function seriesFor(
  metric: GoalMetric,
  players: RankedPlayer[],
  revenue: Increment[],
): Increment[] {
  if (metric === "revenueInr") return revenue;
  if (metric === "xp") return players.flatMap((p) => p.events.map((e) => ({ dateKey: e.dateKey, n: e.xp })));
  return players.flatMap((p) => p.counters[metric as CountableMetric] ?? []);
}

export const getGoalsWithProgress = cache(async (): Promise<GoalProgress[]> => {
  const [rows, game] = await Promise.all([
    prisma.goal.findMany({
      include: { teamProfile: { select: { userId: true } } },
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    }),
    getTeamGame(),
  ]);
  if (rows.length === 0) return [];

  // Revenue is the one metric the game engine doesn't already carry. Load it only
  // when a goal actually asks for it, and only back to the oldest such goal.
  const revenueGoals = rows.filter((r) => r.metric === "revenueInr");
  let revenue: Increment[] = [];
  if (revenueGoals.length) {
    const from = revenueGoals
      .map((g) => goalWindow(g.period, dateKeyOf(g.periodStart)).start)
      .sort()[0];
    const incomes = await prisma.income.findMany({
      where: { ...ACTIVE, date: { gte: new Date(`${from}T00:00:00Z`) } },
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    });
    revenue = incomes.map((i) => ({
      dateKey: dateKeyOf(i.date),
      n: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)) / PAISE_PER_RUPEE,
    }));
  }

  return rows.map((row) => {
    const goal: Goal = {
      id: row.id,
      name: row.name,
      metric: row.metric as GoalMetric,
      scope: row.scope,
      userId: row.teamProfile?.userId ?? null,
      teamProfileId: row.teamProfileId,
      period: row.period,
      periodStart: dateKeyOf(row.periodStart),
      targetValue: Number(row.targetValue),
      active: row.active,
    };
    // A user-scoped goal whose person has no login can never be measured — it reads as 0.
    const players =
      goal.scope === "USER" ? game.players.filter((p) => p.userId === goal.userId) : game.players;
    const { actual, metOn } = computeGoalActual(seriesFor(goal.metric, players, revenue), goal);
    return goalProgress(goal, actual, metOn, game.todayKey);
  });
});

/** Active goals only — what the reward engine and the home dashboard care about. */
export async function getActiveGoals(): Promise<GoalProgress[]> {
  return (await getGoalsWithProgress()).filter((g) => g.goal.active);
}
