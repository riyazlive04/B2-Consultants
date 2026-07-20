import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday, istYearRange } from "@/lib/dates";
import { aggEurMinor, aggInrMinor, sumAgg } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { levelKinds } from "./levels";
import { lineForKind, type BusinessLine } from "@/lib/business-line";

/**
 * Finance dashboard numbers (PRD1 §4.5) - all computed, nothing stored.
 * Aggregates use each record's own stamped FX rate; BigInt → number only at the
 * DTO boundary (paise fit comfortably in Number).
 */

export type Money2 = { inr: number; eur: number };

const toMoney2 = (v: { inr: bigint; eur: bigint }): Money2 => ({
  inr: Number(v.inr),
  eur: Number(v.eur),
});

/** Match incomes to a pending-payment row: linked studentId wins, else exact name (case/space-insensitive). */
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Pending-payment rows with computed paid-so-far / balance / overdue.
 * SHARED: Finance tab (Phase 1) and Cash Health receivables (Phase 3) both read
 * this - the PRD3 "auto-pull, no duplicate entry" connection is this one function.
 */
export const getPendingRows = cache(async () => {
  const today = istToday();
  const [allPendings, allIncomes] = await Promise.all([
    prisma.pendingPayment.findMany({
      where: ACTIVE,
      orderBy: { nextDueDate: "asc" },
      include: { instalments: { orderBy: { seq: "asc" } } },
    }),
    prisma.income.findMany({
      where: ACTIVE,
      select: {
        studentId: true, studentName: true,
        amountInrMinor: true, amountEurMinor: true, fxRateUsed: true,
      },
    }),
  ]);

  const paidByStudentId = new Map<string, { inr: number; eur: number }>();
  const paidByName = new Map<string, { inr: number; eur: number }>();
  for (const i of allIncomes) {
    const agg = {
      inr: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
      eur: Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    };
    if (i.studentId) {
      const cur = paidByStudentId.get(i.studentId) ?? { inr: 0, eur: 0 };
      paidByStudentId.set(i.studentId, { inr: cur.inr + agg.inr, eur: cur.eur + agg.eur });
    }
    const key = nameKey(i.studentName);
    const cur = paidByName.get(key) ?? { inr: 0, eur: 0 };
    paidByName.set(key, { inr: cur.inr + agg.inr, eur: cur.eur + agg.eur });
  }

  const todayMs = today.getTime();
  return allPendings.map((p) => {
    const fee = {
      inr: Number(aggInrMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed)),
      eur: Number(aggEurMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed)),
    };
    // Id-linked rows NEVER fall back to name matching: two students sharing a
    // name would otherwise cross-credit payments and silently zero a real
    // receivable. Name matching is only for rows with no student link at all.
    const paid = p.studentId
      ? paidByStudentId.get(p.studentId) ?? { inr: 0, eur: 0 }
      : paidByName.get(nameKey(p.studentName)) ?? { inr: 0, eur: 0 };
    const balance = { inr: Math.max(0, fee.inr - paid.inr), eur: Math.max(0, fee.eur - paid.eur) };
    // A receivable is overdue when it is still owed and past its due date. It used to require
    // status === "ACTIVE", which is backwards: once the nightly sweep (or a manual edit) escalated
    // a row to the OVERDUE *status*, this flag flipped to FALSE, so the most-overdue payments
    // silently dropped out of the red badge, the KPI count and the dashboard alert (§8.4 —
    // "overdue numbers look wrong"). Both live statuses that can still owe money count; PAID_IN_FULL
    // and DROPPED never do. `balance.inr > 0` guards the case where the money is in but the status
    // simply hasn't been reconciled yet.
    const owing = p.status === "ACTIVE" || p.status === "OVERDUE";
    const overdue = owing && balance.inr > 0 && !!p.nextDueDate && p.nextDueDate.getTime() < todayMs;
    return {
      id: p.id,
      studentName: p.studentName,
      studentId: p.studentId,
      programLevel: p.programLevel,
      totalFee: fee,
      totalFeeInrRaw: p.totalFeeInrMinor.toString(),
      totalFeeEurRaw: p.totalFeeEurMinor.toString(),
      paidSoFar: paid,
      balance,
      nextDueDate: p.nextDueDate?.toISOString() ?? null,
      status: p.status,
      overdue, // display rule: red row (PRD1 §4.4)
      notes: p.notes,
      instalments: p.instalments.map((it) => ({
        id: it.id,
        seq: it.seq,
        inr: Number(it.amountInrMinor),
        eur: Number(it.amountEurMinor),
        dueDate: it.dueDate.toISOString(),
        paidDate: it.paidDate?.toISOString() ?? null,
        status: it.status,
      })),
      daysOverdue:
        owing && p.nextDueDate
          ? Math.max(0, Math.floor((todayMs - p.nextDueDate.getTime()) / 86400000))
          : 0,
    };
  });
});

export async function getFinanceOverview() {
  const today = istToday();
  const month = istMonthRange(today);
  const year = istYearRange(today);

  // Same-day window into LAST month (day 1..today's day) — the honest month-over-
  // month comparator mid-month; comparing a part-month to a full month always lies.
  const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const prevSameDayEnd = new Date(
    Math.min(
      Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), today.getUTCDate() + 1),
      month.start.getTime(),
    ),
  );

  const [monthIncomes, monthExpenses, yearIncomes, pendingRows, incomeList, expenseList, prevIncomes, prevExpenses] =
    await Promise.all([
      prisma.income.findMany({ where: { ...ACTIVE, date: { gte: month.start, lt: month.end } } }),
      prisma.expense.findMany({ where: { ...ACTIVE, date: { gte: month.start, lt: month.end } } }),
      prisma.income.findMany({
        where: { ...ACTIVE, date: { gte: year.start, lt: year.end } },
        // programLevel rides along so year-to-date can be split by business line (§1).
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true, programLevel: true },
      }),
      getPendingRows(),
      // Table rows fetched alongside the aggregates - not as extra serial round-trips. The cap
      // exists so a huge roster can't blow up the payload; it's set well above realistic lifetime
      // volume so the visible table (and its CSV export) don't silently drop older rows the way a
      // 500-cap did. The real scoping fix is the date/course filter (issue 3.10) below.
      prisma.income.findMany({ where: ACTIVE, orderBy: { date: "desc" }, take: 5000 }),
      prisma.expense.findMany({ where: ACTIVE, orderBy: { date: "desc" }, take: 5000 }),
      prisma.income.findMany({
        where: { ...ACTIVE, date: { gte: prevMonthStart, lt: prevSameDayEnd } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
      prisma.expense.findMany({
        where: { ...ACTIVE, date: { gte: prevMonthStart, lt: prevSameDayEnd } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
    ]);

  const revenue = sumAgg(monthIncomes);
  const expenses = sumAgg(monthExpenses);
  const cogs = sumAgg(monthExpenses.filter((e) => e.isCogs));
  const gross = { inr: revenue.inr - cogs.inr, eur: revenue.eur - cogs.eur };
  const net = { inr: revenue.inr - expenses.inr, eur: revenue.eur - expenses.eur };
  const margin = revenue.inr > BigInt(0) ? (Number(net.inr) / Number(revenue.inr)) * 100 : 0;

  // Revenue by level (PRD1: Solo | Guided | Elite | German Note - this month)
  const byLevel: Record<"SOLO" | "GUIDED" | "ELITE" | "GERMAN_NOTE" | "OTHER", Money2> = {
    SOLO: { inr: 0, eur: 0 }, GUIDED: { inr: 0, eur: 0 }, ELITE: { inr: 0, eur: 0 },
    GERMAN_NOTE: { inr: 0, eur: 0 }, OTHER: { inr: 0, eur: 0 },
  };
  // Bucket by the level's KIND, not a "GN_" name-prefix: a German level added with any code
  // (e.g. "C1") still rolls into German Note. Coaching tiers keep their own columns.
  const kindByLevel = await levelKinds();
  for (const i of monthIncomes) {
    const kind = kindByLevel.get(i.programLevel);
    const bucket =
      kind === "GERMAN_LEVEL" || kind === "GERMAN_BUNDLE"
        ? "GERMAN_NOTE"
        : i.programLevel === "SOLO" || i.programLevel === "GUIDED" || i.programLevel === "ELITE"
          ? i.programLevel
          : "OTHER";
    byLevel[bucket].inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    byLevel[bucket].eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
  }

  // ── Business-line segmentation (§1): B2 vs German Note vs Combined ──────────
  //
  // Revenue, collections and receivables split EXACTLY, because every income and
  // receivable row names a programme level and the level's kind decides the line.
  //
  // Costs now carry their OWN line (Expense.businessLine). A cost tagged B2 or GERMAN_NOTE
  // lands wholly on that line; only SHARED costs — rent, ads, tooling — are apportioned by
  // revenue share. That distinction is what makes per-line margin and runway meaningful:
  // when EVERY cost is allocated by revenue share, net÷revenue is identical for both lines
  // by construction, so the metric can only ever repeat the combined number back.
  //
  // Both lines still reconcile exactly to the combined P&L, because the tagged costs are
  // partitioned and the shared remainder is split by shares that sum to 1.
  const lineOfLevel = (levelCode: string): BusinessLine => lineForKind(kindByLevel.get(levelCode));

  const emptyLine = () => ({ revenue: { inr: 0, eur: 0 }, ytd: { inr: 0, eur: 0 }, receivables: { inr: 0, eur: 0 } });
  const lines: Record<BusinessLine, ReturnType<typeof emptyLine>> = {
    B2: emptyLine(),
    GERMAN_NOTE: emptyLine(),
  };

  for (const i of monthIncomes) {
    const l = lines[lineOfLevel(i.programLevel)];
    l.revenue.inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    l.revenue.eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
  }
  for (const i of yearIncomes) {
    const l = lines[lineOfLevel(i.programLevel)];
    l.ytd.inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    l.ytd.eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
  }

  // Daily series per line, on the same continuous calendar as the combined series.
  const dailyByLine: Record<BusinessLine, Map<string, number>> = {
    B2: new Map(),
    GERMAN_NOTE: new Map(),
  };
  for (const i of monthIncomes) {
    const m = dailyByLine[lineOfLevel(i.programLevel)];
    const k = i.date.toISOString().slice(0, 10);
    m.set(k, (m.get(k) ?? 0) + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)));
  }

  const receivableRows = pendingRows.filter(
    (p) => (p.status === "ACTIVE" || p.status === "OVERDUE") && p.balance.inr > 0,
  );
  for (const p of receivableRows) {
    const l = lines[lineOfLevel(p.programLevel)];
    l.receivables.inr += p.balance.inr;
    l.receivables.eur += p.balance.eur;
  }
  const receivables = receivableRows.reduce(
    (acc, p) => ({ inr: acc.inr + p.balance.inr, eur: acc.eur + p.balance.eur }),
    { inr: 0, eur: 0 },
  );

  // Daily revenue for the current month.
  //
  // §3.5: this used to be a map of only the days that HAD income, so a month with
  // takings on the 2nd, 9th and 20th produced a 3-point chart whose x-axis pretended
  // those days were adjacent — a flat week of zero collections looked identical to
  // three consecutive good days. The series is now continuous, one entry per calendar
  // day from the 1st to today, so gaps read as the gaps they are. `cumulativeInr`
  // rides along because the running total is what gets compared to the target.
  const daily = new Map<string, number>();
  for (const i of monthIncomes) {
    const k = i.date.toISOString().slice(0, 10);
    daily.set(k, (daily.get(k) ?? 0) + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)));
  }
  const daysElapsed = today.getUTCDate();
  let running = 0;
  const revenueSeries = Array.from({ length: daysElapsed }, (_, idx) => {
    const d = new Date(Date.UTC(month.start.getUTCFullYear(), month.start.getUTCMonth(), idx + 1));
    const key = d.toISOString().slice(0, 10);
    const inr = daily.get(key) ?? 0;
    running += inr;
    return { date: key, inr, cumulativeInr: running };
  });
  const revenueSpark = revenueSeries.map((p) => p.inr);

  // Per-line view models. Shared costs follow revenue share, so B2 + German Note always
  // reconcile exactly to the combined P&L (a hand-tagged split would leave a remainder).
  // A line with no revenue this month carries no shared cost rather than an NaN share.
  const totalRevInr = Number(revenue.inr);

  // Costs that name a line, and the shared pool that doesn't.
  const ownExpenses = (bl: BusinessLine) => sumAgg(monthExpenses.filter((e) => e.businessLine === bl));
  const ownCogs = (bl: BusinessLine) =>
    sumAgg(monthExpenses.filter((e) => e.businessLine === bl && e.isCogs));
  const sharedExpenses = sumAgg(monthExpenses.filter((e) => e.businessLine === "SHARED"));
  const sharedCogs = sumAgg(monthExpenses.filter((e) => e.businessLine === "SHARED" && e.isCogs));

  const segmentOf = (line: BusinessLine) => {
    const l = lines[line];
    // With no revenue anywhere there is no basis to apportion on; an even split keeps the
    // two lines reconciling to the combined total instead of dropping the shared costs.
    const share = totalRevInr > 0 ? l.revenue.inr / totalRevInr : 0.5;
    const own = ownExpenses(line);
    const ownC = ownCogs(line);
    const allocExpenses = {
      inr: Number(own.inr) + Number(sharedExpenses.inr) * share,
      eur: Number(own.eur) + Number(sharedExpenses.eur) * share,
    };
    const allocCogs = {
      inr: Number(ownC.inr) + Number(sharedCogs.inr) * share,
      eur: Number(ownC.eur) + Number(sharedCogs.eur) * share,
    };
    const netLine = { inr: l.revenue.inr - allocExpenses.inr, eur: l.revenue.eur - allocExpenses.eur };
    const grossLine = { inr: l.revenue.inr - allocCogs.inr, eur: l.revenue.eur - allocCogs.eur };
    let run = 0;
    const series = revenueSeries.map((p) => {
      const v = dailyByLine[line].get(p.date) ?? 0;
      run += v;
      return { date: p.date, inr: v, cumulativeInr: run };
    });
    return {
      revenue: l.revenue,
      ytdRevenue: l.ytd,
      receivables: l.receivables,
      expenses: allocExpenses,
      cogs: allocCogs,
      gross: grossLine,
      net: netLine,
      marginPct: l.revenue.inr > 0 ? (netLine.inr / l.revenue.inr) * 100 : 0,
      revenueSharePct: share * 100,
      /** Costs tagged to this line outright — the part that is measured, not apportioned. */
      directCostInr: Number(own.inr),
      /** This line's slice of the SHARED pool — the part that is an estimate. */
      sharedCostInr: Number(sharedExpenses.inr) * share,
      revenueSeries: series,
    };
  };
  const segments = { B2: segmentOf("B2"), GERMAN_NOTE: segmentOf("GERMAN_NOTE") };

  return {
    metrics: {
      revenue: toMoney2(revenue),
      expenses: toMoney2(expenses),
      cogs: toMoney2(cogs),
      gross: toMoney2(gross),
      net: toMoney2(net),
      marginPct: margin,
      byLevel,
      receivables,
      ytdRevenue: toMoney2(sumAgg(yearIncomes)),
      revenueSpark,
      revenueSeries,
      segments,
      // last month, cut off at the SAME day-of-month — for honest MoM deltas
      prevSameDay: {
        revenueInr: Number(sumAgg(prevIncomes).inr),
        expensesInr: Number(sumAgg(prevExpenses).inr),
        netInr: Number(sumAgg(prevIncomes).inr) - Number(sumAgg(prevExpenses).inr),
      },
    },
    incomes: monthAllIncomeRows(incomeList),
    expenses: expenseList.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      agg: {
        inr: Number(aggInrMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
        eur: Number(aggEurMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
      },
      amountInrRaw: e.amountInrMinor.toString(),
      amountEurRaw: e.amountEurMinor.toString(),
      category: e.category,
      isCogs: e.isCogs,
      businessLine: e.businessLine,
      vendor: e.vendor,
      notes: e.notes,
      source: e.source,
    })),
    pendings: pendingRows,
  };
}

function monthAllIncomeRows(
  rows: Awaited<ReturnType<typeof prisma.income.findMany>>,
) {
  return rows.map((i) => ({
    id: i.id,
    date: i.date.toISOString(),
    studentName: i.studentName,
    studentId: i.studentId,
    agg: {
      inr: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
      eur: Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    },
    amountInrRaw: i.amountInrMinor.toString(),
    amountEurRaw: i.amountEurMinor.toString(),
    programLevel: i.programLevel,
    paymentType: i.paymentType,
    paymentMethod: i.paymentMethod,
    notes: i.notes,
    source: i.source,
  }));
}

export type FinanceOverview = Awaited<ReturnType<typeof getFinanceOverview>>;
export type IncomeRow = FinanceOverview["incomes"][number];
export type ExpenseRow = FinanceOverview["expenses"][number];
export type PendingRow = FinanceOverview["pendings"][number];
