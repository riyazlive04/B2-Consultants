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
    /**
     * The instalment-plan surcharge, priced per plan length in the Console and snapshotted onto
     * the row when its schedule was generated (0 for a row with no plan). It is added here
     * rather than folded into `totalFee` so the agreed fee keeps meaning "the fee we agreed" -
     * `toCollect` is the figure that has to arrive, and it is what the BALANCE is measured from.
     */
    const planExtra = {
      inr: Number(aggInrMinor(p.planExtraInrMinor, p.planExtraEurMinor, p.fxRateUsed)),
      eur: Number(aggEurMinor(p.planExtraInrMinor, p.planExtraEurMinor, p.fxRateUsed)),
    };
    const toCollect = { inr: fee.inr + planExtra.inr, eur: fee.eur + planExtra.eur };
    // Id-linked rows NEVER fall back to name matching: two students sharing a
    // name would otherwise cross-credit payments and silently zero a real
    // receivable. Name matching is only for rows with no student link at all.
    const paid = p.studentId
      ? paidByStudentId.get(p.studentId) ?? { inr: 0, eur: 0 }
      : paidByName.get(nameKey(p.studentName)) ?? { inr: 0, eur: 0 };
    const balance = {
      inr: Math.max(0, toCollect.inr - paid.inr),
      eur: Math.max(0, toCollect.eur - paid.eur),
    };
    // A receivable is overdue when it is still owed and past its due date. It used to require
    // status === "ACTIVE", which is backwards: once the nightly sweep (or a manual edit) escalated
    // a row to the OVERDUE *status*, this flag flipped to FALSE, so the most-overdue payments
    // silently dropped out of the red badge, the KPI count and the dashboard alert (§8.4 -
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
      planExtra,
      planExtraInrRaw: p.planExtraInrMinor.toString(),
      planExtraEurRaw: p.planExtraEurMinor.toString(),
      /** Fee + plan surcharge - what actually has to be collected. Balance measures from this. */
      toCollect,
      intervalDays: p.intervalDays,
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

/**
 * @param period Which window to report on. Defaults to the current calendar month, which is
 *   exactly what this function did before it took an argument - so every existing caller is
 *   unchanged. Pass a resolved period (see `lib/period.ts`) to report on any other window.
 *
 *   The whole screen was hardcoded to `istMonthRange()` with no way to ask for July, which made
 *   "show me last month's P&L" impossible and capped CSV export at the current month.
 */
export async function getFinanceOverview(period?: { start: Date; endExclusive: Date }) {
  const today = istToday();
  const month = period
    ? { start: period.start, end: period.endExclusive }
    : istMonthRange(today);
  const year = istYearRange(today);

  /**
   * The comparison window.
   *
   * For the CURRENT month this stays the same-day slice of last month (day 1..today's day) -
   * comparing a part-month against a full month always flatters the past. For any OTHER window
   * the full preceding window of the same length is the honest comparator, because the window
   * being reported is itself complete.
   */
  const viewingCurrentMonth = today >= month.start && today < month.end;
  const [prevMonthStart, prevSameDayEnd] = viewingCurrentMonth
    ? (() => {
        const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
        const e = new Date(
          Math.min(
            Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), today.getUTCDate() + 1),
            month.start.getTime(),
          ),
        );
        return [s, e];
      })()
    : [new Date(month.start.getTime() - (month.end.getTime() - month.start.getTime())), month.start];

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
        // `programLevel` rides along so revenue-by-level can be compared month over month.
        // Without it the breakdown could only ever say "share of THIS month", which answers
        // "how is the mix split" but never "which level is actually growing" - and the second
        // is the question that moves where the founder spends selling time.
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true, programLevel: true },
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
  const bucketFor = (programLevel: string): keyof typeof byLevel => {
    const kind = kindByLevel.get(programLevel);
    if (kind === "GERMAN_LEVEL" || kind === "GERMAN_BUNDLE") return "GERMAN_NOTE";
    return programLevel === "SOLO" || programLevel === "GUIDED" || programLevel === "ELITE"
      ? programLevel
      : "OTHER";
  };
  for (const i of monthIncomes) {
    const bucket = bucketFor(i.programLevel);
    byLevel[bucket].inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    byLevel[bucket].eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
  }

  /**
   * The same split over the SAME-DAY window into last month.
   *
   * Same-day, not whole-month, for the reason `prevSameDay` already exists: comparing a
   * part-month against a full one always shows a fall, on the 3rd of every month, in every level.
   */
  const prevByLevel: Record<keyof typeof byLevel, Money2> = {
    SOLO: { inr: 0, eur: 0 }, GUIDED: { inr: 0, eur: 0 }, ELITE: { inr: 0, eur: 0 },
    GERMAN_NOTE: { inr: 0, eur: 0 }, OTHER: { inr: 0, eur: 0 },
  };
  for (const i of prevIncomes) {
    const bucket = bucketFor(i.programLevel);
    prevByLevel[bucket].inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    prevByLevel[bucket].eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
  }

  // ── Business-line segmentation (§1): B2 vs German Note vs Combined ──────────
  //
  // Revenue, collections and receivables split EXACTLY, because every income and
  // receivable row names a programme level and the level's kind decides the line.
  //
  // Costs now carry their OWN line (Expense.businessLine). A cost tagged B2 or GERMAN_NOTE
  // lands wholly on that line; only SHARED costs - rent, ads, tooling - are apportioned by
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

  /**
   * A day's takings in both currencies. Each record contributes at ITS OWN stored rate
   * (`sumAgg` does the same), so the chart's closing cumulative equals the revenue KPI
   * above it to the minor unit. Converting an INR total at today's rate instead would put
   * two different EUR numbers for the same month on one screen.
   */
  type DayTakings = { inr: number; eur: number; count: number };
  const addTakings = (m: Map<string, DayTakings>, key: string, i: (typeof monthIncomes)[number]) => {
    const at = m.get(key) ?? { inr: 0, eur: 0, count: 0 };
    at.inr += Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    at.eur += Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    // How many receipts made up the day. ₹1,00,000 from one payment and ₹1,00,000 from eight are
    // different days, and the chart's hover readout is the only place that distinction can live.
    at.count += 1;
    m.set(key, at);
  };

  /** Walk a run of dates carrying both running totals - the combined and per-line series are the
   *  same shape over different day maps, so they share this rather than repeating the loop. */
  const cumulate = (dates: readonly string[], byDay: Map<string, DayTakings>) => {
    let inr = 0;
    let eur = 0;
    return dates.map((date) => {
      const at = byDay.get(date) ?? { inr: 0, eur: 0, count: 0 };
      inr += at.inr;
      eur += at.eur;
      return { date, inr: at.inr, cumulativeInr: inr, eur: at.eur, cumulativeEur: eur, count: at.count };
    });
  };

  // Daily series per line, on the same continuous calendar as the combined series.
  const dailyByLine: Record<BusinessLine, Map<string, DayTakings>> = {
    B2: new Map(),
    GERMAN_NOTE: new Map(),
  };
  for (const i of monthIncomes) {
    addTakings(dailyByLine[lineOfLevel(i.programLevel)], i.date.toISOString().slice(0, 10), i);
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
  // those days were adjacent - a flat week of zero collections looked identical to
  // three consecutive good days. The series is now continuous, one entry per calendar
  // day from the 1st to today, so gaps read as the gaps they are. `cumulativeInr`
  // rides along because the running total is what gets compared to the target.
  const daily = new Map<string, DayTakings>();
  for (const i of monthIncomes) {
    addTakings(daily, i.date.toISOString().slice(0, 10), i);
  }
  /**
   * How many days of the window to plot.
   *
   * For the CURRENT month, stop at today - plotting a flat line out to the 31st would read as
   * "we earned nothing for the rest of the month" rather than "the month hasn't happened yet".
   * For a window that is already over, plot all of it; and for an arbitrary window (a week, a
   * quarter, a custom range) walk day-by-day from its own start rather than assuming the 1st.
   */
  const spanDays = Math.max(1, Math.round((month.end.getTime() - month.start.getTime()) / 86_400_000));
  const daysElapsed = viewingCurrentMonth
    ? Math.max(1, Math.round((today.getTime() - month.start.getTime()) / 86_400_000) + 1)
    : spanDays;
  const monthDates = Array.from({ length: Math.min(daysElapsed, spanDays) }, (_, idx) => {
    const d = new Date(month.start);
    d.setUTCDate(month.start.getUTCDate() + idx);
    return d.toISOString().slice(0, 10);
  });
  const revenueSeries = cumulate(monthDates, daily);
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
    const series = cumulate(monthDates, dailyByLine[line]);
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
      /** Costs tagged to this line outright - the part that is measured, not apportioned. */
      directCostInr: Number(own.inr),
      directCostEur: Number(own.eur),
      /** This line's slice of the SHARED pool - the part that is an estimate. */
      sharedCostInr: Number(sharedExpenses.inr) * share,
      sharedCostEur: Number(sharedExpenses.eur) * share,
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
      prevByLevel,
      receivables,
      ytdRevenue: toMoney2(sumAgg(yearIncomes)),
      revenueSpark,
      revenueSeries,
      segments,
      // last month, cut off at the SAME day-of-month - for honest MoM deltas.
      // Both currencies: the ₹/€ toggle flips the "was X by this day last month" line too, and
      // an INR-only comparator would have forced a read-time conversion - the one thing the
      // dual-aggregate design exists to avoid.
      prevSameDay: {
        revenueInr: Number(sumAgg(prevIncomes).inr),
        revenueEur: Number(sumAgg(prevIncomes).eur),
        expensesInr: Number(sumAgg(prevExpenses).inr),
        expensesEur: Number(sumAgg(prevExpenses).eur),
        netInr: Number(sumAgg(prevIncomes).inr) - Number(sumAgg(prevExpenses).inr),
        netEur: Number(sumAgg(prevIncomes).eur) - Number(sumAgg(prevExpenses).eur),
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
    instalmentCount: i.instalmentCount,
    instalmentExtraInrRaw: i.instalmentExtraInrMinor.toString(),
    instalmentExtraEurRaw: i.instalmentExtraEurMinor.toString(),
    notes: i.notes,
    source: i.source,
  }));
}

export type FinanceOverview = Awaited<ReturnType<typeof getFinanceOverview>>;
export type IncomeRow = FinanceOverview["incomes"][number];
export type ExpenseRow = FinanceOverview["expenses"][number];
export type PendingRow = FinanceOverview["pendings"][number];
