import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getPendingRows } from "@/server/finance-metrics";
import type { AppRole } from "@/lib/sections";
import type { SignalLevel } from "@/lib/signals";

/**
 * My Desk for an admin or head coach — a task list, not call statistics (Error Log Q2).
 *
 * The desk branches on `TeamProfile.logVariant` into the L1 and L2 specialist screens. Anyone
 * without a variant fell through to either the generic call desk (call stats, meaningless to a
 * founder) or, with no team profile at all, an explainer telling them to ask Ameen to link their
 * login — which is what Ameen himself saw.
 *
 * So this answers the same question the specialist desks answer — "what needs me right now?" —
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

  const [pendingRewards, draftAgreements, unconfirmed, overdue] = await Promise.all([
    prisma.rewardGrant.count({ where: { status: "PENDING" } }),
    prisma.agreement.count({ where: { status: "DRAFT" } }),
    prisma.bookingRequest.count({
      where: {
        status: "BOOKED",
        confirmedAt: null,
        slot: { startsAt: { gte: now, lt: horizon } },
      },
    }),
    // NOT `status: "OVERDUE"`. The app decides overdue by DERIVING it on ACTIVE rows — that is
    // what the home page counts — so querying the status column would put a different number on
    // two screens that claim to show the same thing.
    seesMoney ? getPendingRows() : Promise.resolve(null),
  ]);

  const overdueCount = (overdue ?? []).filter(
    (p) => p.status === "ACTIVE" && p.overdue && p.balance.inr > 0,
  ).length;

  const tasks: DeskTask[] = [
    {
      key: "unconfirmed",
      label: "Discovery calls awaiting confirmation",
      detail: `Booked in the next ${CONFIRM_WINDOW_HOURS} hours with no reply yet — unconfirmed calls are the ones that no-show.`,
      count: unconfirmed,
      href: "/bookings",
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

  return { tasks, total: tasks.reduce((a, t) => a + t.count, 0) };
});
