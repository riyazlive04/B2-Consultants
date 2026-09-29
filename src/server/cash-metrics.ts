import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { cashPeriodStart, istMonthRange, istToday, kpiDateRange, type CashPeriodKey, type KpiRangeKey } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { isRecurring, monthlyEquivalentMinor, nextOccurrence } from "@/lib/payable-frequency";
import { getPendingRows } from "./finance-metrics";

/**
 * Cash Health (PRD3 §4). Every cross-phase number here is a native query:
 *  - receivables ← Phase 1 pending payments (shared getPendingRows)
 *  - burn        ← Phase 1 expenses, average of the last 3 full months + current
 *  - break-even  ← active payables, normalised to monthly
 */

/** Monthly-equivalent of a payable (quarterly/3, annual/12; one-time excluded). */
function monthlyEquivalentInr(p: { amountInrMinor: bigint; frequency: string }): number {
  return monthlyEquivalentMinor(p.amountInrMinor, p.frequency);
}

/**
 * Runway core - shared by the Cash Health page and the top-bar badge.
 * burn = average monthly expenses over the LAST 3 CALENDAR MONTHS (PRD3 §4.4);
 * runway = latest bank balance ÷ burn, 1 decimal.
 *
 * `range` (default "this-month") drives the home page's KPI date-range control. It
 * shifts the "last 3 calendar months" burn window to end at the LAST day the selected
 * range covers, not always today - "Last Month" shows the runway as it stood at the end
 * of last month. "This Month"/"QTD" both end today, so they match the original
 * always-today anchor exactly. Every caller that doesn't pass `range` (the top-bar badge,
 * the notification centre, Cash Health's getCashOverview) keeps today's exact behavior.
 */
export const getRunwaySnapshot = cache(async (range: KpiRangeKey = "this-month") => {
  const today = istToday();
  const { end: rangeEnd } = kpiDateRange(range, today);
  const anchor = new Date(Math.min(rangeEnd.getTime() - 86400000, today.getTime()));
  const threeMonthsAgo = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 3, 1));
  const thisMonthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));

  const [latestCash, expenses] = await Promise.all([
    prisma.cashPosition.findFirst({ orderBy: { date: "desc" } }),
    prisma.expense.findMany({
      where: { ...ACTIVE, date: { gte: threeMonthsAgo, lt: thisMonthStart } },
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
  ]);

  const totalExpensesInr = expenses.reduce(
    (a, e) => a + Number(aggInrMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
    0,
  );
  // Average over the months that actually have expense data, not a flat /3 -
  // a young business (or an un-backfilled month) would otherwise dilute burn
  // and overstate runway, silencing the <3/<6-month alerts.
  const monthsWithData = new Set(
    expenses.map((e) => `${e.date.getUTCFullYear()}-${e.date.getUTCMonth()}`),
  ).size;
  const burnInr = monthsWithData > 0 ? totalExpensesInr / monthsWithData : 0;
  const cashInr = latestCash ? Number(latestCash.bankBalanceInrMinor) : null;
  const runwayMonths = cashInr !== null && burnInr > 0 ? Math.round((cashInr / burnInr) * 10) / 10 : null;

  return {
    cashInr,
    cashDate: latestCash?.date.toISOString() ?? null,
    // Staleness is real-world (vs actual today), not range-relative - an old cash figure
    // is stale regardless of which KPI range you're viewing.
    cashStale: latestCash ? today.getTime() - latestCash.date.getTime() > 7 * 86400000 : true,
    burnInr,
    runwayMonths,
  };
});

export async function getCashOverview(period: CashPeriodKey = "12w") {
  const today = istToday();
  const month = istMonthRange(today);
  // F6: the chart window is now selectable; 12 weeks stays the default so every existing
  // caller (and a bare /cash visit) renders exactly what it did before.
  const chartFrom = cashPeriodStart(period, today);

  const [runway, positions, pendingRows, payables, monthIncomes, growthSetting, monthlyRevenue] =
    await Promise.all([
      getRunwaySnapshot(),
      prisma.cashPosition.findMany({
        where: { date: { gte: chartFrom } },
        orderBy: { date: "asc" },
      }),
      getPendingRows(),
      prisma.payable.findMany({ orderBy: { nextDueDate: "asc" } }),
      prisma.income.findMany({
        where: { ...ACTIVE, date: { gte: month.start, lt: month.end } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
      prisma.appSetting.findUnique({ where: { key: "runwayGrowthRatePct" } }),
      // revenue for the last 4 months (growth-rate estimate)
      prisma.income.findMany({
        where: { ...ACTIVE, date: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1)) } },
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
      // `studentId` carries the student CODE through to the age analysis (Error Log G3 /
      // I1): two students called "Anna Smith" is a real case here and has already caused a
      // payment to be credited to the wrong one, so a name on its own is not an identifier.
      studentId: p.studentId,
      balanceInr: p.balance.inr,
      // The denominator for that student's ageing bar (G2). Without it a bar can only be
      // scaled against the largest value in the set, which is what made ₹75,000 of an agreed
      // ₹1,25,000 render as "owes everything".
      totalFeeInr: p.totalFee.inr,
      nextDueDate: p.nextDueDate,
      overdue: p.overdue,
      daysOverdue: p.daysOverdue,
    })),
  };

  // ── Payables (PRD3 §4.3) ──
  const activePayables = payables.filter((p) => p.status === "ACTIVE");
  const monthlyFixedInr = activePayables.reduce((a, p) => a + monthlyEquivalentInr(p), 0);

  /**
   * Money already promised that recurs never - and therefore falls through EVERY other
   * figure on this page:
   *
   *   · break-even  - `monthlyEquivalentMinor` returns 0 for ONE_TIME, correctly: a one-off
   *                   is not a standing commitment and must not raise the line forever;
   *   · burn        - burn reads Expense, and a payable becomes an expense only once PAID;
   *   · due-this-month / dueSoonUnderfunded - both go through `dueOf`, which needs a
   *                   `nextDueDate`, and a one-time payable is routinely entered without one.
   *
   * Each of those rules is right on its own. Together they left a hole exactly where the
   * largest number sits: a ₹3,00,000 one-time payable against a ₹6,45,000 balance was
   * invisible while the gauge read 3.4 months. So it gets its own line, and its own runway.
   *
   * Deliberately NOT folded into `burnInr`: burn is a RATE (₹/month) and this is a STOCK
   * (₹, once). Dividing a one-off by a month would understate runway just as badly as
   * ignoring it overstates it. The honest treatment is to take it off the top of cash.
   */
  const committedOneTimeInr = activePayables
    .filter((p) => !isRecurring(p.frequency))
    .reduce((a, p) => a + Number(p.amountInrMinor), 0);
  const cashAfterCommitmentsInr =
    runway.cashInr === null ? null : runway.cashInr - committedOneTimeInr;
  const runwayAfterCommitmentsMonths =
    cashAfterCommitmentsInr !== null && runway.burnInr > 0
      ? Math.round((cashAfterCommitmentsInr / runway.burnInr) * 10) / 10
      : null;
  /** The occurrence every figure below reads, so the table, the KPI and the alert agree (H5). */
  const dueOf = (p: { nextDueDate: Date | null; frequency: string }) =>
    p.nextDueDate ? nextOccurrence(p.nextDueDate, p.frequency, today) : null;
  const dueThisMonth = activePayables.filter((p) => {
    const due = dueOf(p);
    return due && due >= month.start && due < month.end;
  });
  const payableRows = payables.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    amountInr: Number(p.amountInrMinor),
    amountInrRaw: p.amountInrMinor.toString(),
    frequency: p.frequency,
    // H5: a recurring payable's stored date is the ANCHOR it was set up with, not its next
    // occurrence - a monthly payable entered in January still read "15 Jan" in July. Rolled
    // forward at read time so the column tells the truth; the stored row is left untouched, so
    // the "due on the 15th" fact survives however long the page goes unvisited.
    nextDueDate: dueOf(p)?.toISOString() ?? null,
    isCogs: p.isCogs,
    status: p.status,
    dueSoonUnderfunded:
      p.status === "ACTIVE" && !!dueOf(p) &&
      dueOf(p)!.getTime() - today.getTime() <= 7 * 86400000 &&
      dueOf(p)!.getTime() >= today.getTime() &&
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
    /** Promised, non-recurring, and not yet paid - see the note at the computation. */
    commitments: {
      oneTimeInr: committedOneTimeInr,
      cashAfterInr: cashAfterCommitmentsInr,
      runwayAfterMonths: runwayAfterCommitmentsMonths,
      count: activePayables.filter((p) => !isRecurring(p.frequency)).length,
    },
  };
}

export type CashOverview = Awaited<ReturnType<typeof getCashOverview>>;
export type PayableRow = CashOverview["payables"][number];
