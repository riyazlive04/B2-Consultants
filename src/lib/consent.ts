/**
 * The consent wording, in one place (spec §15: GDPR, Germany + India).
 *
 * The text shown to the prospect and the text stored as evidence MUST be the same string -
 * if they drift, the ConsentRecord stops being proof of anything. So the public form renders
 * CONSENT_LABEL and `submitBooking` stores it verbatim as ConsentRecord.purpose.
 *
 * Bump CONSENT_POLICY_VERSION whenever CONSENT_LABEL changes in substance. Old rows keep
 * their old version, so "what exactly did this person agree to, and when" stays answerable
 * after the wording moves on. Date-stamped rather than semver: the question is always "which
 * wording was in force", and a date answers that without a changelog.
 */
export const CONSENT_POLICY_VERSION = "2026-07-17";

/** Rendered next to the checkbox on /book, and stored verbatim as the consent purpose. */
export const CONSENT_LABEL =
  "I agree that B2 Consultants may store the details I've entered here and contact me about my discovery call.";

/**
 * The wording for the no-slots capture on /book (issue A6).
 *
 * A SEPARATE string rather than a reuse of CONSENT_LABEL, because the two agreements are not the
 * same agreement: that one is about a call the person has just booked, this one is about being
 * contacted when a time opens up. Storing the booking wording against a waitlist sign-up would
 * make the ConsentRecord say something the person was never shown, which is the one thing that
 * file's header rules out.
 *
 * CONSENT_POLICY_VERSION is deliberately NOT bumped: that version names the privacy policy in
 * force, and adding a second purpose does not change the policy. The `purpose` column is what
 * records which sentence was on screen.
 */
export const CONSENT_LABEL_NO_SLOTS =
  "I agree that B2 Consultants may store the details I've entered here and contact me when a discovery call time opens up.";

/** The value the checkbox posts. Absence - an unticked box posts nothing - must read as refusal. */
export const CONSENT_VALUE = "yes";
