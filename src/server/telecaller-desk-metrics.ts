import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istBoundaryToInstant, istMonthInstantRange, istToday } from "@/lib/dates";
import type { GoalProgress } from "@/lib/goals";
import { getGoalsWithProgress } from "./goals";

/**
 * The telecaller's OWN desk — what Nilofer/Asma see about themselves.
 *
 * Distinct from `telecaller-metrics.ts`, which is Ameen's Admin-only payout board and counts
 * calls from self-reported DailyLog numbers. This reads CallLog: one row per real dial. The two
 * will not always agree, and that is the point — this one cannot be typed in.
 *
 * "Converted" here is the person's OWN stage win: a lead THEY are assigned that reached WON.
 * Deliberately a third definition, chosen over the two that already exist:
 *   • gamification `wins` credits whoever CLICKED the stage — Ameen closing Nilofer's lead
 *     would credit Ameen, which is wrong on a page titled "my numbers";
 *   • commission credits on PAYMENT, which lags the call by weeks and would leave the
 *     dashboard reading zero for most of the month.
 * Neither answers "did the lead I worked convert?". This does.
 */

const DAY_MS = 86_400_000;

/** A lead as it appears on the desk — enough to decide who to ring next, and to ring them. */
export type DeskLead = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  stage: string;
  leadSource: string;
  /** ISO, or null when nobody has ever logged a call against this lead. */
  lastCalledAt: string | null;
  callCount: number;
  /** ISO — when the lead landed. Drives the "new today" grouping. */
  createdAt: string;
};

export type DeskToday = {
  calls: number;
  spoke: number;
  /** 0 = no target set by the admin, which hides the bar rather than showing "0 / 0". */
  target: number;
  /** Leads assigned to me, still open, with no call logged today. */
  toCall: number;
};

export type DeskMonth = {
  calls: number;
  /** Distinct leads I actually TALKED to (outcome SPOKE) — not dials. */
  spokenTo: number;
  /** My assigned leads that reached WON this month. */
  converted: number;
  /** converted ÷ spokenTo. Null when I've spoken to nobody — 0% would be a lie. */
  conversionPct: number | null;
};

/**
 * The variants that make someone a telecaller. Same predicate telecaller-metrics.ts uses —
 * "telecaller" is a TeamProfile.logVariant, never a Role, so this is the only honest test.
 */
export const TELECALLER_VARIANTS = ["APPOINTMENT_SETTER", "DISCOVERY_SPECIALIST"] as const;

export type TelecallerDesk = {
  teamProfileId: string;
  name: string;
  roleTitle: string;
  logVariant: string;
  /** False for a non-calling profile (e.g. a coach): the desk still renders, minus the call list. */
  isTelecaller: boolean;
  today: DeskToday;
  month: DeskMonth;
  /** This person's own active goals — the "goal to reach the incentive" bar. */
  goals: GoalProgress[];
  /** Who to ring today, never-called first. */
  worklist: DeskLead[];
};

/** The IST day as real UTC instants — calledAt is a timestamp, so boundaries must be instants. */
function istTodayInstantRange(): { start: Date; end: Date } {
  const today = istToday();
  return {
    start: istBoundaryToInstant(today),
    end: istBoundaryToInstant(new Date(today.getTime() + DAY_MS)),
  };
}

/** Stages that are still worth a phone call. WON/LOST are finished business. */
const OPEN_STAGES = [
  "NEW_LEAD", "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED",
  "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP", "OFFER_FOLLOWUP", "DEPOSIT_FOLLOWUP", "DEPOSIT_PAID",
  "NO_SHOW",
] as const;

/**
 * Everything one telecaller's desk needs, for the given user.
 *
 * `cache`d per request so the page, the login popup and the header can each ask without
 * re-querying — the same trick getPendingRows uses.
 */
export const getTelecallerDesk = cache(async (userId: string): Promise<TelecallerDesk | null> => {
  const profile = await prisma.teamProfile.findUnique({
    where: { userId },
    select: { id: true, fullName: true, roleTitle: true, dailyCallTarget: true, logVariant: true },
  });
  if (!profile) return null;

  const day = istTodayInstantRange();
  const month = istMonthInstantRange();

  const [todayCalls, monthCalls, wonThisMonth, openLeads, allGoals] = await Promise.all([
    prisma.callLog.findMany({
      where: { userId, calledAt: { gte: day.start, lt: day.end } },
      select: { outcome: true },
    }),
    prisma.callLog.findMany({
      where: { userId, calledAt: { gte: month.start, lt: month.end } },
      select: { outcome: true, leadId: true },
    }),
    // My leads that hit WON this month — attributed by lead ownership, NOT by who clicked.
    prisma.leadStageHistory.findMany({
      where: {
        toStage: "WON",
        changedAt: { gte: month.start, lt: month.end },
        lead: { assignedToId: userId },
      },
      select: { leadId: true },
      distinct: ["leadId"], // a lead bounced back into WON twice is still one conversion
    }),
    prisma.lead.findMany({
      // `phone` is nullable since the Synamate import. A lead with no number cannot be rung, so it
      // has no place on a dial list — excluded here rather than downstream, so the take:500 cap is
      // spent on leads that are actually callable.
      where: { assignedToId: userId, stage: { in: [...OPEN_STAGES] }, phone: { not: null } },
      select: {
        id: true, name: true, phone: true, city: true, stage: true,
        leadSource: true, createdAt: true,
        callLogs: {
          orderBy: { calledAt: "desc" },
          take: 1,
          select: { calledAt: true },
        },
        _count: { select: { callLogs: true } },
      },
      take: 500,
    }),
    getGoalsWithProgress(),
  ]);

  const spokeToday = todayCalls.filter((c) => c.outcome === "SPOKE").length;
  const spokenLeadIds = new Set(monthCalls.filter((c) => c.outcome === "SPOKE").map((c) => c.leadId));
  const converted = wonThisMonth.length;

  // Worklist = open + not yet called TODAY. A lead called yesterday is due again; a lead
  // already rung today is done, whatever the outcome — re-dialling within the day is the
  // telecaller's judgement call, not a task the board should keep nagging about.
  const worklist: DeskLead[] = openLeads
    // Narrowing only — the `phone: { not: null }` filter above already did the excluding.
    .filter((l): l is typeof l & { phone: string } => l.phone !== null)
    .map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      city: l.city,
      stage: l.stage,
      leadSource: l.leadSource,
      lastCalledAt: l.callLogs[0]?.calledAt.toISOString() ?? null,
      callCount: l._count.callLogs,
      createdAt: l.createdAt.toISOString(),
    }))
    .filter((l) => {
      if (!l.lastCalledAt) return true; // never called → always due
      return new Date(l.lastCalledAt) < day.start; // last call was before today
    })
    // Never-called first (a lead nobody has rung is the most expensive to leave sitting),
    // then longest-since-contact.
    .sort((a, b) => {
      if (!a.lastCalledAt && !b.lastCalledAt) return a.createdAt.localeCompare(b.createdAt);
      if (!a.lastCalledAt) return -1;
      if (!b.lastCalledAt) return 1;
      return a.lastCalledAt.localeCompare(b.lastCalledAt);
    });

  return {
    teamProfileId: profile.id,
    name: profile.fullName,
    roleTitle: profile.roleTitle,
    logVariant: profile.logVariant,
    isTelecaller: (TELECALLER_VARIANTS as readonly string[]).includes(profile.logVariant),
    today: {
      calls: todayCalls.length,
      spoke: spokeToday,
      target: profile.dailyCallTarget,
      toCall: worklist.length,
    },
    month: {
      calls: monthCalls.length,
      spokenTo: spokenLeadIds.size,
      converted,
      conversionPct: spokenLeadIds.size > 0 ? (converted / spokenLeadIds.size) * 100 : null,
    },
    goals: allGoals.filter(
      (g) => g.goal.active && g.goal.scope === "USER" && g.goal.teamProfileId === profile.id && g.open,
    ),
    worklist,
  };
});

/**
 * Just the number for the login popup / header badge — avoids building the whole desk.
 * Shares the request cache with getTelecallerDesk, so calling both costs one query set.
 */
export async function getCallsDueToday(userId: string): Promise<number> {
  const desk = await getTelecallerDesk(userId);
  return desk?.today.toCall ?? 0;
}
