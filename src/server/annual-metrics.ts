import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istYearRange } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { lineForKind, type BusinessLine } from "@/lib/business-line";
import { levelKinds } from "./levels";

/**
 * Month-on-month performance for the calendar year (§3.2/§3.3).
 *
 * The dashboard could only ever look one month back: there was a 30-day trend and a single
 * year-to-date number, but nothing that showed Jan→Dec, nothing comparing target to achieved
 * across months, and no forward projection — so "are we going to make the year?" could not be
 * answered from the screen at all.
 *
 * Everything here is CUMULATIVE, because that is the question being asked: a good March does
 * not matter if the year is still behind. Variance is cumulative achieved − cumulative target,
 * evaluated only up to the current month (comparing a full year of target against three months
 * of actuals would report a catastrophe every January).
 */

const DEFAULT_MONTHLY_TARGET_MINOR = 80000000; // ₹8,00,000 — same default as the month hero

export type AnnualMonth = {
  month: number; // 0-11
  label: string; // "Jan"
  achievedInr: number;
  targetInr: number;
  cumAchievedInr: number;
  cumTargetInr: number;
  /** Cumulative path including the projected tail — drawn dashed beyond today. */
  cumProjectedInr: number;
  isFuture: boolean;
  isCurrent: boolean;
};

export type AnnualPerformance = {
  year: number;
  months: AnnualMonth[];
  achievedToDateInr: number;
  targetToDateInr: number;
  fullYearTargetInr: number;
  /** Run-rate projection for where the year finishes if today's pace holds. */
  projectedYearEndInr: number;
  /** Cumulative achieved − cumulative target, up to the current month only. */
  varianceInr: number;
  runRateInr: number;
};

/**
 * Clients gained vs lost, month by month (§3.4).
 *
 * Recurring-revenue movement was invisible: the dashboard showed how much money came in but
 * never whether the client base underneath it was growing or shrinking — a flat revenue month
 * that quietly lost four students and won four more is a very different business from a stable
 * one. Additions are counted from `enrollmentDate`; losses only from a DROPPED status change,
 * because a COMPLETED programme is a success finishing, not churn, and lumping the two together
 * would make good months look like bleeding ones.
 */
export type ClientMovementMonth = {
  month: number;
  label: string;
  gained: number;
  lost: number;
  /** Net active enrolments at the end of this month — the baseline the bars move. */
  activeEnd: number;
  isFuture: boolean;
};

export async function getClientMovement(): Promise<ClientMovementMonth[]> {
  const today = istToday();
  const year = istYearRange(today);
  const curMonth = today.getUTCMonth();

  const [enrolments, priorActive] = await Promise.all([
    prisma.enrollment.findMany({
      select: { enrollmentDate: true, status: true, statusChangedAt: true },
    }),
    // Everything that started before this year and hadn't dropped by then — the opening balance.
    prisma.enrollment.count({
      where: {
        enrollmentDate: { lt: year.start },
        NOT: { AND: [{ status: "DROPPED" }, { statusChangedAt: { lt: year.start } }] },
      },
    }),
  ]);

  const gained = new Array<number>(12).fill(0);
  const lost = new Array<number>(12).fill(0);
  for (const e of enrolments) {
    if (e.enrollmentDate >= year.start && e.enrollmentDate < year.end) {
      gained[e.enrollmentDate.getUTCMonth()]++;
    }
    if (e.status === "DROPPED" && e.statusChangedAt >= year.start && e.statusChangedAt < year.end) {
      lost[e.statusChangedAt.getUTCMonth()]++;
    }
  }

  let running = priorActive;
  return gained.map((g, m) => {
    const isFuture = m > curMonth;
    if (!isFuture) running += g - lost[m];
    return {
      month: m,
      label: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
        new Date(Date.UTC(today.getUTCFullYear(), m, 1)),
      ),
      gained: isFuture ? 0 : g,
      lost: isFuture ? 0 : lost[m],
      activeEnd: isFuture ? 0 : running,
      isFuture,
    };
  });
}

export async function getAnnualPerformance(line: BusinessLine | null = null): Promise<AnnualPerformance> {
  const today = istToday();
  const year = istYearRange(today);

  const [incomes, targets, kindByLevel] = await Promise.all([
    prisma.income.findMany({
      where: { ...ACTIVE, date: { gte: year.start, lt: year.end } },
      select: {
        date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true, programLevel: true,
      },
    }),
    prisma.monthlyTarget.findMany({ where: { month: { gte: year.start, lt: year.end } } }),
    levelKinds(),
  ]);

  const targetByMonth = new Map<number, number>();
  for (const t of targets) targetByMonth.set(t.month.getUTCMonth(), Number(t.targetInrMinor));

  const achievedByMonth = new Array<number>(12).fill(0);
  for (const i of incomes) {
    if (line && lineForKind(kindByLevel.get(i.programLevel)) !== line) continue;
    achievedByMonth[i.date.getUTCMonth()] += Number(
      aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed),
    );
  }

  const curMonth = today.getUTCMonth();
  const dayOfMonth = today.getUTCDate();
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), curMonth + 1, 0)).getUTCDate();

  // How much of the year has actually elapsed, as a fraction of months. The current month
  // counts only as far as today, so the run rate isn't diluted by days that haven't happened.
  const monthsElapsed = curMonth + dayOfMonth / daysInMonth;

  const achievedToDateInr = achievedByMonth.slice(0, curMonth + 1).reduce((a, b) => a + b, 0);
  const runRateInr = monthsElapsed > 0 ? achievedToDateInr / monthsElapsed : 0;

  let cumAchieved = 0;
  let cumTarget = 0;
  const months: AnnualMonth[] = achievedByMonth.map((achieved, m) => {
    const target = targetByMonth.get(m) ?? DEFAULT_MONTHLY_TARGET_MINOR;
    const isFuture = m > curMonth;
    const isCurrent = m === curMonth;
    if (!isFuture) cumAchieved += achieved;
    cumTarget += target;

    // Projection continues the achieved line at today's run rate. For elapsed months it
    // simply IS the achieved line, so the dashed tail joins the solid line with no step.
    const cumProjected = isFuture
      ? achievedToDateInr + runRateInr * (m + 1 - monthsElapsed)
      : cumAchieved;

    return {
      month: m,
      label: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
        new Date(Date.UTC(today.getUTCFullYear(), m, 1)),
      ),
      achievedInr: isFuture ? 0 : achieved,
      targetInr: target,
      cumAchievedInr: isFuture ? 0 : cumAchieved,
      cumTargetInr: cumTarget,
      cumProjectedInr: cumProjected,
      isFuture,
      isCurrent,
    };
  });

  const targetToDateInr = months
    .slice(0, curMonth + 1)
    .reduce((a, m) => a + m.targetInr, 0);

  return {
    year: today.getUTCFullYear(),
    months,
    achievedToDateInr,
    targetToDateInr,
    fullYearTargetInr: months.reduce((a, m) => a + m.targetInr, 0),
    projectedYearEndInr: runRateInr * 12,
    varianceInr: achievedToDateInr - targetToDateInr,
    runRateInr,
  };
}
