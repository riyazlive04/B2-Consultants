import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";

/**
 * Per-user work time, stored server-side one row per IST calendar day.
 *
 * The widget used to keep its whole history in localStorage under a single
 * un-scoped key, which meant a new device, a cleared browser or a second person
 * on the same machine all produced wrong totals. The browser is now just a
 * stopwatch that reports elapsed seconds; the DB owns the history.
 */

/** How many seconds one heartbeat may add. Guards against a client that sleeps,
 *  wakes with a huge delta, and books eight phantom hours in one call. */
const MAX_HEARTBEAT_SEC = 15 * 60;

/** A day can never exceed 24h, however many tabs or devices report into it. */
const MAX_DAY_SEC = 24 * 3600;

export type WorkDayRow = { day: string; seconds: number };

/** Local YYYY-MM-DD for a UTC-midnight @db.Date value. */
export function dayKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday->Sunday keys for the IST week containing `ref`. */
export function istWeekKeys(ref = istToday()): string[] {
  const dow = (ref.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return dayKeyOf(d);
  });
}

/**
 * Add elapsed seconds to today's row. Upsert keyed on [userId, day], with the
 * increment done by the DB so two tabs (or a tab and a phone) racing the same
 * heartbeat can't clobber each other's read-modify-write.
 */
export async function addWorkSeconds(userId: string, seconds: number): Promise<number> {
  const delta = Math.floor(Number(seconds));
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  const capped = Math.min(delta, MAX_HEARTBEAT_SEC);
  const day = istToday();

  const row = await prisma.workDay.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, seconds: capped },
    update: { seconds: { increment: capped } },
    select: { seconds: true },
  });

  // Clamp only if a day somehow overshoots; the common path never rewrites.
  if (row.seconds > MAX_DAY_SEC) {
    const fixed = await prisma.workDay.update({
      where: { userId_day: { userId, day } },
      data: { seconds: MAX_DAY_SEC },
      select: { seconds: true },
    });
    return fixed.seconds;
  }
  return row.seconds;
}

/** Zero today's row for a user. Scoped to their own day — never anyone else's. */
export async function resetToday(userId: string): Promise<void> {
  const day = istToday();
  await prisma.workDay.updateMany({ where: { userId, day }, data: { seconds: 0 } });
}

/** Raw day rows for a user, newest-last, over the trailing `days` window. */
export async function getWorkDays(userId: string, days = 28): Promise<WorkDayRow[]> {
  const since = new Date(istToday());
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const rows = await prisma.workDay.findMany({
    where: { userId, day: { gte: since } },
    select: { day: true, seconds: true },
    orderBy: { day: "asc" },
  });
  return rows.map((r) => ({ day: dayKeyOf(r.day), seconds: r.seconds }));
}

/**
 * Everything the dashboard widget needs: the day-keyed map it renders from,
 * plus today's total. React.cache'd so layout and page share one query.
 */
export const getMyWorkTime = cache(async (userId: string) => {
  const rows = await getWorkDays(userId);
  const byDay: Record<string, number> = {};
  for (const r of rows) byDay[r.day] = r.seconds;

  const today = dayKeyOf(istToday());
  return { byDay, todaySec: byDay[today] ?? 0, today };
});
