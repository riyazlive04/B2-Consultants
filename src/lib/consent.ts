/**
 * The consent wording, in one place (spec §15: GDPR, Germany + India).
 *
 * The text shown to the prospect and the text stored as evidence MUST be the same string —
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

/** The value the checkbox posts. Absence — an unticked box posts nothing — must read as refusal. */
export const CONSENT_VALUE = "yes";
