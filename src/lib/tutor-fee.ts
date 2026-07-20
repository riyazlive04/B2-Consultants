import {
  DEFAULT_TUTOR_FEE_CONFIG,
  type TutorFeeConfig,
  type TutorFeeLevel,
} from "./config-schema";

/**
 * The trainer-fee rule from the founders' walkthrough (spec Part 2 §5, restated in the
 * Part 2 §17 quick reference):
 *
 *     rate = (students >= 5) ? ₹7,000 : ₹8,000    — per level, per head
 *
 * Pure on purpose: every input arrives as an argument, so the rule is unit-testable
 * without a database, a session or a running server. Read the config with
 * `getTutorFeeConfig()` (server/founder-config.ts) and pass it in.
 *
 * Worked examples from the spec:
 *   - 5 students in an A1 batch → 5 × ₹7,000 = ₹35,000
 *   - 3 students in an A1 batch → 3 × ₹8,000 = ₹24,000  (the "₹8,000 tier")
 *
 * The threshold is a >= boundary: exactly 5 students earns the ₹7,000 rate, which is what
 * FIN-004 and FIN-005 in the test plan pin down from either side.
 */

/** Money in this codebase is integer paise. */
const RUPEES_TO_PAISE = 100;

/**
 * The per-head rate for one level at a given batch size, in WHOLE RUPEES.
 *
 * An unknown level falls back to the shipped band rather than throwing: this is called
 * from finance read paths, and a config missing a level should not blank a P&L page.
 */
export function tutorRatePerHeadRupees(
  level: TutorFeeLevel,
  headcount: number,
  config: TutorFeeConfig = DEFAULT_TUTOR_FEE_CONFIG,
): number {
  const band = config.ratesByLevel[level] ?? DEFAULT_TUTOR_FEE_CONFIG.ratesByLevel[level];
  return headcount >= config.thresholdStudents ? band.atOrAbove : band.below;
}

/**
 * Total owed to the tutor for running one level of one batch, in paise.
 *
 * An empty batch costs nothing — without this guard a 0-student batch would bill the
 * `below` rate against a headcount of 0 and still read as ₹0, but only by accident; the
 * explicit branch is what makes that intentional.
 */
export function tutorFeeForBatchInrMinor(
  level: TutorFeeLevel,
  headcount: number,
  config: TutorFeeConfig = DEFAULT_TUTOR_FEE_CONFIG,
): number {
  if (headcount <= 0) return 0;
  return tutorRatePerHeadRupees(level, headcount, config) * RUPEES_TO_PAISE * headcount;
}

/**
 * The rate bands as a display row, for the console and the batch P&L to explain *why* a
 * batch is charged what it is — the founders' sheet shows the tier, not just the total.
 */
export function tutorFeeBandLabel(
  level: TutorFeeLevel,
  headcount: number,
  config: TutorFeeConfig = DEFAULT_TUTOR_FEE_CONFIG,
): string {
  const band = headcount >= config.thresholdStudents ? "at-or-above" : "below";
  const rate = tutorRatePerHeadRupees(level, headcount, config);
  return `${headcount} student${headcount === 1 ? "" : "s"} → ${band} ${config.thresholdStudents} → ₹${rate.toLocaleString("en-IN")}/head`;
}
