/**
 * Tutor fee RECORD — turning the rule in `tutor-fee.ts` into something the founders can
 * approve and pay (ER v2 Track C).
 *
 * `tutor-fee.ts` answers "what is owed". This answers "what should the row say, and may it
 * change". It deliberately does not re-implement the rate rule — it calls it — because a
 * posting rule that exists twice is a posting rule that will eventually disagree with itself.
 *
 * Pure: no prisma, no session. The DB side is `server/tutor-fee-actions.ts`.
 */

import type { TutorFeeStatus } from "@prisma/client";
import { tutorFeeForBatchInrMinor, tutorRatePerHeadRupees } from "./tutor-fee";
import { DEFAULT_TUTOR_FEE_CONFIG, type TutorFeeConfig, type TutorFeeLevel } from "./config-schema";

const RUPEES_TO_PAISE = 100;

/** The four fields a recompute writes. All snapshots — see the model comment on `TutorFee`. */
export type ComputedTutorFee = {
  headcount: number;
  ratePerHeadInrMinor: bigint;
  amountInrMinor: bigint;
  /** Human explanation of WHICH band applied and why, for the review table. */
  bandLabel: string;
};

/**
 * The level codes the fee bands are keyed on. `Level.code` is "GN_A1"; the config's band keys
 * are "A1". Anything that is not a German level has no tutor fee — coaching tiers are
 * delivered by a coach on salary, not a per-head trainer.
 */
export function tutorFeeLevelFromCode(levelCode: string): TutorFeeLevel | null {
  const stripped = levelCode.startsWith("GN_") ? levelCode.slice(3) : levelCode;
  return stripped === "A1" || stripped === "A2" || stripped === "B1" ? stripped : null;
}

/**
 * What the fee row for a batch should say, given who is actually seated in it right now.
 *
 * Returns null when the level carries no trainer fee, so callers skip rather than write a
 * zero row — a ₹0 fee and "this batch has no trainer fee concept" are different claims, and
 * a table full of the former hides the latter.
 */
export function computeTutorFee(
  levelCode: string,
  headcount: number,
  config: TutorFeeConfig = DEFAULT_TUTOR_FEE_CONFIG,
): ComputedTutorFee | null {
  const level = tutorFeeLevelFromCode(levelCode);
  if (!level) return null;

  const ratePerHeadRupees = tutorRatePerHeadRupees(level, headcount, config);
  const amount = tutorFeeForBatchInrMinor(level, headcount, config);
  const band = headcount >= config.thresholdStudents ? "at or above" : "below";

  return {
    headcount,
    ratePerHeadInrMinor: BigInt(ratePerHeadRupees * RUPEES_TO_PAISE),
    amountInrMinor: BigInt(amount),
    bandLabel: `${headcount} student${headcount === 1 ? "" : "s"} — ${band} ${config.thresholdStudents} → ₹${ratePerHeadRupees.toLocaleString("en-IN")}/head`,
  };
}

/**
 * Is this fee still recomputable?
 *
 * DRAFT rows track the roster: someone joins, the fee goes up. APPROVED and PAID rows are
 * frozen — the founder signed off on a number computed against a headcount, and a student
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
 * Everything downstream — the batch P&L, the ledger accrual, the payout total — must read
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
