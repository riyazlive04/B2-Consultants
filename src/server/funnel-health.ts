import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istBoundaryToInstant, istMonthKeyOf, istToday } from "@/lib/dates";
import { ACTIVE } from "@/lib/soft-delete";
import { buildFunnelHealth, emptyCounts, type FunnelHealth, type StageCounts } from "@/lib/funnel-health";

/**
 * Row 5 of the executive dashboard (rebuild spec §4) - the nine-stage outreach funnel measured
 * from what actually happened, current month against the six-month average.
 *
 * ONE PASS PER SOURCE, NOT ONE PER MONTH. Seven months × nine stages is 63 round trips, and on
 * Supabase every round trip costs ~200ms on a serialised connection. Instead each source is read
 * once across the whole window and bucketed into IST months in JS.
 *
 * Stage → data mapping, stated plainly because it is the part most worth arguing with:
 *
 *   Leads                   Lead.dateIn                         (@db.Date - day boundaries)
 *   Booked discovery calls  LeadStageHistory → DISCO_BOOKED
 *   BANT qualified          BookingRequest.bantVerdict = CONFIRM (Ameen's >3 threshold)
 *   Confirmed               BookingRequest.confirmedAt           (WhatsApp "yes" or manual)
 *   Showed                  LeadStageHistory → DISCO_COMPLETED
 *   Qualified to L3         OutreachJourney.qualified = YES      (the Discovery Specialist verdict)
 *   Confirmed for L3        LeadStageHistory → SSS_BOOKED
 *   Attended L3             LeadStageHistory → SSS_COMPLETED
 *   Closed                  LeadStageHistory → WON
 *
 * Stage history is counted DISTINCT per lead per stage: a lead bounced back and forth between
 * DISCO_BOOKED and DISCO_NOT_BOOKED would otherwise inflate the stage it re-entered, making the
 * funnel look wider the more indecisive the prospect was.
 */

const HISTORY_MONTHS = 6;

const TRACKED_STAGES = ["DISCO_BOOKED", "DISCO_COMPLETED", "SSS_BOOKED", "SSS_COMPLETED", "WON"] as const;

const STAGE_TO_KEY: Record<(typeof TRACKED_STAGES)[number], keyof StageCounts> = {
  DISCO_BOOKED: "bookedDiscovery",
  DISCO_COMPLETED: "showed",
  SSS_BOOKED: "confirmedL3",
  SSS_COMPLETED: "attendedL3",
  WON: "closed",
};

/** Month keys oldest → newest: the six history months, then the current one last. */
function monthKeys(today: Date): string[] {
  const keys: string[] = [];
  for (let i = HISTORY_MONTHS; i >= 0; i--) {
    keys.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return keys;
}

export const getFunnelHealth = cache(async (): Promise<FunnelHealth> => {
  const today = istToday();
  const keys = monthKeys(today);
  const currentKey = keys[keys.length - 1];

  // Window start is the first day of the oldest history month; end is the first day of NEXT month.
  const windowStartDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - HISTORY_MONTHS, 1));
  const windowEndDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  // Timestamp columns need the real instants those IST day boundaries represent.
  const windowStart = istBoundaryToInstant(windowStartDay);
  const windowEnd = istBoundaryToInstant(windowEndDay);

  const buckets = new Map<string, StageCounts>(keys.map((k) => [k, emptyCounts()]));
  const bump = (key: string, stage: keyof StageCounts, by = 1) => {
    const b = buckets.get(key);
    if (b) b[stage] += by; // instants outside the window can't occur, but a stray one is dropped, not misfiled
  };

  const [leads, stageHistory, bookings, qualifications] = await Promise.all([
    prisma.lead.findMany({
      where: { ...ACTIVE, dateIn: { gte: windowStartDay, lt: windowEndDay } },
      select: { dateIn: true },
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: { in: [...TRACKED_STAGES] }, changedAt: { gte: windowStart, lt: windowEnd } },
      select: { leadId: true, toStage: true, changedAt: true },
      distinct: ["leadId", "toStage"],
    }),
    prisma.bookingRequest.findMany({
      where: {
        OR: [
          { createdAt: { gte: windowStart, lt: windowEnd } },
          { confirmedAt: { gte: windowStart, lt: windowEnd } },
        ],
      },
      select: { createdAt: true, confirmedAt: true, bantVerdict: true },
    }),
    prisma.outreachJourney.findMany({
      where: { qualified: "YES", qualifiedAt: { gte: windowStart, lt: windowEnd } },
      select: { qualifiedAt: true },
    }),
  ]);

  // `dateIn` is a date-only column: it is already the IST day as UTC midnight, so it must NOT be
  // shifted the way an instant is.
  for (const l of leads) bump(l.dateIn.toISOString().slice(0, 7), "leads");

  for (const h of stageHistory) {
    const key = STAGE_TO_KEY[h.toStage as (typeof TRACKED_STAGES)[number]];
    if (key) bump(istMonthKeyOf(h.changedAt), key);
  }

  for (const b of bookings) {
    // Booked and confirmed are counted on their OWN dates - a call booked on the 31st and
    // confirmed on the 1st belongs to two different months, and pretending otherwise would
    // inflate whichever month the query happened to anchor on.
    if (b.bantVerdict === "CONFIRM" && b.createdAt >= windowStart && b.createdAt < windowEnd) {
      bump(istMonthKeyOf(b.createdAt), "bantQualified");
    }
    if (b.confirmedAt && b.confirmedAt >= windowStart && b.confirmedAt < windowEnd) {
      bump(istMonthKeyOf(b.confirmedAt), "confirmed");
    }
  }

  for (const q of qualifications) {
    if (q.qualifiedAt) bump(istMonthKeyOf(q.qualifiedAt), "qualifiedL3");
  }

  const current = buckets.get(currentKey) ?? emptyCounts();
  // Only months that actually carry traffic count as history - a run of empty months would drag
  // the benchmark toward zero and make a normal month look like a triumph.
  const history = keys
    .slice(0, -1)
    .map((k) => buckets.get(k) ?? emptyCounts())
    .filter((m) => m.leads > 0);

  return buildFunnelHealth(current, history);
});
