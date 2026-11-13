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

export type CalendarQuery = { from: Date; to: Date; ownerIds?: string[]; types?: CalType[] };

export async function getCalendarEvents(q: CalendarQuery): Promise<CalEvent[]> {
  const want = (t: CalType) => !q.types || q.types.includes(t);
  const owner = { select: { id: true, name: true } } as const;
  const discoOwner = q.ownerIds ? { assignedToId: { in: q.ownerIds } } : {};
  const range = { gte: q.from, lt: q.to };

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
            ...(q.ownerIds ? { slot: { assignedToId: { in: q.ownerIds } } } : {}),
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
          where: { startsAt: range, status: { not: "OPEN" }, ...(q.ownerIds ? { ownerId: { in: q.ownerIds } } : {}) },
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
  return buildCalendarEvents({ slots, releases, sss }, team);
}
