import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { slotStartsForRange } from "@/lib/slot-plan";
import { getBookingRulesConfig, getSlotPatternConfig } from "./founder-config";

/**
 * Keep the public /book calendar stocked to a rolling horizon.
 *
 * THE PROBLEM THIS SOLVES: appointment slots were only ever created by the founder's one-off
 * "generate for this range" form. On 23 Jul 2026 the newest slot in production was 15 Jul — the
 * booking page had been offering an empty calendar for eight days, at the very top of the funnel,
 * and nothing surfaced it. A batch that has to be re-run by hand cannot fail safe.
 *
 * SAFETY. This job only ever ADDS OPEN slots on instants that currently have no slot at all:
 *  · it never updates or deletes, so a BOOKED or BLOCKED slot is untouchable by construction;
 *  · dedupe is by exact `startsAt`, using the same `slotStartsForRange` the manual form uses, so
 *    hand-made and auto-made slots collide rather than accumulating near-duplicate pairs;
 *  · it is idempotent — a second tick in the same hour creates nothing.
 *
 * It is therefore safe to run hourly, and it does, from `runDailyMaintenance`. There is no
 * "already ran today" guard on purpose: a top-up that only fires once a day would leave the
 * calendar short for up to 24 hours after the founder widened the horizon or a slot was consumed
 * at the far edge.
 */

export type SlotTopUpResult =
  | { ran: false; reason: string }
  | { ran: true; created: number; horizonTo: string; alreadyPresent: number };

export async function ensureBookingSlots(): Promise<SlotTopUpResult> {
  const pattern = await getSlotPatternConfig();
  if (!pattern.enabled) return { ran: false, reason: "slot pattern disabled" };
  if (!pattern.weekdays.length) return { ran: false, reason: "no weekdays configured" };

  const rules = await getBookingRulesConfig();
  const today = istToday();

  /**
   * Never generate past the window the public page will actually offer. `maxAdvanceDays` is the
   * founder's "how far ahead may a prospect book" rule; slots beyond it would be invisible rows
   * that still have to be paged through in the admin calendar forever.
   */
  const horizonDays = Math.min(pattern.horizonDays, rules.maxAdvanceDays);
  const horizonEnd = new Date(today);
  horizonEnd.setUTCDate(today.getUTCDate() + horizonDays);

  const starts = slotStartsForRange({
    startDate: toDateInputValue(today),
    endDate: toDateInputValue(horizonEnd),
    pattern,
    bufferMinutes: rules.bufferMinutes,
    istWallToUtc,
    parseDate: parseDateInput,
    formatDate: toDateInputValue,
  });
  if (!starts.length) return { ran: false, reason: "pattern fits no slots in the horizon" };

  /**
   * Drop instants that have already passed, and those inside the minimum-notice window. Without
   * this the job would helpfully create a slot for 15:00 today at 16:00, which no prospect can
   * book and which then sits in the calendar as permanent noise.
   */
  const earliest = Date.now() + rules.minNoticeHours * 3_600_000;
  const bookable = starts.filter((s) => s.getTime() >= earliest);
  if (!bookable.length) return { ran: false, reason: "every slot in the horizon is inside the notice window" };

  const existing = await prisma.appointmentSlot.findMany({
    where: { startsAt: { in: bookable } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((s) => s.startsAt.getTime()));
  const fresh = bookable.filter((s) => !taken.has(s.getTime()));

  if (fresh.length) {
    await prisma.appointmentSlot.createMany({
      data: fresh.map((startsAt) => ({
        startsAt,
        durationMins: pattern.durationMins,
        assignedToId: pattern.assignedToId || null,
      })),
      // Belt and braces against a concurrent manual generation racing this tick. The dedupe
      // above is a read-then-write, so it is not atomic; the calendar has no unique index on
      // startsAt (two callers may legitimately hold the same slot time), so this only guards
      // against an exact duplicate row, which is the case that matters.
      skipDuplicates: true,
    });
  }

  return {
    ran: true,
    created: fresh.length,
    alreadyPresent: bookable.length - fresh.length,
    horizonTo: toDateInputValue(horizonEnd),
  };
}

/**
 * How many bookable OPEN slots remain in the future — the number that was 0 for eight days.
 * Read by the home-page attention list so an empty calendar announces itself instead of being
 * discovered by a prospect.
 */
export async function countBookableSlots(): Promise<{ open: number; nextAt: Date | null }> {
  const rules = await getBookingRulesConfig();
  const earliest = new Date(Date.now() + rules.minNoticeHours * 3_600_000);
  const [open, next] = await Promise.all([
    prisma.appointmentSlot.count({ where: { status: "OPEN", startsAt: { gte: earliest } } }),
    prisma.appointmentSlot.findFirst({
      where: { status: "OPEN", startsAt: { gte: earliest } },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    }),
  ]);
  return { open, nextAt: next?.startsAt ?? null };
}
