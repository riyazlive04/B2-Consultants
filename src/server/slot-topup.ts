import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { slotStartsForRange } from "@/lib/slot-plan";
import { getBookingCalendars, getBookingRulesConfig } from "./founder-config";

/**
 * Keep every named booking calendar stocked to a rolling horizon.
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
  | { ran: true; created: number; horizonTo: string; alreadyPresent: number; perCalendar: CalendarTopUp[] };

/** What one named calendar contributed to this tick, so an idle one can be told from a full one. */
export type CalendarTopUp = { id: string; name: string; created: number; skipped?: string };

export async function ensureBookingSlots(): Promise<SlotTopUpResult> {
  const calendars = await getBookingCalendars();
  const live = calendars.filter((c) => c.enabled);
  if (!calendars.length) return { ran: false, reason: "no calendars configured" };
  if (!live.length) return { ran: false, reason: "every calendar is switched off" };

  const rules = await getBookingRulesConfig();
  const today = istToday();
  const earliest = Date.now() + rules.minNoticeHours * 3_600_000;

  /**
   * Every instant that already has a slot, keyed by owner as well as time.
   *
   * ── The bug multi-calendar would otherwise have shipped with ──────────────────
   * Dedupe used to be on `startsAt` alone, which was correct while one pattern owned the whole
   * calendar. With a calendar per person it silently breaks: Asma already holding 18:00 would
   * mark 18:00 "taken" for Ameen too, so the second calendar could never generate a slot at any
   * time the first one already ran — and the failure looks exactly like the pattern not working.
   * Two people being free at once is the normal case, not a collision.
   */
  const horizonAll = new Date(today);
  horizonAll.setUTCDate(today.getUTCDate() + rules.maxAdvanceDays);
  const existing = await prisma.appointmentSlot.findMany({
    where: { startsAt: { gte: new Date(earliest), lte: horizonAll } },
    select: { startsAt: true, assignedToId: true },
  });
  const key = (t: number, owner: string | null) => `${t}|${owner ?? ""}`;
  const taken = new Set(existing.map((s) => key(s.startsAt.getTime(), s.assignedToId)));

  const perCalendar: CalendarTopUp[] = [];
  let created = 0;
  let alreadyPresent = 0;
  let furthest = today;

  for (const cal of live) {
    if (!cal.weekdays.length) {
      perCalendar.push({ id: cal.id, name: cal.name, created: 0, skipped: "no weekdays configured" });
      continue;
    }

    /**
     * Never generate past the window the public page will actually offer. `maxAdvanceDays` is the
     * founder's "how far ahead may a prospect book" rule; slots beyond it would be invisible rows
     * that still have to be paged through in the admin calendar forever.
     */
    const horizonDays = Math.min(cal.horizonDays, rules.maxAdvanceDays);
    const horizonEnd = new Date(today);
    horizonEnd.setUTCDate(today.getUTCDate() + horizonDays);
    if (horizonEnd > furthest) furthest = horizonEnd;

    const starts = slotStartsForRange({
      startDate: toDateInputValue(today),
      endDate: toDateInputValue(horizonEnd),
      pattern: cal,
      bufferMinutes: rules.bufferMinutes,
      istWallToUtc,
      parseDate: parseDateInput,
      formatDate: toDateInputValue,
    });
    if (!starts.length) {
      perCalendar.push({ id: cal.id, name: cal.name, created: 0, skipped: "pattern fits no slots in the horizon" });
      continue;
    }

    /**
     * Drop instants that have already passed, and those inside the minimum-notice window. Without
     * this the job would helpfully create a slot for 15:00 today at 16:00, which no prospect can
     * book and which then sits in the calendar as permanent noise.
     */
    const bookable = starts.filter((s) => s.getTime() >= earliest);
    if (!bookable.length) {
      perCalendar.push({ id: cal.id, name: cal.name, created: 0, skipped: "whole horizon is inside the notice window" });
      continue;
    }

    const owner = cal.assignedToId || null;
    const fresh = bookable.filter((s) => !taken.has(key(s.getTime(), owner)));
    alreadyPresent += bookable.length - fresh.length;

    if (fresh.length) {
      await prisma.appointmentSlot.createMany({
        data: fresh.map((startsAt) => ({ startsAt, durationMins: cal.durationMins, assignedToId: owner })),
        // Belt and braces against a concurrent manual generation racing this tick. The dedupe
        // above is a read-then-write, so it is not atomic; the calendar has no unique index on
        // startsAt (two callers may legitimately hold the same slot time), so this only guards
        // against an exact duplicate row, which is the case that matters.
        skipDuplicates: true,
      });
      // Claim them in-memory too, so a second calendar sharing this owner in the same tick
      // cannot re-create the instants this one just wrote.
      for (const s of fresh) taken.add(key(s.getTime(), owner));
    }

    created += fresh.length;
    perCalendar.push({ id: cal.id, name: cal.name, created: fresh.length });
  }

  return { ran: true, created, alreadyPresent, horizonTo: toDateInputValue(furthest), perCalendar };
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
