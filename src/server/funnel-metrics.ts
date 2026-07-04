import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday, istWeekRange } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";

/**
 * Conversion Funnel (PRD3 §3). Monthly numbers = sum of weekly snapshots whose
 * week starts in that month (the PRD's snapshot model, not real-time). The
 * cross-phase pulls (§6) PRE-FILL the weekly entry from Pipeline/Students natively;
 * Admin can override before saving.
 */

const STAGE_NAMES = ["Awareness", "Lead captured", "Discovery call", "Proposal sent", "Enrolled (paid)"] as const;

type MonthAgg = {
  key: string; // YYYY-MM
  label: string;
  awareness: number;
  leads: number;
  calls: number;
  proposals: number;
  enrollSolo: number;
  enrollGuided: number;
  enrollElite: number;
  ghostedDownloads: number;
  enrollTotal: number;
  revenueInr: number;
  gbCallsCompleted: number; // leads sourced from Ghosted Blueprint completing a call
};

function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

/** A week belongs to the month containing its Thursday (ISO rule) - so the current
 *  week counts toward "this month" even when Monday falls in the previous one. */
function weekMonthKey(weekStart: Date): string {
  const thu = new Date(weekStart);
  thu.setUTCDate(weekStart.getUTCDate() + 3);
  return thu.toISOString().slice(0, 7);
}

/** Auto-pulls for one week - pre-fills the snapshot form (PRD3 §6 native queries). */
export async function getWeekAutoPulls(weekStart: Date) {
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

  const [leads, calls, proposals, enrollments] = await Promise.all([
    prisma.lead.count({ where: { dateIn: { gte: weekStart, lt: weekEnd } } }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "DISCO_COMPLETED", changedAt: { gte: weekStart, lt: weekEnd } },
      select: { leadId: true }, distinct: ["leadId"],
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "PROPOSAL_SENT", changedAt: { gte: weekStart, lt: weekEnd } },
      select: { leadId: true }, distinct: ["leadId"],
    }),
    prisma.enrollment.groupBy({
      by: ["programLevel"],
      where: { enrollmentDate: { gte: weekStart, lt: weekEnd } },
      _count: { _all: true },
    }),
  ]);
  const enrollOf = (level: string) => enrollments.find((e) => e.programLevel === level)?._count._all ?? 0;
  return {
    leadsCaptured: leads,
    callsCompleted: calls.length,
    proposalsSent: proposals.length,
    enrollmentsSolo: enrollOf("SOLO"),
    enrollmentsGuided: enrollOf("GUIDED"),
    enrollmentsElite: enrollOf("ELITE"),
  };
}

export async function getFunnelOverview(selectedWeek?: string) {
  const today = istToday();
  const thisMonth = istMonthRange(today);

  // Current month + previous 3, oldest → newest
  const monthStarts: Date[] = [];
  for (let i = 3; i >= 0; i--) {
    monthStarts.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)));
  }
  // widen by 3 days on each side so boundary weeks (Thursday rule) are included
  const windowStart = new Date(monthStarts[0].getTime() - 3 * 86400000);
  const windowEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1) + 3 * 86400000);

  const [snapshots, incomes, gbCallHistory, allSnapshots] = await Promise.all([
    prisma.weeklyFunnelSnapshot.findMany({
      where: { weekStart: { gte: windowStart, lt: windowEnd } },
      orderBy: { weekStart: "desc" },
    }),
    prisma.income.findMany({
      where: { date: { gte: windowStart, lt: windowEnd } },
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.leadStageHistory.findMany({
      where: {
        toStage: "DISCO_COMPLETED",
        changedAt: { gte: windowStart, lt: windowEnd },
        lead: { leadSource: "GHOSTED_BLUEPRINT" },
      },
      select: { leadId: true, changedAt: true },
      distinct: ["leadId"],
    }),
    prisma.weeklyFunnelSnapshot.findMany({ orderBy: { weekStart: "desc" } }),
  ]);

  const months: MonthAgg[] = monthStarts.map((start) => {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const key = start.toISOString().slice(0, 7);
    const snaps = snapshots.filter((s) => weekMonthKey(s.weekStart) === key);
    const sum = (f: (s: (typeof snaps)[number]) => number) => snaps.reduce((a, s) => a + f(s), 0);
    const enrollSolo = sum((s) => s.enrollmentsSolo);
    const enrollGuided = sum((s) => s.enrollmentsGuided);
    const enrollElite = sum((s) => s.enrollmentsElite);
    return {
      key: start.toISOString().slice(0, 7),
      label: monthLabel(start),
      awareness: sum((s) => s.awarenessReach),
      leads: sum((s) => s.leadsCaptured),
      calls: sum((s) => s.callsCompleted),
      proposals: sum((s) => s.proposalsSent),
      enrollSolo, enrollGuided, enrollElite,
      enrollTotal: enrollSolo + enrollGuided + enrollElite,
      ghostedDownloads: sum((s) => s.ghostedDownloads),
      revenueInr: incomes
        .filter((i) => i.date >= start && i.date < end)
        .reduce((a, i) => a + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)), 0),
      gbCallsCompleted: gbCallHistory.filter((h) => h.changedAt >= start && h.changedAt < end).length,
    };
  });

  const current = months[months.length - 1];

  // Biggest drop-off between consecutive stages, current month (PRD3 §3.3)
  const stageValues = [current.awareness, current.leads, current.calls, current.proposals, current.enrollTotal];
  let biggestDrop: { fromStage: string; toStage: string; dropPct: number } | null = null;
  for (let i = 0; i < 4; i++) {
    if (stageValues[i] <= 0) continue;
    const dropPct = ((stageValues[i] - stageValues[i + 1]) / stageValues[i]) * 100;
    if (!biggestDrop || dropPct > biggestDrop.dropPct) {
      biggestDrop = { fromStage: STAGE_NAMES[i], toStage: STAGE_NAMES[i + 1], dropPct };
    }
  }

  // ── Ghosted Blueprint tracker (PRD3 §3.4) - attribution via student leadSource tag ──
  const [gbStudents, gbLeadsWithCall] = await Promise.all([
    prisma.student.findMany({
      where: { leadSource: "GHOSTED_BLUEPRINT" },
      include: {
        enrollments: { select: { programLevel: true } },
        incomes: { select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true } },
      },
    }),
    prisma.lead.count({
      where: { leadSource: "GHOSTED_BLUEPRINT", stageHistory: { some: { toStage: "DISCO_COMPLETED" } } },
    }),
  ]);
  const totalDownloadsAllTime = allSnapshots.reduce((a, s) => a + s.ghostedDownloads, 0);
  const downloadsThisMonth = current.ghostedDownloads;
  const gbEnrolled = gbStudents.length;
  const gbGuided = gbStudents.filter((s) => s.enrollments.some((e) => e.programLevel === "GUIDED")).length;
  const gbRevenueInr = gbStudents.reduce(
    (a, s) => a + s.incomes.reduce((b, i) => b + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)), 0),
    0,
  );
  const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

  // ── Source → enrollment attribution (report §3.D P1): which channel actually
  //    produces paying students, all time. Revenue via student.leadSource tag. ──
  const [allLeads, leadsWithCall, allStudents] = await Promise.all([
    prisma.lead.groupBy({ by: ["leadSource"], _count: { _all: true } }),
    prisma.lead.groupBy({
      by: ["leadSource"],
      where: { stageHistory: { some: { toStage: "DISCO_COMPLETED" } } },
      _count: { _all: true },
    }),
    prisma.student.findMany({
      where: { leadSource: { not: null } },
      include: { incomes: { select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true } } },
    }),
  ]);
  const wonBySource = await prisma.lead.groupBy({
    by: ["leadSource"],
    where: { stage: "WON" },
    _count: { _all: true },
  });
  const sourceKeys = new Set<string>([
    ...allLeads.map((l) => l.leadSource),
    ...allStudents.map((s) => s.leadSource!),
  ]);
  const attribution = [...sourceKeys]
    .map((src) => {
      const students = allStudents.filter((s) => s.leadSource === src);
      const revenueInr = students.reduce(
        (a, s) => a + s.incomes.reduce((b, i) => b + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)), 0),
        0,
      );
      const leads = allLeads.find((l) => l.leadSource === src)?._count._all ?? 0;
      return {
        source: src,
        leads,
        callsCompleted: leadsWithCall.find((l) => l.leadSource === src)?._count._all ?? 0,
        won: wonBySource.find((l) => l.leadSource === src)?._count._all ?? 0,
        students: students.length,
        revenueInr,
        revenuePerLeadInr: leads > 0 ? revenueInr / leads : null,
      };
    })
    .sort((a, b) => b.revenueInr - a.revenueInr);

  // ── Weekly entry: selected week (default: current IST week) + auto pre-fill ──
  const week = selectedWeek ? new Date(`${selectedWeek}T00:00:00Z`) : istWeekRange(today).start;
  const [existingSnapshot, autoPulls] = await Promise.all([
    prisma.weeklyFunnelSnapshot.findUnique({ where: { weekStart: week } }),
    getWeekAutoPulls(week),
  ]);

  return {
    months,
    funnel: STAGE_NAMES.map((name, i) => ({ name, value: stageValues[i] })),
    biggestDrop,
    hasSnapshots: snapshots.some((s) => s.weekStart >= thisMonth.start),
    attribution,
    ghostedBlueprint: {
      totalDownloadsAllTime,
      downloadsThisMonth,
      downloadsToCallPct: pct(gbLeadsWithCall, totalDownloadsAllTime),
      downloadsToEnrollmentPct: pct(gbEnrolled, totalDownloadsAllTime),
      downloadsToGuidedPct: pct(gbGuided, totalDownloadsAllTime),
      revenueInr: gbRevenueInr,
    },
    entry: {
      weekStart: week.toISOString().slice(0, 10),
      existing: existingSnapshot
        ? {
            awarenessReach: existingSnapshot.awarenessReach,
            leadsCaptured: existingSnapshot.leadsCaptured,
            callsCompleted: existingSnapshot.callsCompleted,
            proposalsSent: existingSnapshot.proposalsSent,
            enrollmentsSolo: existingSnapshot.enrollmentsSolo,
            enrollmentsGuided: existingSnapshot.enrollmentsGuided,
            enrollmentsElite: existingSnapshot.enrollmentsElite,
            ghostedDownloads: existingSnapshot.ghostedDownloads,
            workshopAttendees: existingSnapshot.workshopAttendees,
            notes: existingSnapshot.notes,
          }
        : null,
      autoPulls,
    },
    recentSnapshots: allSnapshots.slice(0, 16).map((s) => ({
      weekStart: s.weekStart.toISOString(),
      awarenessReach: s.awarenessReach,
      leadsCaptured: s.leadsCaptured,
      callsCompleted: s.callsCompleted,
      proposalsSent: s.proposalsSent,
      enrollments: s.enrollmentsSolo + s.enrollmentsGuided + s.enrollmentsElite,
      ghostedDownloads: s.ghostedDownloads,
      workshopAttendees: s.workshopAttendees,
      notes: s.notes,
    })),
  };
}

export type FunnelOverview = Awaited<ReturnType<typeof getFunnelOverview>>;
