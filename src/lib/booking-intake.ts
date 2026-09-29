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

/**
 * Every select's option list. Keys match BookingRequest columns.
 *
 * ── These are Synamate's questions, verbatim ────────────────────────────────────
 * The wording, the option sets and their ORDER are copied from the live
 * optin.b2consultants.de intake (07/08/2026) rather than paraphrased. Two reasons: the sales
 * team reads these answers all day and recognises them by their exact phrasing, and the BANT
 * bands below were tuned against what those specific answers mean. A "cleaner" rewrite would
 * silently re-score the pipeline.
 *
 * VALUES are stable slugs, never the label text. A label can be reworded without invalidating
 * every stored answer, and `LEGACY_INTAKE_LABELS` keeps rows written before this change
 * readable (see `intakeLabel`).
 */
export const INTAKE_OPTIONS = {
  highestEducation: [
    { value: "diploma", label: "Diploma" },
    { value: "bachelors", label: "Bachelors" },
    { value: "masters", label: "Masters" },
  ],
  yearsExperience: [
    { value: "fresher", label: "Fresher" },
    { value: "1-2", label: "1 - 2 years" },
    { value: "2-5", label: "2 - 5 years" },
    { value: "5+", label: "5+ years" },
  ],
  // ── Need (BANT: N) ──
  alreadyApplied: [
    { value: "not_started", label: "No, I haven't started applying." },
    { value: "applied_no_response", label: "I've applied, but no responses" },
    { value: "interviews_no_offer", label: "I got some interviews, but no offer" },
  ],
  // ── Timeline (BANT: T) ──
  whenStartGermany: [
    { value: "6_months", label: "in next 6 months." },
    { value: "6_12_months", label: "in 6-12 months." },
    { value: "exploring", label: "No fixed timeline, just exploring for now." },
  ],
  // Context (not scored, kept for the closer - parity with Synamate)
  germanVisa: [
    { value: "none", label: "No, I don't" },
    { value: "planning", label: "I am planning to apply" },
    { value: "yes", label: "Yes, I do" },
  ],
  germanLevel: [
    { value: "none", label: "No German knowledge." },
    { value: "a1", label: "A1 level" },
    { value: "a2", label: "A2 level" },
    { value: "b1_plus", label: "B1 or higher" },
  ],
  willingnessLearnGerman: [
    { value: "no", label: "No, I'm not interested in learning German." },
    { value: "yes", label: "Yes, I am ready to learn German." },
  ],
  /**
   * ── Budget (BANT: B) - NOTE THE UNIT CHANGE ────────────────────────────────────
   * MONTHLY rupees. The previous catalogue asked for annual income, so the bands and their
   * scores below are not a re-labelling of the old ones - ₹50,000/month and ₹50,000/year are
   * opposite ends of the market. Old rows keep their annual values and their annual scores
   * (see BANT_ANSWER_SCORES); nothing is retro-fitted onto a question that was never asked.
   */
  currentIncome: [
    { value: "lt_30k", label: "Less than ₹30,000" },
    { value: "30_50k", label: "₹30,000 - ₹50,000" },
    { value: "50_75k", label: "₹50,000 – ₹75,000" },
    { value: "75k_1l", label: "₹75,000 - ₹1,00,000" },
    { value: "gt_1l", label: "More than ₹1,00,000" },
  ],
  readyToInvest: [
    { value: "ready_now", label: "Ready to invest" },
    { value: "need_clarity", label: "Need clarity before deciding" },
    { value: "not_ready", label: "Not ready at the moment" },
  ],
  // ── Authority (BANT: A) ──
  decisionMaking: [
    { value: "mine", label: "I make the final decision myself" },
    { value: "consult", label: "I make decisions, but consult others" },
    { value: "other", label: "Someone else makes the final decision" },
  ],
  howKnowUs: [
    { value: "instagram", label: "Instagram" },
    { value: "facebook", label: "Facebook" },
    { value: "linkedin", label: "LinkedIn" },
    { value: "workshop", label: "Workshop" },
    { value: "youtube", label: "YouTube" },
    { value: "google", label: "Google" },
    { value: "referral", label: "Someone referred me" },
  ],
  /**
   * Dropped from the public form when it was matched to Synamate's, but KEPT here: both still
   * have stored answers, `optional("commitment")` still parses them, and the closer's view
   * still renders them through `intakeLabel`. Removing the key would turn every historical
   * answer into a raw slug on screen.
   */
  commitment: [
    { value: "fully", label: "Fully committed to moving to Germany" },
    { value: "serious", label: "Serious, but have questions" },
    { value: "curious", label: "Just curious" },
  ],
  participateWorkshop: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
} as const satisfies Record<string, readonly IntakeOption[]>;

/** Suggested industries. Free text on purpose - the form lets a prospect add their own. */
export const INDUSTRY_SUGGESTIONS = ["IT Related", "Mechanical Related"] as const;

/**
 * Labels for answers that are no longer offered.
 *
 * Every booking taken before 07/08/2026 holds a value from the old catalogue. Without this,
 * `intakeLabel` falls through to the raw slug and the Bookings table starts showing "lt_5l"
 * and "b2+" against real prospects - the history silently degrades the moment the question
 * changes. Keyed by field so an old `none` cannot be read as a different field's `none`.
 */
export const LEGACY_INTAKE_LABELS: Record<string, Record<string, string>> = {
  highestEducation: { phd: "PhD", other: "Other" },
  yearsExperience: { "0-2": "0 - 2 years", "5-10": "5 - 10 years", "10+": "10+ years" },
  alreadyApplied: { actively: "Yes - actively applying now", planning: "Planning to start soon", not_yet: "Not yet" },
  whenStartGermany: { immediately: "Immediately", "3_months": "In the next 3 months" },
  germanVisa: { student: "Student visa", work: "Work visa", eu: "EU passport / PR", living: "Already living in Germany" },
  germanLevel: { a1: "Beginner (A1)", b1: "B1", "b2+": "B2 or higher" },
  willingnessLearnGerman: { maybe: "Maybe, if needed" },
  currentIncome: {
    lt_5l: "Under ₹5,00,000 / year",
    "5_10l": "₹5,00,000 - ₹10,00,000 / year",
    "10_20l": "₹10,00,000 - ₹20,00,000 / year",
    gt_20l: "Over ₹20,00,000 / year",
  },
  readyToInvest: { need_plan: "Yes, but I'd need a payment plan", unsure: "Not sure yet", no: "No" },
  decisionMaking: { family: "I decide together with my family / partner" },
  howKnowUs: { summit: "Germany Career Summit", ghosted_blueprint: "The Ghosted Blueprint", other: "Other" },
};

/**
 * Weighted BANT (client notes): "for this answer, this score". Every qualifying answer
 * carries a 0-4 score; a dimension's score is the BEST evidence available for it (e.g.
 * high income still counts toward Budget when the invest answer is lukewarm). Retune by
 * editing the numbers - the form, the score and the verdict all move together.
 */
export const BANT_ANSWER_SCORES: Record<string, Record<string, number>> = {
  // ── Budget ──
  readyToInvest: {
    ready_now: 4, need_clarity: 2, not_ready: 0,
    // legacy
    need_plan: 2.4, unsure: 1.2, no: 0,
  },
  currentIncome: {
    // Monthly bands (current form).
    gt_1l: 4, "75k_1l": 3.2, "50_75k": 2.4, "30_50k": 1.6, lt_30k: 0.8,
    // Legacy ANNUAL bands, kept at their original scores. A stored `5_10l` meant ₹5–10 lakh a
    // YEAR and must keep scoring as that; silently re-reading it against the monthly bands
    // would re-rank every prospect booked before the question changed.
    gt_20l: 4, "10_20l": 3.2, "5_10l": 2, lt_5l: 0.8,
  },
  // ── Authority ──
  decisionMaking: {
    mine: 4, consult: 2.8, other: 0.8,
    // legacy
    family: 2.4,
  },
  // ── Need ──
  /**
   * "Interviews but no offer" scores highest: they have proven the market wants them and that
   * something in the process is failing, which is exactly what the program fixes. Someone who
   * has not started applying has the weakest evidence of need, not the strongest.
   */
  alreadyApplied: {
    interviews_no_offer: 4, applied_no_response: 3.2, not_started: 1.6,
    // legacy
    actively: 4, planning: 2.4, not_yet: 1.2,
  },
  // No longer asked on the public form; still scored so a historical row replays identically.
  commitment: { fully: 4, serious: 2.8, curious: 0.8 },
  // ── Timeline ──
  /**
   * "In the next 6 months" is now the most urgent option the form offers, so it takes the top
   * score. Leaving it at its old 2.4 would have capped Timeline at exactly the "met" threshold and
   * made a genuinely urgent prospect indistinguishable from a borderline one.
   */
  whenStartGermany: {
    "6_months": 4, "6_12_months": 2.4, exploring: 0.4,
    // legacy
    immediately: 4, "3_months": 3.2,
  },
};

/**
 * The top of the BANT scale. Every answer, every dimension and the average run 0-4.
 *
 * It was 0-5 until 22/09/2026, when the founders asked for BANT to read out of 4. Every score
 * and threshold was multiplied by 0.8, so each prospect's verdict is unchanged; the migration
 * `20260922180000_bant_scale_out_of_4` rescaled the stored scores the same way.
 */
export const BANT_MAX = 4;

/** Above this average the verdict is Confirm. */
export const BANT_CONFIRM_ABOVE = 2.4;
/** At or above this average (and not above BANT_CONFIRM_ABOVE) the verdict is Doubt; below it, Cancel. */
export const BANT_DOUBT_FROM = 1.6;

/** A dimension counts as "met" (the boolean the pipeline ranking consumes) at ≥2.4/4. */
export const DIMENSION_MET_AT = 2.4;

/** Verdict thresholds on the 0-4 average: >2.4 confirm · 1.6-2.4 doubt · <1.6 cancel. */
export function bantVerdictFor(avg: number): "CONFIRM" | "DOUBT" | "CANCEL" {
  if (avg > BANT_CONFIRM_ABOVE) return "CONFIRM";
  if (avg >= BANT_DOUBT_FROM) return "DOUBT";
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
  bantAvg: number; // 0-4 mean of the scored answers
  bantVerdict: "CONFIRM" | "DOUBT" | "CANCEL";
};

/**
 * The 0-4 the scorer gives ONE answer. Exported because the contact record and the caller's
 * desk now show it per question: "why did this prospect score 2.6" is only answerable from
 * the individual answers, and re-deriving that table in the view layer is how the number on
 * screen starts disagreeing with the number in the verdict.
 */
export const answerScore = (field: keyof typeof BANT_ANSWER_SCORES, value: string | null | undefined) =>
  BANT_ANSWER_SCORES[field][value ?? ""] ?? 0;

/**
 * Weighted BANT scoring. Each dimension scores 0-4 from its best answer; bantAvg is the
 * mean and bantVerdict applies Ameen's thresholds. The booleans + 0-4 bantScore keep the
 * exact shape the pipeline "Call these first" ranking already consumes.
 */
/**
 * The questions the average divides by - and every one of them is on the live form.
 *
 * `commitment` is deliberately ABSENT. It was scored here until 20/08/2026 while the public form
 * had stopped asking it, so it returned 0 for every submission and took ~0.25 off everyone. That
 * is invisible in a ranking, because a constant shifts everything equally - but the verdict
 * thresholds are absolute and below 1.6 auto-disqualifies, so it was rejecting borderline
 * applicants over a blank. Its scores stay in `BANT_ANSWER_SCORES` so a historical row can still
 * be read; it just no longer divides anything.
 *
 * The rule to keep: a key belongs here only while the form actually asks it. Adding a question
 * to this list without adding it to `BookingIntakeFields` re-creates the same bug.
 */
export const SCORED_QUESTION_KEYS = [
  "readyToInvest",
  "currentIncome",
  "decisionMaking",
  "alreadyApplied",
  "whenStartGermany",
] as const;

export function computeBant(input: BantInput): BantResult {
  const budget = Math.max(answerScore("readyToInvest", input.readyToInvest), answerScore("currentIncome", input.currentIncome));
  const authority = answerScore("decisionMaking", input.decisionMaking);
  /**
   * NEED rests on `alreadyApplied` alone.
   *
   * `commitment` was folded in here too until 20/08/2026. Leaving it while removing it from the
   * average looked harmless - the boolean is "is there evidence for this dimension", and an old
   * answer is still evidence - but it made the two scorers disagree: the catalogue no longer
   * carries the question at all, so a historical row answering it got bantNeed true from one
   * scorer and false from the other. Two scorers that disagree cannot both be right, and the
   * cutover gate would have blocked the catalogue forever. Scored in one place or neither.
   */
  const need = answerScore("alreadyApplied", input.alreadyApplied);
  const timeline = answerScore("whenStartGermany", input.whenStartGermany);

  const dims = [budget, authority, need, timeline];
  const met = dims.map((d) => d >= DIMENSION_MET_AT);
  /**
   * The average is over the six QUESTIONS, not the four dimensions (founder decision,
   * 20/08/2026). Budget therefore carries two votes and Authority one, which is the weighting
   * the sales team had been applying by hand in the "New BANT" sheet.
   *
   * The denominator is the five questions the form asks - see `SCORED_QUESTION_KEYS` for why
   * `commitment` is not among them.
   *
   * The dimension booleans and `bantScore` above are deliberately UNCHANGED - they still take
   * the best evidence per dimension, because the pipeline's "call these first" ranking consumes
   * them and that is a different question from "how strong is this prospect overall".
   */
  const scores = SCORED_QUESTION_KEYS.map((k) => answerScore(k, input[k as keyof BantInput]));
  const bantAvg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

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
 * Map a stored value back to its human label for tables / the closer view.
 *
 * Falls back to the retired catalogue before giving up, so a booking taken under the previous
 * question set still reads as English rather than as its slug.
 */
export function intakeLabel(field: keyof typeof INTAKE_OPTIONS, value: string | null | undefined): string {
  if (!value) return "-";
  const opt = (INTAKE_OPTIONS[field] as readonly IntakeOption[]).find((o) => o.value === value);
  return opt?.label ?? LEGACY_INTAKE_LABELS[field]?.[value] ?? value;
}
