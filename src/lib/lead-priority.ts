/**
 * Which lead to work next - one scorer, founder-tunable.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 * The app had TWO rankings that disagreed, both hardcoded:
 *
 *   • `/pipeline`'s "Call these first" - stage weight + BANT×10 + highly-qualified 15 +
 *     new-this-week 10 − idle penalty.
 *   • The L1 desk - sorted each bucket by ARRIVAL TIME only. So the BANT score shown on every
 *     row changed nothing about the order a caller worked in. A 4.6/5 lead and a 0.5/5 lead that
 *     arrived the same morning were rung in the order they landed.
 *
 * Two rankings is one too many: the founder tunes what "worth calling" means in one place
 * (Console → Qualification decides the BANT score itself), and then the app has to actually act
 * on it consistently. This is that single act.
 *
 * ── Pure, and deliberately so ────────────────────────────────────────────────────
 * No prisma, no clock - `now` is passed in. The weights are the thing most likely to be argued
 * about, so they must be adjustable and testable without a database.
 *
 * ── The default weights reproduce today's pipeline ranking EXACTLY ───────────────
 * That is the safety property of this refactor, and it is asserted in the tests: shipping this
 * with `DEFAULT_PRIORITY_WEIGHTS` changes no existing ordering anywhere. Only a founder editing
 * the numbers changes behaviour.
 */

export type PriorityWeights = {
  /** Points per BANT dimension met (0–4). The founder's main dial. */
  bantPerPoint: number;
  /** Bonus for a lead a discovery specialist marked highly qualified. */
  highlyQualifiedBonus: number;
  /** A lead is "fresh" for this many days after it arrived. */
  freshWithinDays: number;
  /** Bonus while fresh. Speed-to-lead: a new lead converts far better than an old one. */
  freshBonus: number;
  /** Idle days are forgiven up to this point. */
  idleAfterDays: number;
  /** Penalty per idle day beyond `idleAfterDays`. */
  idlePenaltyPerDay: number;
  /**
   * Ceiling on the idle penalty.
   *
   * Uncapped, a year-old lead would score so far below zero that nothing could ever lift it back
   * into view - which is a decision to abandon it, not to deprioritise it. The cap keeps a stale
   * lead beatable rather than buried.
   */
  idlePenaltyMax: number;
};

/**
 * The shipped numbers, chosen to equal the previous hardcoded pipeline formula exactly:
 * `bant * 10`, `highlyQualified +15`, `freshDays <= 7 → +10`, `idleDays > 7 → −min(idle−7, 20)`.
 */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  bantPerPoint: 10,
  highlyQualifiedBonus: 15,
  freshWithinDays: 7,
  freshBonus: 10,
  idleAfterDays: 7,
  idlePenaltyPerDay: 1,
  idlePenaltyMax: 20,
};

export type PriorityInput = {
  /** 0–4 dimensions met. Null = never scored, which is NOT the same as scoring zero. */
  bantScore: number | null;
  /** When the lead arrived - drives freshness. */
  arrivedAt: Date;
  /** Last time anything moved on this lead. Null = nothing ever has. */
  lastActivityAt: Date | null;
  highlyQualified?: boolean;
  /**
   * Funnel position, supplied by the caller.
   *
   * Deliberately NOT part of the weights: stage order is structural (a deposit-paid lead
   * genuinely is further along than a new one) rather than a preference, and offering thirteen
   * stage boxes would bury the three dials that actually matter. The pipeline passes its
   * `STAGE_WEIGHT`; the desk passes 0 because every lead in a desk bucket is at the same point.
   */
  stageWeight?: number;
};

export type PriorityResult = {
  score: number;
  /** Human-readable, in the order applied - this is what the UI shows as "why". */
  reasons: string[];
};

const DAY_MS = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/**
 * Score one lead.
 *
 * An UNSCORED lead (`bantScore: null`) contributes nothing from BANT rather than a zero - the
 * same distinction the BANT chip makes on screen. Scoring it as zero would push every prospect
 * nobody has got round to asking below every prospect who answered badly, which is precisely
 * backwards: one is an absence of evidence, the other is evidence.
 */
export function priorityScore(
  input: PriorityInput,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
  now: Date = new Date(),
): PriorityResult {
  const reasons: string[] = [];
  let score = input.stageWeight ?? 0;

  if (input.bantScore != null && input.bantScore > 0) {
    score += input.bantScore * weights.bantPerPoint;
    reasons.push(`BANT ${input.bantScore}/4`);
  }

  if (input.highlyQualified) {
    score += weights.highlyQualifiedBonus;
    reasons.push("Highly qualified");
  }

  const ageDays = daysBetween(input.arrivedAt, now);
  if (ageDays <= weights.freshWithinDays) {
    score += weights.freshBonus;
    reasons.push("New this week");
  }

  // Idle is measured from the last thing that HAPPENED, falling back to arrival - a lead nobody
  // has touched since it landed is idle from the moment it landed.
  const idleDays = daysBetween(input.lastActivityAt ?? input.arrivedAt, now);
  if (idleDays > weights.idleAfterDays) {
    const penalty = Math.min((idleDays - weights.idleAfterDays) * weights.idlePenaltyPerDay, weights.idlePenaltyMax);
    score -= penalty;
    if (penalty > 0) reasons.push(`Idle ${idleDays}d`);
  }

  return { score, reasons };
}

/**
 * Sort comparator: highest score first, oldest arrival as the tie-break.
 *
 * The tie-break is not cosmetic. Without it, equally-scored leads come back in whatever order the
 * database returned them, so the queue reshuffles between page loads and a caller can never work
 * down it reliably. Oldest-first also preserves the previous desk behaviour for the very common
 * case where nothing is scored at all.
 */
export function byPriority(a: PriorityResult & { arrivedAt: Date }, b: PriorityResult & { arrivedAt: Date }): number {
  return b.score - a.score || a.arrivedAt.getTime() - b.arrivedAt.getTime();
}
