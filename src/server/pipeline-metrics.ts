import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday, istWeekRange } from "@/lib/dates";
import { aggInrMinor, sumAgg } from "@/lib/money";

/**
 * Pipeline dashboard (PRD1 §5.4). Booked / completed / won counts come from the
 * append-only LeadStageHistory (when the transition happened), not from a lead's
 * current stage - a lead that later moved on still counts for the month it was booked.
 */

const INTERESTED_STAGES = ["SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT"] as const;

async function distinctLeadsReaching(stage: string, start: Date, end: Date): Promise<number> {
  const rows = await prisma.leadStageHistory.findMany({
    where: { toStage: stage as never, changedAt: { gte: start, lt: end } },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  return rows.length;
}

export async function getPipelineOverview(viewerId: string, isAdmin: boolean) {
  const today = istToday();
  const week = istWeekRange(today);
  const month = istMonthRange(today);
  // stage changes happen at entry time (timestamps), widen month range to full-day bounds
  const mStart = month.start;
  const mEnd = month.end;

  const [
    leadsThisWeek, leadsThisMonth, booked, completed, noShows, wonRows,
    hqOutcomes, monthOutcomes, interestedLeads, monthIncomes, allIncomes, targetRow,
  ] = await Promise.all([
    prisma.lead.count({ where: { dateIn: { gte: week.start, lt: week.end } } }),
    prisma.lead.count({ where: { dateIn: { gte: mStart, lt: mEnd } } }),
    distinctLeadsReaching("DISCO_BOOKED", mStart, mEnd),
    distinctLeadsReaching("DISCO_COMPLETED", mStart, mEnd),
    distinctLeadsReaching("NO_SHOW", mStart, mEnd),
    prisma.leadStageHistory.findMany({
      where: { toStage: "WON", changedAt: { gte: mStart, lt: mEnd } },
      select: { leadId: true },
      distinct: ["leadId"],
    }),
    prisma.discoveryOutcome.count({
      where: { highlyQualified: true, callDate: { gte: mStart, lt: mEnd } },
    }),
    prisma.discoveryOutcome.count({ where: { callDate: { gte: mStart, lt: mEnd } } }),
    prisma.lead.count({ where: { stage: { in: INTERESTED_STAGES as unknown as never[] } } }),
    prisma.income.findMany({
      where: { date: { gte: mStart, lt: mEnd } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.income.findMany({
      select: { programLevel: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
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

  // Average program fee per level from real income history (₹ aggregate per entry).
  const levelTotals = new Map<string, { total: number; n: number }>();
  for (const i of allIncomes) {
    if (!["SOLO", "GUIDED", "ELITE"].includes(i.programLevel)) continue;
    const v = Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    const cur = levelTotals.get(i.programLevel) ?? { total: 0, n: 0 };
    levelTotals.set(i.programLevel, { total: cur.total + v, n: cur.n + 1 });
  }
  const levelAvgs = [...levelTotals.values()].map((v) => v.total / v.n);
  const avgFeeInr = levelAvgs.length ? levelAvgs.reduce((a, b) => a + b, 0) / levelAvgs.length : 0;

  const showUpPct = booked > 0 ? (completed / booked) * 100 : 0;
  const closePct = completed > 0 ? (wonLeadIds.length / completed) * 100 : 0;
  const noShowPct = booked > 0 ? (noShows / booked) * 100 : 0;
  const hqPct = completed > 0 ? (hqOutcomes / completed) * 100 : 0;
  const pipelineValueInr = interestedLeads * avgFeeInr;
  const forecast30Inr = pipelineValueInr * (closePct / 100);

  const revenue = sumAgg(monthIncomes);
  const targetInr = Number(targetRow?.targetInrMinor ?? BigInt(80000000)); // ₹8,00,000 default
  const targetPct = targetInr > 0 ? (Number(revenue.inr) / targetInr) * 100 : 0;

  // ── Lead priority scoring + deal-risk (report §3.A - rule-based, no AI) ──
  const OPEN_STAGES = [
    "NEW_LEAD", "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED",
    "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "NO_SHOW",
  ] as const;
  const STAGE_WEIGHT: Record<string, number> = {
    SSS_COMPLETED: 30, PROPOSAL_SENT: 28, SSS_BOOKED: 25, DISCO_COMPLETED: 20,
    DISCO_BOOKED: 15, NEW_LEAD: 10, DISCO_NOT_BOOKED: 8, NO_SHOW: 5,
  };

  const [openLeads, lastChanges, openOutcomes] = await Promise.all([
    prisma.lead.findMany({ where: { stage: { in: OPEN_STAGES as unknown as never[] } } }),
    prisma.leadStageHistory.groupBy({ by: ["leadId"], _max: { changedAt: true } }),
    prisma.discoveryOutcome.findMany({ orderBy: { callDate: "desc" } }),
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
    prisma.lead.findMany({ orderBy: { dateIn: "desc" }, take: 500, select: { id: true, name: true, phone: true } }),
    // Setters a lead can be assigned to (Admin-only control). Everyone with a login.
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return {
    metrics: {
      leadsThisWeek, leadsThisMonth,
      booked, completed,
      showUpPct, closePct, noShowPct, hqPct,
      pipelineValueInr, forecast30Inr,
      conversionsByLevel,
      avgFeeKnown: levelAvgs.length > 0,
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
