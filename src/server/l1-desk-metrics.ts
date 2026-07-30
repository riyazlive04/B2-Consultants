import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istBoundaryToInstant, istMonthInstantRange, istToday } from "@/lib/dates";
import { syncLagMs } from "@/lib/offline-calls";
import {
  bucketForLead,
  slaFor,
  rate,
  OLD_LEAD_AFTER_DAYS,
  WORKSHOP_FOLLOWUP_DAYS,
  type QueueBucket,
  type SlaVerdict,
} from "@/lib/outreach-sla";

/**
 * Level 1 — Outreach Specialist desk (rebuild spec §6).
 *
 * Answers one question: *who do I need to call right now?* Everything here is either a
 * queue entry or a JD target; nothing is on this page that the JD does not hold this
 * person accountable for, which is design principle §4.
 *
 * All the grading lives in `lib/outreach-sla.ts` — pure, and unit-tested against the IST
 * window boundaries. This file only fetches and shapes. Keeping the split means the SLA
 * rules can be argued about and re-tested without a database.
 *
 * NOT shown, deliberately: any financial figure beyond this person's own commission, any
 * other caller's queue, and any student record beyond lead detail (§6 access notes).
 */

const DAY_MS = 86_400_000;

export type L1QueueLead = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  leadSource: string;
  stage: string;
  /** The SLA baseline — the journey's opt-in instant, or the lead's creation. */
  optInAt: string;
  /** ISO of the first connected (SPOKE) call, or null. */
  connectedAt: string | null;
  /**
   * Set when that connection was captured offline and synced later — meaning `connectedAt`
   * is the device's clock, not ours. Null for a call logged live.
   */
  connectedSyncLagMs: number | null;
  callCount: number;
  /** Milliseconds left on the 5-minute clock; negative once elapsed. */
  msToFiveMinute: number;
  /**
   * ISO instant the 5-minute clock expires. The countdown anchors on this ABSOLUTE instant
   * rather than on `msToFiveMinute`, so a tab left open for an hour shows the right number
   * instead of the value that was true when the page rendered.
   */
  fiveMinuteBy: string;
  state: SlaVerdict["state"];
  window: SlaVerdict["window"];
  dueBy: string;
};

export type L1Targets = {
  fiveMinuteRate: number | null;
  dayConnect: number | null;
  nightConnect: number | null;
  leadToBooked: number | null;
  bantAccuracy: number | null;
  showRate: number | null;
  oldLeadsWorked: number;
  pipelineUpdated: number | null;
};

export type L1TomorrowCalls = {
  booked: number;
  confirmed: number;
  /** The action queue — these are the ones to chase. */
  unconfirmed: Array<{ id: string; name: string; phone: string; startsAt: string }>;
};

export type L1Desk = {
  queue: Record<QueueBucket, L1QueueLead[]>;
  targets: L1Targets;
  tomorrow: L1TomorrowCalls;
  /**
   * Every callable lead this person OWNS, regardless of whether one is due right now.
   *
   * It exists to tell two very different empty queues apart. "Nothing due" after a day's work is
   * success; "nothing due" because you were never given anybody is a supply problem, and the old
   * empty state congratulated the caller in both cases. On 29 Jul 2026 that mattered: 23,430 of
   * 23,435 leads had no owner at all, so this desk read "your queue is clear" to someone holding
   * three leads.
   */
  ownedCallable: number;
  /** Server clock at build time, so the client countdown doesn't drift off a wrong local clock. */
  now: string;
};

/** IST "today" as real instants — call timestamps are instants, so boundaries must be too. */
function istTodayInstants() {
  const today = istToday();
  return {
    start: istBoundaryToInstant(today),
    end: istBoundaryToInstant(new Date(today.getTime() + DAY_MS)),
  };
}

/**
 * The whole L1 desk for one user.
 *
 * `cache`d per request so the page and the header badge share one query set.
 */
export const getL1Desk = cache(async (userId: string): Promise<L1Desk> => {
  const now = new Date();
  const day = istTodayInstants();
  const month = istMonthInstantRange();
  const oldLeadCutoff = new Date(now.getTime() - OLD_LEAD_AFTER_DAYS * DAY_MS);
  const workshopCutoff = new Date(now.getTime() - WORKSHOP_FOLLOWUP_DAYS * DAY_MS);

  // Shared shape for both halves of the working set. `satisfies` rather than a plain
  // annotation: it validates the shape against Prisma AND keeps the literal inference, so
  // findMany still returns the narrow row type rather than a full Lead.
  const queueLeadSelect = {
    id: true, name: true, phone: true, city: true, stage: true,
    leadSource: true, createdAt: true,
    outreachJourney: { select: { optInAt: true, phase: true, bookingId: true } },
    // The FIRST connection decides both SLA clocks — a lead rung at 09:02 and again at
    // 15:00 met the 5-minute rule, and taking the latest call would wrongly mark it late.
    callLogs: {
      where: { outcome: "SPOKE" },
      orderBy: { calledAt: "asc" },
      take: 1,
      // `syncedAt` rides along so the desk can mark a connection that was captured offline —
      // the figure it feeds (the 5-minute rate) is a device-supplied time, and that should be
      // visible on the row rather than only in the audit log.
      select: { calledAt: true, syncedAt: true },
    },
    _count: { select: { callLogs: true } },
  } satisfies Prisma.LeadSelect;

  // `phone: not null` throughout: a lead with no number cannot be rung, so it has no place
  // on a dial queue (5,886 of the imported contacts have none).
  const callable = {
    ...ACTIVE,
    assignedToId: userId,
    stage: { notIn: ["WON", "LOST"] },
    phone: { not: null },
  } satisfies Prisma.LeadWhereInput;

  const [ownedCallable, recentLeads, backlogLeads, monthLeads, tomorrowSlots, oldWorkedToday, bantChecks] =
    await Promise.all([
      // Cheap COUNT over the same predicate the two working-set reads share — deliberately not
      // derived from their lengths, since the backlog half is capped at 200.
      prisma.lead.count({ where: { ...ACTIVE, assignedToId: userId, stage: { notIn: ["WON", "LOST"] }, phone: { not: null } } }),

      // Everything inside the SLA-relevant window, uncapped. Naturally bounded — it is one
      // person's last 30 days of leads — so nothing that is genuinely due today can be
      // missed by a row limit.
      prisma.lead.findMany({
        where: { ...callable, createdAt: { gte: oldLeadCutoff } },
        select: queueLeadSelect,
        orderBy: { createdAt: "desc" },
      }),

      // The backlog, oldest first and capped. This half MUST be ordered: the import brought
      // in 23,000+ contacts, and an unordered `take` would return an arbitrary slice, so the
      // most urgent lead might simply not be fetched. 200 is comfortably more than the JD's
      // 30-a-day quota, and the next 200 surface as these are cleared.
      prisma.lead.findMany({
        where: { ...callable, createdAt: { lt: oldLeadCutoff } },
        select: queueLeadSelect,
        orderBy: { createdAt: "asc" },
        take: 200,
      }),

    // Denominator for the rate targets: every lead that ARRIVED this month, connected or not.
    // Measuring against only the open ones would let a missed lead improve the score by closing.
    prisma.lead.findMany({
      where: { ...ACTIVE, assignedToId: userId, createdAt: { gte: month.start, lt: month.end } },
      select: {
        id: true, createdAt: true,
        outreachJourney: { select: { optInAt: true, bookingId: true, qualified: true } },
        callLogs: {
          where: { outcome: "SPOKE" },
          orderBy: { calledAt: "asc" },
          take: 1,
          select: { calledAt: true },
        },
        bookings: { select: { id: true, status: true, confirmedAt: true } },
      },
    }),

    // Tomorrow's discovery calls in MY slots — booked vs confirmed vs to-chase.
    prisma.appointmentSlot.findMany({
      where: {
        assignedToId: userId,
        status: "BOOKED",
        startsAt: { gte: day.end, lt: new Date(day.end.getTime() + DAY_MS) },
      },
      select: {
        id: true, startsAt: true,
        booking: { select: { id: true, name: true, phone: true, status: true, confirmedAt: true } },
      },
      orderBy: { startsAt: "asc" },
    }),

    // "Old leads worked today" — an old lead is worked when it is CLOSED with a decision,
    // per the JD ("each closed with interested / not interested"), not merely dialled.
    prisma.callLog.count({
      where: {
        userId,
        calledAt: { gte: day.start, lt: day.end },
        outcome: { in: ["SPOKE", "NOT_INTERESTED"] },
        lead: { createdAt: { lt: oldLeadCutoff } },
      },
    }),

    // BANT accuracy: of the leads I qualified, how many did the discovery call agree with?
    // The outreach verdict is mine; the DiscoveryOutcome is the specialist's — comparing the
    // two is the only honest measure of whether my qualification was right.
    prisma.outreachJourney.findMany({
      where: {
        qualifiedById: userId,
        qualifiedAt: { gte: month.start, lt: month.end },
        qualified: { not: null },
      },
      select: {
        qualified: true,
        lead: {
          select: {
            outcomes: {
              orderBy: { callDate: "desc" },
              take: 1,
              select: { outcome: true, highlyQualified: true },
            },
          },
        },
      },
    }),
  ]);

  // ── The priority queue ──────────────────────────────────────────────────────
  const queue: Record<QueueBucket, L1QueueLead[]> = {
    FIVE_MINUTE: [], DAY_DUE: [], NIGHT_DUE: [], EARLY_DUE: [],
    OPTED_NOT_BOOKED: [], OLD_LEADS: [], WORKSHOP: [],
  };

  const openLeads = [...recentLeads, ...backlogLeads];

  for (const l of openLeads) {
    const optInAt = l.outreachJourney?.optInAt ?? l.createdAt;
    const first = l.callLogs[0];
    const connectedAt = first?.calledAt ?? null;
    const verdict = slaFor(optInAt, connectedAt, now);

    const entry: L1QueueLead = {
      id: l.id,
      name: l.name,
      phone: l.phone,
      city: l.city,
      leadSource: l.leadSource,
      stage: l.stage,
      optInAt: optInAt.toISOString(),
      connectedAt: connectedAt?.toISOString() ?? null,
      connectedSyncLagMs:
        first?.syncedAt && connectedAt ? syncLagMs(connectedAt, first.syncedAt) : null,
      callCount: l._count.callLogs,
      msToFiveMinute: verdict.msToFiveMinute,
      fiveMinuteBy: verdict.fiveMinuteBy.toISOString(),
      state: verdict.state,
      window: verdict.window,
      dueBy: verdict.dueBy.toISOString(),
    };

    // An SLA bucket wins outright — a lead owed a call today is more urgent than the same
    // lead also being old or also being unbooked, and `bucketForLead` returns exactly one.
    //
    // EXCEPT once it is genuinely old. A lead that breached its window two months ago is
    // backlog, not today's work: the import brought in 23,000+ contacts, and letting every
    // stale one sit in "daytime leads, not yet connected" would bury the handful that
    // actually arrived today under thousands that did not. The JD already has a home for
    // these — the "30 old leads a day" bucket — so they go there and stay workable.
    const slaBucket = bucketForLead(verdict);
    if (slaBucket) {
      const isBacklog = slaBucket !== "FIVE_MINUTE" && optInAt < oldLeadCutoff;
      queue[isBacklog ? "OLD_LEADS" : slaBucket].push(entry);
      continue;
    }

    // Connected already. It can still be owed follow-up work, in JD priority order.
    if (l.outreachJourney && !l.outreachJourney.bookingId && l.outreachJourney.phase !== "IGNORED") {
      queue.OPTED_NOT_BOOKED.push(entry);
    } else if (l.leadSource === "WORKSHOP" && optInAt >= workshopCutoff) {
      queue.WORKSHOP.push(entry);
    } else if (optInAt < oldLeadCutoff) {
      queue.OLD_LEADS.push(entry);
    }
  }

  // Within a bucket: oldest deadline first. The 5-minute bucket sorts by the running
  // countdown, so the lead about to breach sits at the top of the screen.
  queue.FIVE_MINUTE.sort((a, b) => a.msToFiveMinute - b.msToFiveMinute);
  for (const key of ["DAY_DUE", "NIGHT_DUE", "EARLY_DUE", "OPTED_NOT_BOOKED", "WORKSHOP", "OLD_LEADS"] as const) {
    queue[key].sort((a, b) => a.optInAt.localeCompare(b.optInAt));
  }

  // ── JD targets ──────────────────────────────────────────────────────────────
  let fiveMinuteHit = 0;
  let dayTotal = 0, dayHit = 0;
  let nightTotal = 0, nightHit = 0;
  let booked = 0;
  let showTotal = 0, showHit = 0;

  for (const l of monthLeads) {
    const optInAt = l.outreachJourney?.optInAt ?? l.createdAt;
    const connectedAt = l.callLogs[0]?.calledAt ?? null;
    const v = slaFor(optInAt, connectedAt, now);

    if (v.metFiveMinute) fiveMinuteHit++;
    if (v.window === "DAY") { dayTotal++; if (v.metWindow) dayHit++; }
    if (v.window === "NIGHT") { nightTotal++; if (v.metWindow) nightHit++; }

    if (l.outreachJourney?.bookingId || l.bookings.length > 0) booked++;
    // Show rate is judged only on calls that actually reached their slot — a call still
    // in the future has not been missed, and counting it as a no-show would be wrong.
    for (const b of l.bookings) {
      if (b.status === "COMPLETED" || b.status === "NO_SHOW") {
        showTotal++;
        if (b.status === "COMPLETED") showHit++;
      }
    }
  }

  // BANT accuracy — my YES upheld by a real discovery outcome, my NO not contradicted.
  let bantTotal = 0, bantHit = 0;
  for (const j of bantChecks) {
    const outcome = j.lead.outcomes[0];
    if (!outcome) continue; // no discovery call yet — nothing to check against
    bantTotal++;
    const specialistAgreed =
      outcome.outcome === "QUALIFIED_FOR_SSS" || outcome.highlyQualified;
    if ((j.qualified === "YES" && specialistAgreed) || (j.qualified === "NO" && !specialistAgreed)) {
      bantHit++;
    }
  }

  // "Pipeline updated before end of day": of the leads I spoke to today, how many had their
  // stage moved off NEW_LEAD? A conversation that leaves the card untouched is the gap the
  // JD's 100% target is aimed at.
  const spokenTodayIds = new Set(
    openLeads
      .filter((l) => l.callLogs[0] && l.callLogs[0].calledAt >= day.start)
      .map((l) => l.id),
  );
  const spokenTodayUpdated = openLeads.filter(
    (l) => spokenTodayIds.has(l.id) && l.stage !== "NEW_LEAD",
  ).length;

  // ── Tomorrow's calls ────────────────────────────────────────────────────────
  const live = tomorrowSlots.filter((s) => s.booking && s.booking.status !== "CANCELLED");
  const tomorrow: L1TomorrowCalls = {
    booked: live.length,
    confirmed: live.filter((s) => s.booking?.confirmedAt).length,
    unconfirmed: live
      .filter((s) => !s.booking?.confirmedAt)
      .map((s) => ({
        id: s.booking!.id,
        name: s.booking!.name,
        phone: s.booking!.phone,
        startsAt: s.startsAt.toISOString(),
      })),
  };

  return {
    queue,
    targets: {
      fiveMinuteRate: rate(fiveMinuteHit, monthLeads.length),
      dayConnect: rate(dayHit, dayTotal),
      nightConnect: rate(nightHit, nightTotal),
      leadToBooked: rate(booked, monthLeads.length),
      bantAccuracy: rate(bantHit, bantTotal),
      showRate: rate(showHit, showTotal),
      oldLeadsWorked: oldWorkedToday,
      pipelineUpdated: rate(spokenTodayUpdated, spokenTodayIds.size),
    },
    tomorrow,
    ownedCallable,
    now: now.toISOString(),
  };
});
