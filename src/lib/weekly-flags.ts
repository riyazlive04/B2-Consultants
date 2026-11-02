/**
 * THE RED FLAG ENGINE - Green, Yellow, Red, and why.
 *
 * ── Where every rule in here comes from ───────────────────────────────────────────────
 * The founders' tracker has a tab called "RED FLAG INTERVENTION SYSTEM" whose first line
 * is "Use this as your reference when flagging students". Every branch below is one row
 * of that tab, and the test file carries the tab's own wording beside each case so that a
 * rule cannot be quietly reinterpreted. Where a rule on that tab is NOT implemented here,
 * it says so and why, rather than being silently dropped.
 *
 * ── Why this replaces a human reading the rules ───────────────────────────────────────
 * The tab was applied by eye, every Monday, across thirty-odd students, by one person who
 * also had to copy the numbers between two sheets first. "A single missed form moves
 * Green to Yellow immediately, no grace period" is not a rule that survives that process
 * on a busy week. It survives this.
 *
 * ── Pure, and null is never zero ──────────────────────────────────────────────────────
 * No Prisma, no clock, no config read from anywhere - everything arrives as an argument.
 * And a metric the template never asked about arrives as `null`, which no rule may read
 * as a miss: a cohort whose form has no LinkedIn question has no LinkedIn figure, and
 * flagging those students for "zero posts" would be the app inventing a failure out of
 * its own omission. Same rule lib/attendance.ts applies to an unmarked register.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────────────
 * The tab's attendance rules ("missed 1 live session, no recording watched within 48hrs")
 * are real, but attendance already has an engine - `signalFor` in lib/attendance.ts, fed
 * by SessionAttendance and the catch-up window. Re-deriving them from this side would be
 * a second definition of "missed a session", free to disagree with the register. The
 * dashboard shows the attendance signal beside this flag instead of absorbing it.
 * Likewise the tab's judgement calls - "pushed back on expectations during onboarding",
 * "openly disengaged or negative" - are things a person noticed, not things a form can
 * know, so they arrive as a tutor's override rather than as a rule.
 */

export type WeeklyFlagValue = "GREEN" | "YELLOW" | "RED";

/** Mirrors `WeeklyMetric` in the schema. */
export type WeeklyMetricKey =
  | "APPLICATIONS"
  | "INTERVIEWS"
  | "NETWORKING"
  | "LINKEDIN_POSTS"
  | "LEARNING_HOURS"
  | "BLOCKERS"
  | "OTHER";

export type FlagReasonCode =
  | "ON_TRACK"
  | "FORM_MISSED"
  | "FORM_MISSED_TWICE"
  | "FORM_LATE"
  | "APPS_BELOW_TARGET"
  | "APPS_ZERO_TWO_WEEKS"
  | "NETWORKING_LOW"
  | "POSTS_LOW"
  | "NETWORKING_ZERO"
  | "POSTS_ZERO"
  | "NETWORKING_ZERO_TWO_WEEKS"
  | "POSTS_ZERO_TWO_WEEKS"
  | "VISIBILITY_WITHOUT_APPLICATIONS"
  | "GHOST"
  | "YELLOW_ESCALATED"
  | "RECOVERING"
  | "TUTOR_OVERRIDE";

/**
 * One line of plain English per reason.
 *
 * Every flag this engine raises is shown with its reason, never as a colour on its own -
 * DESIGN_SYSTEM §7. A tutor who sees "Red" and cannot see why has to go and re-derive it,
 * which is the manual Monday this feature exists to remove.
 */
export const WEEKLY_REASON_LABELS: Record<FlagReasonCode, string> = {
  ON_TRACK: "On track",
  FORM_MISSED: "Did not submit this week's report",
  FORM_MISSED_TWICE: "No report for two weeks running",
  FORM_LATE: "Report came in after the deadline",
  APPS_BELOW_TARGET: "Applications below the weekly target",
  APPS_ZERO_TWO_WEEKS: "No applications for two weeks running",
  NETWORKING_LOW: "Networking contacts well below target",
  POSTS_LOW: "LinkedIn posts well below target",
  NETWORKING_ZERO: "No networking contacts this week",
  POSTS_ZERO: "No LinkedIn posts this week",
  NETWORKING_ZERO_TWO_WEEKS: "No networking for two weeks running",
  POSTS_ZERO_TWO_WEEKS: "No LinkedIn posts for two weeks running",
  VISIBILITY_WITHOUT_APPLICATIONS: "Networking and posting, but not applying",
  GHOST: "Silent - no report for the whole ghost window",
  YELLOW_ESCALATED: "Second yellow week running, escalated",
  RECOVERING: "Recovering - one clean week so far",
  TUTOR_OVERRIDE: "Set by hand on review",
};

export type FlagReason = { code: FlagReasonCode; label: string };

function reason(code: FlagReasonCode): FlagReason {
  return { code, label: WEEKLY_REASON_LABELS[code] };
}

// ── Thresholds ────────────────────────────────────────────────────────────────────────

/**
 * The numbers the rules compare against, all founder-editable in Console.
 *
 * Defaults are the tracker's own: 10 applications a week, 7 networking contacts, 7
 * LinkedIn posts, "below 5 on either metric" as the yellow line, three silent weeks
 * before a Guided student is a ghost.
 */
export type WeeklyThresholds = {
  appsTarget: number;
  networkingTarget: number;
  linkedinTarget: number;
  /** "Below 5 on either metric" - the yellow line, distinct from the green target. */
  lowThreshold: number;
  /** Silent weeks before RED. Guided 3, Elite 2 - the tab's own split. */
  ghostWeeks: number;
  /** Consecutive yellow weeks that escalate to red. */
  yellowToRedWeeks: number;
  /** Clean weeks needed to come back from red. */
  recoveryGreenWeeks: number;
  /**
   * Elite only on the tracker: "1 miss = Yellow + Ameen is CC'd". The flag is the same;
   * who hears about it is not.
   */
  notifyAdminOnYellow: boolean;
};

export const WEEKLY_THRESHOLD_DEFAULTS: WeeklyThresholds = {
  appsTarget: 10,
  networkingTarget: 7,
  linkedinTarget: 7,
  lowThreshold: 5,
  ghostWeeks: 3,
  yellowToRedWeeks: 2,
  recoveryGreenWeeks: 2,
  notifyAdminOnYellow: false,
};

/**
 * Per-level overrides. The tab devotes a whole section to Elite being held to a tighter
 * line than Guided ("Elite students paid Rs 1.5L+. You fight harder to keep them"), so
 * the level is part of the rule, not a cosmetic label.
 */
export const WEEKLY_THRESHOLD_LEVEL_DEFAULTS: Record<string, Partial<WeeklyThresholds>> = {
  ELITE: { ghostWeeks: 2, notifyAdminOnYellow: true },
};

export function weeklyThresholdsFor(
  levelCode: string | null | undefined,
  base: WeeklyThresholds = WEEKLY_THRESHOLD_DEFAULTS,
  perLevel: Record<string, Partial<WeeklyThresholds>> = WEEKLY_THRESHOLD_LEVEL_DEFAULTS,
): WeeklyThresholds {
  const key = (levelCode ?? "").trim().toUpperCase();
  return { ...base, ...(key ? (perLevel[key] ?? {}) : {}) };
}

// ── Input ─────────────────────────────────────────────────────────────────────────────

/**
 * One week of one student's history, oldest first.
 *
 * CALLER'S CONTRACT: pass only the weeks for which a cycle actually existed AND the
 * student was on the roster. A week before they were seated is not a week they missed,
 * and a cohort that ran no cycle asked them nothing - counting either as silence would
 * flag a student for the office's own gap.
 */
export type WeeklyWeekInput = {
  isoWeek: string;
  /** YYYY-MM-DD, the Monday. */
  weekStart: string;
  submitted: boolean;
  late: boolean;
  /** Metric → the figure given. Absent or null means NOT ASKED / NOT ANSWERED, never 0. */
  metrics: Partial<Record<WeeklyMetricKey, number | null>>;
  /** The tutor's override for this week, if they set one. */
  override?: WeeklyFlagValue | null;
};

export type WeeklyFlagRow = {
  isoWeek: string;
  weekStart: string;
  /** This week's own verdict, before carry-forward and before any override. */
  weekFlag: WeeklyFlagValue;
  /** What the student's flag actually is at the end of this week. */
  flag: WeeklyFlagValue;
  reasons: FlagReason[];
  overridden: boolean;
};

export type WeeklyRollup = {
  flag: WeeklyFlagValue;
  reasons: FlagReason[];
  /** The tracker's "Weekly Form Streak": submitted weeks running, counting back. */
  streak: number;
  /** The tracker's "Weeks Silent". */
  weeksSilent: number;
  /** The tracker's "Last Form Date" - the Monday of the last week they submitted. */
  lastFormWeekStart: string | null;
  /** Red, or yellow on a level whose config says the founder hears about yellows. */
  escalateToAdmin: boolean;
  /** Per-metric totals over the weeks supplied, for the lifetime columns. Null when never asked. */
  totals: Partial<Record<WeeklyMetricKey, number | null>>;
  rows: WeeklyFlagRow[];
};

function metric(week: WeeklyWeekInput, key: WeeklyMetricKey): number | null {
  const v = week.metrics[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * This week's verdict from this week's numbers plus however much history each rule needs.
 *
 * `history` is every earlier week, oldest first. The two-week rules read only the week
 * immediately before, because the tab says "2 consecutive" and consecutive means adjacent.
 */
function weekVerdict(
  week: WeeklyWeekInput,
  history: WeeklyWeekInput[],
  cfg: WeeklyThresholds,
): { flag: WeeklyFlagValue; reasons: FlagReason[] } {
  const reasons: FlagReason[] = [];
  let flag: WeeklyFlagValue = "GREEN";
  const raise = (to: WeeklyFlagValue, code: FlagReasonCode) => {
    reasons.push(reason(code));
    if (to === "RED" || (to === "YELLOW" && flag === "GREEN")) flag = to;
  };

  const prev = history.length > 0 ? history[history.length - 1] : null;

  // ── The form itself ────────────────────────────────────────────────────────────────
  // "Missed 1 weekly form → YELLOW". "Green → Yellow: a single missed form moves Green to
  // Yellow immediately. No grace period."
  if (!week.submitted) {
    raise("YELLOW", "FORM_MISSED");
    // "Missed 2 weekly forms in a row → RED".
    if (prev && !prev.submitted) raise("RED", "FORM_MISSED_TWICE");

    // "Complete ghost - no contact for 3+ weeks" (Guided) / 2 weeks (Elite). Counted here
    // rather than only in the rollup so the week the silence crossed the line carries the
    // reason, which is the week a tutor will be looking at.
    let silent = 1;
    for (let i = history.length - 1; i >= 0 && !history[i].submitted; i -= 1) silent += 1;
    if (silent >= cfg.ghostWeeks) raise("RED", "GHOST");

    // Nothing else can be judged: there are no numbers. Returning early also keeps the
    // metric rules from reading a missing form as a week of zeroes.
    return { flag, reasons };
  }

  if (week.late) reasons.push(reason("FORM_LATE"));

  // ── Applications ───────────────────────────────────────────────────────────────────
  const apps = metric(week, "APPLICATIONS");
  if (apps !== null) {
    // "Below 10 apps/week → YELLOW: submitted form but fewer than 10 applications."
    if (apps < cfg.appsTarget) raise("YELLOW", "APPS_BELOW_TARGET");
    // "Zero applications for 2+ weeks → RED: form submitted but 0 apps for 2 consecutive weeks."
    if (apps === 0 && prev && prev.submitted && metric(prev, "APPLICATIONS") === 0) {
      raise("RED", "APPS_ZERO_TWO_WEEKS");
    }
  }

  // ── Networking and LinkedIn (the tab's Phase 2 section) ────────────────────────────
  const net = metric(week, "NETWORKING");
  const posts = metric(week, "LINKEDIN_POSTS");

  if (net !== null) {
    if (net === 0) {
      // "Zero networking OR zero posts for 1 week → YELLOW".
      raise("YELLOW", "NETWORKING_ZERO");
      // "Zero on either metric for 2+ consecutive weeks → RED".
      if (prev && prev.submitted && metric(prev, "NETWORKING") === 0) {
        raise("RED", "NETWORKING_ZERO_TWO_WEEKS");
      }
    } else if (net < cfg.lowThreshold) {
      // "Below 5 on either metric → YELLOW".
      raise("YELLOW", "NETWORKING_LOW");
    }
  }

  if (posts !== null) {
    if (posts === 0) {
      raise("YELLOW", "POSTS_ZERO");
      if (prev && prev.submitted && metric(prev, "LINKEDIN_POSTS") === 0) {
        raise("RED", "POSTS_ZERO_TWO_WEEKS");
      }
    } else if (posts < cfg.lowThreshold) {
      raise("YELLOW", "POSTS_LOW");
    }
  }

  // "High networking + high posts + low applications → YELLOW (coaching)". Its own reason
  // because the tab is explicit that it is "not a punishment flag - a coaching moment":
  // the message that goes out is different, so the reason has to be distinguishable.
  if (
    apps !== null &&
    net !== null &&
    posts !== null &&
    apps < cfg.appsTarget &&
    net >= cfg.networkingTarget &&
    posts >= cfg.linkedinTarget
  ) {
    raise("YELLOW", "VISIBILITY_WITHOUT_APPLICATIONS");
  }

  if (reasons.length === 0) reasons.push(reason("ON_TRACK"));
  return { flag, reasons };
}

/**
 * Walk a student's weeks and produce the flag at the end of each one.
 *
 * Carry-forward is the part a weekly glance at a spreadsheet cannot do, and it is two
 * rules from the ESCALATION block of the tab:
 *   "Yellow → Red: if Yellow flag behaviour continues for 2 consecutive weeks."
 *   "Recovery: Red → Green: student must complete 2 consecutive Green weeks to return to
 *    Green status. Yellow is the interim."
 * So a red student with one clean week is YELLOW, not GREEN - the colour says "not out of
 * it yet", which is exactly what the founders meant by naming Yellow the interim.
 */
export function buildWeeklyFlagSeries(
  weeks: WeeklyWeekInput[],
  cfg: WeeklyThresholds = WEEKLY_THRESHOLD_DEFAULTS,
): WeeklyFlagRow[] {
  const rows: WeeklyFlagRow[] = [];
  let carried: WeeklyFlagValue = "GREEN";
  let greenRun = 0;
  let yellowRun = 0;

  weeks.forEach((week, i) => {
    const verdict = weekVerdict(week, weeks.slice(0, i), cfg);
    const reasons = [...verdict.reasons];
    let effective: WeeklyFlagValue;

    if (verdict.flag === "GREEN") greenRun += 1;
    else greenRun = 0;
    if (verdict.flag === "YELLOW") yellowRun += 1;
    else yellowRun = 0;

    if (carried === "RED" && verdict.flag !== "RED") {
      // Coming back from red: clean weeks only, and enough of them.
      if (verdict.flag === "GREEN" && greenRun >= cfg.recoveryGreenWeeks) {
        effective = "GREEN";
      } else if (verdict.flag === "GREEN") {
        effective = "YELLOW";
        reasons.push(reason("RECOVERING"));
      } else {
        effective = "YELLOW";
      }
    } else if (verdict.flag === "YELLOW" && yellowRun >= cfg.yellowToRedWeeks) {
      effective = "RED";
      reasons.push(reason("YELLOW_ESCALATED"));
    } else {
      effective = verdict.flag;
    }

    const override = week.override ?? null;
    if (override) {
      // A human disagreeing with the rules resets the run they were disagreeing about,
      // otherwise the override would be overturned again next week by the same history.
      effective = override;
      reasons.push(reason("TUTOR_OVERRIDE"));
      greenRun = override === "GREEN" ? cfg.recoveryGreenWeeks : 0;
      yellowRun = override === "YELLOW" ? 1 : 0;
    }

    carried = effective;
    rows.push({
      isoWeek: week.isoWeek,
      weekStart: week.weekStart,
      weekFlag: verdict.flag,
      flag: effective,
      reasons,
      overridden: Boolean(override),
    });
  });

  return rows;
}

const SUMMED_METRICS: WeeklyMetricKey[] = [
  "APPLICATIONS",
  "INTERVIEWS",
  "NETWORKING",
  "LINKEDIN_POSTS",
  "LEARNING_HOURS",
];

/** The Student Master row: where this student stands now, and how they got here. */
export function summariseWeekly(
  weeks: WeeklyWeekInput[],
  cfg: WeeklyThresholds = WEEKLY_THRESHOLD_DEFAULTS,
): WeeklyRollup {
  const rows = buildWeeklyFlagSeries(weeks, cfg);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;

  let streak = 0;
  for (let i = weeks.length - 1; i >= 0 && weeks[i].submitted; i -= 1) streak += 1;

  let weeksSilent = 0;
  for (let i = weeks.length - 1; i >= 0 && !weeks[i].submitted; i -= 1) weeksSilent += 1;

  const submittedWeeks = weeks.filter((w) => w.submitted);
  const lastFormWeekStart =
    submittedWeeks.length > 0 ? submittedWeeks[submittedWeeks.length - 1].weekStart : null;

  const totals: Partial<Record<WeeklyMetricKey, number | null>> = {};
  for (const key of SUMMED_METRICS) {
    // Null, not 0, when the question was never asked of this student in any week - the
    // difference between "they did none" and "we never asked".
    const values = weeks.map((w) => metric(w, key)).filter((v): v is number => v !== null);
    totals[key] = values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  }

  const flag = last?.flag ?? "GREEN";
  return {
    flag,
    reasons: last?.reasons ?? [reason("ON_TRACK")],
    streak,
    weeksSilent,
    lastFormWeekStart,
    escalateToAdmin: flag === "RED" || (flag === "YELLOW" && cfg.notifyAdminOnYellow),
    totals,
    rows,
  };
}

/** Flags that belong on the dashboard's "needs attention" tab, worst first. */
export const WEEKLY_ATTENTION_FLAGS: WeeklyFlagValue[] = ["RED", "YELLOW"];

/** Maps a flag onto the design system's signal tones. Never used as the only cue. */
export const WEEKLY_FLAG_TONE: Record<WeeklyFlagValue, "good" | "warn" | "bad"> = {
  GREEN: "good",
  YELLOW: "warn",
  RED: "bad",
};

export const WEEKLY_FLAG_LABELS: Record<WeeklyFlagValue, string> = {
  GREEN: "Green",
  YELLOW: "Yellow",
  RED: "Red",
};

/**
 * The chase messages, from the "Message Template" column of the founders' Red Flag System tab.
 *
 * Kept close to their own wording rather than rewritten, because the wording is the thing they
 * tested on real students: direct, specific, and naming the number. Lightly edited only where
 * the sheet's bracketed placeholders can be filled in from the data we already hold.
 *
 * These are for COPYING, not for sending. The outbound WhatsApp templates have to be approved by
 * Meta before they can carry anything, and these are longer and more personal than an approved
 * template is allowed to be - so this is what the delivery person pastes into a real
 * conversation, which is also how the sheet used them.
 */
export const WEEKLY_CHASE_TEMPLATES: Partial<Record<FlagReasonCode, string>> = {
  FORM_MISSED:
    "Hey {name}, I noticed you didn't submit your weekly progress form this week. Everything okay? The form takes 4 minutes and it's how we keep you on track. Fill it out today and let me know if you're stuck on anything.",
  FORM_MISSED_TWICE:
    "Hey {name}, I haven't heard from you in 2 weeks. No progress forms, no messages. I'm genuinely concerned. We're here to help but only if you show up. Can you call me today or tomorrow? I want to understand what's happening and get you back on track.",
  APPS_BELOW_TARGET:
    "Hey {name}, I see you sent {applications} applications this week. Our target is {appsTarget} minimum. What's blocking you from hitting that? Is it finding jobs to apply to, or is the application process taking too long? Let me know - I can help you fix this before next week.",
  APPS_ZERO_TWO_WEEKS:
    "Hey {name}, I see you've submitted your forms but haven't sent any applications in 2 weeks. That's a pattern we need to break NOW. I'm booking a 15-minute call with you this week. We're going to figure out what's blocking you and fix it together.",
  GHOST:
    "{name}, it's been {weeksSilent} weeks since we heard from you. I want to be direct - if you've decided this isn't for you, that's your choice. But if something happened in your life that pulled you away, we can adjust the plan. I need to hear from you so I know how to move forward. One message is all I need.",
  NETWORKING_ZERO:
    "Hey {name}, your progress form shows zero networking contacts this week. I get it - reaching out to strangers feels uncomfortable. But every connection you make is a potential referral. Start small: 1 connection today. Send me a screenshot when done.",
  POSTS_ZERO:
    "Hey {name}, your progress form shows zero posts this week. I get it - posting publicly feels uncomfortable. But every post increases your visibility to German recruiters. Start small: 1 post today. Send me a screenshot when done.",
  NETWORKING_ZERO_TWO_WEEKS:
    "Hey {name}, it's been 2 weeks with no networking activity. I need to be direct - applications alone are not enough to get hired in Germany. The hidden job market runs on relationships and visibility. Let's get on a quick call this week to figure out what's blocking you.",
  POSTS_ZERO_TWO_WEEKS:
    "Hey {name}, it's been 2 weeks with no posts. Applications alone are not enough to get hired in Germany - the hidden job market runs on visibility. Let's get on a quick call this week to figure out what's blocking you.",
  NETWORKING_LOW:
    "Hey {name}, I noticed your networking is at {networking} contacts this week. Our target is {networkingTarget}. Networking is what makes German recruiters find YOU instead of you always chasing them. What's harder right now - finding people to connect with, or knowing what to say? Let me help.",
  POSTS_LOW:
    "Hey {name}, I noticed your posting is at {linkedinPosts} this week. Our target is {linkedinTarget}. Posting is what makes German recruiters find YOU instead of you always chasing them. Is it coming up with post ideas that's hard? Let me help.",
  VISIBILITY_WITHOUT_APPLICATIONS:
    "Hey {name}, great work on your networking and LinkedIn presence this week. But I noticed your applications are at {applications}. Networking and posting CREATE opportunities, applications CAPTURE them. This week, try this: for every 3 connections you make, send 1 application to a company in that network. Let's turn visibility into interviews.",
};

/**
 * Fill a chase message in.
 *
 * A placeholder with no value is left as the bracketed word rather than replaced with a blank,
 * so a half-filled message is obvious to the person about to send it. The sheet's own templates
 * carried "[X]" for exactly this reason - a human reads it and types the number.
 */
export function chaseMessage(
  code: FlagReasonCode,
  vars: Record<string, string | number | null | undefined>,
): string | null {
  const template = WEEKLY_CHASE_TEMPLATES[code];
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined || v === "" ? `[${key.toUpperCase()}]` : String(v);
  });
}

/** The reason a chase message should be written about: the most serious one that has copy. */
export function primaryChaseReason(reasons: FlagReason[]): FlagReasonCode | null {
  const ranked: FlagReasonCode[] = [
    "GHOST",
    "FORM_MISSED_TWICE",
    "APPS_ZERO_TWO_WEEKS",
    "NETWORKING_ZERO_TWO_WEEKS",
    "POSTS_ZERO_TWO_WEEKS",
    "FORM_MISSED",
    "APPS_BELOW_TARGET",
    "VISIBILITY_WITHOUT_APPLICATIONS",
    "NETWORKING_ZERO",
    "POSTS_ZERO",
    "NETWORKING_LOW",
    "POSTS_LOW",
  ];
  const held = new Set(reasons.map((r) => r.code));
  return ranked.find((code) => held.has(code)) ?? null;
}
