/**
 * One bookable time per instant, for the calendars that show a SHARED pool.
 *
 * ── The duplicate nobody could explain ─────────────────────────────────────────
 * `AppointmentSlot` has no unique index on `startsAt`, and that is correct: two coaches can both
 * be free at 18:00, and each needs their own row so the funnel step named after one of them can
 * offer that person's diary. The per-owner calendars rely on it.
 *
 * The shared pools do not. `/book` queries every OPEN slot regardless of owner, and a funnel
 * `booking` block with no owner set does the same through `getStepCalendars("")`. Both then
 * rendered one button per ROW, so the moment a second coach's horizon overlapped the first, the
 * public page grew pairs of identical buttons - live it was offering "18:00 18:00 18:45 18:45
 * 19:30 19:30 20:15 20:15". A prospect cannot tell them apart, because there is nothing to tell:
 * the choice between them is a coin flip the page is asking them to make.
 *
 * So a shared pool collapses to one row per instant. The number of bookable times is unchanged -
 * this removes duplicates, never availability - and each surviving row is a real slot id, so
 * `submitBooking` still claims a genuine row and still re-checks it is OPEN.
 */

/** The little a pool needs to know about a slot. Anything wider passes through untouched. */
export type PoolSlot = { startsAt: Date; assignedToId?: string | null };

/**
 * Collapse a shared pool to one slot per start instant, keeping the input order.
 *
 * `preferOwnerId` is the host the surface is ABOUT - `/book` names the person who owns most of
 * the pool in its heading ("Personalized Discovery Call with Ameen"), so when two rows share an
 * instant, keeping theirs is the only choice that makes the page's own promise true. Failing
 * that an assigned row beats an unassigned one, because a call with a named host beats a call
 * nobody owns; otherwise the first row wins, which keeps the result stable across requests.
 */
export function oneSlotPerInstant<T extends PoolSlot>(rows: readonly T[], preferOwnerId?: string | null): T[] {
  const best = new Map<number, T>();
  const order: number[] = [];

  for (const row of rows) {
    const at = row.startsAt.getTime();
    const held = best.get(at);
    if (!held) {
      best.set(at, row);
      order.push(at);
      continue;
    }
    if (rank(row, preferOwnerId) > rank(held, preferOwnerId)) best.set(at, row);
  }

  return order.map((at) => best.get(at)!);
}

/** 2 = the host this surface is about, 1 = somebody, 0 = nobody. Ties keep the incumbent. */
function rank(row: PoolSlot, preferOwnerId?: string | null): number {
  const owner = row.assignedToId ?? null;
  if (preferOwnerId && owner === preferOwnerId) return 2;
  return owner ? 1 : 0;
}
