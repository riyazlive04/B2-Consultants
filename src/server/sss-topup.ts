import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { slotStartsForRange } from "@/lib/slot-plan";
import { getSssConfig, getSssPatternConfig } from "./founder-config";

/**
 * Keep the founder's SSS (sales) calendar stocked to a rolling horizon.
 *
 * The exact counterpart of `slot-topup.ts`, for the exact same reason and one worse symptom: as
 * of 29 Jul 2026 the `SssSlot` table held **zero rows, ever**. The discovery calendar at least
 * ran dry after being filled by hand; the sales-call layer was never filled at all, so the step
 * of the funnel that closes deals had no calendar behind it from the day it shipped.
 *
 * SAFETY, identical to the booking job: it only ever ADDS OPEN slots on instants that currently
 * have none for this owner. It never updates or deletes, so a BOOKED or BLOCKED slot is
 * untouchable by construction, and a second tick in the same hour creates nothing.
 *
 * Two fields of the shared `SlotPatternConfig` are ignored here on purpose — `assignedToId` and
 * `durationMins` — because an SSS slot's owner and length already live in `sssConfig` and two
 * sources for one fact is how they end up disagreeing.
 */

export type SssTopUpResult =
  | { ran: false; reason: string }
  | { ran: true; created: number; horizonTo: string; alreadyPresent: number };

export async function ensureSssSlots(): Promise<SssTopUpResult> {
  const [pattern, sss] = await Promise.all([getSssPatternConfig(), getSssConfig()]);
  if (!pattern.enabled) return { ran: false, reason: "SSS pattern disabled" };
  if (!pattern.weekdays.length) return { ran: false, reason: "no weekdays configured" };
  // Unlike a booking slot, an SSS slot cannot be unassigned: `SssSlot.ownerId` is required, and
  // the whole calendar is "the founder's diary". No owner set = nothing to generate against.
  if (!sss.ownerId) return { ran: false, reason: "no SSS owner set (Bookings → SSS)" };

  const today = istToday();
  const horizonEnd = new Date(today);
  horizonEnd.setUTCDate(today.getUTCDate() + pattern.horizonDays);

  const starts = slotStartsForRange({
    startDate: toDateInputValue(today),
    endDate: toDateInputValue(horizonEnd),
    pattern: { ...pattern, durationMins: sss.slotDurationMins },
    // The SSS diary has no separate buffer rule of its own; the interval is the whole spacing.
    bufferMinutes: 0,
    istWallToUtc,
    parseDate: parseDateInput,
    formatDate: toDateInputValue,
  });
  if (!starts.length) return { ran: false, reason: "pattern fits no slots in the horizon" };

  // Only drop instants already in the past — an SSS is founder-scheduled, so unlike the public
  // booking page there is no minimum-notice window to respect.
  const now = Date.now();
  const upcoming = starts.filter((s) => s.getTime() >= now);
  if (!upcoming.length) return { ran: false, reason: "every slot in the horizon is in the past" };

  const existing = await prisma.sssSlot.findMany({
    where: { ownerId: sss.ownerId, startsAt: { in: upcoming } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((s) => s.startsAt.getTime()));
  const fresh = upcoming.filter((s) => !taken.has(s.getTime()));

  if (fresh.length) {
    await prisma.sssSlot.createMany({
      data: fresh.map((startsAt) => ({
        startsAt,
        durationMins: sss.slotDurationMins,
        ownerId: sss.ownerId!,
        status: "OPEN" as const,
      })),
      skipDuplicates: true,
    });
  }

  return {
    ran: true,
    created: fresh.length,
    alreadyPresent: upcoming.length - fresh.length,
    horizonTo: toDateInputValue(horizonEnd),
  };
}

/** Upcoming OPEN SSS slots — the figure that has been 0 since the table was created. */
export async function countOpenSssSlots(): Promise<{ open: number; nextAt: Date | null }> {
  const now = new Date();
  const [open, next] = await Promise.all([
    prisma.sssSlot.count({ where: { status: "OPEN", startsAt: { gte: now } } }),
    prisma.sssSlot.findFirst({
      where: { status: "OPEN", startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    }),
  ]);
  return { open, nextAt: next?.startsAt ?? null };
}
