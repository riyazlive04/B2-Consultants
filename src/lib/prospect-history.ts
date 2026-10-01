/**
 * What we already know about someone who has turned up before.
 *
 * ── Why this is its own thing ────────────────────────────────────────────────────
 * Every part of this was already in the database and none of it was on screen. A prospect could
 * book a call, not turn up, book again two months later from a different email, and the person
 * about to dial them saw a first-time booking: same blank row, same cold opener. The bookings are
 * on the lead, the no-show is a `BookingStatus`, the scores are on the lead and its bookings - the
 * data was never missing, just never assembled.
 *
 * So this assembles it, and it is deliberately pure: the counting and the headline are the part
 * worth testing, and they are also the part that is easy to get subtly wrong (counting the
 * booking you are looking at as one of its own predecessors, calling a cancellation a no-show).
 * The server module does the reads and hands the rows here.
 *
 * ── The distinctions that matter ─────────────────────────────────────────────────
 * CANCELLED and NO_SHOW are not the same thing and must never be summed. Someone who cancelled
 * told us; someone who no-showed did not. The first is a rescheduling conversation, the second is
 * a reason to confirm harder before holding a slot - which is exactly what the confirm-or-cancel
 * loop is for.
 */

export type BookingOutcome = "BOOKED" | "RESCHEDULED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

export type PriorBooking = {
  id: string;
  /** When the call was (or would have been). Null only when a booking never had a slot. */
  at: Date | null;
  status: BookingOutcome;
  /** The address used on THAT booking - how you see they have moved mailbox. */
  email: string | null;
  bantAvg: number | null;
  bantVerdict: string | null;
};

export type ScoreReading = {
  at: Date;
  avg: number | null;
  score: number | null;
  verdict: string | null;
  source: string;
};

export type KnownEmail = {
  email: string;
  lastSeenAt: Date;
  timesSeen: number;
  /** True for the address we currently write to. */
  primary: boolean;
};

export type ProspectHistory = {
  /** True when there is anything here worth showing. */
  returning: boolean;
  /** Bookings OTHER than the one being looked at, newest first. */
  previous: PriorBooking[];
  attended: number;
  noShows: number;
  cancelled: number;
  /** Still to happen, so "they have a call already" is answerable. */
  upcoming: number;
  /** The most recent booking that actually resolved - what "last time" means. */
  lastOutcome: PriorBooking | null;
  /** Newest first. More than one means their qualification has moved. */
  scores: ScoreReading[];
  emails: KnownEmail[];
  /** One line for a table row: "3rd booking · 1 no-show · was DOUBT". */
  headline: string;
};

const RESOLVED: ReadonlySet<BookingOutcome> = new Set(["COMPLETED", "NO_SHOW", "CANCELLED"]);

function ordinal(n: number): string {
  // 11th/12th/13th are the reason this is not just a lookup on the last digit.
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function summariseProspectHistory(input: {
  /** Every booking on this lead, including the one on screen. */
  bookings: PriorBooking[];
  /** The booking being looked at, excluded from its own history. Omit on a contact page. */
  excludeBookingId?: string | null;
  scores?: ScoreReading[];
  emails?: KnownEmail[];
  now?: Date;
}): ProspectHistory {
  const now = input.now ?? new Date();
  const previous = input.bookings
    .filter((b) => b.id !== input.excludeBookingId)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  const attended = previous.filter((b) => b.status === "COMPLETED").length;
  const noShows = previous.filter((b) => b.status === "NO_SHOW").length;
  const cancelled = previous.filter((b) => b.status === "CANCELLED").length;
  const upcoming = previous.filter(
    (b) => (b.status === "BOOKED" || b.status === "RESCHEDULED") && !!b.at && b.at > now,
  ).length;
  const lastOutcome = previous.find((b) => RESOLVED.has(b.status)) ?? null;

  const scores = [...(input.scores ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime());
  const emails = [...(input.emails ?? [])].sort(
    // Primary first, then most recently used - the order someone would read them in.
    (a, b) => Number(b.primary) - Number(a.primary) || b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  );

  const returning = previous.length > 0 || scores.length > 1 || emails.length > 1;

  const parts: string[] = [];
  // The booking in hand is this many-th, so a first repeat reads "2nd booking".
  if (previous.length > 0) parts.push(`${ordinal(previous.length + 1)} booking`);
  if (noShows > 0) parts.push(`${noShows} no-show${noShows === 1 ? "" : "s"}`);
  if (cancelled > 0) parts.push(`${cancelled} cancelled`);
  if (attended > 0) parts.push(`${attended} attended`);
  // Only worth saying when there is an EARLIER reading to compare against; the current score is
  // already on the row.
  if (scores.length > 1 && scores[1].verdict) parts.push(`was ${scores[1].verdict}`);
  if (emails.length > 1) parts.push(`${emails.length} email addresses`);

  return {
    returning,
    previous,
    attended,
    noShows,
    cancelled,
    upcoming,
    lastOutcome,
    scores,
    emails,
    headline: parts.join(" · "),
  };
}
