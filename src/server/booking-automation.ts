import "server-only";
import { prisma } from "@/lib/prisma";
import { istWallToUtc } from "@/lib/dates";
import { activityStamp } from "@/lib/activity-actions";
import { formatDateTimeInZone } from "@/lib/format";
import { callTimeNotice } from "@/lib/call-notice";
import { releasedSlotStatus } from "@/lib/booking-hold";
import { getBookingRulesConfig } from "./founder-config";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";
import { markReleasePromoted, recordSlotRelease } from "./slot-release";
import {
  sendBookingConfirmRequest,
  sendBookingRescheduled,
  sendBookingAutoCancelled,
} from "./whatsapp";

/**
 * Bookings confirmation loop (Module E) - the in-house "confirm-or-cancel + promote-next" engine.
 *
 * Three jobs, run in order each tick:
 *   1. ASK   - a booked call inside the confirm-request window that hasn't been asked yet gets one
 *              "please reply YES" message; `confirmSentAt` is stamped so we ask exactly once.
 *   2. CANCEL- a still-unconfirmed call inside the auto-cancel window (and past the reply grace) is
 *              released: booking → CANCELLED, slot back on the calendar, a SlotRelease row written
 *              so the cancellation is still visible afterwards, lead re-opened to
 *              DISCO_NOT_BOOKED, and the prospect told the slot was freed. Gated behind
 *              `autoCancelEnabled` (default OFF).
 *   3. PROMOTE- the freed slot is filled by moving the next booked call for the SAME caller on the
 *              SAME day up into it, and that prospect is told their call moved earlier.
 *
 * A confirmation is set elsewhere: a WhatsApp "yes" (src/app/api/wati/webhook) or a manual
 * "Mark confirmed" (booking-actions.setBookingConfirmed). This engine only READS `confirmedAt`.
 *
 * SAFE BY DESIGN: the send wrappers never throw; every state change is guarded so a concurrent
 * booking/cancel can't be clobbered; and no past slot is ever touched (those are no-show territory).
 * There is no autonomous clock - /api/cron/whatsapp drives this alongside the reminder engine, and
 * the Admin "Run booking automation now" button calls it directly.
 */

const HR = 3_600_000;
const MIN = 60_000;
// Bound the work a single tick will do, mirroring the WhatsApp engine's per-run cap.
const MAX_PER_RUN = 200;

const istDateKey = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
});

/** UTC bounds of the IST calendar day that `startsAt` falls on. */
function istDayBounds(startsAt: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = istWallToUtc(istDateKey.format(startsAt), "00:00");
  return { dayStart, dayEnd: new Date(dayStart.getTime() + 24 * HR) };
}

export type PromoteResult = { bookingId: string; name: string; toSlotId: string } | null;

/**
 * Move the next booked call for the same caller on the same IST day up into `freedSlotId`, then
 * notify that prospect. Returns the promoted booking (or null if nothing qualified). Shared by the
 * auto-cancel path and by a manual cancel (booking-actions.setBookingStatus).
 *
 * The freed slot must be OPEN (a cancel both frees the slot AND detaches the cancelled booking, so
 * its unique slotId is available). "Same duration" is required so a 60-min call is never squeezed
 * into a 30-min opening.
 */
export async function promoteIntoFreedSlot(freedSlotId: string, sentById?: string | null): Promise<PromoteResult> {
  const freed = await prisma.appointmentSlot.findUnique({ where: { id: freedSlotId } });
  if (!freed || freed.status !== "OPEN") return null;
  if (freed.startsAt.getTime() <= Date.now()) return null; // never promote into a past slot
  const { dayEnd } = istDayBounds(freed.startsAt);

  const candidate = await prisma.appointmentSlot.findFirst({
    where: {
      status: "BOOKED",
      assignedToId: freed.assignedToId, // null matches unassigned; a string matches that caller
      durationMins: freed.durationMins,
      startsAt: { gt: freed.startsAt, lt: dayEnd },
      booking: { status: "BOOKED" },
    },
    orderBy: { startsAt: "asc" },
    include: { booking: { select: { id: true, name: true } } },
  });
  if (!candidate?.booking) return null;

  const moved = await prisma.$transaction(async (tx) => {
    // Claim the freed slot; bail if someone re-booked it between the read and here.
    const claim = await tx.appointmentSlot.updateMany({
      where: { id: freed.id, status: "OPEN" },
      data: { status: "BOOKED" },
    });
    if (claim.count === 0) return false;
    // Release the candidate's old slot; bail (and undo the claim) if its booking moved meanwhile.
    const release = await tx.appointmentSlot.updateMany({
      where: { id: candidate.id, status: "BOOKED" },
      data: { status: "OPEN" },
    });
    if (release.count === 0) {
      await tx.appointmentSlot.update({ where: { id: freed.id }, data: { status: "OPEN" } });
      return false;
    }
    // Point the booking at the new, earlier slot and reset its confirmation - the new time needs a
    // fresh YES. confirmSentAt=now marks the reschedule notice below as the ask, and with the reply
    // grace it can't be auto-cancelled before the prospect has had a chance to answer.
    await tx.bookingRequest.update({
      where: { id: candidate.booking!.id },
      data: { slotId: freed.id, status: "BOOKED", confirmedAt: null, confirmSentAt: new Date() },
    });
    // The promoted call's OLD slot is now empty too - and nobody cancelled anything, so without
    // this row the later slot would simply appear free with no reason on the calendar.
    await recordSlotRelease(tx, {
      slotId: candidate.id,
      bookingRequestId: candidate.booking!.id,
      slotStartsAt: candidate.startsAt,
      durationMins: candidate.durationMins,
      prospectName: candidate.booking!.name,
      reason: "POSTPONED",
      releasedStatus: "OPEN",
      releasedByName: null,
    });
    return true;
  });
  if (!moved) return null;

  // Only now that the move really happened: claiming a slot was re-used when the concurrency guard
  // bounced the promote is the one error that would make the cancelled-slots list lie.
  await markReleasePromoted(freed.id, candidate.booking.id, candidate.booking.name);

  const out = await sendBookingRescheduled(candidate.booking.id, sentById);
  // The engine owns this row even on the manual path: a person cancelled a booking, but choosing
  // this prospect and moving them up is the promote rule's doing, and nothing else logs it.
  await logSystemActivity(SYSTEM_ACTORS.bookings, {
    action: "booking.promote",
    section: "bookings",
    entityType: "BookingRequest",
    entityId: candidate.booking.id,
    summary: `Moved ${candidate.booking.name}'s call up into the freed ${activityStamp(freed.startsAt)} slot`,
    meta: { fromSlotId: candidate.id, toSlotId: freed.id, notified: out.sent },
  });
  return { bookingId: candidate.booking.id, name: candidate.booking.name, toSlotId: freed.id };
}

export type BookingAutomationRun = {
  enabled: boolean;
  reason?: string;
  ranAt: string;
  asked: number;
  cancelled: number;
  promoted: number;
  /**
   * Due for cancellation, but left alone because we could never prove the prospect was ASKED -
   * no delivered confirm request naming their current slot (see `callTimeNotice`).
   *
   * Counted and reported rather than silently skipped. This is the one way the founder's settings
   * can say "release it after 3 hours" and nothing happen, and until now it happened invisibly:
   * with WhatsApp off, or no approved template, EVERY unconfirmed booking lands here and the
   * run reports "0 cancelled" as though there had been nothing to do. A number with a reason
   * attached is the difference between "working" and "quietly doing nothing".
   */
  skippedNotReached: number;
};

/** Run the confirm-or-cancel cadence + promote-next once. Idempotent across ticks. */
export async function runBookingConfirmations(): Promise<BookingAutomationRun> {
  const ranAt = new Date().toISOString();
  const rules = await getBookingRulesConfig();
  let asked = 0;
  let cancelled = 0;
  let promoted = 0;
  let skippedNotReached = 0;

  // Master switch. When off, the loop is entirely idle: no confirm-request messages leave, and
  // nothing is auto-cancelled - so "off by default" genuinely means nothing automatic happens to a
  // real prospect. The manual controls (block, postpone, mark-confirmed, cancel-with-promote) are
  // unaffected because they don't go through here.
  if (!rules.autoCancelEnabled) {
    return { enabled: false, reason: "Confirmation loop is off - enable auto-cancel in Booking rules", ranAt, asked, cancelled, promoted, skippedNotReached };
  }

  const now = Date.now();

  // The prospect's window to answer, measured from the moment we asked. Founder-editable
  // (Console/WhatsApp settings → "Auto-cancel unconfirmed calls"), floored at 5 minutes by the
  // schema so a just-promoted call - stamped as asked the instant it moves - cannot be cancelled
  // by the very next tick.
  const replyGraceMs = rules.confirmReplyGraceMinutes * MIN;

  // 1. ASK - booked, unconfirmed, unasked calls now inside the confirm-request window.
  if (rules.confirmRequestLeadMinutes > 0) {
    const askCutoff = new Date(now + rules.confirmRequestLeadMinutes * MIN);
    const toAsk = await prisma.bookingRequest.findMany({
      where: {
        status: "BOOKED",
        confirmedAt: null,
        confirmSentAt: null,
        slot: { is: { startsAt: { gt: new Date(now), lte: askCutoff } } },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_RUN,
      select: { id: true, name: true, slot: { select: { startsAt: true } } },
    });
    for (const b of toAsk) {
      // Stamp first so a failed/again-skipped send can't cause us to re-ask every tick.
      await prisma.bookingRequest.update({ where: { id: b.id }, data: { confirmSentAt: new Date() } });
      const out = await sendBookingConfirmRequest(b.id);
      asked++;
      // `asked` counts the ask attempt (that's what the stamp records); the feed only claims a
      // message the prospect actually received - a SKIPPED send means WhatsApp is off or paused.
      if (out.sent && b.slot) {
        await logSystemActivity(SYSTEM_ACTORS.bookings, {
          action: "whatsapp.send",
          section: "bookings",
          entityType: "BookingRequest",
          entityId: b.id,
          summary: `Asked ${b.name} to confirm their ${activityStamp(b.slot.startsAt)} call`,
          meta: { kind: "BOOKING_CONFIRM_REQUEST", messageId: out.messageId },
        });
      }
    }
  }

  // 2. CANCEL - still-unconfirmed calls inside the auto-cancel window, past the reply grace.
  {
    const cancelCutoff = new Date(now + rules.autoCancelMinutes * MIN);
    const graceBefore = new Date(now - replyGraceMs);
    const candidates = await prisma.bookingRequest.findMany({
      where: {
        status: "BOOKED",
        confirmedAt: null,
        confirmSentAt: { not: null, lte: graceBefore },
        slot: { is: { startsAt: { gt: new Date(now), lte: cancelCutoff } } },
      },
      orderBy: { slot: { startsAt: "asc" } },
      take: MAX_PER_RUN,
      select: { id: true },
    });

    for (const c of candidates) {
      // Re-validate: a promote earlier in this same run may already have moved/reset this booking.
      const b = await prisma.bookingRequest.findUnique({
        where: { id: c.id },
        select: {
          id: true, name: true, status: true, confirmedAt: true, confirmSentAt: true, slotId: true, leadId: true,
          slot: { select: { id: true, startsAt: true, durationMins: true } },
        },
      });
      if (!b || b.status !== "BOOKED" || b.confirmedAt || !b.slotId || !b.slot) continue;
      if (b.slot.startsAt.getTime() <= now || b.slot.startsAt.getTime() > now + rules.autoCancelMinutes * MIN) continue;
      if (!b.confirmSentAt || b.confirmSentAt.getTime() > now - replyGraceMs) continue;
      /**
       * Silence is only a "no" if we actually asked. `confirmSentAt` is stamped BEFORE the send
       * (so a failure cannot re-ask every tick), which means it proves an attempt, not a delivery:
       * a request Meta refused, or one that named an older time, left a prospect who never saw the
       * question to be cancelled for not answering it. Only a delivered request naming the
       * CURRENT slot counts; otherwise the booking stays BOOKED for a human, and the post-call
       * sweep will hand it to one rather than write it off.
       */
      const asked = callTimeNotice(
        await prisma.whatsAppMessage.findMany({
          where: { bookingRequestId: b.id, direction: "OUTBOUND", kind: "BOOKING_CONFIRM_REQUEST" },
          select: { kind: true, status: true, params: true, createdAt: true },
        }),
        formatDateTimeInZone(b.slot.startsAt, "Asia/Kolkata"),
      );
      if (!asked.told) {
        skippedNotReached++;
        continue;
      }

      const freedSlotId = b.slot.id;
      /**
       * OPEN only if the public form would actually accept a booking for it (M2).
       *
       * The engine used to hardcode OPEN, which was harmless while the windows were whole hours
       * and the cancel window was comfortably wider than `minNoticeHours`. Minutes made it a real
       * bug: "cancel 20 minutes before" with a 2-hour notice rule published a slot the booking
       * page refuses - a free-looking cell nobody on earth can take. Same helper as the manual
       * cancel, so both paths hand a slot back on the same terms.
       */
      const freedStatus = releasedSlotStatus(b.slot.startsAt, rules.minNoticeHours, now);
      await prisma.$transaction(async (tx) => {
        // Detach the booking from its slot (frees the unique slotId) and hand the slot back.
        await tx.bookingRequest.update({ where: { id: b.id }, data: { status: "CANCELLED", slotId: null } });
        await tx.appointmentSlot.update({ where: { id: freedSlotId }, data: { status: freedStatus } });
        /**
         * The release's own record, written in the SAME transaction as the two updates above.
         *
         * Nulling `slotId` is what makes the slot re-bookable, and it is also what destroys the
         * only trace of when this call was - a cancelled booking rendered "-" in the time column
         * and the slot went back on the calendar looking as if it had never been booked. This row
         * is what the Cancelled-slots list reads.
         */
        await recordSlotRelease(tx, {
          slotId: freedSlotId,
          bookingRequestId: b.id,
          slotStartsAt: b.slot!.startsAt,
          durationMins: b.slot!.durationMins,
          prospectName: b.name,
          reason: "NO_CONFIRMATION",
          releasedStatus: freedStatus,
          releasedByName: null, // the engine
        });
        // Re-open the lead so the discovery-reminder cadence can chase them to rebook.
        if (b.leadId) {
          const lead = await tx.lead.findUnique({ where: { id: b.leadId }, select: { stage: true } });
          if (lead && lead.stage === "DISCO_BOOKED") {
            await tx.lead.update({ where: { id: b.leadId }, data: { stage: "DISCO_NOT_BOOKED" } });
            await tx.leadStageHistory.create({
              data: { leadId: b.leadId, fromStage: "DISCO_BOOKED", toStage: "DISCO_NOT_BOOKED" },
            });
          }
        }
      });
      cancelled++;
      const out = await sendBookingAutoCancelled(b.id);
      // One row for the release itself - that happened whether or not the notice got out, so
      // `notified` carries the part that didn't.
      await logSystemActivity(SYSTEM_ACTORS.bookings, {
        action: "booking.cancel",
        section: "bookings",
        entityType: "BookingRequest",
        entityId: b.id,
        summary: `Auto-cancelled ${b.name}'s ${activityStamp(b.slot.startsAt)} call - no confirmation`,
        meta: { reason: "no-confirmation", slotId: freedSlotId, slotStatus: freedStatus, notified: out.sent },
      });

      // A slot released inside the notice window is BLOCKED, and promoteIntoFreedSlot requires
      // OPEN - so this is a no-op there rather than a surprise. Left explicit: moving someone into
      // a slot the booking page itself would refuse is not a favour.
      if (rules.promoteNext && freedStatus === "OPEN") {
        const res = await promoteIntoFreedSlot(freedSlotId);
        if (res) promoted++;
      }
    }
  }

  return { enabled: true, ranAt, asked, cancelled, promoted, skippedNotReached };
}
