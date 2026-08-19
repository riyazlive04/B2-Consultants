import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istBoundaryToInstant, istToday } from "@/lib/dates";
import { DEFAULT_CALL_DISTRIBUTION } from "@/lib/config-schema";
import { getCallDistribution } from "./founder-config";

/**
 * First-call assignment rules (client notes):
 *   - target split of incoming leads, e.g. Nilofer 80% / Asma 20% (TeamProfile.firstCallSharePct)
 *   - Saturday availability, e.g. Asma doesn't work Saturdays (TeamProfile.worksSaturdays)
 *
 * pickFirstCaller() is a deterministic rule engine, no AI: among today's eligible people it
 * assigns the one furthest BELOW their target share over the last 30 days, so the real split
 * converges on the configured split. Manual reassignment on the Pipeline page always overrides.
 */

/**
 * Fallback only. The live window comes from `callDistribution.lookbackDays` (Console → Call
 * Distribution); this is what a fresh install runs on before anything is configured, and it is
 * the value the engine used when the window was hardcoded.
 */
const LOOKBACK_DAYS = DEFAULT_CALL_DISTRIBUTION.lookbackDays;

const istWeekday = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" }).format(d);

export type RotationMember = {
  userId: string;
  name: string;
  sharePct: number;
  worksSaturdays: boolean;
  /**
   * Leads assigned inside the configured lookback window.
   *
   * Was `assigned30d`, which stopped being true the moment the window became founder-editable -
   * a field name that quietly lies is worse than a vague one.
   */
  assignedInWindow: number;
  /** Share of the window's auto-trackable assignments. */
  actualPct: number;
  /** Excluded right now by the Saturday rule. */
  offToday: boolean;
  /** Auto-assigned so far in the current IST day - measured against the daily cap. */
  assignedToday: number;
  /** At or past the configured daily ceiling, so the rotation will skip them. */
  atDailyCap: boolean;
};

async function loadRotation(now: Date): Promise<RotationMember[]> {
  const cfg = await getCallDistribution();
  const profiles = await prisma.teamProfile.findMany({
    where: { status: "ACTIVE", firstCallSharePct: { gt: 0 }, userId: { not: null } },
    select: { userId: true, fullName: true, firstCallSharePct: true, worksSaturdays: true },
  });
  if (!profiles.length) return [];

  const userIds = profiles.map((p) => p.userId!);
  const since = new Date(now.getTime() - cfg.lookbackDays * 86400000);
  // The IST day boundary, so a cap of "20 a day" means a working day rather than a UTC one.
  const dayStart = istBoundaryToInstant(istToday());

  const [counts, todayCounts] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedToId"],
      where: { ...ACTIVE, assignedToId: { in: userIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // Only queried when a cap is actually set - otherwise it is a round trip on the lead-capture
    // path that can never change the answer.
    cfg.dailyCapPerPerson > 0
      ? prisma.lead.groupBy({
          by: ["assignedToId"],
          where: { ...ACTIVE, assignedToId: { in: userIds }, createdAt: { gte: dayStart } },
          _count: { _all: true },
        })
      : Promise.resolve([] as { assignedToId: string | null; _count: { _all: number } }[]),
  ]);

  const countOf = new Map(counts.map((c) => [c.assignedToId, c._count._all]));
  const todayOf = new Map(todayCounts.map((c) => [c.assignedToId, c._count._all]));
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const isSaturday = istWeekday(now) === "Sat";

  return profiles.map((p) => {
    const assignedInWindow = countOf.get(p.userId!) ?? 0;
    const assignedToday = todayOf.get(p.userId!) ?? 0;
    return {
      userId: p.userId!,
      name: p.fullName,
      sharePct: p.firstCallSharePct,
      worksSaturdays: p.worksSaturdays,
      assignedInWindow,
      actualPct: total > 0 ? (assignedInWindow / total) * 100 : 0,
      offToday: isSaturday && !p.worksSaturdays,
      assignedToday,
      atDailyCap: cfg.dailyCapPerPerson > 0 && assignedToday >= cfg.dailyCapPerPerson,
    };
  });
}

/** The userId a fresh lead should go to right now, or null when no rotation is configured. */
export async function pickFirstCaller(now = new Date()): Promise<string | null> {
  const all = await loadRotation(now);
  // Available = working today AND not already at their ceiling. A capped person is skipped, so
  // the lead goes to the next eligible caller rather than piling onto a queue they cannot work.
  const rotation = all.filter((m) => !m.offToday && !m.atDailyCap);
  if (!rotation.length) {
    // Everyone capped out is a different situation from nobody being configured, and it is worth
    // saying so: the leads still arrive, they just arrive unassigned, and silence would make that
    // look like a rotation misconfiguration.
    if (all.some((m) => m.atDailyCap)) {
      console.warn("[assignment] every eligible caller is at their daily cap - leads will arrive unassigned");
    }
    return null;
  }

  // Deficit vs target share, normalised over today's eligible members - the person most
  // behind their share gets the lead; ties go to the higher target share.
  const shareTotal = rotation.reduce((s, m) => s + m.sharePct, 0);
  const assignedTotal = rotation.reduce((s, m) => s + m.assignedInWindow, 0);
  const best = rotation
    .map((m) => ({
      ...m,
      deficit:
        m.sharePct / shareTotal -
        (assignedTotal > 0 ? m.assignedInWindow / assignedTotal : 0),
    }))
    .sort((a, b) => b.deficit - a.deficit || b.sharePct - a.sharePct)[0];
  return best.userId;
}

/**
 * Target-vs-actual split, for the Pipeline card and the Console panel's live preview.
 *
 * `share` is the NORMALISED figure - what the engine will actually do - not the raw
 * `firstCallSharePct`. The two differ whenever the shares don't total 100, and the Pipeline card
 * used to print the raw number: with 5 and 2 configured it read "5% target / 2% target" while the
 * engine ran 71/29. Showing the founder a number the engine does not use is how a setting gets
 * blamed for not working.
 */
export async function getFirstCallSplit(now = new Date()) {
  const cfg = await getCallDistribution();
  const rotation = await loadRotation(now);
  const shareTotal = rotation.reduce((s, m) => s + m.sharePct, 0);
  return {
    lookbackDays: cfg.lookbackDays,
    dailyCapPerPerson: cfg.dailyCapPerPerson,
    isSaturday: istWeekday(now) === "Sat",
    /** True when the raw shares don't total 100 - the card explains rather than blocks. */
    sharesNormalised: shareTotal > 0 && shareTotal !== 100,
    members: rotation
      .map((m) => ({ ...m, effectivePct: shareTotal > 0 ? (m.sharePct / shareTotal) * 100 : 0 }))
      .sort((a, b) => b.sharePct - a.sharePct),
  };
}

export type FirstCallSplit = Awaited<ReturnType<typeof getFirstCallSplit>>;
