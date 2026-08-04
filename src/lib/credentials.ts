/**
 * Normalising a typed or pasted credential before it is used to sign in.
 *
 * Isomorphic and pure — the login form, the invite acceptance form, the password-change form and
 * the reset form all import this, so "what counts as the same credential" is answered once.
 *
 * ── The failure this exists to stop ──────────────────────────────────────────────
 * Every password in this system is either set by an admin or chosen at invite acceptance, and it
 * then reaches its owner over WhatsApp or email. Both routinely add a trailing space, and mobile
 * keyboards add one after an autocorrected word. The person pastes it, the compare fails on a
 * character they cannot see, and the screen says "Invalid email or password" — which sends them
 * looking for the wrong problem.
 *
 * The email side had already been handled at the INPUT (`field-rules.filterEmail` strips
 * whitespace on change) but never at SUBMIT, and was never case-folded at all — so a keyboard
 * that capitalises the first letter could bounce someone off a `@unique` lowercase column.
 */

/**
 * Whitespace that is invisible in a text field but is not `\s` to a naive trim.
 *
 * NBSP (U+00A0) is what a copy out of a formatted email or a Word document carries; the
 * zero-width family (U+200B–U+200D, U+FEFF) is what survives a copy out of a web page or a
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
 * Whitespace is removed from the MIDDLE too, not just the ends — a wrapped paste can put a space
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
 * ONLY the edges. A password's interior is its own business — spaces are legitimate inside a
 * passphrase, and stripping them would silently lock out anyone who chose one. The edges are
 * different: no one deliberately ends a password with a space, and a paste routinely does.
 *
 * `passwordWasTrimmed` below exists so the UI can SAY that it did this. Silently altering what
 * someone typed and then telling them it was wrong is the same dead end in a new place.
 */
export function normalizePassword(raw: string): string {
  return stripEdges(raw);
}

/** True when normalising actually changed the password — the UI shows a note when it did. */
export function passwordWasTrimmed(raw: string): boolean {
  return normalizePassword(raw) !== raw;
}
