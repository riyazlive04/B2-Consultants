import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import {
  computeTeamGame,
  monthKeyOf,
  weekStartKey,
  type DailyLogVariant,
  type GameInputs,
  type PlayerGame,
  type XpEvent,
} from "@/lib/gamification";
import { okrCompletionPct } from "./people-metrics";

/**
 * Server side of the Arena: loads the append-only history and hands it to the
 * pure engine in lib/gamification.ts. Wrapped in React.cache so the layout
 * (notifications), the home card and the Arena page share ONE computation per
 * request. Data volumes are a 3-4 person team's history — full scans are cheap
 * and keep the scores exact and retroactive.
 */

const LOG_FIELDS = [
  "discoveryCallsCompleted", "highlyQualifiedCalls", "followUpsDone", "proposalsSent", "noShows",
  "newLeadsContacted", "appointmentsSet", "followUpMessagesSent", "leadsAddedToPipeline",
  "sessionsDelivered", "studentsCheckedInOn", "assignmentsReviewed", "studentsFlaggedAtRisk",
] as const;

/** @db.Date columns are UTC midnight — the calendar day IS the key. */
const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/** Timestamps (changedAt etc.) → the IST business day they happened on. */
const istDayKey = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

export type RankedPlayer = PlayerGame & { rankWeek: number; rankMonth: number; rankAll: number };

export type TeamGame = {
  todayKey: string;
  weekStart: string;
  monthKey: string;
  players: RankedPlayer[];
  feed: Array<XpEvent & { name: string }>;
};

export const getTeamGame = cache(async (): Promise<TeamGame> => {
  const todayKey = dateKeyOf(istToday());

  const [profiles, logs, stageHistory, outcomes, milestoneLogs, signalLogs, okrs] = await Promise.all([
    prisma.teamProfile.findMany({
      where: { userId: { not: null }, dashboardRole: { not: "ADMIN" } },
      orderBy: { orderIndex: "asc" },
    }),
    prisma.dailyLog.findMany({ orderBy: { date: "asc" }, take: 3000 }),
    prisma.leadStageHistory.findMany({
      where: { changedById: { not: null } },
      include: { lead: { select: { name: true } } },
      orderBy: { changedAt: "asc" },
      take: 5000,
    }),
    prisma.discoveryOutcome.findMany({
      where: { enteredById: { not: null } },
      select: { enteredById: true, callDate: true, highlyQualified: true },
      take: 5000,
    }),
    prisma.milestoneLog.findMany({
      where: { updatedById: { not: null } },
      include: { enrollment: { select: { student: { select: { fullName: true } } } } },
      take: 5000,
    }),
    prisma.signalChangeLog.findMany({ where: { changedById: { not: null } }, take: 5000 }),
    prisma.oKR.findMany({ include: { teamProfile: { select: { userId: true } } } }),
  ]);

  const playerIds = new Set(profiles.map((p) => p.userId!));

  const inputs: GameInputs = {
    todayKey,
    users: profiles.map((p) => ({
      userId: p.userId!,
      name: p.fullName,
      roleTitle: p.roleTitle,
      variant: p.logVariant as DailyLogVariant,
    })),
    logs: logs
      .filter((l) => playerIds.has(l.userId))
      .map((l) => ({
        userId: l.userId,
        dateKey: dateKeyOf(l.date),
        values: Object.fromEntries(
          LOG_FIELDS.map((f) => [f, l[f]]).filter(([, v]) => v !== null && v !== undefined),
        ) as Record<string, number>,
      })),
    stageMoves: stageHistory
      .filter((s) => playerIds.has(s.changedById!))
      .map((s) => ({
        userId: s.changedById!,
        dateKey: istDayKey(s.changedAt),
        toStage: s.toStage,
        leadName: s.lead.name,
      })),
    outcomes: outcomes
      .filter((o) => playerIds.has(o.enteredById!))
      .map((o) => ({
        userId: o.enteredById!,
        dateKey: dateKeyOf(o.callDate),
        highlyQualified: o.highlyQualified,
      })),
    milestoneMoves: milestoneLogs
      .filter((m) => playerIds.has(m.updatedById!))
      .map((m) => ({
        userId: m.updatedById!,
        dateKey: istDayKey(m.date),
        previousMilestone: m.previousMilestone,
        newMilestone: m.newMilestone,
        studentName: m.enrollment.student.fullName,
      })),
    signalMoves: signalLogs
      .filter((s) => playerIds.has(s.changedById!))
      .map((s) => ({
        userId: s.changedById!,
        dateKey: istDayKey(s.date),
        previousSignal: s.previousSignal,
        newSignal: s.newSignal,
      })),
    okrs: okrs
      .filter((o) => o.teamProfile.userId && playerIds.has(o.teamProfile.userId))
      .map((o) => ({
        userId: o.teamProfile.userId!,
        monthKey: monthKeyOf(dateKeyOf(o.month)),
        completionPct: okrCompletionPct(o),
      })),
  };

  const { players } = computeTeamGame(inputs);

  const rank = (key: "xpWeek" | "xpMonth" | "xpTotal") => {
    const order = [...players].sort((a, b) => b[key] - a[key] || b.xpTotal - a.xpTotal);
    return new Map(order.map((p, i) => [p.userId, i + 1]));
  };
  const rw = rank("xpWeek");
  const rm = rank("xpMonth");
  const ra = rank("xpTotal");

  const ranked: RankedPlayer[] = players
    .map((p) => ({
      ...p,
      rankWeek: rw.get(p.userId)!,
      rankMonth: rm.get(p.userId)!,
      rankAll: ra.get(p.userId)!,
    }))
    .sort((a, b) => a.rankWeek - b.rankWeek);

  const feed = ranked
    .flatMap((p) => p.events.slice(0, 40).map((e) => ({ ...e, name: p.name })))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 30);

  return { todayKey, weekStart: weekStartKey(todayKey), monthKey: monthKeyOf(todayKey), players: ranked, feed };
});

/** This user's player card, or null when they don't play (no team profile / Admin). */
export async function getMyGame(userId: string): Promise<{ me: RankedPlayer; playerCount: number } | null> {
  const game = await getTeamGame();
  const me = game.players.find((p) => p.userId === userId);
  return me ? { me, playerCount: game.players.length } : null;
}
