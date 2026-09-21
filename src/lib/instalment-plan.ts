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
 * BigInt column - floating-point division on money is how a plan ends up 1 paise short.
 */

export type MoneyMinor = { inr: bigint; eur: bigint };

/**
 * The surcharge for choosing an N-part plan - a flat amount added ONCE to the fee, not per
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

/** Fee + plan surcharge - what actually has to be collected once a plan is chosen. */
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

// ───────────────────── Settling a plan from a recorded payment (FIN-06/07/08) ─────────────────────
//
// Recording an Income used to lower the receivable's computed balance and nothing else: the
// Instalment rows stayed DUE/OVERDUE, `nextDueDate` stayed on the instalment just paid, and the
// dunning ladder (which reads Instalment rows, not balances) went on chasing a student who had
// paid. These functions are the decision half of the fix - which plan, which instalments, and
// whether the plan is now paid in full. The server action does the reads and writes around them.

/** Same normalisation as the balance maths in finance-metrics (`nameKey`): case and spacing only. */
export function studentNameKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type PlanCandidate = { id: string; studentId: string | null; studentName: string };

export type PlanPick =
  | { planId: string }
  | { skip: "no-plan" | "ambiguous" };

/**
 * Which live receivable a payment belongs to - or none, when that is not certain.
 *
 * The caller has already narrowed to live plans (not archived, ACTIVE/OVERDUE) at the SAME
 * programme level; this applies the student rule, which deliberately mirrors how the balance is
 * credited in `getPendingRows`, so the schedule and the balance can never be moved by different
 * payments:
 *   - a plan linked to a student is matched ONLY by that student id - never by name, because two
 *     students sharing a name would otherwise settle each other's instalments;
 *   - an unlinked plan is matched by name (case/space-insensitive), whether or not the payment
 *     itself carries a student link.
 *
 * Exactly one match, or nothing. Two plausible plans means the payment could belong to either, and
 * guessing wrong silences the chase on a debt that is still owed, so the admin decides (the EMI
 * schedule's manual "mark paid" is still there for exactly that).
 */
export function pickPlanForPayment(
  payment: { studentId: string | null; studentName: string },
  plans: PlanCandidate[],
): PlanPick {
  const key = studentNameKey(payment.studentName);
  const matches = plans.filter((p) =>
    p.studentId ? !!payment.studentId && p.studentId === payment.studentId : studentNameKey(p.studentName) === key,
  );
  if (matches.length === 0) return { skip: "no-plan" };
  if (matches.length > 1) return { skip: "ambiguous" };
  return { planId: matches[0].id };
}

/**
 * An amount in both currencies plus its INR aggregate at the row's OWN stamped rate. The caller
 * computes `aggInr` (lib/money) so this file stays free of Prisma and trivially testable.
 */
export type SettleAmount = { inr: bigint; eur: bigint; aggInr: bigint };

export type SettleInstalment = SettleAmount & {
  id: string;
  seq: number;
  dueDate: Date;
  status: "DUE" | "PAID" | "OVERDUE";
};

export type SettleDecision = {
  /** Instalments this payment pays off, earliest first. Empty when it covers none in full. */
  settleIds: string[];
  /** The earliest instalment still unpaid afterwards - the plan's new headline "next due". */
  nextDueDate: Date | null;
  /** True when no instalment is left unpaid (the plan MAY be paid in full - see isPlanPaidInFull). */
  allPaid: boolean;
  /** Paid something, but less than the earliest unpaid instalment. Nothing is settled. */
  shortfall: boolean;
};

/**
 * Which instalments a single payment settles.
 *
 * Walks the unpaid instalments in due order and pays off each one the money still covers IN FULL:
 *   - exactly one instalment's worth settles that instalment;
 *   - enough for two (a student paying ahead) settles both - they have paid them, and chasing
 *     them for the second would be chasing someone who paid;
 *   - a remainder smaller than the next instalment is carried NOWHERE. An Instalment row is DUE,
 *     OVERDUE or PAID with no "partly paid" state, and marking it PAID on part of the money would
 *     stop the chase on a debt still owed. The remainder is not lost: the receivable's balance is
 *     computed from every income, so it still shows. The instalment row just keeps its full amount;
 *   - less than the earliest unpaid instalment settles nothing (`shortfall`) - the student has not
 *     paid that instalment, and the ladder has no notion of part payment, so it carries on as before.
 *
 * Amounts are compared in the currency they were agreed in when both sides use one currency
 * (exact, no FX noise), and in INR at each row's own stamped rate otherwise - the same conversion
 * the balance uses, so a cross-currency payment is judged the way the balance will show it.
 */
export function settleDecision(payment: SettleAmount, instalments: SettleInstalment[]): SettleDecision {
  const unpaid = instalments
    .filter((i) => i.status !== "PAID")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.seq - b.seq);

  const inrOnly = payment.eur === BigInt(0) && unpaid.every((i) => i.eur === BigInt(0));
  const eurOnly = payment.inr === BigInt(0) && unpaid.every((i) => i.inr === BigInt(0));
  const value = (a: SettleAmount) => (inrOnly ? a.inr : eurOnly ? a.eur : a.aggInr);

  let remaining = value(payment);
  const settleIds: string[] = [];
  for (const inst of unpaid) {
    const owed = value(inst);
    if (remaining < owed) break;
    remaining -= owed;
    settleIds.push(inst.id);
  }

  const left = unpaid.filter((i) => !settleIds.includes(i.id));
  return {
    settleIds,
    nextDueDate: left[0]?.dueDate ?? null,
    allPaid: left.length === 0,
    shortfall: settleIds.length === 0 && unpaid.length > 0 && value(payment) > BigInt(0),
  };
}

/**
 * "Paid in full" needs BOTH readings to agree: no instalment left unpaid AND nothing left to
 * collect. Either alone can be wrong - a schedule edited after the fee changed, or a balance that
 * only looks settled because other payments were credited to it - and the cost of a false "paid in
 * full" is that the student is never chased again. So when the two disagree the plan stays live.
 *
 * `toCollect` and `paid` are both {INR aggregate, EUR aggregate} at each row's own rate, the same
 * pair the Pending payments table shows; both must be at or below zero, so FX drift between the
 * two views can only ever keep a plan open, never close one early.
 */
export function isPlanPaidInFull(args: {
  allInstalmentsPaid: boolean;
  toCollect: MoneyMinor;
  paid: MoneyMinor;
}): boolean {
  if (!args.allInstalmentsPaid) return false;
  return args.toCollect.inr - args.paid.inr <= BigInt(0) && args.toCollect.eur - args.paid.eur <= BigInt(0);
}
