/**
 * A/B split assignment. Pure, isomorphic, and deliberately without a single random number in it.
 *
 * ── Why hashing a visitor id, and not `Math.random()` + "remember the answer" ──────────────────
 * The obvious design is: roll a die on the first visit, write the winner into a cookie, read that
 * cookie forever after. It cannot be built here. A funnel step is a React Server Component, and a
 * Server Component may not set cookies (Next only allows that in a Server Action, a Route Handler
 * or middleware) - so the roll would have to happen somewhere other than the page that needs it,
 * and `generateMetadata` + the page body each call the loader, which would roll twice and could
 * disagree with each other about which page the visitor is even on.
 *
 * So the cookie holds a VISITOR ID and nothing else - one opaque value, written once by
 * middleware - and the assignment is a pure function of (visitor, control step). Same visitor,
 * same step, same answer, on every request, in both render passes, with no storage per experiment
 * and no write path on the hot public route.
 *
 * ── What this costs ────────────────────────────────────────────────────────────────────────────
 * Changing a weight re-buckets some already-assigned visitors, because the boundary they are
 * compared against moves. That is inherent to hash bucketing (it is what every split-testing tool
 * that avoids a per-visitor assignment table does), and it is the right trade here: the
 * alternative - a row per visitor per experiment - is a write on every anonymous ad click.
 * Weights are meant to be set once at the start of a test, not tuned while it runs.
 *
 * The step id is mixed into the seed so that a visitor is not correlated across experiments - a
 * "control person" on step 1 is not thereby a control person on step 2, which would quietly turn
 * several independent tests into one.
 */

export type AbCandidate = { id: string; abWeight: number };

/**
 * 32-bit FNV-1a, mapped onto [0, 1).
 *
 * Chosen over `crypto.subtle.digest` because that is async, and this runs inside a synchronous
 * render path. Cryptographic strength is not a requirement - nobody gains anything by predicting
 * which landing page they are shown - but even distribution is, and FNV-1a avalanches well enough
 * that adjacent cuid visitor ids land in unrelated buckets.
 */
export function hashUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // The FNV prime, as shifts: `h * 16777619` overflows the 53-bit float mantissa and starts
    // losing low bits, which is exactly where the entropy is.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h / 0x100000000;
}

/**
 * Pick from weighted candidates using a pre-computed unit value.
 *
 * Weights are RELATIVE shares, not percentages - see the note on `FunnelStep.abWeight`. A
 * candidate weighted 0 is switched off without being deleted, which is how you pause a losing
 * variant without throwing away the views it has already collected.
 *
 * Returns the first candidate when every weight is 0 or the list is degenerate, so a
 * misconfigured experiment shows the control rather than a blank page.
 */
export function pickWeighted<T extends AbCandidate>(candidates: T[], unit: number): T | null {
  if (candidates.length === 0) return null;
  const weights = candidates.map((c) => (Number.isFinite(c.abWeight) && c.abWeight > 0 ? c.abWeight : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return candidates[0];

  let cut = Math.min(Math.max(unit, 0), 0.999999999) * total;
  for (let i = 0; i < candidates.length; i++) {
    cut -= weights[i];
    if (cut < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** The whole assignment, seeded so each experiment buckets its visitors independently. */
export function assignVariant<T extends AbCandidate>(candidates: T[], visitorId: string | null, controlId: string): T | null {
  // No cookie yet (a client that refuses them, or a crawler) means no stable identity to bucket
  // on. Serving the control is the honest answer: it keeps the experiment's data clean rather
  // than filling a variant's view count with visitors who can never come back to the same page.
  if (!visitorId) return candidates[0] ?? null;
  return pickWeighted(candidates, hashUnit(`${visitorId}:${controlId}`));
}

/** Percentage share of traffic each candidate should receive, for display in the builder. */
export function weightShares<T extends AbCandidate>(candidates: T[]): number[] {
  const weights = candidates.map((c) => (c.abWeight > 0 ? c.abWeight : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return candidates.map((_, i) => (i === 0 ? 100 : 0));
  return weights.map((w) => Math.round((w / total) * 100));
}

/** Cookie carrying the opaque visitor id. Written by middleware on the public funnel routes. */
export const VISITOR_COOKIE = "b2_vid";
