import "server-only";

import { prisma } from "@/lib/prisma";
import type { Block } from "@/lib/sites-types";
import { getBookingRulesConfig } from "./founder-config";
import type { CalendarSlot } from "@/components/booking/BookingCalendar";

/**
 * Open discovery slots for the `booking` blocks on a funnel step.
 *
 * ── Why per-owner, and why that is new ──────────────────────────────────────────
 * `AppointmentSlot.assignedToId` has existed since the slot table did, but `/book` never used it:
 * it queried every OPEN slot, so one shared pool was shown to everyone. The funnel needs the
 * opposite - Asma's page must offer Asma's times and Ameen's must offer Ameen's, or the
 * "Personalized Discovery Call with X" heading is a lie and prospects book a call with whoever
 * happens to be free.
 *
 * ── Availability is read per request, never cached ──────────────────────────────
 * The page is `force-dynamic`, and this is the reason. A slot list held for even a minute is a
 * window in which two people can be shown the same time; `submitBooking` still guards the write,
 * but the prospect who loses that race gets an error instead of a booking.
 */

export type StepCalendars = Record<string, CalendarSlot[]>;

/** The key a block's slots are filed under. `""` is the unscoped "anyone" pool. */
export function calendarKey(ownerId: string | undefined | null): string {
  return ownerId ?? "";
}

/** Every distinct owner referenced by a `booking` block anywhere in the tree, including chrome. */
export function collectBookingOwnerIds(list: Block[]): string[] {
  return list.flatMap((b) => [
    ...(b.type === "booking" ? [calendarKey(b.bookingOwnerId)] : []),
    ...collectBookingOwnerIds(b.children ?? []),
    ...collectBookingOwnerIds((b.columns ?? []).flat()),
  ]);
}

/**
 * Load the open slots for each requested owner, in one query.
 *
 * Returns a map keyed the same way `collectBookingOwnerIds` reports, so the renderer can look up
 * a block's slots without knowing anything about how they were fetched. An owner with no open
 * slots gets an empty array rather than being absent - the widget renders "no times are open"
 * rather than disappearing, which is the honest thing to show.
 */
export async function getStepCalendars(keys: string[]): Promise<StepCalendars> {
  const wanted = [...new Set(keys)];
  if (!wanted.length) return {};

  // The founder-configurable booking window (§9/§13): hide slots too soon to be booked and ones
  // too far out to be worth showing. Shared with /book so both surfaces agree on what is bookable.
  const rules = await getBookingRulesConfig();
  const now = Date.now();
  const earliest = new Date(now + rules.minNoticeHours * 3_600_000);
  const latest = new Date(now + rules.maxAdvanceDays * 86_400_000);

  const ownerIds = wanted.filter(Boolean);
  const wantsAnyone = wanted.includes("");

  const rows = await prisma.appointmentSlot.findMany({
    where: {
      status: "OPEN",
      startsAt: { gt: earliest, lte: latest },
      // Only narrow by owner when nothing asked for the unscoped pool; if any block wants
      // "anyone", we need the full set anyway and filter per key below.
      ...(wantsAnyone ? {} : { assignedToId: { in: ownerIds } }),
    },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, durationMins: true, assignedToId: true },
  });

  const out: StepCalendars = {};
  for (const key of wanted) {
    out[key] = rows
      .filter((r) => (key === "" ? true : r.assignedToId === key))
      .map((r) => ({
        id: r.id,
        startsAtIso: r.startsAt.toISOString(),
        durationMins: r.durationMins,
      }));
  }
  return out;
}
