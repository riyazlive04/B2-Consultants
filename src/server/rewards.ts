import "server-only";
import { cache } from "react";
import type { Prisma, RewardGrantStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTodayInrPerEur } from "@/lib/fx";
import { parseRewardTrigger } from "@/lib/config-schema";
import { evaluateRewards, type RewardPlayer, type RewardRule } from "@/lib/rewards";
import type { AppRole } from "@/lib/sections";
import { getActiveGoals } from "./goals";
import { getTeamGame } from "./gamification";

/**
 * The reward ledger. Rules describe what earns a payout; grants are the payouts
 * themselves, one per (rule, person, period).
 *
 * `syncRewardGrants` re-derives EVERY qualification in history on every call and
 * inserts what's missing. That is safe — and the reason the design works — because
 * `@@unique([ruleId, teamProfileId, periodKey])` turns a re-insert into a no-op:
 *   · editing a rule and rescanning never double-pays,
 *   · a grant the founder DECLINED is never resurrected as PENDING,
 *   · amounts and the FX rate are stamped on the grant at creation, so later edits
 *     to the rule (or a move in the rate) never re-price what someone already earned.
 */

export type RewardRuleRow = Awaited<ReturnType<typeof listRewardRules>>[number];

const dateOf = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`);

export async function listRewardRules() {
  const rows = await prisma.rewardRule.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    ...r,
    // A trigger that no longer parses (a metric renamed in code) surfaces in the
    // console as broken instead of throwing the page.
    parsedTrigger: parseRewardTrigger(r.trigger),
  }));
}

/**
 * Re-derive every qualification and insert the new ones as PENDING.
 * Returns how many grants were created. Idempotent — call it as often as you like.
 */
export async function syncRewardGrants(): Promise<number> {
  const [rules, game, goals] = await Promise.all([listRewardRules(), getTeamGame(), getActiveGoals()]);

  const active: RewardRule[] = rules
    .filter((r) => r.active && r.parsedTrigger !== null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      active: r.active,
      trigger: r.parsedTrigger!,
      roles: r.roles as AppRole[],
    }));
  if (active.length === 0) return 0;

  const players: RewardPlayer[] = game.players.map((p) => ({ ...p, role: p.role as AppRole }));
  const qualifications = evaluateRewards({ todayKey: game.todayKey, players, rules: active, goals });
  if (qualifications.length === 0) return 0;

  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const profileByUserId = new Map(game.players.map((p) => [p.userId, p.teamProfileId]));
  const { rate } = await getTodayInrPerEur();

  const data: Prisma.RewardGrantCreateManyInput[] = qualifications.flatMap((q) => {
    const rule = ruleById.get(q.ruleId);
    const teamProfileId = profileByUserId.get(q.userId);
    if (!rule || !teamProfileId) return [];
    return [{
      ruleId: rule.id,
      teamProfileId,
      periodKey: q.periodKey,
      qualifiedOn: dateOf(q.qualifiedOn),
      reason: q.reason,
      amountInrMinor: rule.amountInrMinor,
      amountEurMinor: rule.amountEurMinor,
      fxRateUsed: rate,
    }];
  });

  const { count } = await prisma.rewardGrant.createMany({ data, skipDuplicates: true });
  return count;
}

export type GrantRow = {
  id: string;
  ruleName: string;
  ruleKind: string;
  perkLabel: string | null;
  personName: string;
  periodKey: string;
  qualifiedOn: Date;
  reason: string;
  status: RewardGrantStatus;
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
  decidedAt: Date | null;
};

export const listRewardGrants = cache(async (): Promise<GrantRow[]> => {
  const rows = await prisma.rewardGrant.findMany({
    include: {
      rule: { select: { name: true, kind: true, perkLabel: true } },
      teamProfile: { select: { fullName: true } },
    },
    orderBy: [{ status: "asc" }, { qualifiedOn: "desc" }],
    take: 400,
  });
  return rows.map((g) => ({
    id: g.id,
    ruleName: g.rule.name,
    ruleKind: g.rule.kind,
    perkLabel: g.rule.perkLabel,
    personName: g.teamProfile.fullName,
    periodKey: g.periodKey,
    qualifiedOn: g.qualifiedOn,
    reason: g.reason,
    status: g.status,
    amountInrMinor: g.amountInrMinor,
    amountEurMinor: g.amountEurMinor,
    fxRateUsed: g.fxRateUsed,
    decidedAt: g.decidedAt,
  }));
});

export async function countPendingGrants(): Promise<number> {
  return prisma.rewardGrant.count({ where: { status: "PENDING" } });
}
