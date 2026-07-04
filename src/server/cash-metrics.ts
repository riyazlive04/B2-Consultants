import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
import { getPendingRows } from "./finance-metrics";

/**
 * Cash Health (PRD3 §4). Every cross-phase number here is a native query:
 *  - receivables ← Phase 1 pending payments (shared getPendingRows)
 *  - burn        ← Phase 1 expenses, average of the last 3 full months + current
 *  - break-even  ← active payables, normalised to monthly
 */

/** Monthly-equivalent of a payable (quarterly/3, annual/12; one-time excluded). */
function monthlyEquivalentInr(p: { amountInrMinor: bigint; frequency: string }): number {
  const v = Number(p.amountInrMinor);
  switch (p.frequency) {
    case "MONTHLY": return v;
    case "QUARTERLY": return v / 3;
    case "ANNUAL": return v / 12;
    default: return 0;
  }
}

/**
 * Runway core - shared by the Cash Health page and the top-bar badge.
 * burn = average monthly expenses over the LAST 3 CALENDAR MONTHS (PRD3 §4.4);
 * runway = latest bank balance ÷ burn, 1 decimal.
 */
export const getRunwaySnapshot = cache(async () => {
  const today = istToday();
  const threeMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
  const thisMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const [latestCash, expenses] = await Promise.all([
    prisma.cashPosition.findFirst({ orderBy: { date: "desc" } }),
    prisma.expense.findMany({
      where: { date: { gte: threeMonthsAgo, lt: thisMonthStart } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
  ]);

  const totalExpensesInr = expenses.reduce(
    (a, e) => a + Number(aggInrMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
    0,
  );
  const burnInr = totalExpensesInr / 3;
  const cashInr = latestCash ? Number(latestCash.bankBalanceInrMinor) : null;
  const runwayMonths = cashInr !== null && burnInr > 0 ? Math.round((cashInr / burnInr) * 10) / 10 : null;

  return {
    cashInr,
    cashDate: latestCash?.date.toISOString() ?? null,
    cashStale: latestCash ? today.getTime() - latestCash.date.getTime() > 7 * 86400000 : true,
    burnInr,
    runwayMonths,
  };
});

export async function getCashOverview() {
  const today = istToday();
  const month = istMonthRange(today);
  const twelveWeeksAgo = new Date(today);
  twelveWeeksAgo.setUTCDate(today.getUTCDate() - 12 * 7);

  const [runway, positions, pendingRows, payables, monthIncomes, growthSetting, monthlyRevenue] =
    await Promise.all([
      getRunwaySnapshot(),
      prisma.cashPosition.findMany({
        where: { date: { gte: twelveWeeksAgo } },
        orderBy: { date: "asc" },
      }),
      getPendingRows(),
      prisma.payable.findMany({ orderBy: { nextDueDate: "asc" } }),
      prisma.income.findMany({
        where: { date: { gte: month.start, lt: month.end } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
      prisma.appSetting.findUnique({ where: { key: "runwayGrowthRatePct" } }),
      // revenue for the last 4 months (growth-rate estimate)
      prisma.income.findMany({
        where: { date: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1)) } },
        select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
    ]);

  // ── Receivables (auto-pull from Phase 1, PRD3 §4.2) ──
  const active = pendingRows.filter((p) => p.status === "ACTIVE" && p.balance.inr > 0);
  const overdue = active.filter((p) => p.overdue);
  const in30 = active.filter((p) => {
    if (!p.nextDueDate) return false;
    const due = new Date(p.nextDueDate).getTime();
    return due >= today.getTime() && due <= today.getTime() + 30 * 86400000;
  });
  const oldestOverdue = overdue.reduce<null | { name: string; daysOverdue: number }>((acc, p) => {
    if (!acc || p.daysOverdue > acc.daysOverdue) return { name: p.studentName, daysOverdue: p.daysOverdue };
    return acc;
  }, null);

  const receivables = {
    totalInr: active.reduce((a, p) => a + p.balance.inr, 0),
    overdueInr: overdue.reduce((a, p) => a + p.balance.inr, 0),
    next30Inr: in30.reduce((a, p) => a + p.balance.inr, 0),
    countWithBalance: active.length,
    oldestOverdue, // warn when >14 days (PRD3 §4.2)
    rows: active.map((p) => ({
      id: p.id,
      studentName: p.studentName,
      balanceInr: p.balance.inr,
      nextDueDate: p.nextDueDate,
      overdue: p.overdue,
      daysOverdue: p.daysOverdue,
    })),
  };

  // ── Payables (PRD3 §4.3) ──
  const activePayables = payables.filter((p) => p.status === "ACTIVE");
  const monthlyFixedInr = activePayables.reduce((a, p) => a + monthlyEquivalentInr(p), 0);
  const dueThisMonth = activePayables.filter(
    (p) => p.nextDueDate && p.nextDueDate >= month.start && p.nextDueDate < month.end,
  );
  const payableRows = payables.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    amountInr: Number(p.amountInrMinor),
    amountInrRaw: p.amountInrMinor.toString(),
    frequency: p.frequency,
    nextDueDate: p.nextDueDate?.toISOString() ?? null,
    isCogs: p.isCogs,
    status: p.status,
    dueSoonUnderfunded:
      p.status === "ACTIVE" && !!p.nextDueDate &&
      p.nextDueDate.getTime() - today.getTime() <= 7 * 86400000 &&
      p.nextDueDate.getTime() >= today.getTime() &&
      runway.cashInr !== null && runway.cashInr < 2 * Number(p.amountInrMinor), // red rule (PRD3 §4.3)
  }));

  // ── Revenue vs break-even + months to ₹8L (PRD3 §4.4) ──
  const revenueThisMonthInr = monthIncomes.reduce(
    (a, i) => a + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    0,
  );

  const monthRevenue = new Map<string, number>();
  for (const i of monthlyRevenue) {
    const k = i.date.toISOString().slice(0, 7);
    monthRevenue.set(k, (monthRevenue.get(k) ?? 0) + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)));
  }
  const series = [...monthRevenue.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  let avgGrowthPct: number | null = null;
  if (series.length >= 2) {
    const growths: number[] = [];
    for (let i = 1; i < series.length; i++) {
      if (series[i - 1] > 0) growths.push(((series[i] - series[i - 1]) / series[i - 1]) * 100);
    }
    if (growths.length) avgGrowthPct = growths.reduce((a, b) => a + b, 0) / growths.length;
  }
  const growthOverridePct = growthSetting ? Number(growthSetting.value) : null;
  const effectiveGrowthPct = growthOverridePct ?? avgGrowthPct;

  const TARGET_INR = 80_000_000; // ₹8,00,000 in paise
  let monthsToTarget: number | null = null;
  if (revenueThisMonthInr >= TARGET_INR) monthsToTarget = 0;
  else if (effectiveGrowthPct !== null && effectiveGrowthPct > 0 && revenueThisMonthInr > 0) {
    let rev = revenueThisMonthInr;
    let m = 0;
    while (rev < TARGET_INR && m < 60) {
      rev *= 1 + effectiveGrowthPct / 100;
      m++;
    }
    monthsToTarget = m < 60 ? m : null;
  }

  return {
    runway,
    monthlyFixedInr, // break-even (PRD3 §4.3/4.4)
    revenueThisMonthInr,
    revenueVsBreakEvenInr: revenueThisMonthInr - monthlyFixedInr,
    growth: { avgGrowthPct, growthOverridePct, effectiveGrowthPct, monthsToTarget },
    chart: positions.map((p) => ({
      date: p.date.toISOString(),
      balanceInr: Number(p.bankBalanceInrMinor),
    })),
    positions: positions
      .slice()
      .reverse()
      .map((p) => ({
        id: p.id,
        date: p.date.toISOString(),
        balanceInr: Number(p.bankBalanceInrMinor),
        balanceRaw: p.bankBalanceInrMinor.toString(),
        personalSavingsInr: p.personalSavingsInrMinor === null ? null : Number(p.personalSavingsInrMinor),
        notes: p.notes,
      })),
    receivables,
    payables: payableRows,
    dueThisMonthInr: dueThisMonth.reduce((a, p) => a + Number(p.amountInrMinor), 0),
  };
}

export type CashOverview = Awaited<ReturnType<typeof getCashOverview>>;
export type PayableRow = CashOverview["payables"][number];
