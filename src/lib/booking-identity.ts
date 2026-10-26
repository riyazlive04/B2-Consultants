/**
 * One person, one live discovery booking. Pure, so the matching rule can be tested on its own.
 *
 * On 17/09/2026 one phone number held two live bookings ("ameen testing 170926" and "as,a test",
 * both on Fri 18 Sept). Each booking ran its own confirmation and its own pre-call reminders, so
 * the same prospect got every message twice, and nothing could say which appointment was real.
 */

import { normalizeEmail } from "./outreach-engine";

export type BookingContact = { id: string; phone: string | null; whatsapp: string | null; email: string | null };
export type PersonContact = { phone: string | null; whatsapp?: string | null; email: string | null };

/**
 * The existing live booking this submission collides with, or null.
 *
 * `live` is the caller's job - BOOKED with its slot still ahead - so a call that has come and gone
 * without anyone recording an outcome never blocks the same person from booking again.
 *
 * Same person = any normalised number in common (phone or WhatsApp, either side), or the same
 * normalised email. Phone is the identity every message goes to, so it is the collision that
 * doubles messages. Email is included because it is the key the SOP's Step 10 links a lead to a
 * booking on: two live bookings under one email would make that link a coin toss. A household
 * sharing one inbox is the false positive, and the cost of it is one "you already have a call"
 * message pointing them at the team - cheaper than two prospects' calls tangled on one lead.
 *
 * `normalizePhone` is passed in (the server passes `normalizeWhatsappNumber`) so this stays free
 * of libphonenumber's metadata bundle and can be exercised by the unit runner on its own.
 */
export function findLiveBookingForPerson<T extends BookingContact>(
  live: readonly T[],
  person: PersonContact,
  normalizePhone: (raw: string | null) => string | null,
): T | null {
  const numbers = new Set(
    [person.phone, person.whatsapp ?? null].map((n) => normalizePhone(n)).filter((n): n is string => !!n),
  );
  const email = normalizeEmail(person.email);
  for (const b of live) {
    const theirs = [b.phone, b.whatsapp].map((n) => normalizePhone(n));
    if (theirs.some((n) => n !== null && numbers.has(n))) return b;
    if (email !== null && normalizeEmail(b.email) === email) return b;
  }
  return null;
}

/**
 * What the prospect is told. It deliberately does NOT repeat the booked time: this is a public,
 * unauthenticated form, and anyone who types a number would otherwise learn when that person's
 * call is. The team can see the booking and move it.
 *
 * ── WHY THIS IS NOW CONDITIONAL (issue A5) ──────────────────────────────────────────────
 * The one wording said "reply to the WhatsApp message we sent you". When WATI is not armed, no
 * such message was ever sent - `lib/engines.ts` is explicit that with WhatsApp off "no booking
 * confirmations, reminders, payment nudges or SOP messages reach anyone". So a prospect who had
 * received nothing was instructed to reply to it, and the only alternative offered was "contact
 * the B2 Consultants team" with no channel named. That is a dead end at the single most
 * expensive moment in the funnel: somebody who has already decided to talk to us.
 *
 * Both branches now name a channel the prospect can actually use. The caller passes
 * `whatsappArmed` from `getWatiRuntime().enabled`, which is the same flag that decides whether
 * the confirmation went out in the first place - so the sentence cannot claim a message the
 * system did not send.
 */
export function alreadyBookedMessage(o: {
  /** `getWatiRuntime().enabled` - did a confirmation actually go out? */
  whatsappArmed: boolean;
  /** The business WhatsApp/phone number to fall back to. */
  contactNumber: string;
  /** The business email to fall back to. */
  contactEmail: string;
}): string {
  const change = o.whatsappArmed
    ? `reply to the WhatsApp message we sent you, or message us on ${o.contactNumber}`
    : `message us on WhatsApp at ${o.contactNumber}, or email ${o.contactEmail}`;
  return `You already have a Discovery Call booked with us. To change the time, ${change}, and we will move it for you.`;
}
