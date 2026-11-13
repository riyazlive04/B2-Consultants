import "server-only";

import { prisma } from "@/lib/prisma";
import {
  calendarRef, discoStatus, eventTitle, ownerColor, releaseStatus,
  type CalEvent, type CalType,
} from "@/lib/calendar-event";

/**
 * Everything on the Calendars grid for [from, to): booked + blocked Discovery slots, the cancelled /
 * no-show ghosts of released Discovery bookings, and booked + blocked SSS slots. OPEN slots are not
 * events (Synamate hides them; the Book modal lists them instead).
 *
 * Read-only. Writes stay with booking-actions / sss-actions.
 */

type Owner = { id: string; name: string | null } | null;
type Team = { id: string; name: string | null }[];

export type SlotRow = {
  id: string; startsAt: Date; durationMins: number; status: string; assignedTo: Owner;
  booking: {
    id: string; name: string; email: string; phone: string; leadId: string | null;
    status: string; confirmedAt: Date | null;
  } | null;
};
export type ReleaseRow = {
  id: string; slotStartsAt: Date; durationMins: number; prospectName: string; reason: string;
  releasedStatus: string; slotId: string | null;
  slot: { assignedTo: Owner } | null;
  bookingRequest: { id: string; email: string; phone: string; leadId: string | null } | null;
};
export type SssRow = {
  id: string; startsAt: Date; durationMins: number; status: string; owner: Owner;
  journey: {
    id: string; leadId: string; salesCallConfirmed: boolean;
    lead: { name: string | null; email: string | null; phone: string | null } | null;
  } | null;
};

const end = (start: Date, mins: number) => new Date(start.getTime() + mins * 60_000).toISOString();

/** Pure row → event mapping, kept separate from the queries so it is unit-tested. */
export function buildCalendarEvents(rows: { slots: SlotRow[]; releases: ReleaseRow[]; sss: SssRow[] }, team: Team): CalEvent[] {
  const idx = new Map(team.map((u, i) => [u.id, i]));
  const base = (type: CalType, owner: Owner, startsAt: Date, mins: number) => {
    const i = owner ? idx.get(owner.id) ?? -1 : -1;
    return {
      calendar: calendarRef(type, owner, i),
      ownerId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      ownerColor: ownerColor(i),
      startsAt: startsAt.toISOString(),
      endsAt: end(startsAt, mins),
    };
  };
  const blocked = (table: "slot" | "sss", id: string, type: CalType, owner: Owner, startsAt: Date, mins: number): CalEvent => ({
    id: `${table}:${id}`, kind: "BLOCKED", ...base(type, owner, startsAt, mins), title: "Busy", contact: null,
    status: "CONFIRMED", source: { table, id },
  });

  const out: CalEvent[] = [];
  const ghosts = new Set<string>(); // slot ids a release turned BLOCKED (late cancel / no-show)

  for (const r of rows.releases) {
    const status = releaseStatus(r.reason);
    if (!status) continue;
    const owner = r.slot?.assignedTo ?? null;
    if (r.slotId && r.releasedStatus === "BLOCKED") ghosts.add(`${r.slotId}@${r.slotStartsAt.getTime()}`);
    out.push({
      id: `release:${r.id}`, kind: "APPOINTMENT", ...base("DISCO", owner, r.slotStartsAt, r.durationMins),
      title: eventTitle("DISCO", r.prospectName, owner?.name ?? null),
      contact: {
        name: r.prospectName, phone: r.bookingRequest?.phone ?? null,
        email: r.bookingRequest?.email ?? null, leadId: r.bookingRequest?.leadId ?? null,
      },
      status,
      source: { table: "release", id: r.id, bookingId: r.bookingRequest?.id },
    });
  }

  for (const s of rows.slots) {
    if (s.status === "OPEN") continue;
    const b = s.booking;
    if (s.status === "BLOCKED" || !b) {
      // A slot blocked BY a release is already drawn as that release's cancelled card.
      if (!ghosts.has(`${s.id}@${s.startsAt.getTime()}`)) out.push(blocked("slot", s.id, "DISCO", s.assignedTo, s.startsAt, s.durationMins));
      continue;
    }
    out.push({
      id: `slot:${s.id}`, kind: "APPOINTMENT", ...base("DISCO", s.assignedTo, s.startsAt, s.durationMins),
      title: eventTitle("DISCO", b.name, s.assignedTo?.name ?? null),
      contact: { name: b.name, phone: b.phone, email: b.email, leadId: b.leadId },
      status: discoStatus(b.status, b.confirmedAt !== null),
      source: { table: "slot", id: s.id, bookingId: b.id },
    });
  }

  for (const s of rows.sss) {
    if (s.status === "OPEN") continue;
    const j = s.journey;
    if (s.status === "BLOCKED" || !j) {
      out.push(blocked("sss", s.id, "SSS", s.owner, s.startsAt, s.durationMins));
      continue;
    }
    const name = j.lead?.name?.trim() || "Prospect";
    out.push({
      id: `sss:${s.id}`, kind: "APPOINTMENT", ...base("SSS", s.owner, s.startsAt, s.durationMins),
      title: eventTitle("SSS", name, s.owner?.name ?? null),
      contact: { name, phone: j.lead?.phone ?? null, email: j.lead?.email ?? null, leadId: j.leadId },
      status: j.salesCallConfirmed ? "CONFIRMED" : "UNCONFIRMED",
      source: { table: "sss", id: s.id, journeyId: j.id },
    });
  }

  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export type CalendarQuery = {
  from: Date;
  to: Date;
  /** Owner ids to keep. `""` means "also unassigned". Undefined = everyone. */
  ownerIds?: string[];
  /** Owner ids to drop, when the filter is phrased as "everyone except" (see lib/calendar-filters). */
  excludeOwnerIds?: string[];
  types?: CalType[];
  kinds?: CalEvent["kind"][];
};

export async function getCalendarEvents(q: CalendarQuery): Promise<CalEvent[]> {
  const want = (t: CalType) => !q.types || q.types.includes(t);
  const owner = { select: { id: true, name: true } } as const;
  const range = { gte: q.from, lt: q.to };
  /**
   * An unassigned slot has a NULL owner, which `in: [...]` never matches - so ticking
   * "Unassigned" has to ask for the null explicitly or those entries silently vanish.
   */
  const ownerWhere = (field: "assignedToId" | "ownerId") => {
    if (q.ownerIds) {
      const ids = q.ownerIds.filter(Boolean);
      return q.ownerIds.includes("")
        ? { OR: [{ [field]: { in: ids } }, { [field]: null }] }
        : { [field]: { in: ids } };
    }
    if (q.excludeOwnerIds?.length) {
      const ids = q.excludeOwnerIds.filter(Boolean);
      // `notIn` is false for NULL in SQL, so an unassigned slot would be dropped by a filter that
      // never mentioned it - the null has to be allowed back in explicitly unless it was excluded.
      const keepNull = !q.excludeOwnerIds.includes("");
      return keepNull ? { OR: [{ [field]: { notIn: ids } }, { [field]: null }] } : { [field]: { notIn: ids } };
    }
    return {};
  };
  const discoOwner = ownerWhere("assignedToId");
  const narrowed = Boolean(q.ownerIds || q.excludeOwnerIds?.length);

  const [team, slots, releases, sss] = await Promise.all([
    // Colour index = position in the name-sorted active team, so a person keeps one colour everywhere.
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    want("DISCO")
      ? prisma.appointmentSlot.findMany({
          where: { startsAt: range, status: { not: "OPEN" }, ...discoOwner },
          select: {
            id: true, startsAt: true, durationMins: true, status: true, assignedTo: owner,
            booking: { select: { id: true, name: true, email: true, phone: true, leadId: true, status: true, confirmedAt: true } },
          },
        })
      : [],
    want("DISCO")
      ? prisma.slotRelease.findMany({
          where: {
            slotStartsAt: range, reason: { not: "POSTPONED" },
            ...(narrowed ? { slot: ownerWhere("assignedToId") } : {}),
          },
          select: {
            id: true, slotStartsAt: true, durationMins: true, prospectName: true, reason: true,
            releasedStatus: true, slotId: true, slot: { select: { assignedTo: owner } },
            bookingRequest: { select: { id: true, email: true, phone: true, leadId: true } },
          },
        })
      : [],
    want("SSS")
      ? prisma.sssSlot.findMany({
          where: { startsAt: range, status: { not: "OPEN" }, ...ownerWhere("ownerId") },
          select: {
            id: true, startsAt: true, durationMins: true, status: true, owner,
            journey: {
              select: {
                id: true, leadId: true, salesCallConfirmed: true,
                lead: { select: { name: true, email: true, phone: true } },
              },
            },
          },
        })
      : [],
  ]);
  const events = buildCalendarEvents({ slots, releases, sss }, team);
  // Appointments-vs-blocked is decided after building, not in SQL: a cancelled call comes from
  // SlotRelease while its slot may be BLOCKED, so the two cannot be told apart by slot status.
  return q.kinds ? events.filter((e) => q.kinds!.includes(e.kind)) : events;
}
