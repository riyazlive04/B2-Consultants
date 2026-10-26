/**
 * Normalising a typed or pasted credential before it is used to sign in.
 *
 * Isomorphic and pure - the login form, the invite acceptance form, the password-change form and
 * the reset form all import this, so "what counts as the same credential" is answered once.
 *
 * ── The failure this exists to stop ──────────────────────────────────────────────
 * Every password in this system is either set by an admin or chosen at invite acceptance, and it
 * then reaches its owner over WhatsApp or email. Both routinely add a trailing space, and mobile
 * keyboards add one after an autocorrected word. The person pastes it, the compare fails on a
 * character they cannot see, and the screen says "Invalid email or password" - which sends them
 * looking for the wrong problem.
 *
 * The email side had already been handled at the INPUT (`field-rules.filterEmail` strips
 * whitespace on change) but never at SUBMIT, and was never case-folded at all - so a keyboard
 * that capitalises the first letter could bounce someone off a `@unique` lowercase column.
 */

/**
 * Whitespace that is invisible in a text field but is not `\s` to a naive trim.
 *
 * NBSP (U+00A0) is what a copy out of a formatted email or a Word document carries; the
 * zero-width family (U+200B-U+200D, U+FEFF) is what survives a copy out of a web page or a
 * WhatsApp message. `String.prototype.trim` removes none of the zero-width ones.
 */
const INVISIBLE = /[ ​‌‍﻿]/g;

/** Strip invisible characters, then trim ordinary whitespace from both ends. */
function stripEdges(raw: string): string {
  return raw.replace(INVISIBLE, " ").trim();
}

/**
 * An email as it should be compared and stored: no whitespace anywhere, lower-cased.
 *
 * Whitespace is removed from the MIDDLE too, not just the ends - a wrapped paste can put a space
 * inside the address, and no valid address has one (a quoted local part may, but nobody here has
 * one and accepting it would mean accepting the wrapped paste as well).
 *
 * Lower-casing matches `access-requests.ts` and `booking-actions.ts`, which already fold before
 * storing, and `User.email`, which is `@unique`.
 */
export function normalizeEmail(raw: string): string {
  return raw.replace(INVISIBLE, "").replace(/\s/g, "").toLowerCase();
}

/**
 * A password as it should be submitted: edges trimmed, interior untouched.
 *
 * ONLY the edges. A password's interior is its own business - spaces are legitimate inside a
 * passphrase, and stripping them would silently lock out anyone who chose one. The edges are
 * different: no one deliberately ends a password with a space, and a paste routinely does.
 *
 * `passwordWasTrimmed` below exists so the UI can SAY that it did this. Silently altering what
 * someone typed and then telling them it was wrong is the same dead end in a new place.
 */
export function normalizePassword(raw: string): string {
  return stripEdges(raw);
}

/** True when normalising actually changed the password - the UI shows a note when it did. */
export function passwordWasTrimmed(raw: string): boolean {
  return normalizePassword(raw) !== raw;
}

/**
 * ════════════════════════════════════════════════════════════════════════════════════════
 *  HOW LONG A PASSWORD HAS TO BE  (issue B1)
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * Twelve, raised from eight, and - the actual point of this block - stated ONCE.
 *
 * ── Why it moved here ───────────────────────────────────────────────────────────────────
 * Before this constant, "8" was written out fourteen times: five server actions that are the
 * real gates (`account-actions`, `invite-actions`, `users-actions`, `students-actions`,
 * `german-note-actions`), six `minLength={8}` attributes, and five separate hints telling the
 * person "At least 8 characters". Raising the bar meant finding all fourteen, and MISSING one
 * would not fail a build or a test - it would produce a form whose hint and whose server
 * disagree, which the person experiences as a password being refused for no stated reason.
 * That is the same class of bug as the login destinations in `LoginForm` (issue A2): a rule
 * copied is a rule that drifts.
 *
 * ── Why twelve ──────────────────────────────────────────────────────────────────────────
 * There is no second factor behind any of these passwords, so length is the only dial that
 * exists. Every one is either admin-set and temporary or chosen once from an invite link, on a
 * screen nobody revisits - so the cost is four extra characters, once, and the benefit is
 * putting a leaked hash out of reach of an offline attack that eight characters is inside.
 *
 * `better-auth`'s own `minPasswordLength` is set from this in `lib/auth.ts`, so the library's
 * check and the app's checks cannot disagree either.
 *
 * ── What this deliberately is NOT ───────────────────────────────────────────────────────
 * A composition rule. No "one capital, one digit, one symbol": those push people towards
 * `Password1!`, which is shorter in real entropy than three ordinary words, and they would also
 * break the admin-set temporary passwords this app generates. Length only.
 *
 * A breach check is the natural next step and is deliberately absent for now - better-auth ships
 * a `haveibeenpwned` plugin that does it by k-anonymity, and adding it puts a third-party HTTP
 * call on the password-change path. That is a decision about an availability trade-off (what
 * happens to somebody setting a password while the API is down), not a line of config, so it is
 * left to be taken on its own.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** The hint every password field shows. One string, so no form can promise a different rule. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/** The refusal every server-side password gate returns. Same reason: one wording, one rule. */
export const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
