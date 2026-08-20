/**
 * Qualification catalogue - configurable questions, and scoring over their ANSWERS
 * (ER v2 Track D).
 *
 * Isomorphic and pure. The DB side is `server/qualification.ts` (reads) and
 * `server/qualification-actions.ts` (admin CRUD).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 * The questionnaire was 18 hardcoded columns on `BookingRequest` with the weights buried in
 * `booking-intake.ts`. The founders could not add, remove or reweight a question without
 * shipping a migration - even though the resulting BANT verdict decides who gets called.
 *
 * ── The safety property ──────────────────────────────────────────────────────────
 * `scoreFromAnswers` MUST agree with `computeBant` for every submission that today's form
 * can produce. It is not "equivalent by inspection": `catalogueFromIntake()` DERIVES the
 * question catalogue from INTAKE_OPTIONS and BANT_ANSWER_SCORES - the very tables
 * `computeBant` scores against - so the two cannot drift by transcription. The seed writes
 * that derived catalogue, and the shadow phase compares the two scorers on live traffic.
 *
 * The one rule that is easy to get wrong and expensive to get wrong: a dimension's score is
 * the MAX over its questions ("the best evidence available for it"), NOT their sum or mean.
 * High income still counts toward Budget when the invest answer is lukewarm.
 */

import type { BantDimension, QuestionKind } from "@prisma/client";
import { INTAKE_OPTIONS, BANT_ANSWER_SCORES, bantVerdictFor, type BantResult } from "./booking-intake";

/**
 * One option on a SELECT-style question. `score` is the 0–5 weighted layer.
 *
 * `aliases` are additional ANSWER TEXTS an external form may send for this option - the landing
 * page posts its own wording, not our slug. Optional so every option written before inbound
 * mapping existed stays valid; `value` and `label` are always accepted without being listed.
 * See `lib/qualification-inbound.ts` for the matching rules.
 */
export type QuestionOption = { value: string; label: string; score: number; aliases?: string[] };

/** The serializable shape of a `QualificationQuestion` row. */
export type QuestionSpec = {
  key: string;
  version: number;
  text: string;
  helpText: string | null;
  kind: QuestionKind;
  options: QuestionOption[];
  /** Field names an external form may use for this question. Empty = match on `key` alone. */
  inboundKeys: string[];
  dimension: BantDimension;
  weight: number;
  required: boolean;
  orderIndex: number;
};

/** The four scored dimensions, in the order the average is taken over. */
export const SCORED_DIMENSIONS = ["BUDGET", "AUTHORITY", "NEED", "TIMELINE"] as const;

/** A dimension counts as "met" at ≥3/5 - the same constant `computeBant` uses. */
const DIMENSION_MET_AT = 3;

/** Answers keyed by question `key`, exactly as the form posts them. */
export type AnswerMap = Record<string, string | null | undefined>;

/**
 * The 0–5 score one answer contributes.
 *
 * `weight` multiplies and the result is clamped back into 0–5, so the average stays on the
 * same scale the verdict thresholds are expressed in. A weight of 1 - what the seed uses
 * everywhere - is the identity, which is what makes the derived catalogue reproduce
 * `computeBant` exactly.
 */
export function optionScore(q: QuestionSpec, value: string | null | undefined): number {
  if (!value) return 0;
  const opt = q.options.find((o) => o.value === value);
  if (!opt) return 0;
  return Math.min(5, Math.max(0, opt.score * q.weight));
}

/**
 * Score a submission against a question catalogue.
 *
 * The average is over every SCORED QUESTION, mirroring `computeBant` - so a dimension with two
 * questions carries twice the weight of one with a single question. That is the founders' own
 * hand-scoring made explicit (20/08/2026).
 *
 * Divides by the questions the catalogue HAS, never by "questions that were answered": an
 * unanswered scored question contributes 0 and stays in the denominator. Dropping it would
 * quietly inflate the verdict of every incomplete submission, which is the opposite of what a
 * qualification score is for. The consequence is that a scored question the form never asks
 * costs every prospect a share of their score - see the note in `computeBant`.
 *
 * The dimension booleans below are unchanged and still take the best evidence per dimension,
 * because the pipeline ranking consumes them.
 */
export function scoreFromAnswers(answers: AnswerMap, questions: QuestionSpec[]): BantResult {
  const dims = SCORED_DIMENSIONS.map((dimension) => {
    const forDim = questions.filter((q) => q.dimension === dimension);
    // MAX, not sum: "the best evidence available for this dimension".
    return forDim.reduce((best, q) => Math.max(best, optionScore(q, answers[q.key])), 0);
  });

  const scored = questions.filter((q) => (SCORED_DIMENSIONS as readonly BantDimension[]).includes(q.dimension));
  const total = scored.reduce((sum, q) => sum + optionScore(q, answers[q.key]), 0);
  const bantAvg = scored.length ? Math.round((total / scored.length) * 10) / 10 : 0;
  const met = dims.map((d) => d >= DIMENSION_MET_AT);

  return {
    bantBudget: met[0],
    bantAuthority: met[1],
    bantNeed: met[2],
    bantTimeline: met[3],
    bantScore: met.filter(Boolean).length,
    bantAvg,
    bantVerdict: bantVerdictFor(bantAvg),
  };
}

/**
 * Which BANT dimension each of today's hardcoded questions feeds. Mirrors the section
 * comments in `booking-intake.ts` - questions absent from BANT_ANSWER_SCORES score nothing
 * and are kept for context, exactly as they are today.
 */
export const DIMENSION_BY_KEY: Record<string, BantDimension> = {
  readyToInvest: "BUDGET",
  currentIncome: "BUDGET",
  decisionMaking: "AUTHORITY",
  alreadyApplied: "NEED",
  commitment: "NEED",
  whenStartGermany: "TIMELINE",
};

/** The founders' wording for each question, as the public form asks it today. */
export const QUESTION_TEXT: Record<string, string> = {
  yearsExperience: "How many years of work experience do you have?",
  highestEducation: "What is your highest qualification?",
  whenStartGermany: "When are you looking to start your move to Germany?",
  alreadyApplied: "Have you already applied for jobs in Germany?",
  commitment: "How committed are you to moving to Germany?",
  readyToInvest: "Are you ready to invest in the right program?",
  currentIncome: "What is your current annual income?",
  decisionMaking: "Who makes the decision to go ahead?",
  germanVisa: "Do you currently hold a German visa?",
  germanLevel: "What is your current German level?",
  willingnessLearnGerman: "Are you willing to learn German?",
  participateWorkshop: "Would you like to join our next workshop?",
  howKnowUs: "How did you hear about us?",
};

/**
 * DERIVE the question catalogue from the shipped intake tables.
 *
 * This is the whole safety argument for Track D's cutover. A hand-written seed would be
 * "equivalent by inspection" - a claim that survives exactly until someone mistypes a 3 as a
 * 5 in a 40-row score table and nobody notices, because the resulting verdict still looks
 * plausible. Deriving it makes divergence impossible by construction: the scores here ARE
 * BANT_ANSWER_SCORES, and the options here ARE INTAKE_OPTIONS.
 *
 * Ordering follows INTAKE_OPTIONS' declaration order, which is the order the form renders.
 */
export function catalogueFromIntake(): QuestionSpec[] {
  return Object.entries(INTAKE_OPTIONS).map(([key, options], index) => {
    const scores = BANT_ANSWER_SCORES[key] ?? {};
    return {
      key,
      version: 1,
      text: QUESTION_TEXT[key] ?? key,
      helpText: null,
      kind: "SELECT" as QuestionKind,
      options: (options as readonly { value: string; label: string }[]).map((o) => ({
        value: o.value,
        label: o.label,
        score: scores[o.value] ?? 0,
      })),
      // No seeded inbound mapping. `value` and `label` are accepted implicitly and the folded
      // match already gets `whenStartGermany` from "when_start_germany" or "When Start Germany"
      // unaided; anything beyond that is read off a REAL delivery. Seeding guesses here would
      // look like configuration someone had checked against a live payload when they had not.
      inboundKeys: [],
      dimension: DIMENSION_BY_KEY[key] ?? ("NONE" as BantDimension),
      weight: 1,
      required: key in DIMENSION_BY_KEY, // the scored questions are the ones we must have
      orderIndex: index,
    };
  });
}

/** Do two scoring results agree? The gate the Track D cutover is held to. */
export function bantResultsAgree(a: BantResult, b: BantResult): boolean {
  return (
    a.bantAvg === b.bantAvg &&
    a.bantScore === b.bantScore &&
    a.bantVerdict === b.bantVerdict &&
    a.bantBudget === b.bantBudget &&
    a.bantAuthority === b.bantAuthority &&
    a.bantNeed === b.bantNeed &&
    a.bantTimeline === b.bantTimeline
  );
}

export const DIMENSION_LABELS: Record<BantDimension, string> = {
  BUDGET: "Budget",
  AUTHORITY: "Authority",
  NEED: "Need",
  TIMELINE: "Timeline",
  NONE: "Context only",
};
