import "server-only";
import { prisma } from "@/lib/prisma";
import { istWallToUtc } from "@/lib/dates";
import { getBookingRulesConfig } from "./founder-config";
import {
  sendBookingConfirmRequest,
  sendBookingRescheduled,
  sendBookingAutoCancelled,
} from "./whatsapp";

/**
 * Bookings confirmation loop (Module E) — the in-house "confirm-or-cancel + promote-next" engine.
 *
 * Three jobs, run in order each tick:
 *   1. ASK   — a booked call inside the confirm-request window that hasn't been asked yet gets one
 *              "please reply YES" message; `confirmSentAt` is stamped so we ask exactly once.
 *   2. CANCEL— a still-unconfirmed call inside the auto-cancel window (and past the reply grace) is
 *              released: booking → CANCELLED, slot → OPEN, lead re-opened to DISCO_NOT_BOOKED, and
 *              the prospect told the slot was freed. Gated behind `autoCancelEnabled` (default OFF).
 *   3. PROMOTE— the freed slot is filled by moving the next booked call for the SAME caller on the
 *              SAME day up into it, and that prospect is told their call moved earlier.
 *
 * A confirmation is set elsewhere: a WhatsApp "yes" (src/app/api/wati/webhook) or a manual
 * "Mark confirmed" (booking-actions.setBookingConfirmed). This engine only READS `confirmedAt`.
 *
 * SAFE BY DESIGN: the send wrappers never throw; every state change is guarded so a concurrent
 * booking/cancel can't be clobbered; and no past slot is ever touched (those are no-show territory).
 * There is no autonomous clock — /api/cron/whatsapp drives this alongside the reminder engine, and
 * the Admin "Run booking automation now" button calls it directly.
 */

const HR = 3_600_000;
// A prospect must get at least this long to reply after we ask before the slot can be auto-cancelled.
// It also protects a just-promoted call (whose new, earlier slot may already sit inside the
// auto-cancel window) from being cancelled on the very next tick.
const REPLY_GRACE_MS = 30 * 60_000;
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
    // Point the booking at the new, earlier slot and reset its confirmation — the new time needs a
    // fresh YES. confirmSentAt=now marks the reschedule notice below as the ask, and with the reply
    // grace it can't be auto-cancelled before the prospect has had a chance to answer.
    await tx.bookingRequest.update({
      where: { id: candidate.booking!.id },
      data: { slotId: freed.id, status: "BOOKED", confirmedAt: null, confirmSentAt: new Date() },
    });
    return true;
  });
  if (!moved) return null;

  await sendBookingRescheduled(candidate.booking.id, sentById);
  return { bookingId: candidate.booking.id, name: candidate.booking.name, toSlotId: freed.id };
}

export type BookingAutomationRun = {
  enabled: boolean;
  reason?: string;
  ranAt: string;
  asked: number;
  cancelled: number;
  promoted: number;
};

/** Run the confirm-or-cancel cadence + promote-next once. Idempotent across ticks. */
export async function runBookingConfirmations(): Promise<BookingAutomationRun> {
  const ranAt = new Date().toISOString();
  const rules = await getBookingRulesConfig();
  let asked = 0;
  let cancelled = 0;
  let promoted = 0;

  // Master switch. When off, the loop is entirely idle: no confirm-request messages leave, and
  // nothing is auto-cancelled — so "off by default" genuinely means nothing automatic happens to a
  // real prospect. The manual controls (block, postpone, mark-confirmed, cancel-with-promote) are
  // unaffected because they don't go through here.
  if (!rules.autoCancelEnabled) {
    return { enabled: false, reason: "Confirmation loop is off — enable auto-cancel in Booking rules", ranAt, asked, cancelled, promoted };
  }

  const now = Date.now();

  // 1. ASK — booked, unconfirmed, unasked calls now inside the confirm-request window.
  if (rules.confirmRequestLeadHours > 0) {
    const askCutoff = new Date(now + rules.confirmRequestLeadHours * HR);
    const toAsk = await prisma.bookingRequest.findMany({
      where: {
        status: "BOOKED",
        confirmedAt: null,
        confirmSentAt: null,
        slot: { is: { startsAt: { gt: new Date(now), lte: askCutoff } } },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_RUN,
      select: { id: true },
    });
    for (const b of toAsk) {
      // Stamp first so a failed/again-skipped send can't cause us to re-ask every tick.
      await prisma.bookingRequest.update({ where: { id: b.id }, data: { confirmSentAt: new Date() } });
      await sendBookingConfirmRequest(b.id);
      asked++;
    }
  }

  // 2. CANCEL — still-unconfirmed calls inside the auto-cancel window, past the reply grace.
  {
    const cancelCutoff = new Date(now + rules.autoCancelHours * HR);
    const graceBefore = new Date(now - REPLY_GRACE_MS);
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
          id: true, status: true, confirmedAt: true, confirmSentAt: true, slotId: true, leadId: true,
          slot: { select: { id: true, startsAt: true } },
        },
      });
      if (!b || b.status !== "BOOKED" || b.confirmedAt || !b.slotId || !b.slot) continue;
      if (b.slot.startsAt.getTime() <= now || b.slot.startsAt.getTime() > now + rules.autoCancelHours * HR) continue;
      if (!b.confirmSentAt || b.confirmSentAt.getTime() > now - REPLY_GRACE_MS) continue;

      const freedSlotId = b.slot.id;
      await prisma.$transaction(async (tx) => {
        // Detach the booking from its slot (frees the unique slotId) and open the slot back up.
        await tx.bookingRequest.update({ where: { id: b.id }, data: { status: "CANCELLED", slotId: null } });
        await tx.appointmentSlot.update({ where: { id: freedSlotId }, data: { status: "OPEN" } });
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
      await sendBookingAutoCancelled(b.id);

      if (rules.promoteNext) {
        const res = await promoteIntoFreedSlot(freedSlotId);
        if (res) promoted++;
      }
    }
  }

  return { enabled: true, ranAt, asked, cancelled, promoted };
}
