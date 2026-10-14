import "server-only";
import { prisma } from "@/lib/prisma";
import {
  coerceZoomConfig,
  ZOOM_SETTINGS_KEY,
  zoomHostFor,
  type ZoomConfig,
} from "@/lib/config-schema";
import { createZoomMeeting, deleteZoomMeeting, getZoomRuntime, updateZoomMeeting } from "@/lib/zoom";

/**
 * Keeping Zoom in step with the calendar.
 *
 * WHY ONE RECONCILER AND NOT SIX CALL SITES. A booked call can be created, moved, cancelled,
 * marked a no-show, auto-cancelled by the confirmation engine, promoted into somebody else's
 * freed slot, or revived weeks later - seven paths, each of which would otherwise need its own
 * "and now create / move / delete the Zoom meeting" branch, and any one of them forgotten leaves
 * a prospect holding a link to a room nobody will be in.
 *
 * Instead every path calls the SAME function and it asks one question: does Zoom currently agree
 * with what the calendar says? It then creates, moves or deletes whatever is needed to make that
 * true. That makes it idempotent - calling it twice changes nothing the second time - which is
 * what lets the retry sweep run the identical code over every live booking to heal whatever a
 * timeout left behind.
 *
 * NOTHING HERE THROWS and nothing here is awaited inside a booking transaction. A booking is a
 * commitment made to a prospect; a meeting link is a convenience attached to it afterwards. If
 * Zoom is down, the booking still stands and the link arrives on the next tick.
 */

/**
 * Read the host mapping WITHOUT `founder-config`'s request-scoped cache.
 *
 * Everything in this file runs from a server action's deferred tail, from the cron tick, or from
 * a maintenance script - never from a render. A per-request cache has nothing to deduplicate
 * there, and `unstable_cache` carries a real cost outside a request: it needs a store that a
 * plain Node process does not have, which is also what made this module impossible to exercise
 * from `scripts/zoom-selftest.ts`. One indexed lookup by primary key is cheaper than the
 * machinery it replaces.
 */
async function readZoomConfig(): Promise<ZoomConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: ZOOM_SETTINGS_KEY } });
  return coerceZoomConfig(row?.value);
}

export type MeetingSync =
  | { outcome: "off" }
  | { outcome: "unchanged" }
  | { outcome: "created"; joinUrl: string }
  | { outcome: "moved" }
  | { outcome: "removed" }
  | { outcome: "failed"; error: string };

/** Live statuses: the call is still expected to happen, so it should hold a meeting. */
const LIVE_STATUSES = new Set(["BOOKED"]);

/**
 * Only ever schedule a meeting for a call that has not happened yet.
 *
 * Without this, the retry sweep would cheerfully create meetings for every past booking it found
 * with a null link - months of them on the first run after this ships.
 */
function isUpcoming(startsAt: Date): boolean {
  return startsAt.getTime() > Date.now();
}

/** Zoom only stores minutes, so compare at minute resolution or every sync looks like drift. */
function sameMinute(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

/**
 * Make Zoom match what `/bookings` says about this booking.
 *
 * Returns what it did, for the caller's logs and for the sweep's summary. Never throws.
 */
export async function syncBookingMeeting(bookingId: string): Promise<MeetingSync> {
  if (!getZoomRuntime().enabled) return { outcome: "off" };

  try {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        name: true,
        status: true,
        zoomMeetingId: true,
        zoomStartsAt: true,
        slot: { select: { startsAt: true, durationMins: true, assignedToId: true } },
      },
    });
    if (!booking) return { outcome: "unchanged" };

    const live = LIVE_STATUSES.has(booking.status) && booking.slot !== null;

    // ── The call is off (cancelled, no-show, or detached from its slot). Zoom must forget it. ──
    if (!live) {
      if (!booking.zoomMeetingId) return { outcome: "unchanged" };
      const gone = await deleteZoomMeeting(booking.zoomMeetingId);
      if (!gone.ok) return { outcome: "failed", error: gone.error };
      await prisma.bookingRequest.update({
        where: { id: booking.id },
        // The join url goes too: a cancelled booking that still renders a link is an invitation
        // for someone to forward it, and the room behind it no longer exists.
        data: { zoomMeetingId: null, zoomJoinUrl: null, zoomStartUrl: null, zoomStartsAt: null },
      });
      return { outcome: "removed" };
    }

    const slot = booking.slot!;

    // ── Already correct. The overwhelmingly common case, and it costs zero Zoom calls. ──
    if (booking.zoomMeetingId && sameMinute(booking.zoomStartsAt, slot.startsAt)) {
      return { outcome: "unchanged" };
    }

    // ── Held a meeting, but the call moved. Move the meeting rather than making a second one. ──
    if (booking.zoomMeetingId) {
      const moved = await updateZoomMeeting(booking.zoomMeetingId, {
        startsAt: slot.startsAt,
        durationMins: slot.durationMins,
      });
      if (!moved.ok) return { outcome: "failed", error: moved.error };
      await prisma.bookingRequest.update({
        where: { id: booking.id },
        data: { zoomStartsAt: slot.startsAt },
      });
      return { outcome: "moved" };
    }

    // ── No meeting yet. ──
    if (!isUpcoming(slot.startsAt)) return { outcome: "unchanged" };

    const config = await readZoomConfig();
    const created = await createZoomMeeting({
      hostEmail: zoomHostFor(config, slot.assignedToId),
      topic: `Discovery call - ${booking.name}`.slice(0, 200),
      startsAt: slot.startsAt,
      durationMins: slot.durationMins,
    });
    if (!created.ok) return { outcome: "failed", error: created.error };

    await prisma.bookingRequest.update({
      where: { id: booking.id },
      data: {
        zoomMeetingId: created.value.meetingId,
        zoomJoinUrl: created.value.joinUrl,
        zoomStartUrl: created.value.startUrl || null,
        zoomStartsAt: slot.startsAt,
      },
    });
    return { outcome: "created", joinUrl: created.value.joinUrl };
  } catch (e) {
    return { outcome: "failed", error: e instanceof Error ? e.message : "Zoom sync failed" };
  }
}

/**
 * The same reconcile for an SSS (sales) call, which lives on `OutreachJourney` + `SssSlot`.
 *
 * Writes `zoomLink`, the field the SOP's confirmation steps already read and that somebody has
 * been pasting by hand out of a calendar. A HAND-PASTED link is never overwritten by a failure
 * here and never deleted on cancellation unless we were the ones who created it - `zoomMeetingId`
 * is how we tell our own link from theirs, and clobbering a human's correction would be the most
 * annoying possible bug in this file.
 */
export async function syncJourneyMeeting(journeyId: string): Promise<MeetingSync> {
  if (!getZoomRuntime().enabled) return { outcome: "off" };

  try {
    const journey = await prisma.outreachJourney.findUnique({
      where: { id: journeyId },
      select: {
        id: true,
        zoomMeetingId: true,
        zoomStartsAt: true,
        cancelledAt: true,
        lead: { select: { name: true } },
        sssSlot: { select: { startsAt: true, durationMins: true, ownerId: true } },
      },
    });
    if (!journey) return { outcome: "unchanged" };

    const live = journey.sssSlot !== null && journey.cancelledAt === null;

    if (!live) {
      if (!journey.zoomMeetingId) return { outcome: "unchanged" };
      const gone = await deleteZoomMeeting(journey.zoomMeetingId);
      if (!gone.ok) return { outcome: "failed", error: gone.error };
      await prisma.outreachJourney.update({
        where: { id: journey.id },
        data: { zoomMeetingId: null, zoomLink: null, zoomStartsAt: null },
      });
      return { outcome: "removed" };
    }

    const slot = journey.sssSlot!;

    if (journey.zoomMeetingId && sameMinute(journey.zoomStartsAt, slot.startsAt)) {
      return { outcome: "unchanged" };
    }

    if (journey.zoomMeetingId) {
      const moved = await updateZoomMeeting(journey.zoomMeetingId, {
        startsAt: slot.startsAt,
        durationMins: slot.durationMins,
      });
      if (!moved.ok) return { outcome: "failed", error: moved.error };
      await prisma.outreachJourney.update({
        where: { id: journey.id },
        data: { zoomStartsAt: slot.startsAt },
      });
      return { outcome: "moved" };
    }

    if (!isUpcoming(slot.startsAt)) return { outcome: "unchanged" };

    const config = await readZoomConfig();
    const created = await createZoomMeeting({
      hostEmail: zoomHostFor(config, slot.ownerId),
      topic: `Strategy session - ${journey.lead.name}`.slice(0, 200),
      startsAt: slot.startsAt,
      durationMins: slot.durationMins,
    });
    if (!created.ok) return { outcome: "failed", error: created.error };

    await prisma.outreachJourney.update({
      where: { id: journey.id },
      data: {
        zoomMeetingId: created.value.meetingId,
        zoomLink: created.value.joinUrl,
        zoomStartsAt: slot.startsAt,
      },
    });
    return { outcome: "created", joinUrl: created.value.joinUrl };
  } catch (e) {
    return { outcome: "failed", error: e instanceof Error ? e.message : "Zoom sync failed" };
  }
}

export type ZoomSweepResult = {
  checked: number;
  created: number;
  moved: number;
  removed: number;
  failed: number;
};

/**
 * Heal every upcoming call whose Zoom state has drifted. Run from the booking-automation tick.
 *
 * This is what makes a Zoom outage a non-event: a booking taken while Zoom was timing out has no
 * link, the prospect's confirmation goes out without one, and the next sweep creates the meeting
 * and fills it in. Bounded by `take` so one bad afternoon cannot turn into a thousand API calls
 * in a single tick - whatever it does not reach, the next tick will.
 */
export async function sweepZoomMeetings(take = 25): Promise<ZoomSweepResult> {
  const result: ZoomSweepResult = { checked: 0, created: 0, moved: 0, removed: 0, failed: 0 };
  if (!getZoomRuntime().enabled) return result;

  const now = new Date();

  const bookings = await prisma.bookingRequest.findMany({
    where: {
      status: "BOOKED",
      slot: { is: { startsAt: { gt: now } } },
      // Needs work only if there is no meeting at all, or the one we have is at the wrong time.
      // The equality case (`zoomStartsAt` = the slot's time) is excluded in `syncBookingMeeting`,
      // so a booking already in step costs one row read and nothing else.
      OR: [{ zoomMeetingId: null }, { zoomStartsAt: null }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take,
  });

  for (const b of bookings) {
    result.checked += 1;
    const sync = await syncBookingMeeting(b.id);
    if (sync.outcome === "created") result.created += 1;
    else if (sync.outcome === "moved") result.moved += 1;
    else if (sync.outcome === "removed") result.removed += 1;
    else if (sync.outcome === "failed") result.failed += 1;
  }

  return result;
}
