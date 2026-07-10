import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istMonthRange } from "@/lib/dates";
import { aggInrMinor, aggEurMinor } from "@/lib/money";
import { LOG_FIELD_SHORT } from "@/lib/labels";

/**
 * Telecaller Pay board (Admin-only). Lists the telecallers (USER-role team members
 * who make calls — appointment setters + discovery specialists), each with this
 * month's call activity pulled from their daily logs as context for the reward,
 * plus every bonus/commission Ameen has assigned for the month.
 *
 * Money follows the app rule (CONTEXT §6): stored as INR + EUR minor units with the
 * FX rate stamped per row; aggregates roll each row up at its own stored rate.
 */

// Which daily-log fields count as "calls" for each telecaller function.
const CALL_FIELDS: Record<string, string[]> = {
  APPOINTMENT_SETTER: ["appointmentsSet", "newLeadsContacted", "followUpMessagesSent"],
  DISCOVERY_SPECIALIST: ["discoveryCallsCompleted", "highlyQualifiedCalls", "followUpsDone"],
};

export type CallStat = { key: string; label: string; value: number };

export type TelecallerRow = {
  teamProfileId: string;
  name: string;
  roleTitle: string;
  logVariant: string;
  calls: CallStat[];
  assignedInrMinor: number; // this month's bonus+commission, aggregated to INR
  payoutCount: number;
};

export type PayoutRow = {
  id: string;
  teamProfileId: string;
  name: string;
  bonusInrRaw: string;
  bonusEurRaw: string;
  commInrRaw: string;
  commEurRaw: string;
  aggInrMinor: number; // bonus + commission, rolled to INR at the stamped rate
  reason: string;
  status: "PENDING" | "PAID";
  enteredBy: string | null;
  createdAt: string;
};

export type TelecallerBoard = {
  month: string; // YYYY-MM
  monthLabel: string; // "July 2026"
  telecallers: TelecallerRow[];
  teamOptions: { value: string; label: string }[];
  payouts: PayoutRow[];
  totals: {
    bonusInrMinor: number;
    commInrMinor: number;
    totalInrMinor: number;
    totalEurMinor: number;
    paidInrMinor: number;
    pendingInrMinor: number;
    rewardedCount: number;
  };
};

/** Resolve a `YYYY-MM` param (or the current IST month) to its first-of-month UTC date. */
export function monthRef(month?: string): Date {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  const t = istToday();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
}

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export async function getTelecallerBoard(month?: string): Promise<TelecallerBoard> {
  const ref = monthRef(month);
  const { start, end } = istMonthRange(ref);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(ref);

  const [telecallers, payouts] = await Promise.all([
    prisma.teamProfile.findMany({
      where: {
        status: "ACTIVE",
        logVariant: { in: ["APPOINTMENT_SETTER", "DISCOVERY_SPECIALIST"] },
      },
      orderBy: [{ orderIndex: "asc" }, { fullName: "asc" }],
    }),
    prisma.telecallerPayout.findMany({
      where: { month: ref },
      include: {
        teamProfile: { select: { fullName: true } },
        enteredBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Call activity this month, per linked user, summed from daily logs.
  const userIds = telecallers.map((t) => t.userId).filter((id): id is string => !!id);
  const logs = userIds.length
    ? await prisma.dailyLog.findMany({
        where: { userId: { in: userIds }, date: { gte: start, lt: end } },
      })
    : [];
  const callsByUser = new Map<string, Record<string, number>>();
  for (const log of logs) {
    const acc = callsByUser.get(log.userId) ?? {};
    for (const field of CALL_FIELDS[log.variant] ?? []) {
      const v = (log as unknown as Record<string, number | null>)[field];
      if (typeof v === "number") acc[field] = (acc[field] ?? 0) + v;
    }
    callsByUser.set(log.userId, acc);
  }

  // Aggregate each payout row to INR/EUR at its own stamped rate.
  const rowAggInr = (p: (typeof payouts)[number]) =>
    Number(aggInrMinor(p.bonusInrMinor + p.commInrMinor, p.bonusEurMinor + p.commEurMinor, p.fxRateUsed));
  const rowAggEur = (p: (typeof payouts)[number]) =>
    Number(aggEurMinor(p.bonusInrMinor + p.commInrMinor, p.bonusEurMinor + p.commEurMinor, p.fxRateUsed));

  const assignedByProfile = new Map<string, { inr: number; count: number }>();
  for (const p of payouts) {
    const cur = assignedByProfile.get(p.teamProfileId) ?? { inr: 0, count: 0 };
    cur.inr += rowAggInr(p);
    cur.count += 1;
    assignedByProfile.set(p.teamProfileId, cur);
  }

  const telecallerRows: TelecallerRow[] = telecallers.map((t) => {
    const acc = t.userId ? callsByUser.get(t.userId) ?? {} : {};
    const calls: CallStat[] = (CALL_FIELDS[t.logVariant] ?? []).map((key) => ({
      key,
      label: LOG_FIELD_SHORT[key] ?? key,
      value: acc[key] ?? 0,
    }));
    const assigned = assignedByProfile.get(t.id);
    return {
      teamProfileId: t.id,
      name: t.fullName,
      roleTitle: t.roleTitle,
      logVariant: t.logVariant,
      calls,
      assignedInrMinor: assigned?.inr ?? 0,
      payoutCount: assigned?.count ?? 0,
    };
  });

  const payoutRows: PayoutRow[] = payouts.map((p) => ({
    id: p.id,
    teamProfileId: p.teamProfileId,
    name: p.teamProfile.fullName,
    bonusInrRaw: p.bonusInrMinor.toString(),
    bonusEurRaw: p.bonusEurMinor.toString(),
    commInrRaw: p.commInrMinor.toString(),
    commEurRaw: p.commEurMinor.toString(),
    aggInrMinor: rowAggInr(p),
    reason: p.reason,
    status: p.status,
    enteredBy: p.enteredBy?.name ?? null,
    createdAt: p.createdAt.toISOString(),
  }));

  const totals = payouts.reduce(
    (acc, p) => {
      const bonusInr = Number(aggInrMinor(p.bonusInrMinor, p.bonusEurMinor, p.fxRateUsed));
      const commInr = Number(aggInrMinor(p.commInrMinor, p.commEurMinor, p.fxRateUsed));
      const totalInr = rowAggInr(p);
      acc.bonusInrMinor += bonusInr;
      acc.commInrMinor += commInr;
      acc.totalInrMinor += totalInr;
      acc.totalEurMinor += rowAggEur(p);
      if (p.status === "PAID") acc.paidInrMinor += totalInr;
      else acc.pendingInrMinor += totalInr;
      return acc;
    },
    { bonusInrMinor: 0, commInrMinor: 0, totalInrMinor: 0, totalEurMinor: 0, paidInrMinor: 0, pendingInrMinor: 0, rewardedCount: 0 },
  );
  totals.rewardedCount = assignedByProfile.size;

  return {
    month: monthKey(ref),
    monthLabel,
    telecallers: telecallerRows,
    teamOptions: telecallers.map((t) => ({ value: t.id, label: t.fullName })),
    payouts: payoutRows,
    totals,
  };
}
