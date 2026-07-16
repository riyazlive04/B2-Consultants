import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday, istYearRange } from "@/lib/dates";
import { aggEurMinor, aggInrMinor, sumAgg } from "@/lib/money";

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
      orderBy: { nextDueDate: "asc" },
      include: { instalments: { orderBy: { seq: "asc" } } },
    }),
    prisma.income.findMany({
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
    const overdue =
      p.status === "ACTIVE" && !!p.nextDueDate && p.nextDueDate.getTime() < todayMs;
    return {
      id: p.id,
      studentName: p.studentName,
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
        p.status === "ACTIVE" && p.nextDueDate
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
      prisma.income.findMany({ where: { date: { gte: month.start, lt: month.end } } }),
      prisma.expense.findMany({ where: { date: { gte: month.start, lt: month.end } } }),
      prisma.income.findMany({
        where: { date: { gte: year.start, lt: year.end } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
      getPendingRows(),
      // table rows fetched alongside the aggregates - not as extra serial round-trips
      prisma.income.findMany({ orderBy: { date: "desc" }, take: 500 }),
      prisma.expense.findMany({ orderBy: { date: "desc" }, take: 500 }),
      prisma.income.findMany({
        where: { date: { gte: prevMonthStart, lt: prevSameDayEnd } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: prevMonthStart, lt: prevSameDayEnd } },
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
  for (const i of monthIncomes) {
    const bucket = i.programLevel.startsWith("GN_")
      ? "GERMAN_NOTE"
      : i.programLevel === "SOLO" || i.programLevel === "GUIDED" || i.programLevel === "ELITE"
        ? i.programLevel
        : "OTHER";
    byLevel[bucket].inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    byLevel[bucket].eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
  }

  const receivableRows = pendingRows.filter(
    (p) => (p.status === "ACTIVE" || p.status === "OVERDUE") && p.balance.inr > 0,
  );
  const receivables = receivableRows.reduce(
    (acc, p) => ({ inr: acc.inr + p.balance.inr, eur: acc.eur + p.balance.eur }),
    { inr: 0, eur: 0 },
  );

  // Daily revenue sparkline for the current month
  const daily = new Map<string, number>();
  for (const i of monthIncomes) {
    const k = i.date.toISOString().slice(0, 10);
    daily.set(k, (daily.get(k) ?? 0) + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)));
  }
  const revenueSpark = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);

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
