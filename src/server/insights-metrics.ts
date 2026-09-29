import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { eurMinorToInrMinor } from "@/lib/fx";
import { economicsFor, bandByMedian, type SourceTotals, type SourceEconomics, type Performance } from "@/lib/attribution";

/**
 * Campaign attribution (ER v2 Track F) - the report that stands in for the diagram's
 * `INSIGHT` entity.
 *
 * INSIGHT is NOT a table here, deliberately. Every field of it (`metric`,
 * `performance "high|low"`) is a division over rows that already exist; storing it would be a
 * cached quotient that goes stale the moment a lead converts, and would then need its own
 * invalidation story. The arithmetic lives in `lib/attribution.ts` so it is testable without
 * a database; this module only gathers the counts.
 */

export type AttributionRow = SourceEconomics & { performance: Performance };

/**
 * Per-campaign economics for a date window.
 *
 * The window applies to LEADS and SPEND, not to revenue: a lead captured in March that
 * enrolls in May earned its campaign that money, and clipping revenue to the window would
 * make every recent campaign look like a failure. This is cohort attribution, not cash
 * accounting - the Finance screens are where the period matters.
 */
export const getAttribution = cache(async (from: Date, to: Date): Promise<AttributionRow[]> => {
  const sources = await prisma.marketingSource.findMany({
    where: { active: true },
    select: { id: true, channel: true, campaign: true },
    orderBy: [{ channel: "asc" }, { campaign: "asc" }],
  });
  if (sources.length === 0) return [];

  const ids = sources.map((s) => s.id);

  const [spendRows, leadRows, bookingRows, enrolmentRows] = await Promise.all([
    prisma.adSpend.findMany({
      where: {
        sourceId: { in: ids },
        OR: [{ periodStart: null }, { periodStart: { gte: from, lte: to } }],
      },
      select: { sourceId: true, adSpendInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.lead.groupBy({
      by: ["marketingSourceId"],
      where: { marketingSourceId: { in: ids }, deletedAt: null, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    prisma.bookingRequest.groupBy({
      by: ["leadId"],
      where: { lead: { marketingSourceId: { in: ids }, deletedAt: null, createdAt: { gte: from, lte: to } } },
      _count: { _all: true },
    }),
    // Enrolments and their revenue, joined back to the campaign through the lead. Read in one
    // pass rather than per-source: a per-campaign query would be N round trips on a database
    // whose round trip is the dominant cost.
    prisma.enrollment.findMany({
      where: {
        OR: [
          { lead: { marketingSourceId: { in: ids }, createdAt: { gte: from, lte: to } } },
          { student: { lead: { marketingSourceId: { in: ids }, createdAt: { gte: from, lte: to } } } },
        ],
      },
      select: {
        id: true,
        lead: { select: { marketingSourceId: true } },
        student: { select: { lead: { select: { marketingSourceId: true } } } },
        incomes: { where: { deletedAt: null }, select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true } },
      },
    }),
  ]);

  const spendBySource = new Map<string, bigint>();
  for (const s of spendRows) {
    if (!s.sourceId) continue;
    const eur = s.fxRateUsed ? eurMinorToInrMinor(s.amountEurMinor, s.fxRateUsed) : 0n;
    spendBySource.set(s.sourceId, (spendBySource.get(s.sourceId) ?? 0n) + s.adSpendInrMinor + eur);
  }

  const leadsBySource = new Map<string, number>();
  for (const l of leadRows) if (l.marketingSourceId) leadsBySource.set(l.marketingSourceId, l._count._all);

  // groupBy leadId gives one row per booked lead; count them per source via a second lookup
  // only when there are bookings at all.
  const bookingsBySource = new Map<string, number>();
  if (bookingRows.length > 0) {
    const leadIds = bookingRows.map((b) => b.leadId).filter((x): x is string => x !== null);
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { marketingSourceId: true },
    });
    for (const l of leads) {
      if (!l.marketingSourceId) continue;
      bookingsBySource.set(l.marketingSourceId, (bookingsBySource.get(l.marketingSourceId) ?? 0) + 1);
    }
  }

  const enrolBySource = new Map<string, number>();
  const revenueBySource = new Map<string, bigint>();
  for (const e of enrolRowsOf(enrolmentRows)) {
    enrolBySource.set(e.sourceId, (enrolBySource.get(e.sourceId) ?? 0) + 1);
    revenueBySource.set(e.sourceId, (revenueBySource.get(e.sourceId) ?? 0n) + e.revenue);
  }

  const totals: SourceTotals[] = sources.map((s) => ({
    sourceId: s.id,
    channel: s.channel,
    campaign: s.campaign,
    spendInrMinor: spendBySource.get(s.id) ?? 0n,
    leads: leadsBySource.get(s.id) ?? 0,
    bookings: bookingsBySource.get(s.id) ?? 0,
    enrolments: enrolBySource.get(s.id) ?? 0,
    revenueInrMinor: revenueBySource.get(s.id) ?? 0n,
  }));

  const economics = totals.map(economicsFor);
  const bands = bandByMedian(economics);
  return economics.map((e) => ({ ...e, performance: bands.get(e.sourceId) ?? "unrated" }));
});

/**
 * Resolve each enrolment to ONE campaign and its revenue.
 *
 * `Enrollment.leadId` (Track E) wins over the older `Student.lead` route when both are set:
 * a student who came back through a second campaign has two acquisition stories, and the one
 * attached to THIS sale is the direct link. Falling back to the student's original lead keeps
 * pre-Track-E rows attributable instead of silently dropping them from every report.
 */
function enrolRowsOf(
  rows: {
    lead: { marketingSourceId: string | null } | null;
    student: { lead: { marketingSourceId: string | null } | null };
    incomes: { amountInrMinor: bigint; amountEurMinor: bigint; fxRateUsed: { toString(): string } }[];
  }[],
): { sourceId: string; revenue: bigint }[] {
  const out: { sourceId: string; revenue: bigint }[] = [];
  for (const e of rows) {
    const sourceId = e.lead?.marketingSourceId ?? e.student.lead?.marketingSourceId ?? null;
    if (!sourceId) continue;
    const revenue = e.incomes.reduce(
      (sum, i) => sum + i.amountInrMinor + eurMinorToInrMinor(i.amountEurMinor, i.fxRateUsed as never),
      0n,
    );
    out.push({ sourceId, revenue });
  }
  return out;
}

/** Campaigns for the admin picker + the lead form. */
export const listMarketingSources = cache(async () => {
  const rows = await prisma.marketingSource.findMany({
    orderBy: [{ active: "desc" }, { channel: "asc" }, { campaign: "asc" }],
    include: { _count: { select: { leads: true, adSpends: true } } },
  });
  return rows.map((s) => ({
    id: s.id,
    channel: s.channel,
    campaign: s.campaign,
    externalRef: s.externalRef,
    line: s.line,
    active: s.active,
    leadCount: s._count.leads,
    adSpendCount: s._count.adSpends,
  }));
});
