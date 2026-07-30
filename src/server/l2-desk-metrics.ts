import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istBoundaryToInstant, istMonthInstantRange, istMonthRange, istToday } from "@/lib/dates";
import { rate } from "@/lib/outreach-sla";

/**
 * Level 2 — Discovery Specialist desk (rebuild spec §7).
 *
 * Opens to: *who is on my calendar today, and who hasn't shown?*
 *
 * The JD draws a line this file has to respect: a missed call is NOT a no-show until the
 * specialist has rung the prospect directly. So a slot whose time has passed with nobody
 * marked present is surfaced as "chase" — an action — rather than silently counted against
 * the show rate. Only an explicit NO_SHOW does that.
 */

const DAY_MS = 86_400_000;

export type L2Call = {
  slotId: string;
  bookingId: string | null;
  leadId: string | null;
  name: string;
  phone: string;
  startsAt: string;
  confirmed: boolean;
  /** True once this call has an outcome recorded — the row drops out of the work list. */
  recorded: boolean;
  /** The slot's time has passed, nobody has recorded anything: ring them before judging. */
  needsChase: boolean;
  zoomLink: string | null;
};

export type L2Targets = {
  callsToday: number;
  showRate: number | null;
  discoveryToSss: number | null;
  confirmationsSent: number | null;
  pipelineUpdated: number | null;
};

export type L2Desk = {
  today: L2Call[];
  targets: L2Targets;
  now: string;
};

function istTodayInstants() {
  const today = istToday();
  return {
    start: istBoundaryToInstant(today),
    end: istBoundaryToInstant(new Date(today.getTime() + DAY_MS)),
  };
}

export const getL2Desk = cache(async (userId: string): Promise<L2Desk> => {
  const now = new Date();
  const day = istTodayInstants();
  const month = istMonthInstantRange();

  /**
   * `DiscoveryOutcome.callDate` is `@db.Date`, NOT a timestamp — so it must be filtered with
   * DATE boundaries, never the instant boundaries used for `startsAt` above.
   *
   * Filtering a DATE column with an instant silently shifts the window by a day: the IST day
   * boundary is 18:30Z, Prisma truncates that to a date for a DATE column, and today's own
   * outcome then falls outside `lt`. The symptom is a call that stays on the work list after
   * its outcome has been recorded.
   */
  const todayDate = istToday();
  const tomorrowDate = new Date(todayDate.getTime() + DAY_MS);
  const monthDates = istMonthRange();

  const [todaySlots, monthSlots, monthOutcomes] = await Promise.all([
    prisma.appointmentSlot.findMany({
      where: {
        assignedToId: userId,
        status: "BOOKED",
        startsAt: { gte: day.start, lt: day.end },
      },
      select: {
        id: true, startsAt: true,
        booking: {
          select: {
            id: true, name: true, phone: true, status: true, confirmedAt: true,
            lead: {
              select: {
                id: true,
                outreachJourney: { select: { zoomLink: true } },
                // Today's outcome, if one has already been recorded for this lead.
                outcomes: {
                  where: { callDate: { gte: todayDate, lt: tomorrowDate } },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { startsAt: "asc" },
    }),

    // Show rate denominator: my slots this month whose time has PASSED. A call still in
    // the future has not been missed, and counting it would drag the rate down all month.
    prisma.appointmentSlot.findMany({
      where: {
        assignedToId: userId,
        // "This month, and already in the past" — the earlier of month-end and now, since
        // a duplicate `lt` key would silently keep only one of the two bounds.
        startsAt: { gte: month.start, lt: new Date(Math.min(month.end.getTime(), now.getTime())) },
        booking: { isNot: null },
      },
      select: { booking: { select: { status: true, confirmedAt: true } } },
    }),

    // Conversion + confirmation targets, from the outcomes I entered this month.
    prisma.discoveryOutcome.findMany({
      where: { enteredById: userId, callDate: { gte: monthDates.start, lt: monthDates.end } },
      select: {
        outcome: true,
        lead: { select: { outreachJourney: { select: { salesCallConfirmed: true } } } },
      },
    }),
  ]);

  const today: L2Call[] = todaySlots
    .filter((s) => s.booking && s.booking.status !== "CANCELLED")
    .map((s) => {
      const b = s.booking!;
      const recorded = (b.lead?.outcomes.length ?? 0) > 0;
      return {
        slotId: s.id,
        bookingId: b.id,
        leadId: b.lead?.id ?? null,
        name: b.name,
        phone: b.phone,
        startsAt: s.startsAt.toISOString(),
        confirmed: !!b.confirmedAt,
        recorded,
        // Per the JD: past its time, nothing recorded → the specialist owes them a direct
        // call before this can be called a no-show.
        needsChase: !recorded && s.startsAt < now && b.status !== "COMPLETED",
        zoomLink: b.lead?.outreachJourney?.zoomLink ?? null,
      };
    });

  // Show rate: only slots with a settled verdict count. A booking still sitting at BOOKED
  // after its time is unresolved — it is in the chase list, not in the statistics.
  let showTotal = 0, showHit = 0;
  for (const s of monthSlots) {
    const st = s.booking?.status;
    if (st === "COMPLETED" || st === "NO_SHOW") {
      showTotal++;
      if (st === "COMPLETED") showHit++;
    }
  }

  const routedToL3 = monthOutcomes.filter((o) => o.outcome === "QUALIFIED_FOR_SSS");
  const confirmedToL3 = routedToL3.filter((o) => o.lead.outreachJourney?.salesCallConfirmed).length;

  const callsToday = today.filter((c) => c.recorded).length;
  const dueToday = today.filter((c) => new Date(c.startsAt) < now).length;

  return {
    today,
    targets: {
      callsToday,
      showRate: rate(showHit, showTotal),
      discoveryToSss: rate(routedToL3.length, monthOutcomes.length),
      confirmationsSent: rate(confirmedToL3, routedToL3.length),
      // Of the calls whose time has passed today, how many have their outcome recorded?
      pipelineUpdated: rate(callsToday, dueToday),
    },
    now: now.toISOString(),
  };
});
