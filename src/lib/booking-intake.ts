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

/** Which answer values count as a "yes" for each BANT dimension. */
const QUALIFIES = {
  budget: new Set(["ready_now", "need_plan", "10_20l", "gt_20l"]),
  authority: new Set(["mine", "family"]),
  need: new Set(["actively", "applied_no_response", "fully", "serious"]),
  timeline: new Set(["immediately", "3_months", "6_months"]),
} as const;

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
  bantScore: number; // 0-4
};

/**
 * BANT scoring. Budget = ready to invest OR high income; Authority = has a say in the
 * decision; Need = actively pursuing / committed; Timeline = starting within ~6 months.
 * Score is the count of dimensions met (0-4) - same shape the pipeline "Call these
 * first" ranking already consumes from DiscoveryOutcome.
 */
export function computeBant(input: BantInput): BantResult {
  const budget =
    QUALIFIES.budget.has(input.readyToInvest ?? "") ||
    QUALIFIES.budget.has(input.currentIncome ?? "");
  const authority = QUALIFIES.authority.has(input.decisionMaking ?? "");
  const need =
    QUALIFIES.need.has(input.alreadyApplied ?? "") ||
    QUALIFIES.need.has(input.commitment ?? "");
  const timeline = QUALIFIES.timeline.has(input.whenStartGermany ?? "");
  const bantScore = [budget, authority, need, timeline].filter(Boolean).length;
  return { bantBudget: budget, bantAuthority: authority, bantNeed: need, bantTimeline: timeline, bantScore };
}

/** Map a stored value back to its human label for tables / the closer view. */
export function intakeLabel(field: keyof typeof INTAKE_OPTIONS, value: string | null | undefined): string {
  if (!value) return "-";
  const opt = (INTAKE_OPTIONS[field] as readonly IntakeOption[]).find((o) => o.value === value);
  return opt?.label ?? value;
}
