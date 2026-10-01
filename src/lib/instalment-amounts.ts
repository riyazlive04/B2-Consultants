/**
 * Splitting an agreed fee across the instalments of a plan.
 *
 * WHY THE FORM DOES THIS. A plan is agreed as one number - "₹40,000, four instalments, ₹600 for
 * the plan" - and the income form then asked for that number four more times, by hand, in the
 * schedule. Every one of those is a chance to mistype, and the schedule is what the chasing
 * ladder reads: a row typed as ₹1,015 instead of ₹10,150 chases the student for a tenth of what
 * they owe and marks the plan settled when they pay it.
 *
 * So the fee and the surcharge are entered once and divided here. The arithmetic itself already
 * existed for the Console's plan preview (`instalment-plan.ts`) and is reused unchanged, so what
 * the founder is shown when pricing a plan and what the income form writes cannot drift.
 *
 * ── Why currencies are kept apart ─────────────────────────────────────────────────
 * `AmountPair` submits only the currency the money was actually agreed in; the other box is a
 * visible conversion that is deliberately NOT stored, because the two columns ADD (lib/money).
 * So a currency with no text is not "zero" here - it is absent, and must come back out as "",
 * or the form would start submitting a euro amount next to a rupee one and double every plan.
 */

import { majorStringToMinor, minorToMajorString } from "./format";
import { splitInstalments, totalToCollect, type MoneyMinor } from "./instalment-plan";

/** A ₹/€ amount as the form holds it: major-unit text, "" when that currency is not in play. */
export type MoneyText = { inr: string; eur: string };

const EMPTY: MoneyText = { inr: "", eur: "" };

const used = (text: string): boolean => text.trim() !== "";
const minorOf = (text: string): bigint => (used(text) ? majorStringToMinor(text) : BigInt(0));

/**
 * The fee plus the plan surcharge, cut into `count` equal instalments.
 *
 * Returns one entry per instalment - the FIRST is the payment being recorded now, the rest are
 * the schedule. The remainder lands on the last instalment (see `splitInstalments`), so the
 * earlier figures are the round number the student was quoted and the plan still sums exactly.
 *
 * An empty list when there is nothing usable to split: no count, or no money entered. The caller
 * then leaves the boxes alone rather than filling them with zeroes.
 */
export function planShares(fee: MoneyText, extra: MoneyText, count: number | null): MoneyText[] {
  if (!count || !Number.isInteger(count) || count < 2) return [];
  if (!used(fee.inr) && !used(fee.eur)) return [];

  const total: MoneyMinor = totalToCollect(
    { inr: minorOf(fee.inr), eur: minorOf(fee.eur) },
    { inr: minorOf(extra.inr), eur: minorOf(extra.eur) },
  );
  // A currency the fee was not agreed in stays absent all the way through, even if a surcharge
  // was somehow typed into it - the surcharge follows the fee, it does not open a second ledger.
  const inrInPlay = used(fee.inr);
  const eurInPlay = used(fee.eur);

  return splitInstalments(total, count).map((share) => ({
    inr: inrInPlay ? minorToMajorString(share.inr) : "",
    eur: eurInPlay ? minorToMajorString(share.eur) : "",
  }));
}

/** What is banked today: the first instalment, or nothing when the plan cannot be split yet. */
export function firstShare(shares: MoneyText[]): MoneyText {
  return shares[0] ?? EMPTY;
}

/** The instalments still to come - what the schedule rows below the form are for. */
export function remainingShares(shares: MoneyText[]): MoneyText[] {
  return shares.slice(1);
}
