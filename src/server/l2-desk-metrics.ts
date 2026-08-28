import "server-only";
import { cache } from "react";
import type { BantDimension } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istBoundaryToInstant, istMonthInstantRange, istMonthRange, istToday } from "@/lib/dates";
import { rate } from "@/lib/outreach-sla";
import { resolveBant, type BantSnapshot } from "@/lib/bant-view";
import { bookingAnswerLines, storedAnswerLines, type BantAnswerLine as BantAnswerLineT } from "@/lib/bant-answers";

/**
 * Level 2 - Discovery Specialist desk (rebuild spec §7).
 *
 * Opens to: *who is on my calendar today, and who hasn't shown?*
 *
 * The JD draws a line this file has to respect: a missed call is NOT a no-show until the
 * specialist has rung the prospect directly. So a slot whose time has passed with nobody
 * marked present is surfaced as "chase" - an action - rather than silently counted against
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
  /** True once this call has an outcome recorded - the row drops out of the work list. */
  recorded: boolean;
  /** The slot's time has passed, nobody has recorded anything: ring them before judging. */
  needsChase: boolean;
  zoomLink: string | null;
  /**
   * What the prospect said when they qualified, and how it scored - the whole reason the
   * landing page asks the band-score questions.
   *
   * Null means genuinely unscored, never zero. `origin` tells the specialist how much evidence
   * they are looking at: a 3.2 from a full booking form and a 3.2 from a three-question landing
   * page are not the same claim, and this is the screen where that difference gets acted on.
   */
  bant: BantSnapshot | null;
  /** The individual answers behind the score, in catalogue order. The call prep. */
  answers: BantAnswerLineT[];
};

/** One answered qualification question, ready to render. Shared with the contact record. */
export type { BantAnswerLine } from "@/lib/bant-answers";

export type L2Targets = {
  callsToday: number;
  showRate: number | null;
  discoveryToSss: number | null;
  confirmationsSent: number | null;
  pipelineUpdated: number | null;
};

export type L2Lead = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  stage: string;
  createdAt: string;
};

export type L2Desk = {
  today: L2Call[];
  /**
   * Leads owned by me (first-call rotation, or a manual reassign) that have no booked
   * slot yet - the only place they are visible on this desk, since `today` only reads
   * `AppointmentSlot`. Without this list, a lead handed to a Discovery Specialist before
   * anyone books a call for them is invisible here even though `Lead.assignedToId` is
   * set correctly.
   */
  myLeads: L2Lead[];
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

/**
 * The answers behind the score, as the discovery specialist should read them.
 *
 * Booking columns first, falling back to the lead's stored `LeadAnswer` rows - the same
 * precedence `resolveBant` applies to the score itself, so the number and the answers under it
 * can never describe different submissions.
 *
 * The lead branch reads `question.text`, i.e. the wording THIS prospect was actually shown, not
 * today's wording. That is the point of Track D's versioning: a specialist reading back "they
 * said 'Immediately'" needs to know what they were asked.
 */
function answerLinesFor(
  booking: Record<string, unknown> | null,
  lead: {
    answers: { answerRaw: string; score: number | null; question: { text: string; dimension: BantDimension } }[];
  } | null,
): BantAnswerLineT[] {
  const fromBooking = bookingAnswerLines(booking);
  if (fromBooking.length > 0) return fromBooking;
  return storedAnswerLines(lead?.answers ?? []);
}

export const getL2Desk = cache(async (userId: string): Promise<L2Desk> => {
  const now = new Date();
  const day = istTodayInstants();
  const month = istMonthInstantRange();

  /**
   * `DiscoveryOutcome.callDate` is `@db.Date`, NOT a timestamp - so it must be filtered with
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

  const [todaySlots, monthSlots, monthOutcomes, myLeadRows] = await Promise.all([
    prisma.appointmentSlot.findMany({
      where: {
        assignedToId: userId,
        status: "BOOKED",
        startsAt: { gte: day.start, lt: day.end },
        // Today's list reaches its people through AppointmentSlot → BookingRequest → Lead, so
        // it never passed through the `deletedAt` filter every other desk read uses: an archived
        // lead with a booked slot stayed on this list. `leadId: null` is kept deliberately - a
        // booking made by someone who never became a lead is still a call that must be taken.
        booking: { is: { OR: [{ leadId: null }, { lead: { deletedAt: null } }] } },
      },
      select: {
        id: true, startsAt: true,
        booking: {
          select: {
            id: true, name: true, phone: true, status: true, confirmedAt: true,
            // The booking's own score + the six scored answers, for the call-prep panel.
            bantAvg: true, bantScore: true, bantVerdict: true,
            bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
            readyToInvest: true, currentIncome: true, decisionMaking: true,
            alreadyApplied: true, commitment: true, whenStartGermany: true,
            lead: {
              select: {
                id: true,
                // The landing page's score, for a prospect who never filled our booking form -
                // this is the case that used to arrive here blank.
                bantAvg: true, bantScore: true, bantVerdict: true, bantSource: true,
                bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
                // The opt-in answers, pinned to the question wording they were given against.
                answers: {
                  where: { bookingRequestId: null },
                  select: {
                    answerRaw: true,
                    score: true,
                    question: { select: { text: true, dimension: true, orderIndex: true } },
                  },
                  orderBy: { question: { orderIndex: "asc" } },
                },
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
        // "This month, and already in the past" - the earlier of month-end and now, since
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

    // Leads I own that have no booked slot yet - NEW_LEAD (fresh, from the first-call
    // rotation or a manual reassign) or DISCO_NOT_BOOKED (a booking that fell through and
    // was reopened). Anything already booked shows up in `today`/`monthSlots` instead, via
    // the AppointmentSlot it claimed, not via this stage-based list.
    prisma.lead.findMany({
      where: { ...ACTIVE, assignedToId: userId, stage: { in: ["NEW_LEAD", "DISCO_NOT_BOOKED"] } },
      select: { id: true, name: true, phone: true, city: true, stage: true, createdAt: true },
      orderBy: { createdAt: "asc" },
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
        bant: resolveBant(b, b.lead),
        answers: answerLinesFor(b, b.lead),
      };
    });

  // Show rate: only slots with a settled verdict count. A booking still sitting at BOOKED
  // after its time is unresolved - it is in the chase list, not in the statistics.
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

  const myLeads: L2Lead[] = myLeadRows.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    city: l.city,
    stage: l.stage,
    createdAt: l.createdAt.toISOString(),
  }));

  return {
    today,
    myLeads,
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
