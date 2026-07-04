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
    prisma.pendingPayment.findMany({ orderBy: { nextDueDate: "asc" } }),
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
    const paid =
      (p.studentId ? paidByStudentId.get(p.studentId) : undefined) ??
      paidByName.get(nameKey(p.studentName)) ?? { inr: 0, eur: 0 };
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

  const [monthIncomes, monthExpenses, yearIncomes, pendingRows] = await Promise.all([
    prisma.income.findMany({ where: { date: { gte: month.start, lt: month.end } } }),
    prisma.expense.findMany({ where: { date: { gte: month.start, lt: month.end } } }),
    prisma.income.findMany({
      where: { date: { gte: year.start, lt: year.end } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    getPendingRows(),
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
    },
    incomes: monthAllIncomeRows(await prisma.income.findMany({ orderBy: { date: "desc" }, take: 500 })),
    expenses: (await prisma.expense.findMany({ orderBy: { date: "desc" }, take: 500 })).map((e) => ({
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
