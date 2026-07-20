import {
  DEFAULT_BOOK_ORDER_CONFIG,
  type BookOrderConfig,
} from "./config-schema";

/**
 * The publisher-ordering rule (spec §9.2, Part 2 §4.4).
 *
 * The founders' words: "if the student pays a large sum up front (e.g. ₹30,000), order
 * immediately; otherwise wait. If the student is on EMI, ordering is deferred (they haven't
 * fully paid)."
 *
 * So the decision is about CASH RECEIVED, not about the sale price or the plan on paper — an
 * EMI student who has actually paid ₹30,000 across instalments has earned their books just as
 * much as someone who paid it in one go. Keying off "is on EMI" instead of "has paid enough"
 * would strand exactly the customer who has been paying reliably for months.
 *
 * Pure: pass the money in. All amounts are integer paise.
 */

export type BookOrderDecision = {
  /** True when the publisher order should go out now. */
  order: boolean;
  /** Machine-readable why, for logging and the UI badge. */
  reason: "threshold_met" | "below_threshold";
  /** Human sentence for the team, so a DEFERRED row never reads as "forgotten". */
  explain: string;
  /** Paise still to collect before the order releases. 0 once met. */
  shortfallInrMinor: number;
};

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * Decide whether to order books for a level, given what the student has actually paid.
 *
 * @param cashCollectedInrMinor total cash received from this student so far, in paise
 */
export function decideBookOrder(
  cashCollectedInrMinor: number,
  config: BookOrderConfig = DEFAULT_BOOK_ORDER_CONFIG,
): BookOrderDecision {
  const threshold = config.orderThresholdInrMinor;
  // Guard the degenerate config: a threshold of 0 means "always order", and a negative
  // cash figure (a refund overshoot) must not read as having paid.
  const paid = Math.max(0, cashCollectedInrMinor);

  if (paid >= threshold) {
    return {
      order: true,
      reason: "threshold_met",
      explain: `Paid ${inr(paid)} — at or above the ${inr(threshold)} order threshold. Order now.`,
      shortfallInrMinor: 0,
    };
  }
  const shortfall = threshold - paid;
  return {
    order: false,
    reason: "below_threshold",
    explain: `Paid ${inr(paid)} of the ${inr(threshold)} threshold — hold until ${inr(shortfall)} more is collected.`,
    shortfallInrMinor: shortfall,
  };
}

/** The status a fresh order should take, given the decision. */
export function initialBookOrderStatus(
  decision: BookOrderDecision,
): "QUOTE_REQUESTED" | "DEFERRED" {
  // Ordering starts by asking the publisher for a price (§9.2: "get a quotation first"),
  // never by jumping straight to ORDERED — the amount isn't known until they quote.
  return decision.order ? "QUOTE_REQUESTED" : "DEFERRED";
}
