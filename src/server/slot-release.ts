import "server-only";
import type { Prisma, SlotReleaseReason, SlotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTimeInZone } from "@/lib/format";

/**
 * Slots handed back to the calendar - the record that used to be destroyed by the release itself.
 *
 * Freeing a slot NULLS `BookingRequest.slotId`, because that column is `@unique` and the slot
 * cannot be re-booked while a cancelled booking still points at it. So after a cancel there was
 * nothing left that said when the call had been: the bookings table rendered "-" in the time
 * column, and the slot went back onto the week grid looking untouched. One row written inside the
 * same transaction fixes that, and it is the only place "which slots did we cancel, and did we get
 * them re-used?" can be answered from.
 *
 * Written on all four release paths - the confirm-or-cancel engine, a manual cancel, a no-show,
 * and a postpone - so the list is the whole truth about a slot coming back, not just the
 * automation's share of it.
 */

type Tx = Prisma.TransactionClient;

export type RecordReleaseArgs = {
  slotId: string;
  bookingRequestId: string;
  slotStartsAt: Date;
  durationMins: number;
  prospectName: string;
  reason: SlotReleaseReason;
  /** What the slot became - OPEN, or BLOCKED when it was released inside the min-notice window. */
  releasedStatus: SlotStatus;
  /** Null for the engine; a person's name when a human did it. */
  releasedByName?: string | null;
};

/**
 * Write the release row. Takes the transaction client on purpose: the row and the slot's status
 * flip have to land together, or a crash between them leaves a freed slot with no explanation -
 * exactly the hole this table exists to close.
 */
export async function recordSlotRelease(tx: Tx, a: RecordReleaseArgs): Promise<void> {
  await tx.slotRelease.create({
    data: {
      slotId: a.slotId,
      bookingRequestId: a.bookingRequestId,
      slotStartsAt: a.slotStartsAt,
      durationMins: a.durationMins,
      prospectName: a.prospectName,
      reason: a.reason,
      releasedStatus: a.releasedStatus,
      releasedByName: a.releasedByName ?? null,
    },
  });
}

/**
 * Note that promote-next filled this opening.
 *
 * Deliberately a separate write, after the promote has succeeded: a promote can fail its own
 * concurrency guard, and claiming the slot was re-used when it wasn't is the one error that would
 * make this list misleading. Stamps the most recent unfilled release of that slot - a slot can be
 * released more than once over its life, and only the latest release is the one just filled.
 */
export async function markReleasePromoted(
  slotId: string,
  promotedBookingId: string,
  promotedName: string,
): Promise<void> {
  const latest = await prisma.slotRelease.findFirst({
    where: { slotId, promotedBookingId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return;
  await prisma.slotRelease.update({
    where: { id: latest.id },
    data: { promotedBookingId, promotedName },
  });
}

const istDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
});
const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});

/**
 * The "cancelled slots" list.
 *
 * `slot.status` is read live rather than snapshotted, because the question a founder asks of this
 * screen is about NOW: a slot released this morning and re-booked this afternoon is a success
 * story, and one still sitting open an hour before the call is lost capacity. The snapshot columns
 * answer what happened; this one answers what came of it.
 */
export async function listSlotReleases(limit = 300) {
  const rows = await prisma.slotRelease.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      slot: { select: { status: true, booking: { select: { id: true, name: true } } } },
      bookingRequest: { select: { id: true, status: true, leadId: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    slotId: r.slotId,
    bookingId: r.bookingRequestId,
    leadId: r.bookingRequest?.leadId ?? null,
    prospectName: r.prospectName,
    slotStartsAt: r.slotStartsAt.toISOString(),
    slotDay: istDay.format(r.slotStartsAt),
    slotTime: istTime.format(r.slotStartsAt),
    slotCet: formatDateTimeInZone(r.slotStartsAt, "Europe/Berlin"),
    durationMins: r.durationMins,
    reason: r.reason,
    releasedStatus: r.releasedStatus,
    releasedAt: r.createdAt.toISOString(),
    releasedDay: istDay.format(r.createdAt),
    releasedTime: istTime.format(r.createdAt),
    releasedByName: r.releasedByName,
    promotedName: r.promotedName,
    /** What became of the slot: null when the slot row itself has since been deleted. */
    slotStatusNow: r.slot?.status ?? null,
    /** Who holds it now, if anybody re-booked it. */
    rebookedName: r.slot?.booking?.name ?? null,
    /** Whether the released call itself was later put back on the calendar. */
    bookingStatusNow: r.bookingRequest?.status ?? null,
  }));
}

export type SlotReleaseRow = Awaited<ReturnType<typeof listSlotReleases>>[number];

/**
 * The latest release per slot inside a week, for the week calendar.
 *
 * Lets an OPEN cell say "freed - Priya never replied" instead of looking like a slot that was
 * simply never booked. Keyed by slot id; a slot released twice shows only the most recent, which
 * is the one that explains its current state.
 */
export async function releasesBySlotForWeek(weekStartUtc: Date, weekEndUtc: Date) {
  const rows = await prisma.slotRelease.findMany({
    where: { slotStartsAt: { gte: weekStartUtc, lt: weekEndUtc }, slotId: { not: null } },
    orderBy: { createdAt: "asc" }, // later rows overwrite earlier ones below
    select: { slotId: true, prospectName: true, reason: true, createdAt: true, promotedName: true },
  });
  const bySlot: Record<string, { prospectName: string; reason: SlotReleaseReason; promotedName: string | null }> = {};
  for (const r of rows) {
    if (!r.slotId) continue;
    bySlot[r.slotId] = { prospectName: r.prospectName, reason: r.reason, promotedName: r.promotedName };
  }
  return bySlot;
}

export type WeekReleaseMap = Awaited<ReturnType<typeof releasesBySlotForWeek>>;
