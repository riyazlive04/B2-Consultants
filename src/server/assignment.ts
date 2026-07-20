import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";

/**
 * First-call assignment rules (client notes):
 *   - target split of incoming leads, e.g. Nilofer 80% / Asma 20% (TeamProfile.firstCallSharePct)
 *   - Saturday availability, e.g. Asma doesn't work Saturdays (TeamProfile.worksSaturdays)
 *
 * pickFirstCaller() is a deterministic rule engine, no AI: among today's eligible people it
 * assigns the one furthest BELOW their target share over the last 30 days, so the real split
 * converges on the configured split. Manual reassignment on the Pipeline page always overrides.
 */

const LOOKBACK_DAYS = 30;

const istWeekday = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" }).format(d);

export type RotationMember = {
  userId: string;
  name: string;
  sharePct: number;
  worksSaturdays: boolean;
  assigned30d: number;
  actualPct: number; // share of the last 30 days' auto-trackable assignments
  offToday: boolean; // excluded right now by the Saturday rule
};

async function loadRotation(now: Date): Promise<RotationMember[]> {
  const profiles = await prisma.teamProfile.findMany({
    where: { status: "ACTIVE", firstCallSharePct: { gt: 0 }, userId: { not: null } },
    select: { userId: true, fullName: true, firstCallSharePct: true, worksSaturdays: true },
  });
  if (!profiles.length) return [];

  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  const counts = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { ...ACTIVE, assignedToId: { in: profiles.map((p) => p.userId!) }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.assignedToId, c._count._all]));
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const isSaturday = istWeekday(now) === "Sat";

  return profiles.map((p) => {
    const assigned30d = countOf.get(p.userId!) ?? 0;
    return {
      userId: p.userId!,
      name: p.fullName,
      sharePct: p.firstCallSharePct,
      worksSaturdays: p.worksSaturdays,
      assigned30d,
      actualPct: total > 0 ? (assigned30d / total) * 100 : 0,
      offToday: isSaturday && !p.worksSaturdays,
    };
  });
}

/** The userId a fresh lead should go to right now, or null when no rotation is configured. */
export async function pickFirstCaller(now = new Date()): Promise<string | null> {
  const rotation = (await loadRotation(now)).filter((m) => !m.offToday);
  if (!rotation.length) return null;

  // Deficit vs target share, normalised over today's eligible members - the person most
  // behind their share gets the lead; ties go to the higher target share.
  const shareTotal = rotation.reduce((s, m) => s + m.sharePct, 0);
  const assignedTotal = rotation.reduce((s, m) => s + m.assigned30d, 0);
  const best = rotation
    .map((m) => ({
      ...m,
      deficit:
        m.sharePct / shareTotal -
        (assignedTotal > 0 ? m.assigned30d / assignedTotal : 0),
    }))
    .sort((a, b) => b.deficit - a.deficit || b.sharePct - a.sharePct)[0];
  return best.userId;
}

/** Target-vs-actual split for the Pipeline "First-call split" card (Admin). */
export async function getFirstCallSplit(now = new Date()) {
  const rotation = await loadRotation(now);
  return {
    lookbackDays: LOOKBACK_DAYS,
    isSaturday: istWeekday(now) === "Sat",
    members: rotation.sort((a, b) => b.sharePct - a.sharePct),
  };
}

export type FirstCallSplit = Awaited<ReturnType<typeof getFirstCallSplit>>;
