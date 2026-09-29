import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istMonthInstantRange } from "@/lib/dates";
import { getOwnershipInventory, type OwnershipInventory } from "./termination";

/**
 * What one person did, and what they still hold - the record the founder reviews before
 * offboarding them, and files afterwards.
 *
 * ── Why the figures are computed here rather than pulled from the desks ──────────
 * The L1/L2 desk modules answer "how am I doing THIS MONTH" and are shaped for a live screen:
 * they cap rows, sort queues and build call lists. A leaving report wants the opposite - the
 * whole tenure, no caps, no queues - so reusing them would mean passing flags through several
 * layers to suppress most of what they do.
 *
 * What IS reused is the ownership inventory (`termination.ts`), because "what do they still hold"
 * must be the same question the migration answers. If the report said 12 open leads and the
 * migration moved 9, one of them would be wrong and there would be no way to tell which.
 */

export type TerminationReport = {
  profile: {
    id: string;
    name: string;
    roleTitle: string;
    email: string;
    logVariant: string;
    dateJoined: string | null;
    keyResponsibilities: string | null;
    firstCallSharePct: number;
    userId: string | null;
    accountStatus: string | null;
  };
  tenure: {
    /** Whole months from joining, or null when no join date was ever recorded. */
    months: number | null;
    joined: string | null;
  };
  /** Lifetime activity - the honest measure of what they actually did. */
  work: {
    callsLogged: number;
    conversationsHad: number;
    leadsOwnedEver: number;
    leadsWon: number;
    discoveryOutcomes: number;
    highlyQualified: number;
    bookingsAttended: number;
    dailyLogsSubmitted: number;
  };
  thisMonth: { callsLogged: number; conversationsHad: number };
  /** Commission credited to them across their whole tenure, in INR minor units. */
  earnings: { commissionInrMinor: number; payouts: number };
  /** What still needs a new owner - the same numbers the migration acts on. */
  holds: OwnershipInventory;
  generatedAt: string;
};

const MONTH_MS = 30.44 * 86_400_000;

export async function getTerminationReport(profileId: string): Promise<TerminationReport | null> {
  const profile = await prisma.teamProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true, fullName: true, roleTitle: true, email: true, logVariant: true,
      dateJoined: true, keyResponsibilities: true, firstCallSharePct: true, userId: true,
      user: { select: { status: true } },
    },
  });
  if (!profile) return null;

  const userId = profile.userId;
  const month = istMonthInstantRange();

  // A profile with no linked login has no CallLog/Lead history to read - every one of those
  // relations keys off `User`, not `TeamProfile`. Return the shape with zeros rather than
  // pretending, so the dialog can still show their responsibilities and let them be offboarded.
  const [
    callsLogged, conversationsHad, leadsOwnedEver, leadsWon,
    discoveryOutcomes, highlyQualified, bookingsAttended, dailyLogsSubmitted,
    monthCalls, monthSpoke, payoutRows, holds,
  ] = await Promise.all([
    userId ? prisma.callLog.count({ where: { userId } }) : 0,
    userId ? prisma.callLog.count({ where: { userId, outcome: "SPOKE" } }) : 0,
    userId ? prisma.lead.count({ where: { ...ACTIVE, assignedToId: userId } }) : 0,
    userId ? prisma.lead.count({ where: { ...ACTIVE, assignedToId: userId, stage: "WON" } }) : 0,
    userId ? prisma.discoveryOutcome.count({ where: { enteredById: userId } }) : 0,
    userId ? prisma.discoveryOutcome.count({ where: { enteredById: userId, highlyQualified: true } }) : 0,
    userId
      ? prisma.bookingRequest.count({ where: { status: "COMPLETED", slot: { assignedToId: userId } } })
      : 0,
    userId ? prisma.dailyLog.count({ where: { userId } }) : 0,
    userId ? prisma.callLog.count({ where: { userId, calledAt: { gte: month.start, lt: month.end } } }) : 0,
    userId
      ? prisma.callLog.count({ where: { userId, outcome: "SPOKE", calledAt: { gte: month.start, lt: month.end } } })
      : 0,
    // Recorded payouts, which is the durable statement of what they were actually paid - the
    // derived commission report only covers a single month and would understate a tenure.
    prisma.telecallerPayout.findMany({
      where: { teamProfileId: profileId },
      select: { commInrMinor: true, bonusInrMinor: true },
    }),
    userId ? getOwnershipInventory(userId) : Promise.resolve({ categories: [], total: 0 }),
  ]);

  const commissionInrMinor = payoutRows.reduce(
    (s, p) => s + Number(p.commInrMinor) + Number(p.bonusInrMinor),
    0,
  );

  return {
    profile: {
      id: profile.id,
      name: profile.fullName,
      roleTitle: profile.roleTitle,
      email: profile.email,
      logVariant: profile.logVariant,
      dateJoined: profile.dateJoined?.toISOString() ?? null,
      keyResponsibilities: profile.keyResponsibilities,
      firstCallSharePct: profile.firstCallSharePct,
      userId,
      accountStatus: profile.user?.status ?? null,
    },
    tenure: {
      months: profile.dateJoined
        ? Math.max(0, Math.floor((Date.now() - profile.dateJoined.getTime()) / MONTH_MS))
        : null,
      joined: profile.dateJoined?.toISOString() ?? null,
    },
    work: {
      callsLogged, conversationsHad, leadsOwnedEver, leadsWon,
      discoveryOutcomes, highlyQualified, bookingsAttended, dailyLogsSubmitted,
    },
    thisMonth: { callsLogged: monthCalls, conversationsHad: monthSpoke },
    earnings: { commissionInrMinor, payouts: payoutRows.length },
    holds,
    generatedAt: new Date().toISOString(),
  };
}
