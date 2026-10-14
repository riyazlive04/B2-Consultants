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
export function planShares(
  fee: MoneyText,
  extra: MoneyText,
  count: number | null,
  /**
   * What the FIRST instalment is actually being paid at, when somebody has typed it.
   *
   * Null - the ordinary case - divides the total equally, as before. A figure here is taken as
   * agreed and the REST of the plan absorbs the difference: a student paying ₹20,000 of a
   * ₹40,000 four-part plan today leaves ₹20,000 over three instalments, not ₹20,000 over four.
   *
   * This is the half of the form that could not be said at all before. The first instalment was
   * derived from "total ÷ count" and submitted through a hidden field, so the single commonest
   * plan in the business - a larger payment up front, the balance spread - had to be recorded as
   * something it was not, or recorded as a plain payment and the schedule rebuilt by hand
   * afterwards (which is the plan nobody goes back to build).
   */
  firstOverride?: MoneyText | null,
): MoneyText[] {
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
  const text = (m: MoneyMinor): MoneyText => ({
    inr: inrInPlay ? minorToMajorString(m.inr) : "",
    eur: eurInPlay ? minorToMajorString(m.eur) : "",
  });

  if (firstOverride && (used(firstOverride.inr) || used(firstOverride.eur))) {
    const first: MoneyMinor = { inr: minorOf(firstOverride.inr), eur: minorOf(firstOverride.eur) };
    /**
     * Never negative. A first instalment typed ABOVE the total is a mistake the operator is
     * about to see named on screen (the schedule box reconciles the parts against the total),
     * and filling the remaining rows with minus signs would bury it.
     */
    const rest: MoneyMinor = {
      inr: total.inr - first.inr > BigInt(0) ? total.inr - first.inr : BigInt(0),
      eur: total.eur - first.eur > BigInt(0) ? total.eur - first.eur : BigInt(0),
    };
    return [text(first), ...splitInstalments(rest, count - 1).map(text)];
  }

  return splitInstalments(total, count).map(text);
}

/**
 * What the plan has to collect in total: the fee plus the surcharge, in the currencies the FEE
 * was agreed in.
 *
 * The same rule `planShares` divides by, extracted so the form can reconcile its parts against
 * the total without re-deciding which currencies are in play - a surcharge typed into a currency
 * the fee does not use is ignored here exactly as it is ignored there.
 */
export function planTotalText(fee: MoneyText, extra: MoneyText): MoneyText {
  const total: MoneyMinor = totalToCollect(
    { inr: minorOf(fee.inr), eur: minorOf(fee.eur) },
    { inr: minorOf(extra.inr), eur: minorOf(extra.eur) },
  );
  return {
    inr: used(fee.inr) ? minorToMajorString(total.inr) : "",
    eur: used(fee.eur) ? minorToMajorString(total.eur) : "",
  };
}

/**
 * Add up ₹/€ amounts as the form holds them, keeping an unused currency unused.
 *
 * Used to reconcile what the plan's PARTS come to against the total typed above them. Every
 * amount on the form is now editable - the first instalment and every row of the schedule - so
 * the two can legitimately disagree, and the server stores the parts (total fee = received now +
 * everything scheduled). The form therefore has to SAY what it is about to store.
 */
export function sumMoneyText(parts: MoneyText[]): MoneyText {
  const add = (pick: (p: MoneyText) => string): string => {
    const live = parts.filter((p) => used(pick(p)));
    if (live.length === 0) return "";
    return minorToMajorString(live.reduce((a, p) => a + majorStringToMinor(pick(p)), BigInt(0)));
  };
  return { inr: add((p) => p.inr), eur: add((p) => p.eur) };
}

/**
 * The parts minus the total, per currency, in minor units. Zero on both sides = they agree.
 *
 * Positive means the schedule bills MORE than the price typed above; negative means less. Either
 * way the figure that gets stored is the parts, so this is what the form warns with.
 */
export function planGap(total: MoneyText, parts: MoneyText[]): { inr: bigint; eur: bigint } {
  const sum = sumMoneyText(parts);
  return {
    inr: minorOf(sum.inr) - minorOf(total.inr),
    eur: minorOf(sum.eur) - minorOf(total.eur),
  };
}

/** What is banked today: the first instalment, or nothing when the plan cannot be split yet. */
export function firstShare(shares: MoneyText[]): MoneyText {
  return shares[0] ?? EMPTY;
}

/** The instalments still to come - what the schedule rows below the form are for. */
export function remainingShares(shares: MoneyText[]): MoneyText[] {
  return shares.slice(1);
}
