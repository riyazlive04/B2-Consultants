import {
  DEFAULT_INSTALMENT_PLAN_CONFIG,
  type InstalmentPlanConfig,
} from "./config-schema";

/**
 * The instalment-plan arithmetic, as pure functions.
 *
 * This used to live inline inside `generateInstalmentPlan`, which made it unreachable from a
 * test and invisible to the Console panel that now has to PREVIEW the same numbers before they
 * are written. Both the server action and the panel call these, so what the founder is shown
 * and what gets stored cannot drift.
 *
 * Money is minor units throughout (paise / cents). The split uses BigInt because a fee is a
 * BigInt column — floating-point division on money is how a plan ends up 1 paise short.
 */

export type MoneyMinor = { inr: bigint; eur: bigint };

/**
 * The surcharge for choosing an N-part plan — a flat amount added ONCE to the fee, not per
 * instalment. An unlisted length costs nothing: the table is an allow-list of priced plans,
 * so a length the founder never priced can never invent a charge.
 */
export function instalmentExtraFor(
  count: number,
  config: InstalmentPlanConfig = DEFAULT_INSTALMENT_PLAN_CONFIG,
): MoneyMinor {
  const tier = config.tiers.find((t) => t.count === count);
  if (!tier) return { inr: BigInt(0), eur: BigInt(0) };
  return { inr: BigInt(tier.extraInrMinor), eur: BigInt(tier.extraEurMinor) };
}

/** Fee + plan surcharge — what actually has to be collected once a plan is chosen. */
export function totalToCollect(fee: MoneyMinor, extra: MoneyMinor): MoneyMinor {
  return { inr: fee.inr + extra.inr, eur: fee.eur + extra.eur };
}

/**
 * Split a total into `count` equal instalments, exactly.
 *
 * The remainder goes on the LAST instalment rather than being spread, so the earlier amounts
 * are the round number the student was quoted and the schedule still sums to the total to the
 * paise. `count < 1` yields an empty schedule rather than dividing by zero.
 */
export function splitInstalments(total: MoneyMinor, count: number): MoneyMinor[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const n = BigInt(count);
  const baseInr = total.inr / n;
  const baseEur = total.eur / n;
  const remInr = total.inr - baseInr * n;
  const remEur = total.eur - baseEur * n;
  return Array.from({ length: count }, (_, i) => {
    const last = i === count - 1;
    return {
      inr: baseInr + (last ? remInr : BigInt(0)),
      eur: baseEur + (last ? remEur : BigInt(0)),
    };
  });
}

/**
 * The due date for every instalment: the first one on `firstDueDate`, each later one
 * `intervalDays` after the previous.
 *
 * Stepping from `first + i * interval` (not from the previous result) keeps the whole schedule
 * anchored to the start date, so no rounding accumulates across a long plan. Dates are UTC
 * midnights to match the `@db.Date` columns the rest of Finance uses.
 */
export function instalmentDueDates(firstDueDate: Date, count: number, intervalDays: number): Date[] {
  if (!Number.isInteger(count) || count < 1) return [];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(firstDueDate);
    d.setUTCDate(firstDueDate.getUTCDate() + i * intervalDays);
    return d;
  });
}
