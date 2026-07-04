/**
 * Booking intake catalogue + BANT scoring - the in-house replacement for Synamate's
 * "Appointment booking" qualification form and its BANT SCORE column.
 *
 * Isomorphic (no server-only): the public booking form renders selects from
 * INTAKE_OPTIONS, and the submit action scores the same values with computeBant().
 * Because the qualifying answers are a fixed option set (not free text), scoring is
 * deterministic and easy for Ameen to re-tune later - change the `qualifies` lists
 * below and both the form and the score move together.
 */

export type IntakeOption = { value: string; label: string };

/** Every select's option list. Keys match BookingRequest columns. */
export const INTAKE_OPTIONS = {
  yearsExperience: [
    { value: "0-2", label: "0 - 2 years" },
    { value: "2-5", label: "2 - 5 years" },
    { value: "5-10", label: "5 - 10 years" },
    { value: "10+", label: "10+ years" },
  ],
  highestEducation: [
    { value: "diploma", label: "Diploma" },
    { value: "bachelors", label: "Bachelors" },
    { value: "masters", label: "Masters" },
    { value: "phd", label: "PhD" },
    { value: "other", label: "Other" },
  ],
  // ── Timeline (BANT: T) ──
  whenStartGermany: [
    { value: "immediately", label: "Immediately" },
    { value: "3_months", label: "In the next 3 months" },
    { value: "6_months", label: "In the next 6 months" },
    { value: "6_12_months", label: "In 6 - 12 months" },
    { value: "exploring", label: "Just exploring for now" },
  ],
  // ── Need (BANT: N) ──
  alreadyApplied: [
    { value: "actively", label: "Yes - actively applying now" },
    { value: "applied_no_response", label: "Applied, but no responses" },
    { value: "planning", label: "Planning to start soon" },
    { value: "not_yet", label: "Not yet" },
  ],
  commitment: [
    { value: "fully", label: "Fully committed to moving to Germany" },
    { value: "serious", label: "Serious, but have questions" },
    { value: "curious", label: "Just curious" },
  ],
  // ── Budget (BANT: B) ──
  readyToInvest: [
    { value: "ready_now", label: "Yes - ready to invest in the right program" },
    { value: "need_plan", label: "Yes, but I'd need a payment plan" },
    { value: "unsure", label: "Not sure yet" },
    { value: "no", label: "No" },
  ],
  currentIncome: [
    { value: "lt_5l", label: "Under ₹5,00,000 / year" },
    { value: "5_10l", label: "₹5,00,000 - ₹10,00,000 / year" },
    { value: "10_20l", label: "₹10,00,000 - ₹20,00,000 / year" },
    { value: "gt_20l", label: "Over ₹20,00,000 / year" },
  ],
  // ── Authority (BANT: A) ──
  decisionMaking: [
    { value: "mine", label: "Yes - it's fully my decision" },
    { value: "family", label: "I decide together with my family / partner" },
    { value: "other", label: "Someone else decides" },
  ],
  // Context (not scored, kept for the closer - parity with Synamate)
  germanVisa: [
    { value: "none", label: "No German visa" },
    { value: "student", label: "Student visa" },
    { value: "work", label: "Work visa" },
    { value: "eu", label: "EU passport / PR" },
    { value: "living", label: "Already living in Germany" },
  ],
  germanLevel: [
    { value: "none", label: "None" },
    { value: "a1", label: "Beginner (A1)" },
    { value: "a2", label: "A2" },
    { value: "b1", label: "B1" },
    { value: "b2+", label: "B2 or higher" },
  ],
  willingnessLearnGerman: [
    { value: "yes", label: "Yes, I'm ready to learn German" },
    { value: "maybe", label: "Maybe, if needed" },
    { value: "no", label: "No" },
  ],
  participateWorkshop: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
  howKnowUs: [
    { value: "instagram", label: "Instagram" },
    { value: "youtube", label: "YouTube" },
    { value: "linkedin", label: "LinkedIn" },
    { value: "referral", label: "A friend / referral" },
    { value: "summit", label: "Germany Career Summit" },
    { value: "ghosted_blueprint", label: "The Ghosted Blueprint" },
    { value: "other", label: "Other" },
  ],
} as const satisfies Record<string, readonly IntakeOption[]>;

/**
 * Weighted BANT (client notes): "for this answer, this score". Every qualifying answer
 * carries a 0-5 score; a dimension's score is the BEST evidence available for it (e.g.
 * high income still counts toward Budget when the invest answer is lukewarm). Retune by
 * editing the numbers - the form, the score and the verdict all move together.
 */
export const BANT_ANSWER_SCORES: Record<string, Record<string, number>> = {
  // ── Budget ──
  readyToInvest: { ready_now: 5, need_plan: 3, unsure: 1.5, no: 0 },
  currentIncome: { gt_20l: 5, "10_20l": 4, "5_10l": 2.5, lt_5l: 1 },
  // ── Authority ──
  decisionMaking: { mine: 5, family: 3, other: 1 },
  // ── Need ──
  alreadyApplied: { actively: 5, applied_no_response: 4, planning: 3, not_yet: 1.5 },
  commitment: { fully: 5, serious: 3.5, curious: 1 },
  // ── Timeline ──
  whenStartGermany: { immediately: 5, "3_months": 4, "6_months": 3, "6_12_months": 2, exploring: 0.5 },
};

/** A dimension counts as "met" (the boolean the pipeline ranking consumes) at ≥3/5. */
const DIMENSION_MET_AT = 3;

/** Verdict thresholds on the 0-5 average: >3 confirm · 2-3 doubt · <2 cancel. */
export function bantVerdictFor(avg: number): "CONFIRM" | "DOUBT" | "CANCEL" {
  if (avg > 3) return "CONFIRM";
  if (avg >= 2) return "DOUBT";
  return "CANCEL";
}

export type BantInput = {
  readyToInvest?: string | null;
  currentIncome?: string | null;
  decisionMaking?: string | null;
  alreadyApplied?: string | null;
  commitment?: string | null;
  whenStartGermany?: string | null;
};

export type BantResult = {
  bantBudget: boolean;
  bantAuthority: boolean;
  bantNeed: boolean;
  bantTimeline: boolean;
  bantScore: number; // 0-4 count of dimensions met (pipeline-compatible)
  bantAvg: number; // 0-5 mean of the four weighted dimension scores
  bantVerdict: "CONFIRM" | "DOUBT" | "CANCEL";
};

const answerScore = (field: keyof typeof BANT_ANSWER_SCORES, value: string | null | undefined) =>
  BANT_ANSWER_SCORES[field][value ?? ""] ?? 0;

/**
 * Weighted BANT scoring. Each dimension scores 0-5 from its best answer; bantAvg is the
 * mean and bantVerdict applies Ameen's thresholds. The booleans + 0-4 bantScore keep the
 * exact shape the pipeline "Call these first" ranking already consumes.
 */
export function computeBant(input: BantInput): BantResult {
  const budget = Math.max(answerScore("readyToInvest", input.readyToInvest), answerScore("currentIncome", input.currentIncome));
  const authority = answerScore("decisionMaking", input.decisionMaking);
  const need = Math.max(answerScore("alreadyApplied", input.alreadyApplied), answerScore("commitment", input.commitment));
  const timeline = answerScore("whenStartGermany", input.whenStartGermany);

  const dims = [budget, authority, need, timeline];
  const bantAvg = Math.round((dims.reduce((a, b) => a + b, 0) / dims.length) * 10) / 10;
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

/** Map a stored value back to its human label for tables / the closer view. */
export function intakeLabel(field: keyof typeof INTAKE_OPTIONS, value: string | null | undefined): string {
  if (!value) return "-";
  const opt = (INTAKE_OPTIONS[field] as readonly IntakeOption[]).find((o) => o.value === value);
  return opt?.label ?? value;
}
