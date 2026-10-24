/**
 * The canonical form of a person's typed name, for matching one record against another.
 *
 * ── Why this is its own module ──────────────────────────────────────────────────────────
 * It was defined five times, identically, in five files: `finance-actions.ts`,
 * `german-note-actions.ts`, `students-actions.ts`, `lib/income-form.ts` and
 * `lib/payment-allocation.ts`. All five were `trim().toLowerCase()` with runs of whitespace
 * collapsed, and all five decide whether a payment typed as free text belongs to a student
 * record - so a change to any one of them would have silently split the money in half.
 *
 * ── What it deliberately does not do ───────────────────────────────────────────────────
 * It does not strip punctuation, reorder name parts, or attempt any fuzziness. "Anita Rao" and
 * "Rao, Anita" are different keys, and that is the safe direction to be wrong in: a missed link
 * is visible (the payment sits unattached, and Onboarding → Needs completing lists the student)
 * while a wrong link quietly moves somebody's money onto somebody else's record.
 */
export const nameKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** True when two typed names are the same person as far as this app is concerned. */
export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}
