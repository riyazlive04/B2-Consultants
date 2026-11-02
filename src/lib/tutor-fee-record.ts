/**
 * Tutor fee RECORD - turning the rule in `tutor-fee.ts` into something the founders can
 * approve and pay (ER v2 Track C).
 *
 * `tutor-fee.ts` answers "what is owed". This answers "what should the row say, and may it
 * change". It deliberately does not re-implement the rate rule - it calls it - because a
 * posting rule that exists twice is a posting rule that will eventually disagree with itself.
 *
 * Pure: no prisma, no session. The DB side is `server/tutor-fee-actions.ts`.
 */

import type { TutorFeeStatus } from "@prisma/client";
import { tutorFeeForBatchInrMinor, tutorRatePerHeadRupees } from "./tutor-fee";
import { DEFAULT_TUTOR_FEE_CONFIG, type TutorFeeConfig, type TutorFeeLevel } from "./config-schema";

const RUPEES_TO_PAISE = 100;

/** The four fields a recompute writes. All snapshots - see the model comment on `TutorFee`. */
export type ComputedTutorFee = {
  headcount: number;
  ratePerHeadInrMinor: bigint;
  amountInrMinor: bigint;
  /** Human explanation of WHICH band applied and why, for the review table. */
  bandLabel: string;
};

/** `Level.code` is "GN_A1"; the rate card keys its bands as "A1". */
export function stripLevelPrefix(levelCode: string): string {
  return levelCode.startsWith("GN_") ? levelCode.slice(3) : levelCode;
}

/**
 * THE GATE: does this level carry a trainer fee at all?
 *
 * Returns the card's key for the level, or null when the card does not price it. Null is not an
 * error - coaching tiers are delivered by a coach on salary, not a per-head trainer, and a level
 * the founders have not given a rate for is a level they have not decided about yet. Callers skip
 * on null rather than writing a zero row, because "₹0" and "no trainer fee concept here" are
 * different claims and a table full of the first hides the second.
 *
 * ── What changed on 1 Nov 2026, and what deliberately did not ───────────────────────────────
 * This used to answer `A1 | A2 | B1` from a hardcoded comparison, so a GN_B2 batch was dropped
 * from the tutor-cost table with nothing on screen saying a level had been skipped. It now asks
 * the founder's rate card instead.
 *
 * The BEHAVIOUR for an unpriced level is unchanged on purpose: no band, no fee, omitted. Adding
 * the ability to price B2 must not retroactively start pricing it at a guessed rate - that would
 * silently restate the German Note P&L for every month already reported. The founder adds the row
 * when they are ready, and only then does the level start costing anything.
 */
export function tutorFeeLevelFromCode(
  levelCode: string,
  config: TutorFeeConfig = DEFAULT_TUTOR_FEE_CONFIG,
): TutorFeeLevel | null {
  const stripped = stripLevelPrefix(levelCode);
  return config.ratesByLevel[stripped] ? stripped : null;
}

/**
 * What the fee row for a batch should say, given who is actually seated in it right now.
 *
 * Returns null when the level carries no trainer fee, so callers skip rather than write a
 * zero row - a ₹0 fee and "this batch has no trainer fee concept" are different claims, and
 * a table full of the former hides the latter.
 */
export function computeTutorFee(
  levelCode: string,
  headcount: number,
  config: TutorFeeConfig = DEFAULT_TUTOR_FEE_CONFIG,
): ComputedTutorFee | null {
  const level = tutorFeeLevelFromCode(levelCode, config);
  if (!level) return null;

  const ratePerHeadRupees = tutorRatePerHeadRupees(level, headcount, config);
  const amount = tutorFeeForBatchInrMinor(level, headcount, config);
  const band = headcount >= config.thresholdStudents ? "at or above" : "below";

  return {
    headcount,
    ratePerHeadInrMinor: BigInt(ratePerHeadRupees * RUPEES_TO_PAISE),
    amountInrMinor: BigInt(amount),
    bandLabel: `${headcount} student${headcount === 1 ? "" : "s"} - ${band} ${config.thresholdStudents} → ₹${ratePerHeadRupees.toLocaleString("en-IN")}/head`,
  };
}

/**
 * Is this fee still recomputable?
 *
 * DRAFT rows track the roster: someone joins, the fee goes up. APPROVED and PAID rows are
 * frozen - the founder signed off on a number computed against a headcount, and a student
 * arriving next month must not silently re-price it. CANCELLED rows are left alone too;
 * reviving one is a deliberate act, not a side effect of a nightly job.
 *
 * The database enforces this as well (`tutor_fee_settled_guard`). This function exists so the
 * recompute can SKIP AND REPORT rather than hit an exception it would have to interpret.
 */
export function isRecomputable(status: TutorFeeStatus): boolean {
  return status === "DRAFT";
}

/** Allowed status moves. Anything absent is rejected by the action, not silently ignored. */
const TRANSITIONS: Record<TutorFeeStatus, readonly TutorFeeStatus[]> = {
  DRAFT: ["APPROVED", "CANCELLED"],
  APPROVED: ["PAID", "CANCELLED"],
  PAID: [], // terminal: money left the building
  CANCELLED: ["DRAFT"], // re-open for a fresh recompute
};

export function canTransition(from: TutorFeeStatus, to: TutorFeeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The figure actually owed: the override when one is set, otherwise the computed amount.
 *
 * Everything downstream - the batch P&L, the ledger accrual, the payout total - must read
 * THIS, never `amountInrMinor` directly, or an override would show on screen and be ignored
 * by the money.
 */
export function payableAmountInrMinor(fee: {
  amountInrMinor: bigint;
  overrideAmountInrMinor: bigint | null;
}): bigint {
  return fee.overrideAmountInrMinor ?? fee.amountInrMinor;
}

export const TUTOR_FEE_STATUS_LABELS: Record<TutorFeeStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};
