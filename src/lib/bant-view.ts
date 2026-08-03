/**
 * The one shape every screen shows a band score in, and the one rule for choosing which stored
 * score to show.
 *
 * Isomorphic and pure. Exists because BANT is now recorded in two places — `BookingRequest`
 * (the booking form) and `Lead` (the landing page, at opt-in) — and "which one do I display"
 * is a decision that must not be re-answered per screen. It was already re-answered per screen
 * for the booking-only case: `BookingsTable` renders `bantAvg ?? bantScore`, the outreach queue
 * renders `bantAvg` alone, Key Metrics renders `bantScoreAtQual ?? booking.bantAvg`. Adding a
 * third source to each of those independently is how they start disagreeing about the same
 * prospect.
 */

import type { BantVerdict } from "@prisma/client";
import { bantVerdictFor } from "./booking-intake";

/** Where a displayed score came from — shown to the reader, never inferred by them. */
export type BantOrigin = "booking" | "opt-in" | "manual";

export type BantSnapshot = {
  /** 0–5 weighted average of the four dimensions. */
  avg: number;
  /** 0–4 count of dimensions met — the figure the pipeline ranking consumes. */
  score: number;
  verdict: BantVerdict;
  budget: boolean;
  authority: boolean;
  need: boolean;
  timeline: boolean;
  origin: BantOrigin;
};

/** The minimum a booking row must select for `resolveBant` to read it. */
export type BantColumns = {
  bantAvg: number | null;
  bantScore?: number | null;
  bantVerdict?: BantVerdict | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
};

/**
 * Choose and normalise the score to display for a prospect.
 *
 * Precedence: the BOOKING's score, then the LEAD's. The booking form asks more, and asks it
 * after the prospect has committed to a call, so where both exist it is the better evidence.
 * The lead's is the landing page's answer set, taken at opt-in — earlier, thinner, and until
 * now discarded entirely.
 *
 * Returns null when neither exists. Callers MUST render that as "not scored" and not as zero:
 * an unscored prospect is one nobody has evidence about, and showing them as 0.0/5 alongside
 * genuinely poor prospects is how a good lead gets deprioritised for never having been asked.
 */
export function resolveBant(
  booking: BantColumns | null | undefined,
  lead: (BantColumns & { bantSource?: string | null }) | null | undefined,
): BantSnapshot | null {
  if (booking?.bantAvg != null) return snapshot(booking, "booking");
  if (lead?.bantAvg != null) {
    return snapshot(lead, lead.bantSource === "MANUAL" ? "manual" : "opt-in");
  }
  return null;
}

function snapshot(c: BantColumns, origin: BantOrigin): BantSnapshot {
  const budget = c.bantBudget ?? false;
  const authority = c.bantAuthority ?? false;
  const need = c.bantNeed ?? false;
  const timeline = c.bantTimeline ?? false;
  return {
    avg: c.bantAvg!,
    // Derived from the booleans rather than trusted from the column, so a row written before
    // `bantScore` existed still counts correctly instead of reading 0.
    score: c.bantScore ?? [budget, authority, need, timeline].filter(Boolean).length,
    verdict: c.bantVerdict ?? bantVerdictFor(c.bantAvg!),
    budget,
    authority,
    need,
    timeline,
    origin,
  };
}

export const BANT_ORIGIN_LABELS: Record<BantOrigin, string> = {
  booking: "from the booking form",
  "opt-in": "from the landing page",
  manual: "set by a specialist",
};

/** Traffic light on the 0–5 average, matching Ameen's verdict thresholds (>3 · 2–3 · <2). */
export function bantSignal(avg: number): "ok" | "watch" | "risk" {
  return avg > 3 ? "ok" : avg >= 2 ? "watch" : "risk";
}
