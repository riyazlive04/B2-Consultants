import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  istMonthInstantRange, istMonthRange, istToday, istWeekRange,
  kpiInstantRange, type KpiRangeKey,
} from "@/lib/dates";
import { aggInrMinor, sumAgg } from "@/lib/money";

/**
 * Pipeline dashboard (PRD1 §5.4). Booked / completed / won counts come from the
 * append-only LeadStageHistory (when the transition happened), not from a lead's
 * current stage - a lead that later moved on still counts for the month it was booked.
 */

const INTERESTED_STAGES = [
  "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT",
  "OFFER_FOLLOWUP", "DEPOSIT_FOLLOWUP", "DEPOSIT_PAID",
] as const;

async function distinctLeadsReaching(
  stage: string,
  start: Date,
  end: Date,
  leadFilter?: Prisma.LeadWhereInput,
): Promise<number> {
  const rows = await prisma.leadStageHistory.findMany({
    where: {
      toStage: stage as never,
      changedAt: { gte: start, lt: end },
      ...(leadFilter ? { lead: leadFilter } : {}),
    },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  return rows.length;
}

type FeeIncomeRow = {
  programLevel: string;
  studentId: string | null;
  studentName: string | null;
  amountInrMinor: bigint;
  amountEurMinor: bigint;
  fxRateUsed: Prisma.Decimal;
};

/**
 * Average program fee per level from real income history. Sum per STUDENT
 * first — a fee paid in 4 instalments is one fee, not four small ones —
 * then average those per-student totals within each level.
 */
type AvgFeeByLevel = { SOLO: number | null; GUIDED: number | null; ELITE: number | null };

function computeAvgProgramFeeInr(rows: FeeIncomeRow[]): {
  avgFeeInr: number;
  known: boolean;
  byLevel: AvgFeeByLevel;
} {
  const perStudent = new Map<string, { level: string; total: number }>();
  for (const i of rows) {
    if (!["SOLO", "GUIDED", "ELITE"].includes(i.programLevel)) continue;
    const who = i.studentId ?? (i.studentName ? `name:${i.studentName.trim().toLowerCase()}` : null);
    if (!who) continue; // unattributed income can't define a per-deal fee
    const key = `${i.programLevel}:${who}`;
    const v = Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    const cur = perStudent.get(key) ?? { level: i.programLevel, total: 0 };
    perStudent.set(key, { level: cur.level, total: cur.total + v });
  }
  const levelTotals = new Map<string, { total: number; n: number }>();
  for (const { level, total } of perStudent.values()) {
    const cur = levelTotals.get(level) ?? { total: 0, n: 0 };
    levelTotals.set(level, { total: cur.total + total, n: cur.n + 1 });
  }
  const byLevel: AvgFeeByLevel = { SOLO: null, GUIDED: null, ELITE: null };
  for (const [level, v] of levelTotals) {
    if (level === "SOLO" || level === "GUIDED" || level === "ELITE") byLevel[level] = v.total / v.n;
  }
  const levelAvgs = [...levelTotals.values()].map((v) => v.total / v.n);
  const avgFeeInr = levelAvgs.length ? levelAvgs.reduce((a, b) => a + b, 0) / levelAvgs.length : 0;
  return { avgFeeInr, known: levelAvgs.length > 0, byLevel };
}

/** Founder-set fallback average fee (PRD1 §5.4) in INR minor units, or 0 if unset. */
async function getFeeFallbackMinor(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: "pipelineAvgFeeInr" } });
  const major = row ? Number(row.value) : 0;
  return Number.isFinite(major) && major > 0 ? Math.round(major * 100) : 0;
}

/** Only B2 levels define a program fee; German Note income never should. */
const FEE_LEVELS = ["SOLO", "GUIDED", "ELITE"] as const;
/** Two years of deals is plenty to learn a fee, and keeps old pricing out of it. */
const FEE_WINDOW_MONTHS = 24;
const FEE_TTL_MS = 60_000;

let feeMemo: { at: number; value: EffectiveFee } | null = null;

type EffectiveFee = {
  avgFeeInr: number; // effective blended fee (minor units) used to value open leads
  fromIncome: boolean; // true = learned from income, false = founder fallback / unset
  known: boolean; // either source produced a usable fee
  byLevel: AvgFeeByLevel;
};

/**
 * The average program fee, resolved once and shared.
 *
 * This used to be `income.findMany()` with NO where clause — a full scan of every
 * income row ever, run TWICE per page view (home snapshot + pipeline overview),
 * purely to average a handful of deals. Now it is:
 *   - filtered to B2 levels + a 24-month window, so it rides the [programLevel, date] index,
 *   - React.cache'd, so the two callers in one request share a single query,
 *   - memoised for 60s across requests, because the fee only moves when income is
 *     written and a minute of staleness on an *estimate* is invisible.
 */
const getEffectiveAvgFee = cache(async (): Promise<EffectiveFee> => {
  if (feeMemo && Date.now() - feeMemo.at < FEE_TTL_MS) return feeMemo.value;

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - FEE_WINDOW_MONTHS);

  const [rows, fallbackMinor] = await Promise.all([
    prisma.income.findMany({
      where: { programLevel: { in: FEE_LEVELS as unknown as never[] }, date: { gte: since } },
      select: {
        programLevel: true, studentId: true, studentName: true,
        amountInrMinor: true, amountEurMinor: true, fxRateUsed: true,
      },
    }),
    getFeeFallbackMinor(),
  ]);

  const { avgFeeInr, known: fromIncome, byLevel } = computeAvgProgramFeeInr(rows);
  const value: EffectiveFee = {
    avgFeeInr: fromIncome ? avgFeeInr : fallbackMinor,
    fromIncome,
    known: fromIncome || fallbackMinor > 0,
    byLevel,
  };
  feeMemo = { at: Date.now(), value };
  return value;
});

/**
 * Drop the cross-request fee memo. Income writes can ride out the 60s TTL (the fee
 * is an estimate), but when the founder explicitly SETS the fallback fee they must
 * see it take effect on the very next render — so that action busts this directly.
 */
export function invalidateAvgFeeCache(): void {
  feeMemo = null;
}

/**
 * Light founder-home snapshot: what the open pipeline is worth and how the month
 * is converting. Same INTERESTED_STAGES + avg-fee logic as getPipelineOverview,
 * but none of that function's table payloads (500 leads/outcomes) — cheap enough
 * for the home page on every load.
 *
 * `range` (default "this-month") drives the home page's KPI date-range control —
 * wins/completed-calls are counted within the selected window. `interestedLeads` and
 * `pipelineValueInr` are a point-in-time snapshot of currently-open deals and are not
 * range-scoped (there's no such thing as "open deals as of last month"). Every caller
 * that doesn't pass `range` (FounderPulse) keeps today's exact "this month" behavior.
 */
export const getPipelineSnapshot = cache(async (range: KpiRangeKey = "this-month") => {
  const ts = kpiInstantRange(range);
  const [interestedLeads, fee, wonRows, completedRows] = await Promise.all([
    prisma.lead.count({ where: { stage: { in: INTERESTED_STAGES as unknown as never[] } } }),
    getEffectiveAvgFee(),
    prisma.leadStageHistory.findMany({
      where: { toStage: "WON", changedAt: { gte: ts.start, lt: ts.end } },
      select: { leadId: true },
      distinct: ["leadId"],
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "DISCO_COMPLETED", changedAt: { gte: ts.start, lt: ts.end } },
      select: { leadId: true },
      distinct: ["leadId"],
    }),
  ]);

  const winsThisMonth = wonRows.length;
  const completed = completedRows.length;
  const closePct = completed > 0 ? (winsThisMonth / completed) * 100 : 0;
  const pipelineValueInr = interestedLeads * fee.avgFeeInr;

  return {
    interestedLeads,
    avgFeeKnown: fee.known,
    pipelineValueInr,
    forecast30Inr: pipelineValueInr * (closePct / 100),
    winsThisMonth,
    completedThisMonth: completed,
    closePct,
  };
});

export async function getPipelineOverview(viewerId: string, isAdmin: boolean) {
  const today = istToday();
  const week = istWeekRange(today);
  const month = istMonthRange(today);
  // @db.Date columns (dateIn, callDate) use the UTC-midnight day boundaries…
  const mStart = month.start;
  const mEnd = month.end;
  // …but stage changes are true timestamps: query them with the IST instants,
  // otherwise 00:00–05:30 IST events on the 1st land in the wrong month.
  const ts = istMonthInstantRange(today);

  // PRD §2: a User sees only their own data. Admin sees everything. Scope every
  // dashboard number (and the priority lists below) to the viewer's own leads /
  // outcomes for non-admins, so no team member's leads leak through the metrics.
  const ownScope: Prisma.LeadWhereInput | undefined = isAdmin ? undefined : { enteredById: viewerId };
  const ownLeadWhere = ownScope ?? {};
  const ownOutcomeWhere = isAdmin ? {} : { enteredById: viewerId };

  const [
    leadsThisWeek, leadsThisMonth, booked, completed, noShows, wonRows,
    hqOutcomes, monthOutcomes, interestedLeads, monthIncomes, fee, targetRow,
  ] = await Promise.all([
    prisma.lead.count({ where: { dateIn: { gte: week.start, lt: week.end }, ...ownLeadWhere } }),
    prisma.lead.count({ where: { dateIn: { gte: mStart, lt: mEnd }, ...ownLeadWhere } }),
    distinctLeadsReaching("DISCO_BOOKED", ts.start, ts.end, ownScope),
    distinctLeadsReaching("DISCO_COMPLETED", ts.start, ts.end, ownScope),
    distinctLeadsReaching("NO_SHOW", ts.start, ts.end, ownScope),
    prisma.leadStageHistory.findMany({
      where: { toStage: "WON", changedAt: { gte: ts.start, lt: ts.end }, ...(ownScope ? { lead: ownScope } : {}) },
      select: { leadId: true },
      distinct: ["leadId"],
    }),
    prisma.discoveryOutcome.count({
      where: { highlyQualified: true, callDate: { gte: mStart, lt: mEnd }, ...ownOutcomeWhere },
    }),
    prisma.discoveryOutcome.count({ where: { callDate: { gte: mStart, lt: mEnd }, ...ownOutcomeWhere } }),
    prisma.lead.count({ where: { stage: { in: INTERESTED_STAGES as unknown as never[] }, ...ownLeadWhere } }),
    prisma.income.findMany({
      where: { date: { gte: mStart, lt: mEnd } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    getEffectiveAvgFee(),
    prisma.monthlyTarget.findUnique({ where: { month: mStart } }),
  ]);

  const wonLeadIds = wonRows.map((r) => r.leadId);
  const wonLeads = wonLeadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: wonLeadIds } }, select: { wonLevel: true } })
    : [];
  const conversionsByLevel = { SOLO: 0, GUIDED: 0, ELITE: 0, OTHER: 0 };
  for (const l of wonLeads) {
    const k = l.wonLevel === "SOLO" || l.wonLevel === "GUIDED" || l.wonLevel === "ELITE" ? l.wonLevel : "OTHER";
    conversionsByLevel[k] += 1;
  }

  // Per-level averages come straight from income; the single blended figure used to
  // value open leads (which carry no committed level yet) falls back to the founder's
  // configured fee when there's no income history, so it's never a misleading ₹0.
  const { avgFeeInr: effectiveFeeInr, fromIncome: avgFeeFromIncome, known: avgFeeKnown, byLevel: avgFeeByLevel } = fee;

  const showUpPct = booked > 0 ? (completed / booked) * 100 : 0;
  const closePct = completed > 0 ? (wonLeadIds.length / completed) * 100 : 0;
  const noShowPct = booked > 0 ? (noShows / booked) * 100 : 0;
  // HQ ÷ disco conducted (SALES-LOGIC §3): numerator and denominator from the
  // SAME table + date column, so the ratio can never exceed 100%.
  const hqPct = monthOutcomes > 0 ? (hqOutcomes / monthOutcomes) * 100 : 0;
  const pipelineValueInr = interestedLeads * effectiveFeeInr;
  const forecast30Inr = pipelineValueInr * (closePct / 100);

  const revenue = sumAgg(monthIncomes);
  const targetInr = Number(targetRow?.targetInrMinor ?? BigInt(80000000)); // ₹8,00,000 default
  const targetPct = targetInr > 0 ? (Number(revenue.inr) / targetInr) * 100 : 0;

  // ── Lead priority scoring + deal-risk (report §3.A - rule-based, no AI) ──
  const OPEN_STAGES = [
    "NEW_LEAD", "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED",
    "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT",
    "SENT_TO_WORKSHOP", "WORKSHOP_FOLLOWUP", "OFFER_FOLLOWUP", "DEPOSIT_FOLLOWUP", "DEPOSIT_PAID",
    "NO_SHOW",
  ] as const;
  const STAGE_WEIGHT: Record<string, number> = {
    DEPOSIT_PAID: 32, SSS_COMPLETED: 30, DEPOSIT_FOLLOWUP: 29, PROPOSAL_SENT: 28,
    OFFER_FOLLOWUP: 26, SSS_BOOKED: 25, DISCO_COMPLETED: 20, DISCO_BOOKED: 15,
    WORKSHOP_FOLLOWUP: 14, SENT_TO_WORKSHOP: 12, NEW_LEAD: 10, DISCO_NOT_BOOKED: 8, NO_SHOW: 5,
  };

  // Open leads first (lean select), then history/outcomes scoped to just those
  // ids — the unscoped groupBy walked the entire stage history on every render.
  const openLeads = await prisma.lead.findMany({
    where: { stage: { in: OPEN_STAGES as unknown as never[] }, ...ownLeadWhere },
    select: { id: true, name: true, phone: true, stage: true, dateIn: true, createdAt: true },
  });
  const openLeadIds = openLeads.map((l) => l.id);
  const [lastChanges, openOutcomes] = await Promise.all([
    prisma.leadStageHistory.groupBy({
      by: ["leadId"],
      where: { leadId: { in: openLeadIds } },
      _max: { changedAt: true },
    }),
    prisma.discoveryOutcome.findMany({
      where: { leadId: { in: openLeadIds } },
      orderBy: { callDate: "desc" },
      select: {
        leadId: true, outcome: true, highlyQualified: true,
        bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
      },
    }),
  ]);
  const lastChangeAt = new Map(lastChanges.map((c) => [c.leadId, c._max.changedAt!]));
  const latestOutcome = new Map<string, (typeof openOutcomes)[number]>();
  for (const o of openOutcomes) if (!latestOutcome.has(o.leadId)) latestOutcome.set(o.leadId, o);

  const nowMs = Date.now();
  const dayMs = 86400000;
  const scored = openLeads.map((l) => {
    const o = latestOutcome.get(l.id);
    const bant = o ? [o.bantBudget, o.bantAuthority, o.bantNeed, o.bantTimeline].filter(Boolean).length : 0;
    const idleDays = Math.floor((nowMs - (lastChangeAt.get(l.id) ?? l.createdAt).getTime()) / dayMs);
    const freshDays = Math.floor((nowMs - l.dateIn.getTime()) / dayMs);

    let score = STAGE_WEIGHT[l.stage] ?? 0;
    const reasons: string[] = [];
    if (bant > 0) { score += bant * 10; reasons.push(`BANT ${bant}/4`); }
    if (o?.highlyQualified) { score += 15; reasons.push("Highly qualified"); }
    if (freshDays <= 7) { score += 10; reasons.push("New this week"); }
    if (idleDays > 7) { score -= Math.min(idleDays - 7, 20); }
    reasons.push(STAGE_WEIGHT[l.stage] >= 25 ? "Late stage" : `Stage: ${l.stage.replace(/_/g, " ").toLowerCase()}`);

    // Deal-risk rules
    let risk: string | null = null;
    if (l.stage === "NO_SHOW") risk = "No-show never rebooked";
    else if (l.stage === "PROPOSAL_SENT" && idleDays > 7) risk = `Proposal aging ${idleDays}d - no decision`;
    else if (l.stage === "OFFER_FOLLOWUP" && idleDays > 7) risk = `Offer open ${idleDays}d - didn't buy`;
    else if (l.stage === "DEPOSIT_FOLLOWUP" && idleDays > 5) risk = `Agreed but no deposit for ${idleDays}d`;
    else if (o?.outcome === "FOLLOW_UP_NEEDED" && idleDays > 5) risk = `Follow-up promised, silent ${idleDays}d`;
    else if (l.stage !== "NEW_LEAD" && idleDays > 10) risk = `Stalled - no movement in ${idleDays}d`;

    return {
      id: l.id, name: l.name, phone: l.phone, stage: l.stage,
      score, reasons: reasons.slice(0, 3), idleDays, risk,
    };
  });
  const callFirst = [...scored].filter((s) => !s.risk).sort((a, b) => b.score - a.score).slice(0, 5);
  const riskDeals = scored.filter((s) => s.risk).sort((a, b) => b.idleDays - a.idleDays).slice(0, 8);

  // Tables - Admin sees all; Users see only their own entries (CONTEXT §2)
  const leadWhere = isAdmin ? {} : { enteredById: viewerId };
  const outcomeWhere = isAdmin ? {} : { enteredById: viewerId };
  const [leads, outcomes, leadOptions, assigneeRows] = await Promise.all([
    prisma.lead.findMany({
      where: leadWhere,
      orderBy: { dateIn: "desc" },
      take: 500,
      include: { enteredBy: { select: { name: true } }, assignedTo: { select: { name: true } } },
    }),
    prisma.discoveryOutcome.findMany({
      where: outcomeWhere,
      orderBy: { callDate: "desc" },
      take: 500,
      include: { lead: { select: { name: true } }, enteredBy: { select: { name: true } } },
    }),
    // Outcome-form lead picker: non-admins only see leads they entered or own —
    // matches the write rules in pipeline-actions and keeps the full lead book
    // (names + phones) out of a member's serialized page props.
    prisma.lead.findMany({
      where: isAdmin ? {} : { OR: [{ enteredById: viewerId }, { assignedToId: viewerId }] },
      orderBy: { dateIn: "desc" },
      take: 500,
      select: { id: true, name: true, phone: true },
    }),
    // Setters a lead can be assigned to — the assign control is Admin-only, so
    // only Admin gets the roster (and never student portal accounts).
    isAdmin
      ? prisma.user.findMany({
          where: { role: { notIn: ["STUDENT", "TUTOR"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    metrics: {
      leadsThisWeek, leadsThisMonth,
      booked, completed,
      showUpPct, closePct, noShowPct, hqPct,
      pipelineValueInr, forecast30Inr,
      conversionsByLevel,
      avgFeeKnown,
      avgFeeFromIncome,
      avgFeeByLevel, // per-level average program fee (₹ minor), null where no income
      avgFeeInrMajor: Math.round(effectiveFeeInr / 100), // blended fee used for open leads
      monthOutcomes,
    },
    target: {
      month: mStart.toISOString().slice(0, 7),
      targetInrMinor: targetInr,
      revenueInrMinor: Number(revenue.inr),
      pct: targetPct,
    },
    callFirst,
    riskDeals,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      leadSource: l.leadSource,
      dateIn: l.dateIn.toISOString(),
      stage: l.stage,
      wonLevel: l.wonLevel,
      paymentPlan: l.paymentPlan,
      notes: l.notes,
      enteredBy: l.enteredBy?.name ?? "-",
      source: l.source,
      // Speed-to-lead (Wave-1): who owns it, and how long until first contact.
      assignedToId: l.assignedToId,
      assignedTo: l.assignedTo?.name ?? null,
      contactedAt: l.contactedAt?.toISOString() ?? null,
      speedMs: l.contactedAt ? l.contactedAt.getTime() - l.createdAt.getTime() : null,
    })),
    assignees: assigneeRows.map((u) => ({ value: u.id, label: u.name })),
    outcomes: outcomes.map((o) => ({
      id: o.id,
      leadId: o.leadId,
      leadName: o.lead.name,
      callDate: o.callDate.toISOString(),
      outcome: o.outcome,
      highlyQualified: o.highlyQualified,
      bantBudget: o.bantBudget,
      bantAuthority: o.bantAuthority,
      bantNeed: o.bantNeed,
      bantTimeline: o.bantTimeline,
      sssDate: o.sssDate?.toISOString() ?? null,
      notes: o.notes,
      enteredBy: o.enteredBy?.name ?? "-",
    })),
    leadOptions: leadOptions.map((l) => ({ value: l.id, label: `${l.name} (${l.phone})` })),
  };
}

export type PipelineOverview = Awaited<ReturnType<typeof getPipelineOverview>>;
export type LeadRow = PipelineOverview["leads"][number];
export type OutcomeRow = PipelineOverview["outcomes"][number];
