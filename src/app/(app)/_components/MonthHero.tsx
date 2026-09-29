import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { ACTIVE } from "@/lib/soft-delete";
import { getTodayInrPerEur } from "@/lib/fx";
import { type SignalLevel } from "@/lib/signals";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";
import { getActiveLevels } from "@/server/levels";
import { BUSINESS_LINE_LABELS, lineForKind, type BusinessLineView } from "@/lib/business-line";
import { MonthHeroView, type HeroFigures, type HeroLabels, type HeroRatios } from "./MonthHeroView";

/**
 * "This month" money hero (Admin only) - the one question that leads the founder's day: am I on
 * pace to hit the target, and where does the rest come from?
 *
 * This half does the reads and the arithmetic; MonthHeroView renders it. The split exists because
 * the hero has to follow the app's ₹/€ toggle, and a server component cannot read the client
 * context that holds it - which is why every figure here is computed as a `{inr, eur}` PAIR.
 *
 * Where each EUR figure comes from matters:
 *   - collections / receivables / last month's comparator: summed from each record's OWN stamped
 *     rate (`aggEurMinor` semantics, inlined below), so they are exact and never drift.
 *   - the monthly TARGET and the pipeline forecast: no EUR exists in the database, so they are
 *     converted at today's ECB rate. The view marks them "≈" and names the rupee original.
 *
 * Every ratio (pace, % of target, needle, meter widths) is computed on the INR basis and passed
 * down, so flipping currency cannot change the judgement the hero is making.
 */
export async function MonthHero({ line = "ALL" }: { line?: BusinessLineView } = {}) {
  const { start: monthStart, end: monthEnd } = istMonthRange();
  const today = istToday();
  const prevMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));

  const [trendIncomes, target, pendingRows, pipeline, levels, fx] = await Promise.all([
    prisma.income.findMany({
      where: { ...ACTIVE, date: { gte: prevMonthStart } },
      // `programLevel` decides which business the money belongs to - derived, never stored,
      // so historic rows segment correctly with no backfill (see lib/business-line.ts).
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true, programLevel: true },
    }),
    prisma.monthlyTarget.findUnique({ where: { month: monthStart } }),
    getPendingRows(), // React-cached - shared with notifications, no extra cost
    getPipelineSnapshot(),
    getActiveLevels(),
    getTodayInrPerEur(),
  ]);

  type Row = (typeof trendIncomes)[number];
  /** INR aggregate of one row: its rupee part + its euro part at the row's own stamped rate. */
  const inrOf = (r: Row) => Number(r.amountInrMinor) + Number(r.amountEurMinor) * Number(r.fxRateUsed);
  /** EUR aggregate of the same row, at that same stamped rate - the mirror of aggEurMinor. */
  const eurOf = (r: Row) => Number(r.amountEurMinor) + Number(r.amountInrMinor) / Number(r.fxRateUsed);

  const rate = Number(fx.rate);
  /** A rupee-only figure shown in euros: today's rate, and the view says so. */
  const toEur = (inr: number) => (rate > 0 ? inr / rate : 0);
  const pair = (inr: number) => ({ inr, eur: toEur(inr) });
  const sumPair = (rows: Row[]) => ({
    inr: rows.reduce((a, r) => a + inrOf(r), 0),
    eur: rows.reduce((a, r) => a + eurOf(r), 0),
  });

  // Segment filter (Error Log E1). A level's KIND decides the line, so a newly added German
  // level lands on the right side with no code change.
  const kindByLevel = new Map(levels.map((l) => [l.code, l.kind as string]));
  const inLine = (r: { programLevel: string }) =>
    line === "ALL" || lineForKind(kindByLevel.get(r.programLevel)) === line;

  const incomes = trendIncomes.filter(inLine);
  const segmented = line !== "ALL";
  const collected = sumPair(incomes.filter((r) => r.date >= monthStart));

  // ── Pace vs target: compare to where the month SHOULD be today, not to 100% ──
  const targetInr = Number(target?.targetInrMinor ?? BigInt(80000000));
  const targetPair = pair(targetInr);
  const dayOfMonth = today.getUTCDate();
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000);
  const monthFrac = Math.min(1, dayOfMonth / daysInMonth);
  const expected = { inr: targetPair.inr * monthFrac, eur: targetPair.eur * monthFrac };
  const paceDelta = { inr: collected.inr - expected.inr, eur: collected.eur - expected.eur };
  // Ratios are INR-based on purpose: the EUR target is a today-rate conversion, so deriving the
  // pace from it would make "am I on track" wobble with the ECB rather than with the business.
  const pacePct = expected.inr > 0 ? (collected.inr / expected.inr) * 100 : null;
  // Green ONLY at/ahead of pace - a chip that says "behind pace" must never wear green.
  const paceSignal: SignalLevel | null =
    pacePct === null ? null : pacePct >= 100 ? "ok" : pacePct >= 75 ? "watch" : "risk";

  // ── Same-day comparison vs last month (day 1..N of each) ──
  const prevCutoffMs = Math.min(
    Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), dayOfMonth + 1),
    monthStart.getTime(),
  );
  // Every comparison reads the SEGMENTED list. Mixing a segmented headline with a combined
  // comparator would invent a month-on-month delta that is true of neither.
  const prevSameDay = sumPair(
    incomes.filter((r) => r.date >= prevMonthStart && r.date.getTime() < prevCutoffMs),
  );
  const momPct =
    prevSameDay.inr > 0 ? ((collected.inr - prevSameDay.inr) / prevSameDay.inr) * 100 : null;

  // ── Daily cumulative paths for the pacing chart, in both currencies ──
  const prevDaysInMonth = Math.round((monthStart.getTime() - prevMonthStart.getTime()) / 86400000);
  const cumOf = (rows: Row[], start: Date, days: number) => {
    const dailyInr = new Array<number>(days).fill(0);
    const dailyEur = new Array<number>(days).fill(0);
    for (const r of rows) {
      const idx = Math.floor((r.date.getTime() - start.getTime()) / 86400000);
      if (idx >= 0 && idx < days) {
        dailyInr[idx] += inrOf(r);
        dailyEur[idx] += eurOf(r);
      }
    }
    let accInr = 0;
    let accEur = 0;
    return {
      inr: dailyInr.map((v) => (accInr += v)),
      eur: dailyEur.map((v) => (accEur += v)),
    };
  };
  const curCum = cumOf(incomes.filter((r) => r.date >= monthStart), monthStart, dayOfMonth);
  const prevCum = cumOf(
    incomes.filter((r) => r.date >= prevMonthStart && r.date < monthStart),
    prevMonthStart,
    prevDaysInMonth,
  );

  // §2.6: "vs same day last month" was read as "vs last year" by some people. Naming the actual
  // calendar date it compares against removes an ambiguity no rewording of the phrase could.
  const prevSameDayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(
    new Date(
      Date.UTC(
        prevMonthStart.getUTCFullYear(),
        prevMonthStart.getUTCMonth(),
        Math.min(dayOfMonth, prevDaysInMonth),
      ),
    ),
  );

  // ── Projected finish: collected + receivables due before month-end + the pipeline forecast
  //    pro-rated to the days left. "Will I hit ₹8L?" gets a number.
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
  const dueRows = pendingRows.filter(
    (p) =>
      p.status === "ACTIVE" && p.balance.inr > 0 && p.nextDueDate &&
      new Date(p.nextDueDate) >= today && new Date(p.nextDueDate) < monthEnd,
  );
  // Receivables carry a real EUR balance (each from its own stamped rate) - no conversion here.
  const dueThisMonth = dueRows.reduce(
    (a, p) => ({ inr: a.inr + p.balance.inr, eur: a.eur + p.balance.eur }),
    { inr: 0, eur: 0 },
  );
  const forecastInr = pipeline.avgFeeKnown ? pipeline.forecast30Inr * Math.min(1, remainingDays / 30) : 0;
  const forecast = pair(forecastInr); // pipeline value is priced in rupees only
  const projected = {
    inr: collected.inr + dueThisMonth.inr + forecast.inr,
    eur: collected.eur + dueThisMonth.eur + forecast.eur,
  };
  const projectedPct = targetPair.inr > 0 ? (projected.inr / targetPair.inr) * 100 : null;
  const projectedSignal: SignalLevel | null =
    projectedPct === null ? null : projectedPct >= 100 ? "ok" : projectedPct >= 80 ? "watch" : "risk";

  const figures: HeroFigures = {
    collected,
    target: targetPair,
    expected,
    paceDelta,
    prevSameDay,
    dueThisMonth,
    forecast,
    projected,
    curCum,
    prevCum,
  };

  const ratios: HeroRatios = {
    monthFrac,
    dayOfMonth,
    daysInMonth,
    pacePct,
    paceSignal,
    momPct,
    projectedPct,
    projectedSignal,
    projectedFrac: targetPair.inr > 0 ? projected.inr / targetPair.inr : 0,
    collectedPctOfTarget: targetPair.inr > 0 ? (collected.inr / targetPair.inr) * 100 : null,
  };

  const labels: HeroLabels = {
    monthStart: monthStart.toISOString(),
    monthShort: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(monthStart),
    prevMonthShort: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(prevMonthStart),
    prevSameDayLabel,
    lineLabel: segmented ? BUSINESS_LINE_LABELS[line] : null,
    fxDate: fx.date.toISOString(),
    fxRate: rate,
  };

  return <MonthHeroView figures={figures} ratios={ratios} labels={labels} segmented={segmented} />;
}
