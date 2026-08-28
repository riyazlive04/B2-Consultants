import type { BantDimension } from "@prisma/client";
import {
  answerScore, BANT_ANSWER_SCORES, DIMENSION_MET_AT, INTAKE_OPTIONS, intakeLabel,
  SCORED_QUESTION_KEYS,
} from "./booking-intake";
import { DIMENSION_BY_KEY, QUESTION_TEXT } from "./qualification";

/**
 * What the prospect answered, and what each answer was worth.
 *
 * ── Why this module exists ──────────────────────────────────────────────────────
 * The verdict was visible everywhere and its REASONS nowhere. A specialist could see "2.6 / 5 -
 * Doubt" and had no way to learn which answer cost the prospect the marks, which is the only
 * form of the number that is any use on a call. Worse, the two places that did show answers
 * disagreed about which answers they were: the contact record listed only the LANDING PAGE's
 * answers (`LeadAnswer` rows are written by the opt-in path alone) and therefore showed nothing
 * at all for a prospect who had qualified by BOOKING A DISCOVERY CALL - which is most of them.
 *
 * ── Where a booking's per-answer score comes from ───────────────────────────────
 * A booking's answers live in BookingRequest's own columns and were never stored per question -
 * only the four dimension booleans and the average survive the submit. The score shown here is
 * therefore RE-DERIVED from `BANT_ANSWER_SCORES`, the same table `computeBant` scores from, so
 * it is the real figure rather than an estimate. It re-derives rather than reads because there
 * is nothing to read.
 *
 * That has one consequence worth being honest about, and `stale` below is how it is said out
 * loud: this table lives in code, so editing a score changes what an OLD booking appears to have
 * scored, even though the stored average still reflects the old table. The opt-in path has no
 * such problem - a `LeadAnswer` stores its score at submit time, which is why those lines are
 * passed through untouched.
 */
export type BantAnswerLine = {
  /** The wording the prospect was actually shown. */
  question: string;
  /** Their answer, as a human label rather than a stored slug. */
  answer: string;
  dimension: BantDimension;
  /** 0-5. Null when the question scores nothing (context questions) or the score was not kept. */
  score: number | null;
  /**
   * Whether this answer divides the average. `commitment` is the case this exists for: the form
   * stopped asking it, so it still HAS a score but no longer counts towards anything, and showing
   * it as though it did would send someone hunting for a 0.3 that is not there.
   */
  counted: boolean;
  /** True when the score was re-derived from today's table rather than stored at submit time. */
  derived: boolean;
};

/** Is this dimension's evidence strong enough to count as met? Mirrors computeBant. */
export function scoreMeetsBar(score: number | null): boolean {
  return score !== null && score >= DIMENSION_MET_AT;
}

const COUNTED = new Set<string>(SCORED_QUESTION_KEYS);

/**
 * The columns a booking answers, in the order the form asks them.
 *
 * Context questions are included even though they score nothing - "what do you do" and "why
 * Germany" are the two answers a specialist most wants in front of them, and a qualification
 * card that hides them is answering the wrong question.
 */
const BOOKING_KEYS = [
  "whenStartGermany", "alreadyApplied", "commitment",
  "readyToInvest", "currentIncome", "decisionMaking",
  "germanLevel", "willingnessLearnGerman", "germanVisa",
] as const satisfies readonly (keyof typeof INTAKE_OPTIONS)[];

/** Free-text answers - no options, so nothing to score, but they carry the story. */
const BOOKING_TEXT_KEYS = ["currentJobTitle", "prospectIndustry", "yearsExperience", "highestEducation", "whyGermany", "reasonForCall"] as const;

export function bookingAnswerLines(booking: Record<string, unknown> | null | undefined): BantAnswerLine[] {
  if (!booking) return [];
  const lines: BantAnswerLine[] = [];

  for (const key of BOOKING_KEYS) {
    const value = booking[key];
    if (typeof value !== "string" || !value) continue;
    const scorable = key in BANT_ANSWER_SCORES;
    lines.push({
      question: QUESTION_TEXT[key] ?? key,
      answer: intakeLabel(key, value),
      dimension: DIMENSION_BY_KEY[key] ?? ("NONE" as BantDimension),
      score: scorable ? answerScore(key as keyof typeof BANT_ANSWER_SCORES, value) : null,
      counted: COUNTED.has(key),
      derived: scorable,
    });
  }

  for (const key of BOOKING_TEXT_KEYS) {
    const value = booking[key];
    if (typeof value !== "string" || !value.trim()) continue;
    lines.push({
      question: QUESTION_TEXT[key] ?? key,
      answer: value.trim(),
      dimension: "NONE" as BantDimension,
      score: null,
      counted: false,
      derived: false,
    });
  }

  return lines;
}

/** `LeadAnswer` rows - the opt-in path, where every score was stored when it was given. */
export function storedAnswerLines(
  answers: readonly {
    answerRaw: string;
    score: number | null;
    question: { key?: string; text: string; dimension: BantDimension };
  }[],
): BantAnswerLine[] {
  return answers.map((a) => ({
    question: a.question.text,
    answer: a.answerRaw,
    dimension: a.question.dimension,
    score: a.score,
    counted: a.question.key ? COUNTED.has(a.question.key) : a.question.dimension !== "NONE",
    derived: false,
  }));
}
