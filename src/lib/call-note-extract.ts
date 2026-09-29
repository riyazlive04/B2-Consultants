/**
 * Call note → structured outcome. The specialist types what actually happened, in the
 * shorthand they'd use anyway ("wants it but father decides, call Sun"), and this turns it
 * into the fields the discovery form asks for: the outcome, the four BANT boxes, a follow-up
 * date, and one clean line for the closer.
 *
 * WHY IT EXISTS: BANT and outcome drive priority scoring, the HQ rate, commission and the
 * SSS ladder - and they are the fields most likely to be left at their defaults when someone
 * has fifteen more calls to make. The note gets typed regardless. Reading the note is
 * therefore the cheapest place in the app to recover that data.
 *
 * PURE and isomorphic - no prisma, no server-only, no hidden `new Date()`. `today` is passed
 * in, so every relative date ("Sunday", "in 3 days") is testable without fake timers, the
 * same contract as automation-quiet-hours.ts and daily-log.ts.
 *
 * TWO ENGINES, ONE SHAPE. `heuristicExtract` is a deterministic keyword pass that always
 * runs; the Claude path (server/call-note-extract.ts) is layered on top when the founder has
 * armed it. Both return the same `CallNoteExtraction`, both carry `source`, and the UI says
 * which one produced the suggestion. That is deliberate: the AI seam in this app is
 * keys-off by default (lib/anthropic.ts), so a feature that only works with a key would be
 * dead weight on a fresh install - and a suggestion whose provenance is hidden is worse than
 * no suggestion at all.
 *
 * NOTHING HERE DECIDES ANYTHING. The output is a suggestion the human confirms before the
 * form is submitted; `highlyQualified` in particular is never auto-applied (see below).
 */

// ───────────────────────────── shapes ─────────────────────────────

/** The `CallOutcome` enum values, restated so this file stays isomorphic (no @prisma/client). */
export const CALL_OUTCOMES = [
  "QUALIFIED_FOR_SSS",
  "NOT_QUALIFIED_FOR_SSS",
  "FOLLOW_UP_NEEDED",
  "NO_SHOW",
  "SENT_TO_WORKSHOP",
] as const;
export type CallOutcomeValue = (typeof CALL_OUTCOMES)[number];

export type BantFlags = { budget: boolean; authority: boolean; need: boolean; timeline: boolean };

/** Which phrase in the note justified each field - shown in the UI so a tick can be checked. */
export type Evidence = Partial<Record<"outcome" | "budget" | "authority" | "need" | "timeline" | "followUpDate", string>>;

export type CallNoteExtraction = {
  /** null = the note doesn't say; leave the form's current value alone */
  outcome: CallOutcomeValue | null;
  bant: BantFlags;
  /** YYYY-MM-DD, only when the note actually implies one */
  followUpDate: string | null;
  /** short tag for what's blocking - "decision-maker absent", "budget", … */
  objection: string | null;
  /** one clean line for the closer */
  summary: string | null;
  /**
   * Reads as highly qualified. SUGGESTION ONLY - never auto-applied to the checkbox.
   * `highlyQualified` is capability-guarded (outreach.qualify) and drives priority scoring,
   * the HQ-rate metric, gamification XP and the SSS confirmation ladder. A model that ticks
   * it silently would be writing to a permissioned field through the back door.
   */
  highlyQualified: boolean;
  /** 0–1. Below LOW_CONFIDENCE the UI asks for a human read rather than pre-filling. */
  confidence: number;
  evidence: Evidence;
  source: "ai" | "rules";
};

export const LOW_CONFIDENCE = 0.5;

const EMPTY_BANT: BantFlags = { budget: false, authority: false, need: false, timeline: false };

export function emptyExtraction(source: "ai" | "rules"): CallNoteExtraction {
  return {
    outcome: null,
    bant: { ...EMPTY_BANT },
    followUpDate: null,
    objection: null,
    summary: null,
    highlyQualified: false,
    confidence: 0,
    evidence: {},
    source,
  };
}

// ───────────────────────────── dates ─────────────────────────────

const DAY_MS = 86_400_000;
/** A follow-up further out than this is a mis-parse, not a plan. */
const MAX_FOLLOW_UP_DAYS = 180;

/**
 * Weekday names and the short forms people actually type in a hurry. The alternation is
 * `\b`-anchored, so "sun" can't swallow the start of "sunday" - the engine backtracks to the
 * longer alias.
 */
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/** YYYY-MM-DD for a Date, in UTC - the form's date inputs are date-only, so no timezone maths. */
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD key to a UTC Date. Returns null for anything malformed. */
export function fromDateKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip guard: "2026-02-31" parses to 3 March, which is not the date anyone meant.
  return toDateKey(d) === key ? d : null;
}

/**
 * The next occurrence of `weekday` strictly after `from`. "Call Sunday" said on a Sunday
 * means next Sunday, not today - the call already happened today.
 */
export function nextWeekday(from: Date, weekday: number): Date {
  const delta = ((weekday - from.getUTCDay() + 7) % 7) || 7;
  return new Date(from.getTime() + delta * DAY_MS);
}

/**
 * A follow-up date is only kept if it's plausibly a follow-up: not before the call, and not
 * beyond MAX_FOLLOW_UP_DAYS. Everything else is dropped rather than shown - a wrong date
 * silently written into the form is the most expensive mistake this feature could make.
 */
export function boundFollowUp(key: string | null, today: string): string | null {
  if (!key) return null;
  const d = fromDateKey(key);
  const base = fromDateKey(today);
  if (!d || !base) return null;
  const days = Math.round((d.getTime() - base.getTime()) / DAY_MS);
  if (days < 0 || days > MAX_FOLLOW_UP_DAYS) return null;
  return key;
}

/**
 * Relative dates as people write them in a call note. Returns a YYYY-MM-DD key or null.
 * Deliberately narrow: the four shapes that actually show up ("tomorrow", a weekday,
 * "next week", "in N days"). Anything else is left for a human.
 */
export function parseRelativeDate(text: string, today: string): { key: string; phrase: string } | null {
  const base = fromDateKey(today);
  if (!base) return null;
  const s = text.toLowerCase();

  const tomorrow = /\btomorrow\b|\btmrw?\b/.exec(s);
  if (tomorrow) return { key: toDateKey(new Date(base.getTime() + DAY_MS)), phrase: tomorrow[0] };

  const inDays = /\bin (\d{1,3}) days?\b/.exec(s);
  if (inDays) {
    const n = Number(inDays[1]);
    if (n > 0 && n <= MAX_FOLLOW_UP_DAYS) return { key: toDateKey(new Date(base.getTime() + n * DAY_MS)), phrase: inDays[0] };
  }

  // Weekday before "next week": "call next Sunday" should resolve to the Sunday, not +7 days.
  const weekday = new RegExp(`\\b(${Object.keys(WEEKDAY_ALIASES).join("|")})\\b`).exec(s);
  if (weekday) {
    const idx = WEEKDAY_ALIASES[weekday[1]];
    if (typeof idx === "number") return { key: toDateKey(nextWeekday(base, idx)), phrase: weekday[0] };
  }

  const nextWeek = /\bnext week\b/.exec(s);
  if (nextWeek) return { key: toDateKey(new Date(base.getTime() + 7 * DAY_MS)), phrase: nextWeek[0] };

  return null;
}

// ───────────────────────────── the deterministic pass ─────────────────────────────

/** Phrase → field, with the phrase kept so the UI can show why a box was ticked. */
type Rule = { re: RegExp; phrase: string };

const rule = (source: string, phrase: string): Rule => ({ re: new RegExp(source, "i"), phrase });

const BUDGET_RULES: Rule[] = [
  rule("\\bcan afford\\b|\\bafford(s|able)?\\b", "affordability mentioned"),
  rule("\\bbudget (is )?(ok|fine|approved|sorted|ready)\\b", "budget confirmed"),
  rule("\\bhas (the )?(funds|money|savings)\\b", "funds mentioned"),
  rule("\\bready to (invest|pay|spend)\\b", "ready to invest"),
  rule("\\bloan (approved|sanctioned)\\b", "loan approved"),
];
const BUDGET_NEGATIVE = /\bno budget\b|\bcan'?t afford\b|\bcannot afford\b|\btoo expensive\b|\bno money\b|\bfunds? (issue|problem)\b/i;

const AUTHORITY_RULES: Rule[] = [
  rule("\\b(sole|final) decision\\b|\\bdecision ?maker\\b", "decision maker"),
  rule("\\bhe (decides|will decide)\\b|\\bshe (decides|will decide)\\b|\\bi decide\\b", "decides themselves"),
  rule("\\bown decision\\b|\\bdecides? (on )?(his|her|their) own\\b", "decides alone"),
];
const AUTHORITY_NEGATIVE =
  /\bfather\b|\bmother\b|\bparents?\b|\bhusband\b|\bwife\b|\bspouse\b|\bfamily (will )?decides?\b|\bneeds? (to )?(ask|check with|discuss with)\b|\bmanager (approval|decides)\b/i;

const NEED_RULES: Rule[] = [
  rule("\\b(really |very )?(keen|interested|serious)\\b", "expressed interest"),
  rule("\\bwants? (to|the|it)\\b|\\bwilling\\b", "wants it"),
  rule("\\bmotivated\\b|\\bdesperate\\b|\\bkeen to (move|shift|go)\\b", "motivated"),
  rule("\\bneeds? (a |the )?(job|change|move|shift)\\b", "need stated"),
];
const NEED_NEGATIVE = /\bnot interested\b|\bjust (looking|browsing|curious)\b|\btime ?pass\b|\bnot serious\b/i;

const TIMELINE_RULES: Rule[] = [
  rule("\\b(this|next) (month|quarter|year)\\b", "timeframe given"),
  rule("\\bwithin \\d+ (weeks?|months?)\\b", "timeframe given"),
  rule("\\basap\\b|\\bimmediately\\b|\\bright away\\b|\\burgent\\b", "urgent"),
  rule("\\bstart(ing)? (in|by|from) \\w+\\b", "start date given"),
  rule("\\bready to (start|begin|join)\\b", "ready to start"),
];
const TIMELINE_NEGATIVE = /\bno (rush|hurry|timeline)\b|\bsome ?time later\b|\bnext year maybe\b|\bnot (sure|decided) when\b/i;

const OUTCOME_RULES: { outcome: CallOutcomeValue; re: RegExp; phrase: string }[] = [
  { outcome: "NO_SHOW", re: /\bno[- ]?show\b|\bdidn'?t (show|join|turn up|attend)\b|\bnever joined\b|\bnot available for the call\b/i, phrase: "no show" },
  { outcome: "SENT_TO_WORKSHOP", re: /\bworkshop\b/i, phrase: "workshop mentioned" },
  { outcome: "NOT_QUALIFIED_FOR_SSS", re: /\bnot qualified\b|\bnot interested\b|\bdisqualif|\bnot a fit\b|\bwrong (profile|fit)\b/i, phrase: "not qualified" },
  { outcome: "QUALIFIED_FOR_SSS", re: /\bqualified\b|\bbook(ed)? (the )?sss\b|\bstrategy session\b|\bmoving to sss\b/i, phrase: "qualified / SSS" },
  { outcome: "FOLLOW_UP_NEEDED", re: /\bfollow[- ]?up\b|\bcall (back|again|him|her|them)\b|\brevert\b|\bwill (think|discuss|get back)\b/i, phrase: "follow-up needed" },
];

const OBJECTION_RULES: { tag: string; re: RegExp }[] = [
  { tag: "decision-maker absent", re: AUTHORITY_NEGATIVE },
  { tag: "budget", re: BUDGET_NEGATIVE },
  { tag: "timing", re: TIMELINE_NEGATIVE },
  { tag: "not interested", re: NEED_NEGATIVE },
  { tag: "German language", re: /\bgerman\b.{0,20}\b(hard|difficult|worried|scared|no time)\b/i },
];

function firstMatch(text: string, rules: Rule[]): string | null {
  for (const r of rules) if (r.re.test(text)) return r.phrase;
  return null;
}

/**
 * Deterministic extraction - no network, no key, always available.
 *
 * It is intentionally conservative: a rule fires only on a phrase that means one thing, and
 * every BANT dimension has a negative pattern that VETOES a positive match ("wants it but
 * father decides" is Need yes, Authority no). Confidence scales with how much it actually
 * found, so a note it barely understood presents as a weak suggestion rather than a
 * confident wrong one.
 */
export function heuristicExtract(note: string, today: string): CallNoteExtraction {
  const out = emptyExtraction("rules");
  const text = (note ?? "").trim();
  if (!text) return out;

  const evidence: Evidence = {};

  const budgetHit = BUDGET_NEGATIVE.test(text) ? null : firstMatch(text, BUDGET_RULES);
  const authorityHit = AUTHORITY_NEGATIVE.test(text) ? null : firstMatch(text, AUTHORITY_RULES);
  const needHit = NEED_NEGATIVE.test(text) ? null : firstMatch(text, NEED_RULES);
  const timelineHit = TIMELINE_NEGATIVE.test(text) ? null : firstMatch(text, TIMELINE_RULES);

  out.bant = {
    budget: Boolean(budgetHit),
    authority: Boolean(authorityHit),
    need: Boolean(needHit),
    timeline: Boolean(timelineHit),
  };
  if (budgetHit) evidence.budget = budgetHit;
  if (authorityHit) evidence.authority = authorityHit;
  if (needHit) evidence.need = needHit;
  if (timelineHit) evidence.timeline = timelineHit;

  for (const r of OUTCOME_RULES) {
    if (r.re.test(text)) {
      out.outcome = r.outcome;
      evidence.outcome = r.phrase;
      break;
    }
  }

  const rel = parseRelativeDate(text, today);
  if (rel) {
    out.followUpDate = boundFollowUp(rel.key, today);
    if (out.followUpDate) evidence.followUpDate = rel.phrase;
  }

  for (const o of OBJECTION_RULES) {
    if (o.re.test(text)) {
      out.objection = o.tag;
      break;
    }
  }

  out.evidence = evidence;
  // Four BANT dimensions + outcome + date = 6 signals; confidence is how many landed,
  // capped below 1 because a keyword pass is never certain about a human sentence.
  const found = Object.keys(evidence).length;
  out.confidence = Math.min(0.75, found / 6);
  return out;
}

// ───────────────────────────── the model pass ─────────────────────────────

/**
 * The system prompt. Two rules do the heavy lifting:
 *   - "unstated is not false" - the note is shorthand, so silence must map to null/false
 *     rather than an invented negative;
 *   - every field carries the phrase it came from, so a human can check a tick in one glance
 *     instead of re-reading the note.
 */
export const EXTRACTION_SYSTEM = [
  "You read a sales call note written in a hurry by a discovery specialist at a German-careers consultancy and turn it into structured fields.",
  "",
  "Return ONLY a JSON object, no prose, with exactly these keys:",
  '  outcome: one of "QUALIFIED_FOR_SSS" | "NOT_QUALIFIED_FOR_SSS" | "FOLLOW_UP_NEEDED" | "NO_SHOW" | "SENT_TO_WORKSHOP" | null',
  "  bant: { budget: boolean, authority: boolean, need: boolean, timeline: boolean }",
  "  followUpDate: \"YYYY-MM-DD\" or null",
  "  objection: a short lowercase tag for the main blocker, or null",
  "  summary: one sentence for the closer, or null",
  "  highlyQualified: boolean",
  "  confidence: number between 0 and 1",
  "  evidence: an object mapping any of outcome|budget|authority|need|timeline|followUpDate to the exact phrase from the note that justifies it",
  "",
  "Rules:",
  "- The note is shorthand. If it does not say, use null or false. Never infer a negative from silence.",
  "- authority is TRUE only if this prospect decides alone. A parent, spouse or manager deciding means FALSE.",
  "- budget is about whether they can pay, not whether they want to.",
  "- timeline needs a stated timeframe, not general eagerness.",
  "- Resolve relative dates against the call date you are given. Never return a date before it.",
  "- Every field you fill must appear in `evidence`. If you cannot quote the note for it, leave the field null or false.",
  "- Quote the note verbatim in `evidence` - do not paraphrase.",
].join("\n");

/** The user turn: the note, plus the call date so relative dates resolve. */
export function buildExtractionUser(note: string, callDate: string): string {
  return [`Call date: ${callDate}`, "", "Call note:", note.trim()].join("\n");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asBool = (v: unknown): boolean => v === true;
const asText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * Validate whatever the model returned into a `CallNoteExtraction`.
 *
 * Everything is treated as hostile: an unknown outcome string, a date in the past, a
 * confidence of 7, evidence as an array. The model is a suggestion engine pointed at fields
 * that drive commission - this is the boundary where that suggestion has to become
 * well-formed or be dropped.
 */
export function coerceExtraction(raw: unknown, today: string): CallNoteExtraction {
  const out = emptyExtraction("ai");
  if (!isRecord(raw)) return out;

  if (typeof raw.outcome === "string" && (CALL_OUTCOMES as readonly string[]).includes(raw.outcome)) {
    out.outcome = raw.outcome as CallOutcomeValue;
  }

  const bant = isRecord(raw.bant) ? raw.bant : {};
  out.bant = {
    budget: asBool(bant.budget),
    authority: asBool(bant.authority),
    need: asBool(bant.need),
    timeline: asBool(bant.timeline),
  };

  out.followUpDate = boundFollowUp(typeof raw.followUpDate === "string" ? raw.followUpDate : null, today);
  out.objection = asText(raw.objection, 40)?.toLowerCase() ?? null;
  out.summary = asText(raw.summary, 280);
  out.highlyQualified = asBool(raw.highlyQualified);

  const conf = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : 0;
  out.confidence = Math.max(0, Math.min(1, conf));

  if (isRecord(raw.evidence)) {
    const ev: Evidence = {};
    for (const k of ["outcome", "budget", "authority", "need", "timeline", "followUpDate"] as const) {
      const phrase = asText(raw.evidence[k], 120);
      if (phrase) ev[k] = phrase;
    }
    out.evidence = ev;
  }

  // A tick with no evidence is exactly what the prompt forbids, so it's a signal the model
  // drifted - drop the tick rather than the whole extraction. Same for a dropped date.
  if (out.bant.budget && !out.evidence.budget) out.bant.budget = false;
  if (out.bant.authority && !out.evidence.authority) out.bant.authority = false;
  if (out.bant.need && !out.evidence.need) out.bant.need = false;
  if (out.bant.timeline && !out.evidence.timeline) out.bant.timeline = false;
  if (!out.followUpDate) delete out.evidence.followUpDate;

  return out;
}

// ───────────────────────────── presentation ─────────────────────────────

export const BANT_LABELS: Record<keyof BantFlags, string> = {
  budget: "Budget",
  authority: "Authority",
  need: "Need",
  timeline: "Timeline",
};

/** "Filled 3 fields from the note." - the one line the panel leads with. */
export function summariseExtraction(x: CallNoteExtraction): string {
  const bits: string[] = [];
  if (x.outcome) bits.push("the outcome");
  const ticks = (Object.keys(x.bant) as (keyof BantFlags)[]).filter((k) => x.bant[k]);
  if (ticks.length) bits.push(`${ticks.length} BANT box${ticks.length === 1 ? "" : "es"}`);
  if (x.followUpDate) bits.push("a follow-up date");
  if (bits.length === 0) return "Nothing in that note mapped to a field - fill them in by hand.";
  const last = bits.pop();
  const list = bits.length ? `${bits.join(", ")} and ${last}` : last;
  return `Suggested ${list} from the note.`;
}
