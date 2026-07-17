import "server-only";
import { prisma } from "@/lib/prisma";
import { istWallToUtc } from "@/lib/dates";
import { formatDateTimeInZone } from "@/lib/format";
import { getSssConfig } from "./founder-config";
import { sendSssRescheduled } from "./whatsapp";

/**
 * SSS (Success Strategy Session) slot engine — the founder-run sales call calendar.
 *
 * Mirrors the discovery booking-automation engine, adapted to SssSlot (which links an
 * OutreachJourney rather than a public BookingRequest). Three ideas:
 *
 *   - GENERATE / BOOK — the founder lays out OPEN slots; a prospect's journey is booked into one,
 *     which sets `slot.status = BOOKED`, `slot.journeyId`, and mirrors `journey.sssAt = startsAt`
 *     so the SSS confirmation ladder (SOP steps 19–21, anchored on sssAt) keeps working.
 *   - BLOCK / UNBLOCK — the founder marks a slot (or a whole IST day) unavailable. Blocking a
 *     BOOKED slot first RELOCATES its prospect to the next OPEN same-owner slot within the config
 *     window, resets the SSS confirmation, and WhatsApps the new time. No open slot in range →
 *     the prospect is detached and surfaces on the "needs an SSS time" list for manual rebooking.
 *   - MOVE — a manual/drag reschedule of a booked prospect onto a chosen OPEN slot.
 *
 * SAFE BY DESIGN: every claim/free is a guarded updateMany inside a transaction, so a concurrent
 * book/move can't be clobbered; the WhatsApp wrapper never throws; a moved prospect always has to
 * re-confirm (salesCallConfirmed reset). There is no autonomous clock — blocks are founder actions.
 */

const HR = 3_600_000;

const istDateKey = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
});

/** UTC bounds of the IST calendar day that `d` falls on. */
function istDayBounds(d: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = istWallToUtc(istDateKey.format(d), "00:00");
  return { dayStart, dayEnd: new Date(dayStart.getTime() + 24 * HR) };
}

export type SssSlotView = {
  id: string;
  startsAt: string; // ISO UTC
  startsAtIst: string; // full display
  dayKey: string; // IST YYYY-MM-DD (grid column)
  timeIst: string; // IST HH:MM (cell label)
  durationMins: number;
  status: "OPEN" | "BOOKED" | "BLOCKED";
  ownerId: string | null;
  ownerName: string | null;
  journeyId: string | null;
  prospectName: string | null;
  prospectLeadId: string | null;
  isPast: boolean;
};

const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
});

/** Slots in [from, to) with owner + booked-prospect labels, for the calendar UI. */
export async function listSssSlots(from: Date, to: Date): Promise<SssSlotView[]> {
  const slots = await prisma.sssSlot.findMany({
    where: { startsAt: { gte: from, lt: to } },
    orderBy: { startsAt: "asc" },
    include: {
      owner: { select: { name: true } },
      journey: { select: { id: true, leadId: true, lead: { select: { name: true } } } },
    },
  });
  const now = Date.now();
  return slots.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    startsAtIst: formatDateTimeInZone(s.startsAt, "Asia/Kolkata"),
    dayKey: istDateKey.format(s.startsAt),
    timeIst: istTime.format(s.startsAt),
    durationMins: s.durationMins,
    status: s.status as SssSlotView["status"],
    ownerId: s.ownerId,
    ownerName: s.owner?.name ?? null,
    journeyId: s.journey?.id ?? null,
    prospectName: s.journey?.lead?.name ?? null,
    prospectLeadId: s.journey?.leadId ?? null,
    isPast: s.startsAt.getTime() <= now,
  }));
}

/** HQ prospects who have no SSS slot booked — includes anyone bumped off a blocked slot. */
export async function listSssNeedsScheduling(): Promise<
  { journeyId: string; leadId: string; name: string; sssAtIst: string | null }[]
> {
  const rows = await prisma.outreachJourney.findMany({
    where: { highlyQualified: true, sssSlot: { is: null }, cancelledAt: null },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, leadId: true, sssAt: true, lead: { select: { name: true } } },
  });
  return rows.map((r) => ({
    journeyId: r.id,
    leadId: r.leadId,
    name: r.lead?.name ?? "—",
    sssAtIst: r.sssAt ? formatDateTimeInZone(r.sssAt, "Asia/Kolkata") : null,
  }));
}

export type SssActionResult = { ok: true } | { ok: false; error: string };

/**
 * Generate OPEN slots at each (date, time) for an owner. Idempotent: an existing slot at the same
 * owner+instant is skipped, never duplicated. Dates are IST day keys (YYYY-MM-DD); times are IST
 * HH:MM. Returns how many were created.
 */
export async function generateSssSlots(input: {
  ownerId: string;
  dates: string[];
  times: string[];
  durationMins: number;
}): Promise<{ created: number }> {
  const wanted = input.dates
    .flatMap((d) => input.times.map((t) => istWallToUtc(d, t)))
    .filter((dt) => Number.isFinite(dt.getTime()));

  if (!wanted.length) return { created: 0 };

  const existing = await prisma.sssSlot.findMany({
    where: { ownerId: input.ownerId, startsAt: { in: wanted } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((e) => e.startsAt.getTime()));
  const fresh = wanted.filter((dt) => !taken.has(dt.getTime()));
  if (!fresh.length) return { created: 0 };

  await prisma.sssSlot.createMany({
    data: fresh.map((dt) => ({
      startsAt: dt,
      durationMins: input.durationMins,
      ownerId: input.ownerId,
      status: "OPEN" as const,
    })),
  });
  return { created: fresh.length };
}

/** Book a prospect's journey into an OPEN slot. Mirrors journey.sssAt to the slot instant. */
export async function bookJourneyIntoSlot(journeyId: string, slotId: string): Promise<SssActionResult> {
  const slot = await prisma.sssSlot.findUnique({ where: { id: slotId }, select: { id: true, status: true, startsAt: true } });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status !== "OPEN") return { ok: false, error: "That slot isn't open" };

  const ok = await prisma
    .$transaction(async (tx) => {
      // Vacate any slot this journey already sits in FIRST — journeyId is unique, so the target
      // can't take it until it's free. Throw (not return) on a lost race so the vacate rolls back.
      await tx.sssSlot.updateMany({ where: { journeyId }, data: { status: "OPEN", journeyId: null } });
      const claim = await tx.sssSlot.updateMany({
        where: { id: slot.id, status: "OPEN" },
        data: { status: "BOOKED", journeyId },
      });
      if (claim.count === 0) throw new Error("slot-taken");
      await tx.outreachJourney.update({
        where: { id: journeyId },
        data: { sssAt: slot.startsAt, salesCallConfirmed: false, salesCallConfirmedAt: null },
      });
      return true;
    })
    .catch(() => false);
  return ok ? { ok: true } : { ok: false, error: "That slot was just taken — pick another" };
}

/**
 * Relocate a journey onto `toSlotId`, freeing its current slot to `freeOldTo` (OPEN for a move,
 * BLOCKED when the current slot is the one being blocked). Resets confirmation. Returns success.
 */
async function relocate(journeyId: string, toSlotId: string, freeOldTo: "OPEN" | "BLOCKED"): Promise<{ ok: boolean; newStartsAt?: Date }> {
  const target = await prisma.sssSlot.findUnique({ where: { id: toSlotId }, select: { id: true, status: true, startsAt: true } });
  if (!target || target.status !== "OPEN") return { ok: false };

  const done = await prisma
    .$transaction(async (tx) => {
      // Free the journey's previous slot(s) FIRST (freeOldTo = OPEN for a move, BLOCKED when the old
      // slot is the one being blocked) so the unique journeyId is available for the target. Throw on
      // a lost claim so the free rolls back and the prospect keeps their original slot.
      await tx.sssSlot.updateMany({
        where: { journeyId, id: { not: target.id } },
        data: { status: freeOldTo, journeyId: null },
      });
      const claim = await tx.sssSlot.updateMany({
        where: { id: target.id, status: "OPEN" },
        data: { status: "BOOKED", journeyId },
      });
      if (claim.count === 0) throw new Error("slot-taken");
      await tx.outreachJourney.update({
        where: { id: journeyId },
        data: { sssAt: target.startsAt, salesCallConfirmed: false, salesCallConfirmedAt: null },
      });
      return true;
    })
    .catch(() => false);
  return done ? { ok: true, newStartsAt: target.startsAt } : { ok: false };
}

/** The next OPEN same-owner slot after now, within the reschedule window, excluding one id. */
async function findNextOpenSlot(ownerId: string | null, withinDays: number, excludeSlotId: string) {
  const now = new Date();
  return prisma.sssSlot.findFirst({
    where: {
      status: "OPEN",
      ownerId,
      id: { not: excludeSlotId },
      startsAt: { gt: now, lte: new Date(now.getTime() + withinDays * 24 * HR) },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
}

/**
 * Manual / drag reschedule: move a booked prospect onto a specific OPEN slot, then WhatsApp them.
 */
export async function moveJourneyToSlot(journeyId: string, toSlotId: string, sentById?: string | null): Promise<SssActionResult> {
  const res = await relocate(journeyId, toSlotId, "OPEN");
  if (!res.ok) return { ok: false, error: "That slot was just taken — pick another" };
  await sendSssRescheduled(journeyId, sentById);
  return { ok: true };
}

export type BlockResult =
  | { ok: true; moved: boolean; movedTo?: string; orphaned: boolean }
  | { ok: false; error: string };

/**
 * Block one slot. If it holds a prospect, relocate them to the next open same-owner slot first
 * (WhatsApp + confirmation reset); with none in range, detach them (they land on the needs-
 * scheduling list) and block anyway. An already-blocked slot is a no-op.
 */
export async function blockSssSlot(slotId: string, sentById?: string | null): Promise<BlockResult> {
  const slot = await prisma.sssSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, ownerId: true, journeyId: true },
  });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status === "BLOCKED") return { ok: true, moved: false, orphaned: false };

  if (slot.status === "OPEN" || !slot.journeyId) {
    await prisma.sssSlot.updateMany({ where: { id: slot.id, status: { not: "BOOKED" } }, data: { status: "BLOCKED", journeyId: null } });
    // If it flipped to BOOKED between read and here, fall through to the booked path.
    const after = await prisma.sssSlot.findUnique({ where: { id: slot.id }, select: { status: true, journeyId: true } });
    if (after?.status === "BLOCKED") return { ok: true, moved: false, orphaned: false };
  }

  // BOOKED: try to relocate the prospect to the next open slot, blocking this one in the same move.
  const journeyId = slot.journeyId;
  if (!journeyId) {
    await prisma.sssSlot.update({ where: { id: slot.id }, data: { status: "BLOCKED", journeyId: null } });
    return { ok: true, moved: false, orphaned: false };
  }

  const { rescheduleWithinDays } = await getSssConfig();
  const next = await findNextOpenSlot(slot.ownerId, rescheduleWithinDays, slot.id);
  if (next) {
    const res = await relocate(journeyId, next.id, "BLOCKED");
    if (res.ok) {
      await sendSssRescheduled(journeyId, sentById);
      return { ok: true, moved: true, movedTo: next.id, orphaned: false };
    }
  }

  // No open slot in range (or the relocate raced) → detach the prospect and block. They appear on
  // the needs-scheduling list; clearing sssAt stops the SSS confirmation ladder chasing a dead time.
  await prisma.$transaction(async (tx) => {
    await tx.sssSlot.update({ where: { id: slot.id }, data: { status: "BLOCKED", journeyId: null } });
    await tx.outreachJourney.update({
      where: { id: journeyId },
      data: { sssAt: null, salesCallConfirmed: false, salesCallConfirmedAt: null },
    });
  });
  return { ok: true, moved: false, orphaned: true };
}

/** Re-open a blocked slot. */
export async function unblockSssSlot(slotId: string): Promise<SssActionResult> {
  const slot = await prisma.sssSlot.findUnique({ where: { id: slotId }, select: { status: true } });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status !== "BLOCKED") return { ok: false, error: "That slot isn't blocked" };
  await prisma.sssSlot.update({ where: { id: slotId }, data: { status: "OPEN" } });
  return { ok: true };
}

export type BlockDayResult = { ok: true; blocked: number; moved: number; orphaned: number } | { ok: false; error: string };

/**
 * Block a whole IST day for one owner — the "I'm out on Thursday" fast path. Blocks every OPEN slot
 * and reschedules every BOOKED one, reporting how many moved vs. couldn't be placed.
 */
export async function blockSssDay(ownerId: string, dayKey: string, sentById?: string | null): Promise<BlockDayResult> {
  const dayStart = istWallToUtc(dayKey, "00:00");
  if (!Number.isFinite(dayStart.getTime())) return { ok: false, error: "Bad date" };
  const dayEnd = new Date(dayStart.getTime() + 24 * HR);

  const slots = await prisma.sssSlot.findMany({
    where: { ownerId, status: { not: "BLOCKED" }, startsAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });

  let blocked = 0;
  let moved = 0;
  let orphaned = 0;
  for (const s of slots) {
    const res = await blockSssSlot(s.id, sentById);
    if (res.ok) {
      blocked++;
      if (res.moved) moved++;
      if (res.orphaned) orphaned++;
    }
  }
  return { ok: true, blocked, moved, orphaned };
}

/** Delete an OPEN or BLOCKED slot. A BOOKED slot must be freed (block/move the prospect) first. */
export async function deleteSssSlot(slotId: string): Promise<SssActionResult> {
  const slot = await prisma.sssSlot.findUnique({ where: { id: slotId }, select: { status: true } });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status === "BOOKED") return { ok: false, error: "Move or block the booked prospect before deleting this slot" };
  await prisma.sssSlot.delete({ where: { id: slotId } });
  return { ok: true };
}
