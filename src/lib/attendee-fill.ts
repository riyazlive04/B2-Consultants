/**
 * Which contact details a picked meeting attendee may write into a form.
 *
 * ── WHY THIS IS NOT THREE LINES INSIDE THE COMPONENT ─────────────────────────────
 * Because getting it wrong is expensive and invisible. The agreement form fills the WhatsApp
 * number from whoever is picked in the name box, and that number is where the signing link AND
 * the one-time code that executes the contract are delivered. A stale number does not look like
 * a bug on screen - the form reads "Arun Mehta" with a number beside it, and the code goes to
 * Priya's phone.
 *
 * It got that wrong twice in one sitting, in two different ways:
 *   1. "only fill empty boxes" meant correcting yourself from one attendee to another kept the
 *      first one's number, because the box was no longer empty;
 *   2. the repair compared against a ref that the same handler had already reassigned, so the
 *      comparison was always false and nothing was filled at all. (React runs a setState updater
 *      during a later render, not at the call - which is why the decision has to be made HERE,
 *      from plain values, and handed to the updater as a result.)
 *
 * So it is a pure function over three facts: what the boxes hold now, what the LAST pick put
 * there, and who has just been picked.
 */

/** The two fields a booking actually knows about the person who attended. */
export type ContactFields = { phone: string; email: string };

/**
 * What the boxes should hold after a pick.
 *
 * The rule, per field:
 *   - empty → take the attendee's value. Nothing is being lost.
 *   - still holding what the LAST pick wrote → take the new attendee's value, INCLUDING when
 *     that is blank. A blank is honest; the previous person's number is not.
 *   - anything else → leave it alone. It came from the CRM record or from a person typing, and
 *     both are better sources than a booking form filled in months ago.
 */
export function fillFromAttendee(args: {
  /** What the form's boxes hold right now. */
  current: ContactFields;
  /** What the previous pick wrote into them, or blanks if there has been no pick. */
  injected: ContactFields;
  /** The attendee just picked. */
  picked: ContactFields;
}): ContactFields {
  const decide = (current: string, injected: string, picked: string): string =>
    current.trim() === "" || current === injected ? picked : current;

  return {
    phone: decide(args.current.phone, args.injected.phone, args.picked.phone),
    email: decide(args.current.email, args.injected.email, args.picked.email),
  };
}
