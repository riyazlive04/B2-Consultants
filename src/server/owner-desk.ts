import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getPendingRows } from "@/server/finance-metrics";
import { getOutreachQueue } from "@/server/outreach-metrics";
import { ACTIVE } from "@/lib/soft-delete";
import type { AppRole } from "@/lib/sections";
import type { SignalLevel } from "@/lib/signals";

/**
 * My Desk for an admin or head coach - a task list, not call statistics (Error Log Q2).
 *
 * The desk branches on `TeamProfile.logVariant` into the L1 and L2 specialist screens. Anyone
 * without a variant fell through to either the generic call desk (call stats, meaningless to a
 * founder) or, with no team profile at all, an explainer telling them to ask Ameen to link their
 * login - which is what Ameen himself saw.
 *
 * So this answers the same question the specialist desks answer - "what needs me right now?" -
 * with the queues a founder or head actually owns. It is deliberately NOT the home page's Needs
 * Attention: that surfaces metric alerts (runway, overdue totals, targets slipping). These are
 * items sitting in a queue with someone's name on them, waiting on a decision.
 *
 * Every queue is a COUNT plus a link to the screen that clears it. Rebuilding those screens'
 * tables here would mean two places to fix when either changes.
 */

export type DeskTask = {
  readonly key: string;
  readonly label: string;
  /** What clearing it means, in one line. */
  readonly detail: string;
  readonly count: number;
  readonly href: string;
  /** Canonical signal level: `watch` for things going stale, `risk` for things already late. */
  readonly tone: SignalLevel;
  /**
   * True for a stopped PROCESS rather than a cleared queue - `count` is 0 because nothing is
   * running, not because the work is done. Must never render as the same green "all clear" a
   * genuine empty queue gets (that's what happened to the Outreach engine: off since it shipped,
   * and nothing on any screen said so until someone opened Settings).
   */
  readonly disabled?: boolean;
};

export type OwnerDesk = {
  readonly tasks: DeskTask[];
  readonly total: number;
};

/** Bookings confirmed this far ahead are the ones still worth chasing. */
const CONFIRM_WINDOW_HOURS = 48;

export const getOwnerDesk = cache(async (role: AppRole): Promise<OwnerDesk> => {
  const now = new Date();
  const horizon = new Date(now.getTime() + CONFIRM_WINDOW_HOURS * 3600_000);

  // The head coach has no Finance or Cash access, so the receivables queue is not theirs to clear
  // and asking them to would be a dead link.
  const seesMoney = role === "ADMIN";

  const [pendingRewards, draftAgreements, unconfirmed, unassignedCallable, overdue, outreach] =
    await Promise.all([
      prisma.rewardGrant.count({ where: { status: "PENDING" } }),
      prisma.agreement.count({ where: { status: "DRAFT" } }),
      prisma.bookingRequest.count({
        where: {
          status: "BOOKED",
          confirmedAt: null,
          slot: { startsAt: { gte: now, lt: horizon } },
        },
      }),
      // Same predicate as l1-desk-metrics.ts's `callable` / the hand-out batch's candidates -
      // a lead nobody could call anyway (WON, LOST, no phone) doesn't belong in this count. This
      // exists because the 29 Jul incident (23,430 of 23,435 leads unassigned) was invisible on
      // every screen in the app until someone thought to run this exact query by hand; a founder
      // checking their own desk should never have to rediscover that by accident again.
      prisma.lead.count({
        where: { ...ACTIVE, assignedToId: null, stage: { notIn: ["WON", "LOST"] }, phone: { not: null } },
      }),
      // NOT `status: "OVERDUE"`. The app decides overdue by DERIVING it on ACTIVE rows - that is
      // what the home page counts - so querying the status column would put a different number on
      // two screens that claim to show the same thing.
      seesMoney ? getPendingRows() : Promise.resolve(null),
      // Same shape the Outreach page itself reads - reusing it here rather than re-deriving a
      // second "is it on, how much is due" query that could drift from what /outreach shows.
      seesMoney ? getOutreachQueue() : Promise.resolve(null),
    ]);

  const overdueCount = (overdue ?? []).filter(
    (p) => p.status === "ACTIVE" && p.overdue && p.balance.inr > 0,
  ).length;

  const tasks: DeskTask[] = [
    {
      key: "unconfirmed",
      label: "Discovery calls awaiting confirmation",
      detail: `Booked in the next ${CONFIRM_WINDOW_HOURS} hours with no reply yet - unconfirmed calls are the ones that no-show.`,
      count: unconfirmed,
      href: "/bookings",
      tone: "risk",
    },
    {
      key: "unassigned-leads",
      label: "Unassigned leads",
      detail: "Callable leads nobody owns - no specialist desk or SOP queue will ever surface these on its own.",
      count: unassignedCallable,
      href: "/pipeline",
      tone: "risk",
    },
    {
      key: "agreements",
      label: "Agreements still in draft",
      detail: "Written but never issued, so the student has nothing to sign.",
      count: draftAgreements,
      href: "/agreements",
      tone: "watch",
    },
    {
      key: "rewards",
      label: "Rewards awaiting your decision",
      detail: "Auto-detected and held until you approve or decline.",
      count: pendingRewards,
      href: "/console",
      tone: "watch",
    },
  ];

  if (seesMoney) {
    tasks.push({
      key: "overdue",
      label: "Overdue payments",
      detail: "Money already earned that has not arrived.",
      count: overdueCount,
      href: "/cash",
      tone: "risk",
    });
  }

  // ADMIN-only, matching `seesMoney`: HEAD has no `outreach` section at all (sections.ts), so a
  // link there would be a dead end, and turning the engine on is a founder call, not a coach's.
  if (seesMoney && outreach) {
    tasks.push({
      key: "outreach-engine",
      label: "Outreach SOP engine",
      detail: outreach.enabled
        ? `${outreach.counts.due} step${outreach.counts.due === 1 ? "" : "s"} waiting on a specialist - send, call or check a booking.`
        : "Off since it shipped - nobody is being scheduled a WhatsApp, a call or a booking check. Turn it on in Outreach → Settings when the team is ready.",
      count: outreach.counts.due,
      href: "/outreach",
      tone: "watch",
      disabled: !outreach.enabled,
    });
  }

  return { tasks, total: tasks.reduce((a, t) => a + t.count, 0) };
});
