import { nameKey } from "./name-key";
/**
 * WHICH PLAN A PAYMENT PAID (FIN-12).
 *
 * ── The bug this replaces ─────────────────────────────────────────────────────────
 * Paid-so-far was summed per STUDENT and then handed to every one of that student's plans. A
 * student with four receivables saw the same figure on all four, each reading "still to collect
 * 0" while its own instalments were plainly still due - so the receivables total, the overdue
 * badge and the dashboard alert all came out LOWER than reality. Worse, the rule was not even
 * consistent: an id-linked plan ignored a payment typed under the same name, while an unlinked
 * plan counted it, so whether a plan looked paid depended on how the operator had entered it.
 *
 * ── The rule now, one rule everywhere ─────────────────────────────────────────────
 * 1. A payment that NAMES its plan is credited to that plan and to no other.
 * 2. Anything left over - a payment recorded before the plan existed, or one of the 23k rows that
 *    predate the link - is spread across that student's plans OLDEST FIRST, each filled only up
 *    to its own balance.
 * 3. Money still unplaced after every plan is full is `unapplied`: real money, held at the
 *    student rather than invented onto a plan that did not ask for it.
 *
 * Rule 2 is what makes the arithmetic close. Because each plan takes at most its own `toCollect`,
 * summing the credited figures can never exceed summing the totals, so the summary strip's
 * "Total to collect - Collected = Still to collect" holds for every selection of rows.
 *
 * Pure and currency-blind: both the ₹ and € sides run through it independently, which is why it
 * takes plain numbers and is unit-testable without a database.
 */

/** The two sides of every money figure in Finance, in MINOR units. */
export type Money = { inr: number; eur: number };

export type PlanInput = {
  id: string;
  /** Fee + plan surcharge: the figure the balance is measured from. */
  toCollect: Money;
  /** Tie-break for "oldest first". ISO string or epoch ms - compared, never parsed. */
  createdAt: string | number;
};

export type PaymentInput = {
  /** The plan this payment names, or null for an unlinked one. */
  pendingPaymentId: string | null;
  amount: Money;
};

export type PlanAllocation = {
  /** Capped at `toCollect`. What the table shows as "Collected" and what the summary adds up. */
  paid: Money;
  /** `toCollect - paid`, never below zero. */
  balance: Money;
  /**
   * How much of a DIRECTLY LINKED payment exceeded this plan's own total.
   *
   * Only a named payment can overshoot: unlinked money stops at the brim and moves to the next
   * plan. Surfaced rather than hidden because it is the one case where the capped `paid` above is
   * knowingly less than the money that arrived, and somebody has to be told.
   */
  overpaid: Money;
};

export type AllocationResult = {
  byPlan: Map<string, PlanAllocation>;
  /** Money that belongs to the student but to none of their plans (all full, or no plan at all). */
  unapplied: Money;
};

const ZERO: Money = { inr: 0, eur: 0 };
const add = (a: Money, b: Money): Money => ({ inr: a.inr + b.inr, eur: a.eur + b.eur });
const sub = (a: Money, b: Money): Money => ({ inr: a.inr - b.inr, eur: a.eur - b.eur });
const clampLow = (m: Money): Money => ({ inr: Math.max(0, m.inr), eur: Math.max(0, m.eur) });

/** Per-currency minimum - the ₹ and € sides fill up independently. */
const capped = (want: Money, room: Money): Money => ({
  inr: Math.min(want.inr, Math.max(0, room.inr)),
  eur: Math.min(want.eur, Math.max(0, room.eur)),
});

const isZero = (m: Money) => m.inr === 0 && m.eur === 0;

/**
 * Allocate ONE student's payments across ONE student's plans.
 *
 * `plans` need not be sorted - the oldest-first order is established here, so every caller gets
 * the same answer for the same data regardless of how it arrived.
 */
export function allocatePayments(plans: PlanInput[], payments: PaymentInput[]): AllocationResult {
  const ordered = [...plans].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
  );
  const byPlan = new Map<string, PlanAllocation>();
  const credited = new Map<string, Money>();
  const overpaid = new Map<string, Money>();
  for (const p of ordered) {
    credited.set(p.id, ZERO);
    overpaid.set(p.id, ZERO);
  }

  // ── Pass 1: payments that name their plan ──────────────────────────────────────
  // A named payment is never moved elsewhere, even when it overshoots: the operator said where
  // this money went, and silently re-homing the excess would make the link a suggestion.
  let unlinkedTotal: Money = ZERO;
  for (const pay of payments) {
    const id = pay.pendingPaymentId;
    if (id && credited.has(id)) credited.set(id, add(credited.get(id)!, pay.amount));
    // A link pointing at a plan that is archived or gone behaves as unlinked money rather than
    // vanishing - the payment still arrived.
    else unlinkedTotal = add(unlinkedTotal, pay.amount);
  }

  // Named money beyond a plan's total is recorded as overpayment and does NOT crowd out the
  // unlinked money that still has to find a home.
  for (const p of ordered) {
    const got = credited.get(p.id)!;
    const over = clampLow(sub(got, p.toCollect));
    if (!isZero(over)) {
      overpaid.set(p.id, over);
      credited.set(p.id, sub(got, over));
    }
  }

  // ── Pass 2: everything else, oldest plan first, each only up to its own balance ─
  for (const p of ordered) {
    if (isZero(unlinkedTotal)) break;
    const room = sub(p.toCollect, credited.get(p.id)!);
    const take = capped(unlinkedTotal, room);
    if (isZero(take)) continue;
    credited.set(p.id, add(credited.get(p.id)!, take));
    unlinkedTotal = sub(unlinkedTotal, take);
  }

  for (const p of ordered) {
    const paid = credited.get(p.id)!;
    byPlan.set(p.id, {
      paid,
      balance: clampLow(sub(p.toCollect, paid)),
      overpaid: overpaid.get(p.id)!,
    });
  }

  return { byPlan, unapplied: clampLow(unlinkedTotal) };
}

/**
 * The key a payment and a plan are paired under when neither carries a student id.
 *
 * Case- and whitespace-insensitive, because "anna  smith" and "Anna Smith" are one person to
 * everybody except a string comparison. An id ALWAYS wins over this: two students who share a
 * name are exactly the ambiguity the student code exists to settle.
 */
/* Allocation matches a payment to a plan by this key. One definition, in lib/name-key.ts - it was five identical copies, all of
   them deciding whether a payment belongs to a student, so any divergence would have
   split somebody's money in half. Re-exported rather than moved so existing importers
   are untouched. */
export { nameKey };

/** `studentId` when there is one, the normalised name otherwise. */
export function studentKey(studentId: string | null, studentName: string): string {
  return studentId ? `id:${studentId}` : `name:${nameKey(studentName)}`;
}

/** Which currency a plan's fee was actually entered in. "BOTH" when the founder typed each side. */
export type QuotedIn = "INR" | "EUR" | "BOTH";

/**
 * Has this plan been collected in full?
 *
 * Deliberately NOT "balance is zero and nothing else": a plan with a schedule is only finished
 * when its instalments agree, because the ladder is what the dunning engine chases. A plan with
 * no schedule has nothing to disagree with and goes on the balance alone - which is the case
 * that used to sit at "Active" forever, since the only code that ever set PAID_IN_FULL lived in
 * the instalment settler.
 *
 * ── Only the currency the debt was QUOTED in may hold it open ────────────────────
 * Every amount here is a `{inr, eur}` pair, but only one side of that pair was ever typed: the
 * other is the stamped FX rate applied to it. A plan and the payments against it are stamped on
 * different days at different rates, so the converted side drifts by a minor unit or two - and
 * requiring BOTH sides to reach zero let that drift decide whether a debt was paid.
 *
 * That is not hypothetical. A ₹2,50,000 plan, collected to the rupee, read "Still to collect
 * ₹0.00 / 0,01 €" and stayed Active: one cent of arithmetic residue, in a currency nobody had
 * quoted, against a quarter of a million rupees that had arrived. The nightly sweep would never
 * have closed it either, so the student stayed in the dunning queue indefinitely.
 *
 * The rule is the same one the ₹/€ toggle follows: a converted figure is for reading, never for
 * deciding. A plan quoted in both currencies is a genuine two-currency debt, and both sides of it
 * do have to clear.
 */
export function isSettled(input: {
  balance: Money;
  instalmentCount: number;
  unpaidInstalments: number;
  /**
   * Defaults to "BOTH" - the strictest reading - so a caller that has not said which side was
   * quoted can never accidentally close a debt that is genuinely outstanding.
   */
  quotedIn?: QuotedIn;
}): boolean {
  const quoted = input.quotedIn ?? "BOTH";
  const owes =
    quoted === "INR"
      ? input.balance.inr > 0
      : quoted === "EUR"
        ? input.balance.eur > 0
        : input.balance.inr > 0 || input.balance.eur > 0;
  if (owes) return false;
  return input.instalmentCount === 0 || input.unpaidInstalments === 0;
}
