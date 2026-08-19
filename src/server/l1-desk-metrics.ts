import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { istBoundaryToInstant, istMonthInstantRange, istToday } from "@/lib/dates";
import { syncLagMs } from "@/lib/offline-calls";
import { resolveBant, type BantSnapshot } from "@/lib/bant-view";
import { priorityScore } from "@/lib/lead-priority";
import { getCallDistribution } from "./founder-config";
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
 * Level 1 - Outreach Specialist desk (rebuild spec §6).
 *
 * Answers one question: *who do I need to call right now?* Everything here is either a
 * queue entry or a JD target; nothing is on this page that the JD does not hold this
 * person accountable for, which is design principle §4.
 *
 * All the grading lives in `lib/outreach-sla.ts` - pure, and unit-tested against the IST
 * window boundaries. This file only fetches and shapes. Keeping the split means the SLA
 * rules can be argued about and re-tested without a database.
 *
 * NOT shown, deliberately: any financial figure beyond this person's own commission, any
 * other caller's queue, and any student record beyond lead detail (§6 access notes).
 */

const DAY_MS = 86_400_000;

/**
 * Row caps on the two reads that used to have none.
 *
 * Both were written when a caller owned a handful of leads and "one person's month" was
 * self-limiting. The 23,430-lead bulk hand-out made that false, and an uncapped read with nested
 * relations on the pooled Supabase connection is what the desk feeling slow actually is.
 *
 * The numbers are chosen against the JD, not picked round: it sets a 30-old-leads-a-day quota
 * and a 5-minute connection target, so 600 recent leads is roughly three weeks of a caller's
 * entire realistic throughput - a queue longer than that is a supply problem, not a display
 * problem, and the screen only ever renders 25 per bucket anyway.
 */
const RECENT_WINDOW_CAP = 600;

/**
 * The targets sample. Rates are computed over these rows, so the cap is a SAMPLE SIZE, and 2000
 * leads is far past the point where one more changes a percentage. The counted figures
 * (`leadToBooked`, the show rate) are exact regardless - they never load a row.
 */
const MONTH_TARGETS_CAP = 2000;

/** Rows per bucket sent to the browser. Must match what `L1Desk.tsx` renders. */
export const QUEUE_VISIBLE = 25;

export type L1QueueLead = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  leadSource: string;
  stage: string;
  /** The SLA baseline - the journey's opt-in instant, or the lead's creation. */
  optInAt: string;
  /** ISO of the first connected (SPOKE) call, or null. */
  connectedAt: string | null;
  /**
   * Set when that connection was captured offline and synced later - meaning `connectedAt`
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
  /**
   * The band score from the landing page, when they answered the qualification questions there.
   *
   * Null is "nobody has asked them", NOT "they scored zero" - see `BantChip`. The distinction is
   * the entire value of showing it on a dial queue: a caller working top-down should be able to
   * see that the 4.6 three rows down is worth jumping to, and that the blank rows are simply
   * unasked rather than poor.
   */
  bant: BantSnapshot | null;
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
  /** The action queue - these are the ones to chase. */
  unconfirmed: Array<{ id: string; name: string; phone: string; startsAt: string }>;
};

export type L1Desk = {
  /** The top `QUEUE_VISIBLE` of each bucket - what the screen draws. See `total` for the rest. */
  queue: Record<QueueBucket, L1QueueLead[]>;
  /** How many are really in each bucket, before the display trim. */
  total: Record<QueueBucket, number>;
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

/** IST "today" as real instants - call timestamps are instants, so boundaries must be too. */
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
  // Founder-set ranking weights (Console → Call Distribution), shared with the pipeline list.
  const priorityWeights = (await getCallDistribution()).priority;
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
    // Scalars on the row already being fetched - no extra query, no extra join.
    bantAvg: true, bantScore: true, bantVerdict: true, bantSource: true,
    bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
    outreachJourney: { select: { optInAt: true, phase: true, bookingId: true } },
    // The FIRST connection decides both SLA clocks - a lead rung at 09:02 and again at
    // 15:00 met the 5-minute rule, and taking the latest call would wrongly mark it late.
    callLogs: {
      where: { outcome: "SPOKE" },
      orderBy: { calledAt: "asc" },
      take: 1,
      // `syncedAt` rides along so the desk can mark a connection that was captured offline -
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

  const [
    ownedCallable,
    recentLeads,
    backlogLeads,
    monthLeads,
    monthConnections,
    monthLeadTotal,
    monthBooked,
    monthShowRows,
    tomorrowSlots,
    sopCallsDue,
    oldWorkedToday,
    bantChecks,
  ] = await Promise.all([
      // Cheap COUNT over the same predicate the two working-set reads share - deliberately not
      // derived from their lengths, since the backlog half is capped at 200.
      prisma.lead.count({ where: { ...ACTIVE, assignedToId: userId, stage: { notIn: ["WON", "LOST"] }, phone: { not: null } } }),

      // Everything inside the SLA-relevant window. "One person's last 30 days" was assumed to be
      // naturally bounded and left uncapped; the 23,430-lead bulk hand-out on 29 Jul made that
      // assumption false, and this became a several-thousand-row read with three nested
      // relations, on every desk load.
      //
      // NEWEST FIRST and capped, so the cap sheds the LEAST urgent rows. The 5-minute bucket
      // lives at the top of this ordering, which is the one thing that must never be shed -
      // sorting the other way would drop today's arrivals to keep last month's.
      prisma.lead.findMany({
        where: { ...callable, createdAt: { gte: oldLeadCutoff } },
        select: queueLeadSelect,
        orderBy: { createdAt: "desc" },
        take: RECENT_WINDOW_CAP,
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

    /**
     * Denominator for the SLA rate targets: every lead that ARRIVED this month, connected or
     * not. Measuring against only the open ones would let a missed lead improve the score by
     * closing.
     *
     * The select is now the bare minimum the SLA maths needs - the opt-in instant and nothing
     * else. It previously also pulled each lead's first SPOKE call, its journey's booking and
     * verdict, and ALL of its bookings.
     *
     * ── What this trade actually is ──────────────────────────────────────────────────
     * Measured, not assumed: this block issues SIX statements where the old one issued four. The
     * win is not statement count, it is shape.
     *
     *   • Prisma resolves nested relations only AFTER the parent findMany returns, so the old
     *     version was two sequential waves - 1 query, then 3. These six sit in one `Promise.all`
     *     against a pooler with `connection_limit=10`, so they overlap: one wave, not two. On a
     *     link where every round trip costs ~200ms, that is the figure that matters.
     *   • The rows are bounded and far narrower, so the payload no longer grows with the number
     *     of leads a caller happens to own.
     *   • `leadToBooked` and the show rate are now counted in the database, which makes them
     *     exact rather than "exact up to the cap".
     */
    prisma.lead.findMany({
      where: { ...ACTIVE, assignedToId: userId, createdAt: { gte: month.start, lt: month.end } },
      select: { id: true, createdAt: true, outreachJourney: { select: { optInAt: true } } },
      orderBy: { createdAt: "desc" },
      take: MONTH_TARGETS_CAP,
    }),

    /**
     * First CONNECTED call per lead this month, as one grouped read.
     *
     * `_min(calledAt)` over SPOKE calls is exactly "the first connection", which is the instant
     * both SLA clocks are judged on - a lead rung at 09:02 and again at 15:00 met the 5-minute
     * rule, and taking the latest call would wrongly mark it late.
     */
    prisma.callLog.groupBy({
      by: ["leadId"],
      where: {
        outcome: "SPOKE",
        lead: { ...ACTIVE, assignedToId: userId, createdAt: { gte: month.start, lt: month.end } },
      },
      _min: { calledAt: true },
    }),

    /**
     * The TRUE month total - the denominator for every rate below.
     *
     * Deliberately a separate count rather than `monthLeads.length`. `monthLeads` is capped, and
     * `booked` beside it is an uncapped count; dividing an uncapped numerator by a capped
     * denominator is how a rate quietly exceeds 100%. Costs one index-only count.
     */
    prisma.lead.count({
      where: { ...ACTIVE, assignedToId: userId, createdAt: { gte: month.start, lt: month.end } },
    }),

    // Lead → booked discovery call. A count, not a row scan: the rate needs how many, not which.
    prisma.lead.count({
      where: {
        ...ACTIVE,
        assignedToId: userId,
        createdAt: { gte: month.start, lt: month.end },
        OR: [{ outreachJourney: { bookingId: { not: null } } }, { bookings: { some: {} } }],
      },
    }),

    /**
     * Show rate, as two counts over the same predicate.
     *
     * Only calls that actually REACHED their slot are judged - a call still in the future has
     * not been missed, and counting it as a no-show would be wrong. That is what restricting to
     * the two settled statuses does.
     */
    prisma.bookingRequest.groupBy({
      by: ["status"],
      where: {
        status: { in: ["COMPLETED", "NO_SHOW"] },
        lead: { ...ACTIVE, assignedToId: userId, createdAt: { gte: month.start, lt: month.end } },
      },
      _count: { _all: true },
    }),

    // Tomorrow's discovery calls in MY slots - booked vs confirmed vs to-chase.
    prisma.appointmentSlot.findMany({
      where: {
        assignedToId: userId,
        status: "BOOKED",
        startsAt: { gte: day.end, lt: new Date(day.end.getTime() + DAY_MS) },
        // Reached via AppointmentSlot → BookingRequest → Lead, so unlike every other read on
        // this desk it never saw the lead's `deletedAt` - an archived lead holding a slot stayed
        // on tomorrow's list. A booking with no lead behind it is still a call, hence the OR.
        booking: { is: { OR: [{ leadId: null }, { lead: { deletedAt: null } }] } },
      },
      select: {
        id: true, startsAt: true,
        booking: { select: { id: true, name: true, phone: true, status: true, confirmedAt: true } },
      },
      orderBy: { startsAt: "asc" },
    }),

    /**
     * Calls the SOP has formally raised for THIS person - the "they didn't book, ring them" task.
     *
     * Until now these lived only in the Outreach queue, which is not filtered by assignee, so a
     * telecaller working from My Desk never saw them. That is the gap this closes: the engine can
     * decide a call is due and nobody whose job it is would find out.
     *
     * Only ACTIONABLE rows (`dueAt <= now`) - a step materialised for later is not work yet, and
     * showing it would make the queue lie about how much is owed right now.
     */
    prisma.outreachStepLog.findMany({
      where: {
        channel: "CALL",
        status: "DUE",
        dueAt: { lte: now },
        journey: { lead: { ...ACTIVE, assignedToId: userId, stage: { notIn: ["WON", "LOST"] } } },
      },
      select: { step: true, dueAt: true, journey: { select: { leadId: true } } },
      orderBy: { dueAt: "asc" },
      take: RECENT_WINDOW_CAP,
    }),

    // "Old leads worked today" - an old lead is worked when it is CLOSED with a decision,
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
    // The outreach verdict is mine; the DiscoveryOutcome is the specialist's - comparing the
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
    FIVE_MINUTE: [], NOT_BOOKED_AFTER_MESSAGE: [], DAY_DUE: [], NIGHT_DUE: [], EARLY_DUE: [],
    OPTED_NOT_BOOKED: [], OLD_LEADS: [], WORKSHOP: [],
  };

  // Leads the SOP has raised a call for. A Set because the bucket test below runs per lead and
  // must not turn into a scan.
  const sopCallLeadIds = new Set(sopCallsDue.map((s) => s.journey.leadId));

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
      // No booking to prefer here - the dial queue is by definition prospects who have not
      // booked yet, so the lead's own score is the only one that exists.
      bant: resolveBant(null, l),
    };

    /**
     * A SOP-raised call outranks every other bucket, including the SLA ones.
     *
     * Checked FIRST and with a `continue`, because a lead here would otherwise also qualify as a
     * daytime lead or as backlog, and appear twice - a queue that double-counts is one people
     * stop trusting. The precedence is not arbitrary: every other bucket is the specialist's own
     * judgement about when to work something, whereas this is the process having already decided
     * the prospect ignored a message and is owed a call now.
     *
     * The 5-minute bucket still outranks it by ORDER in `QUEUE_BUCKETS` - a lead that fresh
     * cannot yet have been messaged, checked and found unbooked, so the two never contend.
     */
    if (sopCallLeadIds.has(l.id)) {
      queue.NOT_BOOKED_AFTER_MESSAGE.push(entry);
      continue;
    }

    // An SLA bucket wins outright - a lead owed a call today is more urgent than the same
    // lead also being old or also being unbooked, and `bucketForLead` returns exactly one.
    //
    // EXCEPT once it is genuinely old. A lead that breached its window two months ago is
    // backlog, not today's work: the import brought in 23,000+ contacts, and letting every
    // stale one sit in "daytime leads, not yet connected" would bury the handful that
    // actually arrived today under thousands that did not. The JD already has a home for
    // these - the "30 old leads a day" bucket - so they go there and stay workable.
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
  // Longest-waiting SOP call first: the step's own dueAt is the deadline that was set for it, and
  // `sopCallsDue` already arrives ordered by it.
  const sopCallOrder = new Map(sopCallsDue.map((s, i) => [s.journey.leadId, i]));
  queue.NOT_BOOKED_AFTER_MESSAGE.sort(
    (a, b) => (sopCallOrder.get(a.id) ?? 0) - (sopCallOrder.get(b.id) ?? 0),
  );
  /**
   * Everything else ranks by the founder's own priority weights.
   *
   * This is the change that makes the BANT chip mean something on this screen. The buckets used
   * to sort by arrival time alone, so a 4/4 lead and a 0/4 lead that landed the same morning were
   * rung in the order they arrived - the score was shown and then ignored. Now the same weights
   * that drive the pipeline's "call these first" list drive the caller's own queue, and the
   * founder tunes both in one place.
   *
   * Arrival time survives as the TIE-BREAK (inside `byPriority`), which is exactly the old
   * behaviour for the very common case where nothing is scored yet.
   */
  const scoreFor = new Map(
    openLeads.map((l) => [
      l.id,
      priorityScore(
        {
          bantScore: l.bantScore,
          arrivedAt: l.outreachJourney?.optInAt ?? l.createdAt,
          // The desk has no stage-history read, and every lead in a bucket is at the same point
          // in the funnel anyway - so freshness and staleness both anchor on arrival here.
          lastActivityAt: l.callLogs[0]?.calledAt ?? null,
        },
        priorityWeights,
        now,
      ).score,
    ]),
  );
  for (const key of ["DAY_DUE", "NIGHT_DUE", "EARLY_DUE", "OPTED_NOT_BOOKED", "WORKSHOP", "OLD_LEADS"] as const) {
    queue[key].sort(
      (a, b) =>
        (scoreFor.get(b.id) ?? 0) - (scoreFor.get(a.id) ?? 0) || a.optInAt.localeCompare(b.optInAt),
    );
  }

  /**
   * Ship only what is rendered.
   *
   * The desk draws the top `QUEUE_VISIBLE` of each bucket and says "showing the 25 most urgent
   * of N" underneath - but every row was being serialised into the RSC payload regardless, so a
   * caller with 600 leads downloaded 600 lead records to look at 25. The counts survive the trim
   * (`total` below) because that sentence needs the real number.
   *
   * Trimmed AFTER sorting, so the rows kept are the urgent ones rather than whichever the
   * database happened to return first.
   */
  const total: Record<QueueBucket, number> = {
    FIVE_MINUTE: queue.FIVE_MINUTE.length,
    NOT_BOOKED_AFTER_MESSAGE: queue.NOT_BOOKED_AFTER_MESSAGE.length,
    DAY_DUE: queue.DAY_DUE.length,
    NIGHT_DUE: queue.NIGHT_DUE.length,
    EARLY_DUE: queue.EARLY_DUE.length,
    OPTED_NOT_BOOKED: queue.OPTED_NOT_BOOKED.length,
    OLD_LEADS: queue.OLD_LEADS.length,
    WORKSHOP: queue.WORKSHOP.length,
  };
  for (const key of Object.keys(queue) as QueueBucket[]) {
    queue[key] = queue[key].slice(0, QUEUE_VISIBLE);
  }

  // ── JD targets ──────────────────────────────────────────────────────────────
  let fiveMinuteHit = 0;
  let dayTotal = 0, dayHit = 0;
  let nightTotal = 0, nightHit = 0;

  // The grouped connection times, back on their leads. One pass, not a lookup per lead.
  const firstConnectedAt = new Map(
    monthConnections.map((c) => [c.leadId, c._min.calledAt] as const),
  );

  for (const l of monthLeads) {
    const optInAt = l.outreachJourney?.optInAt ?? l.createdAt;
    const v = slaFor(optInAt, firstConnectedAt.get(l.id) ?? null, now);

    if (v.metFiveMinute) fiveMinuteHit++;
    if (v.window === "DAY") { dayTotal++; if (v.metWindow) dayHit++; }
    if (v.window === "NIGHT") { nightTotal++; if (v.metWindow) nightHit++; }
  }

  // Counted in the database rather than walked in JS - see the queries above.
  const booked = monthBooked;
  const showTotal = monthShowRows.reduce((n, r) => n + r._count._all, 0);
  const showHit = monthShowRows.find((r) => r.status === "COMPLETED")?._count._all ?? 0;

  // BANT accuracy - my YES upheld by a real discovery outcome, my NO not contradicted.
  let bantTotal = 0, bantHit = 0;
  for (const j of bantChecks) {
    const outcome = j.lead.outcomes[0];
    if (!outcome) continue; // no discovery call yet - nothing to check against
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
    total,
    targets: {
      // Against the sampled rows, not the true total: `fiveMinuteHit` was counted over
      // `monthLeads`, so its denominator must be too. `monthLeadTotal` is the right denominator
      // only for figures counted in the database.
      fiveMinuteRate: rate(fiveMinuteHit, monthLeads.length),
      dayConnect: rate(dayHit, dayTotal),
      nightConnect: rate(nightHit, nightTotal),
      leadToBooked: rate(booked, monthLeadTotal),
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
