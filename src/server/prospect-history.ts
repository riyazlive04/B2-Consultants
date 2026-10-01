import "server-only";
import { prisma } from "@/lib/prisma";
import {
  summariseProspectHistory,
  type BookingOutcome,
  type ProspectHistory,
} from "@/lib/prospect-history";

/**
 * "Have we met this person before?", answered from what the database already knew.
 *
 * The summarising is pure and tested (lib/prospect-history); this does the reads and nothing
 * else. Both entry points are BATCHED on purpose: the bookings table renders 300 rows, and the
 * obvious per-row version of this is 900 extra round trips to Singapore - which on a table nobody
 * asked to be slower is how a useful column becomes a reason to remove it.
 */

/**
 * The raw material for a set of leads, read once.
 *
 * Kept separate from the summarising because the exclusion is PER BOOKING, not per lead: a lead
 * with two bookings on screen needs two different summaries, each leaving its own row out. Keying
 * the exclusion by lead - which is what this did first - gave both rows the same history, so the
 * no-show row cheerfully reported "1 attended" and said nothing about the miss.
 */
async function readProspectMaterial(ids: string[]) {
  const [bookings, scores, emails, leads] = await Promise.all([
    prisma.bookingRequest.findMany({
      where: { leadId: { in: ids } },
      select: {
        id: true, leadId: true, email: true, status: true, createdAt: true,
        bantAvg: true, bantVerdict: true,
        slot: { select: { startsAt: true } },
        // A cancelled booking has no slot any more, so the time it HELD is the only record of
        // when the call would have been - see SlotRelease.
        slotReleases: { orderBy: { createdAt: "desc" }, take: 1, select: { slotStartsAt: true } },
      },
    }),
    prisma.leadScoreEvent.findMany({
      where: { leadId: { in: ids } },
      orderBy: { scoredAt: "desc" },
      select: { leadId: true, scoredAt: true, avg: true, score: true, verdict: true, source: true },
    }),
    prisma.leadEmail.findMany({
      where: { leadId: { in: ids } },
      select: { leadId: true, email: true, emailKey: true, lastSeenAt: true, timesSeen: true },
    }),
    // The address we currently write to, so the list can say which one that is.
    prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
  ]);

  const primaryKey = new Map(
    leads.map((l) => [l.id, (l.email ?? "").trim().toLowerCase()] as const),
  );
  const group = <T extends { leadId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.leadId) continue;
      const list = m.get(r.leadId);
      if (list) list.push(r);
      else m.set(r.leadId, [r]);
    }
    return m;
  };
  const bookingsBy = group(bookings);
  const scoresBy = group(scores);
  const emailsBy = group(emails);

  /** Summarise one lead, optionally leaving one of its own bookings out. */
  return (id: string, excludeBookingId: string | null): ProspectHistory =>
    summariseProspectHistory({
      bookings: (bookingsBy.get(id) ?? []).map((b) => ({
        id: b.id,
        at: b.slot?.startsAt ?? b.slotReleases[0]?.slotStartsAt ?? null,
        status: b.status as BookingOutcome,
        email: b.email || null,
        bantAvg: b.bantAvg,
        bantVerdict: b.bantVerdict,
      })),
      excludeBookingId,
      scores: (scoresBy.get(id) ?? []).map((s) => ({
        at: s.scoredAt,
        avg: s.avg,
        score: s.score,
        verdict: s.verdict,
        source: s.source,
      })),
      emails: (emailsBy.get(id) ?? []).map((e) => ({
        email: e.email,
        lastSeenAt: e.lastSeenAt,
        timesSeen: e.timesSeen,
        primary: e.emailKey === primaryKey.get(id),
      })),
    });
}

const EMPTY: ProspectHistory = {
  returning: false, previous: [], attended: 0, noShows: 0, cancelled: 0,
  upcoming: 0, lastOutcome: null, scores: [], emails: [], headline: "",
};

/**
 * History for a table of bookings, keyed by BOOKING id.
 *
 * Each row leaves ITSELF out, which is the whole point: on a lead with two bookings on screen,
 * one row should read "1 no-show" and the other "1 attended", because each is describing what
 * came before it. Keying the exclusion by lead instead - the first shape of this - gave both rows
 * the same summary, so the no-show row reported "1 attended" and said nothing about the miss.
 */
export async function prospectHistoryForBookings(
  rows: readonly { bookingId: string; leadId: string | null }[],
): Promise<Map<string, ProspectHistory>> {
  const ids = [...new Set(rows.map((r) => r.leadId).filter((id): id is string => !!id))];
  const out = new Map<string, ProspectHistory>();
  if (ids.length === 0) return out;
  const summarise = await readProspectMaterial(ids);
  for (const r of rows) out.set(r.bookingId, r.leadId ? summarise(r.leadId, r.bookingId) : EMPTY);
  return out;
}

/** One lead - the contact record. Every booking counts here; nothing is on screen to exclude. */
export async function prospectHistory(leadId: string): Promise<ProspectHistory> {
  const summarise = await readProspectMaterial([leadId]);
  return summarise(leadId, null);
}
