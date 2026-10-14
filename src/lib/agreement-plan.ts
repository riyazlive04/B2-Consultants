/**
 * The instalment plan of an AGREEMENT, as pure arithmetic.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 * The agreement's §7 payment block asked for every instalment by hand: click "Add instalment",
 * type the amount, type the milestone, four more times, and then check the sum yourself. The
 * income entry form had already solved exactly this problem - say how many instalments, and the
 * fee, the surcharge, the amounts and the due dates fall out of it (lib/instalment-amounts,
 * lib/instalment-dates) - and the contract is where those numbers become binding, so it is the
 * LAST place they should be retyped.
 *
 * This module is the agreement-shaped half of that. It deliberately reuses `splitInstalments`
 * and `dueDateFor` rather than re-deriving them, so a plan quoted in the income form and the
 * same plan written into the contract cannot disagree about a single paise or a single date.
 *
 * ── What is different from the income form ───────────────────────────────────────
 * Two things, and both are properties of a contract rather than of a payment:
 *
 *   1. INR ONLY. `AgreementData` holds `totalInrMinor` and nothing else - the master document
 *      prints "69,999 INR" throughout (see `formatInrPlainForDocument`) and there is no euro
 *      column to agree a fee in. So this works in plain bigint paise, not the ₹/€ `MoneyText`
 *      pair the income form carries.
 *
 *   2. EVERY instalment gets a date, including the first. The income form's schedule starts at
 *      instalment 2 because instalment 1 is the money being banked as you type. Nothing is being
 *      banked here: all N instalments are future promises, and the first one falls due at the
 *      programme start ("Before commencement of Week 1"), which is why the series is anchored on
 *      `batch.startDate` rather than on today.
 */

import { dueDateFor, type DueDateScheme } from "./instalment-dates";
import { splitInstalments } from "./instalment-plan";

/** Must mirror `agreementDataSchema`'s instalment bounds - the server re-checks these. */
export const AGREEMENT_MIN_INSTALMENTS = 2;
export const AGREEMENT_MAX_INSTALMENTS = 6;

const ZERO = BigInt(0);

/**
 * What the plan has to collect: the programme price plus the instalment-plan surcharge.
 *
 * The surcharge is ADDED to the price rather than carved out of it - that is what "extra price
 * for paying in instalments" means, and it is the same rule `totalToCollect` applies on the
 * income side. §7.1 keeps printing the programme fee; the surcharge is disclosed on its own line
 * so the student can see what the plan itself costs them.
 */
export function agreementPlanTotal(totalMinor: bigint, extraMinor: bigint = ZERO): bigint {
  return totalMinor + (extraMinor > ZERO ? extraMinor : ZERO);
}

/**
 * The fee plus the surcharge, cut into `count` instalments.
 *
 * The remainder lands on the LAST instalment, which is `splitInstalments`' rule and therefore
 * the rule the income form, the Console's plan preview and the receivable schedule all already
 * use. (The old "Split equally" button here put it on the first instead - a difference nobody
 * chose, which meant the same plan written in two places differed by a paise.)
 *
 * `firstOverride` is the one plan the business sells most and the old form could not express: a
 * larger payment up front with the balance spread. The typed figure is taken as agreed and the
 * REMAINING instalments are re-cut from what is left, so the plan still sums to the total
 * without anybody re-typing the other rows.
 *
 * An empty list when there is nothing usable to split - no count, or no money - so the caller
 * leaves the boxes alone rather than filling them with zeroes.
 */
export function agreementShares(
  totalMinor: bigint,
  extraMinor: bigint,
  count: number | null,
  firstOverride?: bigint | null,
): bigint[] {
  if (!count || !Number.isInteger(count) || count < 2) return [];
  const total = agreementPlanTotal(totalMinor, extraMinor);
  if (total <= ZERO) return [];

  const split = (amount: bigint, n: number) =>
    splitInstalments({ inr: amount, eur: ZERO }, n).map((m) => m.inr);

  if (firstOverride !== null && firstOverride !== undefined && firstOverride > ZERO) {
    // Never negative. A first instalment typed ABOVE the total is a mistake the form is about to
    // name on screen (the parts are reconciled against the price), and filling the rows below it
    // with minus signs would bury it.
    const rest = total - firstOverride > ZERO ? total - firstOverride : ZERO;
    return [firstOverride, ...split(rest, count - 1)];
  }
  return split(total, count);
}

/**
 * When each instalment of a `count`-part plan falls due, for a programme starting `startIso`.
 *
 * The FIRST is the start date itself - that is what "Before commencement of Week 1" means, and
 * it is the date §7.2 has always implied without ever writing down. The rest follow the chosen
 * rule, counted from the start date (`dueDateFor`), so a plan reads the way it was agreed:
 * "the 1st of each month" or "every 30 days".
 *
 * An unusable start date yields an empty list, never a row of "Invalid Date" - the form then
 * leaves the date boxes alone and says the start date is still needed.
 */
export function agreementDueDates(
  scheme: DueDateScheme,
  startIso: string,
  count: number | null,
): string[] {
  if (!count || !Number.isInteger(count) || count < 1) return [];
  const first = dueDateFor(scheme, startIso, 1);
  if (!first) return []; // the anchor itself is unparseable - say nothing rather than guess
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? startIso : dueDateFor(scheme, startIso, i),
  );
}

/** Sum of the instalments as the form holds them - what the save is reconciled against. */
export function sumShares(amounts: bigint[]): bigint {
  return amounts.reduce((a, b) => a + b, ZERO);
}
