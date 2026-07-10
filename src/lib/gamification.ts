/**
 * Gamification engine — PURE and isomorphic (no prisma, no zod, no server-only).
 *
 * Design rule (same spirit as LTV / runway / funnel): every score is DERIVED at
 * read time from the append-only history the app already keeps — daily logs,
 * lead stage history, discovery outcomes, milestone logs, signal changes, OKRs.
 * No score is stored, so XP is retroactive from day one, can never drift out of
 * sync with the real work, and can't be edited — you earn it by doing the work
 * that is already audited.
 *
 * WHAT THE FOUNDER OWNS
 * Every number and label below (XP values, the streak ladder, levels, badges,
 * quests, the student journey) lives in a Ruleset, edited from /console and
 * persisted as JSON. The constants here are only the DEFAULTS — the genesis
 * ruleset a fresh install starts from.
 *
 * EFFECTIVE DATING — the reason this isn't a plain settings object
 * Rulesets are stamped with `effectiveFrom`. An event is scored by the ruleset
 * in force ON THE DAY IT HAPPENED, so tuning "deal won" from 100 → 50 today
 * never re-prices a deal closed in March. Two consequences fall out of that,
 * and both are deliberate:
 *
 *   - Levels RATCHET. We track the highest level ever attained against the
 *     rules of the day. Raising a level threshold never demotes anyone.
 *   - Badges RATCHET. A badge unlocks the first day its criteria were met
 *     under THAT day's threshold. Raising "5 deals" to "8 deals" applies to
 *     people who haven't earned it yet; it never re-locks a badge.
 *
 * Earned is earned. The founder tunes the future, not the past.
 *
 * Two audiences:
 *  - EMPLOYEES: XP → levels, badges, weekly quests, leaderboard (the Arena).
 *  - STUDENTS:  journey XP over the 7 milestones, stage titles, momentum,
 *    achievement badges — shown to the team on the student pages (students
 *    don't log in; the team uses this in sessions to motivate them).
 */

// ───────────────────────────── shared types ─────────────────────────────

export type DailyLogVariant = "DISCOVERY_SPECIALIST" | "APPOINTMENT_SETTER" | "DELIVERY_COACH";

export type XpEvent = {
  userId: string;
  dateKey: string; // YYYY-MM-DD (IST business day)
  kind: string;
  label: string;
  xp: number;
  /** machine-readable subject: quest key, stage name, streak length… (reward triggers read this) */
  refKey?: string;
};

export type BadgeTier = "bronze" | "silver" | "gold" | "legend";

export type BadgeDef = {
  key: string;
  name: string;
  description: string;
  icon: string; // emoji — renders everywhere, no asset pipeline
  tier: BadgeTier;
};

export type UnlockedBadge = BadgeDef & { unlockedAt: string | null }; // null = still locked

// ───────────────────────────── the ruleset ─────────────────────────────

export type XpRules = {
  LOG_SUBMITTED: number;
  /** streak length (as a string key, because this round-trips through JSON) → bonus XP */
  STREAK_BONUS: Record<string, number>;
  /** lead stage → XP for moving a lead INTO it */
  STAGE_MOVED: Record<string, number>;
  OUTCOME_LOGGED: number;
  OUTCOME_HQ_BONUS: number;
  MILESTONE_ADVANCED: number;
  MILESTONE_OFFER_BONUS: number; // student reached "Offer received"
  MILESTONE_COMPLETED_BONUS: number;
  STUDENT_RESCUED: number; // signal RED → GREEN
  OKR_HIT: number; // ≥100% completion
  OKR_NEAR: number; // ≥80% at month close
};

export type LevelDef = { level: number; title: string; minXp: number };

/**
 * The countable things an employee badge can be pinned to. The METRIC is a code
 * concept (it must map to real history); the THRESHOLD, name, icon, tier and
 * copy are the founder's. New badges are made by combining any metric with any
 * threshold — no code change.
 */
export const EMPLOYEE_BADGE_METRICS = [
  "logs",
  "streak",
  "wins",
  "proposals",
  "discoveryCalls",
  "hqCalls",
  "appointments",
  "leadsContacted",
  "sessions",
  "milestoneMoves",
  "studentOffers",
  "rescues",
  "okrHits",
  "okrPerfectMonths",
  "level",
] as const;
export type EmployeeBadgeMetric = (typeof EMPLOYEE_BADGE_METRICS)[number];

/**
 * Metrics that are a running total of dated increments. `streak` and `level` are
 * excluded: a streak is a property of a RUN of days (it resets), and a level is
 * already a function of XP. Both are unlocked by their own walk, not by summing.
 * Reward rules threshold over exactly these.
 */
export const COUNTABLE_METRICS = EMPLOYEE_BADGE_METRICS.filter(
  (m): m is CountableMetric => m !== "streak" && m !== "level",
);
export type CountableMetric = Exclude<EmployeeBadgeMetric, "streak" | "level">;

export const EMPLOYEE_METRIC_LABELS: Record<EmployeeBadgeMetric, string> = {
  logs: "Daily logs submitted",
  streak: "Consecutive logging days",
  wins: "Deals won",
  proposals: "Proposals sent",
  discoveryCalls: "Discovery calls completed",
  hqCalls: "Highly-qualified calls",
  appointments: "Appointments set",
  leadsContacted: "New leads contacted",
  sessions: "Coaching sessions delivered",
  milestoneMoves: "Student milestones advanced",
  studentOffers: "Students moved to Offer received",
  rescues: "Students rescued (red → green)",
  okrHits: "OKRs completed at 100%",
  okrPerfectMonths: "Perfect OKR months",
  level: "Level reached",
};

export type EmployeeBadgeRule = BadgeDef & {
  metric: EmployeeBadgeMetric;
  threshold: number;
  enabled: boolean;
};

export const STUDENT_BADGE_METRICS = [
  "milestoneReached",
  "milestoneWithinDays",
  "applications",
  "interviews",
  "sessions",
  "comeback",
  "greenSignal",
] as const;
export type StudentBadgeMetric = (typeof STUDENT_BADGE_METRICS)[number];

export const STUDENT_METRIC_LABELS: Record<StudentBadgeMetric, string> = {
  milestoneReached: "Reached a milestone",
  milestoneWithinDays: "Reached a milestone within N days of enrolling",
  applications: "Applications submitted",
  interviews: "Interviews received",
  sessions: "Coaching sessions completed",
  comeback: "Bounced back from red to green",
  greenSignal: "Currently on a green signal",
};

export type StudentBadgeRule = BadgeDef & {
  metric: StudentBadgeMetric;
  /** count for applications/interviews/sessions; DAYS for milestoneWithinDays; ignored otherwise */
  threshold: number;
  /** required by milestoneReached + milestoneWithinDays */
  milestone: string | null;
  enabled: boolean;
};

export type QuestDef = {
  key: string;
  title: string;
  description: string;
  icon: string;
  /** daily-log numeric field summed over the week; "__weekdayLogs" = count of Mon-Fri logs */
  field: string;
  target: number;
  xp: number;
  variant: DailyLogVariant | "ANY";
  enabled: boolean;
};

export const WEEKDAY_LOGS_FIELD = "__weekdayLogs";

/** Daily-log fields a quest (or a reward's metric threshold) may be pinned to. */
export const QUEST_FIELDS = [
  WEEKDAY_LOGS_FIELD,
  "discoveryCallsCompleted",
  "highlyQualifiedCalls",
  "followUpsDone",
  "proposalsSent",
  "noShows",
  "newLeadsContacted",
  "appointmentsSet",
  "followUpMessagesSent",
  "leadsAddedToPipeline",
  "sessionsDelivered",
  "studentsCheckedInOn",
  "assignmentsReviewed",
  "studentsFlaggedAtRisk",
] as const;

export type StudentJourneyConfig = {
  /** milestone → journey XP weight. Their SUM is the 100% denominator. */
  milestoneXp: Record<string, number>;
  /** one title per milestone, aligned to MILESTONE_ORDER */
  stageTitles: string[];
  bonusXp: { perSession: number; perApplication: number; perInterview: number };
  /** idle-day ceilings; anything past `cooling` is STALLED */
  momentumDays: { hot: number; steady: number; cooling: number };
  nextSteps: Record<string, { focus: string; steps: string[] }>;
};

export type Ruleset = {
  id: string;
  label: string;
  /** YYYY-MM-DD — events on/after this day score by this ruleset */
  effectiveFrom: string;
  xpRules: XpRules;
  levels: LevelDef[];
  employeeBadges: EmployeeBadgeRule[];
  studentBadges: StudentBadgeRule[];
  quests: QuestDef[];
  student: StudentJourneyConfig;
};

export type GamificationConfig = { rulesets: Ruleset[] };

// ───────────────────────────── defaults (the genesis ruleset) ─────────────────────────────

export const GENESIS_EFFECTIVE_FROM = "1970-01-01";

export const DEFAULT_XP_RULES: XpRules = {
  LOG_SUBMITTED: 20,
  STREAK_BONUS: { "7": 40, "14": 90, "30": 250, "60": 450, "90": 700 },
  STAGE_MOVED: {
    DISCO_BOOKED: 10,
    SSS_BOOKED: 15,
    SSS_COMPLETED: 15,
    PROPOSAL_SENT: 20,
    SENT_TO_WORKSHOP: 8,
    WORKSHOP_FOLLOWUP: 8,
    OFFER_FOLLOWUP: 20,
    DEPOSIT_FOLLOWUP: 20,
    DEPOSIT_PAID: 60,
    WON: 100,
  },
  OUTCOME_LOGGED: 5,
  OUTCOME_HQ_BONUS: 10,
  MILESTONE_ADVANCED: 15,
  MILESTONE_OFFER_BONUS: 50,
  MILESTONE_COMPLETED_BONUS: 35,
  STUDENT_RESCUED: 50,
  OKR_HIT: 120,
  OKR_NEAR: 60,
};

export const DEFAULT_LEVELS: LevelDef[] = [
  { level: 1, title: "Newcomer", minXp: 0 },
  { level: 2, title: "Apprentice", minXp: 150 },
  { level: 3, title: "Operator", minXp: 400 },
  { level: 4, title: "Specialist", minXp: 800 },
  { level: 5, title: "Mentor", minXp: 1400 },
  { level: 6, title: "Strategist", minXp: 2200 },
  { level: 7, title: "Champion", minXp: 3200 },
  { level: 8, title: "Master", minXp: 4600 },
  { level: 9, title: "Grandmaster", minXp: 6400 },
  { level: 10, title: "Legend", minXp: 8800 },
];

export const DEFAULT_EMPLOYEE_BADGES: EmployeeBadgeRule[] = [
  { key: "first-log", name: "First Steps", icon: "👣", tier: "bronze", description: "Submitted your first daily log.", metric: "logs", threshold: 1, enabled: true },
  { key: "streak-7", name: "On Fire", icon: "🔥", tier: "bronze", description: "7-day logging streak.", metric: "streak", threshold: 7, enabled: true },
  { key: "streak-14", name: "Unstoppable", icon: "⚡", tier: "silver", description: "14-day logging streak.", metric: "streak", threshold: 14, enabled: true },
  { key: "streak-30", name: "Iron Discipline", icon: "🛡️", tier: "gold", description: "30-day logging streak.", metric: "streak", threshold: 30, enabled: true },
  { key: "streak-60", name: "Habit Machine", icon: "⚙️", tier: "gold", description: "60-day logging streak.", metric: "streak", threshold: 60, enabled: true },
  { key: "streak-90", name: "Relentless", icon: "🌋", tier: "legend", description: "90-day logging streak.", metric: "streak", threshold: 90, enabled: true },
  { key: "logs-100", name: "Century Logger", icon: "💯", tier: "gold", description: "100 daily logs submitted.", metric: "logs", threshold: 100, enabled: true },
  { key: "first-win", name: "First Win", icon: "🏁", tier: "bronze", description: "Closed your first deal (lead → Won).", metric: "wins", threshold: 1, enabled: true },
  { key: "closer-5", name: "Closer", icon: "🤝", tier: "silver", description: "5 deals closed.", metric: "wins", threshold: 5, enabled: true },
  { key: "rainmaker-15", name: "Rainmaker", icon: "🌧️", tier: "gold", description: "15 deals closed.", metric: "wins", threshold: 15, enabled: true },
  { key: "proposals-25", name: "Proposal Pro", icon: "📨", tier: "silver", description: "25 proposals sent.", metric: "proposals", threshold: 25, enabled: true },
  { key: "calls-100", name: "Call Centurion", icon: "☎️", tier: "gold", description: "100 discovery calls completed.", metric: "discoveryCalls", threshold: 100, enabled: true },
  { key: "hq-25", name: "Quality Hunter", icon: "💎", tier: "silver", description: "25 calls marked Highly Qualified.", metric: "hqCalls", threshold: 25, enabled: true },
  { key: "appointments-50", name: "Booking Machine", icon: "📅", tier: "silver", description: "50 appointments set.", metric: "appointments", threshold: 50, enabled: true },
  { key: "leads-500", name: "Outreach Army", icon: "📣", tier: "gold", description: "500 new leads contacted.", metric: "leadsContacted", threshold: 500, enabled: true },
  { key: "sessions-50", name: "Coach's Whistle", icon: "🎓", tier: "silver", description: "50 coaching sessions delivered.", metric: "sessions", threshold: 50, enabled: true },
  { key: "milestones-25", name: "Milestone Mover", icon: "🚀", tier: "silver", description: "Advanced student milestones 25 times.", metric: "milestoneMoves", threshold: 25, enabled: true },
  { key: "offers-5", name: "Offer Factory", icon: "💼", tier: "gold", description: "5 students moved to Offer received.", metric: "studentOffers", threshold: 5, enabled: true },
  { key: "rescues-3", name: "Lifeguard", icon: "🛟", tier: "gold", description: "Turned 3 red-signal students green.", metric: "rescues", threshold: 3, enabled: true },
  { key: "okr-100", name: "Bullseye", icon: "🎯", tier: "silver", description: "Completed an OKR at 100%.", metric: "okrHits", threshold: 1, enabled: true },
  { key: "okr-perfect-month", name: "Perfect Month", icon: "🌕", tier: "gold", description: "All OKRs (2+) at 100% in one month.", metric: "okrPerfectMonths", threshold: 1, enabled: true },
  { key: "level-5", name: "Halfway to Legend", icon: "⭐", tier: "silver", description: "Reached level 5 — Mentor.", metric: "level", threshold: 5, enabled: true },
  { key: "level-10", name: "Living Legend", icon: "👑", tier: "legend", description: "Reached level 10 — Legend.", metric: "level", threshold: 10, enabled: true },
];

export const DEFAULT_QUESTS: QuestDef[] = [
  { key: "steady-week", title: "Steady Week", icon: "🗓️", field: WEEKDAY_LOGS_FIELD, description: "Submit your daily log on all five weekdays.", target: 5, xp: 60, variant: "ANY", enabled: true },
  // Discovery specialist
  { key: "call-blitz", title: "Call Blitz", icon: "☎️", field: "discoveryCallsCompleted", description: "Complete 15 discovery calls this week.", target: 15, xp: 80, variant: "DISCOVERY_SPECIALIST", enabled: true },
  { key: "diamond-week", title: "Diamond Week", icon: "💎", field: "highlyQualifiedCalls", description: "Mark 5 calls Highly Qualified this week.", target: 5, xp: 70, variant: "DISCOVERY_SPECIALIST", enabled: true },
  { key: "paper-trail", title: "Paper Trail", icon: "📨", field: "proposalsSent", description: "Send 5 proposals this week.", target: 5, xp: 70, variant: "DISCOVERY_SPECIALIST", enabled: true },
  // Appointment setter
  { key: "calendar-filler", title: "Calendar Filler", icon: "📅", field: "appointmentsSet", description: "Set 10 appointments this week.", target: 10, xp: 80, variant: "APPOINTMENT_SETTER", enabled: true },
  { key: "outreach-wave", title: "Outreach Wave", icon: "📣", field: "newLeadsContacted", description: "Contact 40 new leads this week.", target: 40, xp: 70, variant: "APPOINTMENT_SETTER", enabled: true },
  { key: "pipeline-builder", title: "Pipeline Builder", icon: "🧱", field: "leadsAddedToPipeline", description: "Add 15 leads to the pipeline this week.", target: 15, xp: 60, variant: "APPOINTMENT_SETTER", enabled: true },
  // Delivery coach
  { key: "session-marathon", title: "Session Marathon", icon: "🎓", field: "sessionsDelivered", description: "Deliver 8 coaching sessions this week.", target: 8, xp: 80, variant: "DELIVERY_COACH", enabled: true },
  { key: "pulse-check", title: "Pulse Check", icon: "🤝", field: "studentsCheckedInOn", description: "Check in on 10 students this week.", target: 10, xp: 70, variant: "DELIVERY_COACH", enabled: true },
  { key: "red-pen", title: "Red Pen", icon: "✍️", field: "assignmentsReviewed", description: "Review 10 assignments this week.", target: 10, xp: 60, variant: "DELIVERY_COACH", enabled: true },
];

export const MILESTONE_ORDER = [
  "ONBOARDING", "RESUME_BUILD", "LINKEDIN_OPTIMISATION", "APPLICATIONS",
  "INTERVIEWS", "OFFER_RECEIVED", "COMPLETED",
] as const;

export const DEFAULT_STUDENT_BADGES: StudentBadgeRule[] = [
  { key: "fast-starter", name: "Fast Starter", icon: "🚀", tier: "bronze", description: "Reached Resume build within 14 days of enrolling.", metric: "milestoneWithinDays", threshold: 14, milestone: "RESUME_BUILD", enabled: true },
  { key: "linkedin-live", name: "Visible", icon: "🔗", tier: "bronze", description: "LinkedIn optimisation reached.", metric: "milestoneReached", threshold: 1, milestone: "LINKEDIN_OPTIMISATION", enabled: true },
  { key: "first-application", name: "In the Game", icon: "📄", tier: "bronze", description: "First application submitted.", metric: "applications", threshold: 1, milestone: null, enabled: true },
  { key: "sprinter-20", name: "Application Sprinter", icon: "🏃", tier: "silver", description: "20+ applications submitted.", metric: "applications", threshold: 20, milestone: null, enabled: true },
  { key: "first-interview", name: "Foot in the Door", icon: "🎤", tier: "silver", description: "First interview received.", metric: "interviews", threshold: 1, milestone: null, enabled: true },
  { key: "interview-magnet", name: "Interview Magnet", icon: "🧲", tier: "gold", description: "3+ interviews received.", metric: "interviews", threshold: 3, milestone: null, enabled: true },
  { key: "sessions-10", name: "Committed", icon: "📚", tier: "silver", description: "10+ coaching sessions completed.", metric: "sessions", threshold: 10, milestone: null, enabled: true },
  { key: "comeback", name: "Comeback Story", icon: "💪", tier: "gold", description: "Bounced back from red signal to green.", metric: "comeback", threshold: 1, milestone: null, enabled: true },
  { key: "green-zone", name: "In the Zone", icon: "🟢", tier: "bronze", description: "Currently on a green signal.", metric: "greenSignal", threshold: 1, milestone: null, enabled: true },
  { key: "offer-champion", name: "Offer Champion", icon: "🏆", tier: "legend", description: "Received a job offer in Germany.", metric: "milestoneReached", threshold: 1, milestone: "OFFER_RECEIVED", enabled: true },
  { key: "finisher", name: "Finisher", icon: "🎓", tier: "gold", description: "Completed the full program journey.", metric: "milestoneReached", threshold: 1, milestone: "COMPLETED", enabled: true },
];

export const DEFAULT_STUDENT_JOURNEY: StudentJourneyConfig = {
  milestoneXp: {
    ONBOARDING: 60,
    RESUME_BUILD: 120,
    LINKEDIN_OPTIMISATION: 120,
    APPLICATIONS: 180,
    INTERVIEWS: 220,
    OFFER_RECEIVED: 200,
    COMPLETED: 100,
  },
  stageTitles: ["Explorer", "Builder", "Connector", "Applicant", "Interviewer", "Offer Holder", "Alumni"],
  bonusXp: { perSession: 8, perApplication: 4, perInterview: 20 },
  momentumDays: { hot: 7, steady: 14, cooling: 21 },
  nextSteps: {
    ONBOARDING: {
      focus: "Get set up and aligned",
      steps: [
        "Complete your onboarding checklist with your coach.",
        "Agree your target role and cities in Germany.",
        "Book your first coaching session if it isn't scheduled yet.",
      ],
    },
    RESUME_BUILD: {
      focus: "Build a German-market CV",
      steps: [
        "Rework every bullet as Verb + what + measurable result.",
        "Run your draft through the CV Diagnostic against a real job description.",
        "Close the gaps it finds, then review the final version with your coach.",
      ],
    },
    LINKEDIN_OPTIMISATION: {
      focus: "Become visible to German recruiters",
      steps: [
        "Update headline and About section for your target role.",
        "Set your location preference and 'open to work' for Germany.",
        "Connect with 10+ people at target companies this week.",
      ],
    },
    APPLICATIONS: {
      focus: "Volume with quality",
      steps: [
        "Aim for 5+ tailored applications every week.",
        "Track every application so follow-ups never slip.",
        "Tailor the CV keywords to each job description — the diagnostic helps.",
      ],
    },
    INTERVIEWS: {
      focus: "Convert interviews into offers",
      steps: [
        "Do a mock interview with your coach before each real one.",
        "Prepare your salary range and visa answers in advance.",
        "Debrief every interview - what worked, what to sharpen.",
      ],
    },
    OFFER_RECEIVED: {
      focus: "Close it out properly",
      steps: [
        "Review the contract and relocation terms with your coach.",
        "Start the visa / Anerkennung paperwork immediately.",
        "Celebrate - then help the next student with a testimonial. 🏆",
      ],
    },
    COMPLETED: {
      focus: "You made it — Alumni",
      steps: [
        "Share your story and a testimonial for the community.",
        "Stay in touch - referrals from alumni open doors for others.",
      ],
    },
  },
};

export const DEFAULT_RULESET: Ruleset = {
  id: "genesis",
  label: "Original rules",
  effectiveFrom: GENESIS_EFFECTIVE_FROM,
  xpRules: DEFAULT_XP_RULES,
  levels: DEFAULT_LEVELS,
  employeeBadges: DEFAULT_EMPLOYEE_BADGES,
  studentBadges: DEFAULT_STUDENT_BADGES,
  quests: DEFAULT_QUESTS,
  student: DEFAULT_STUDENT_JOURNEY,
};

export const DEFAULT_GAMIFICATION_CONFIG: GamificationConfig = { rulesets: [DEFAULT_RULESET] };

// ───────────────────────────── ruleset resolution ─────────────────────────────

/** Oldest first. The founder's list may arrive in any order. */
export function sortedRulesets(config: GamificationConfig): Ruleset[] {
  const rulesets = config.rulesets.length ? config.rulesets : [DEFAULT_RULESET];
  return [...rulesets].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The ruleset in force on `dateKey` — the last one that had started by then. */
export function rulesetFor(config: GamificationConfig, dateKey: string): Ruleset {
  const all = sortedRulesets(config);
  let match = all[0];
  for (const r of all) if (r.effectiveFrom <= dateKey) match = r;
  return match;
}

/** The ruleset in force today — what the UI renders and what future work will score by. */
export function currentRuleset(config: GamificationConfig, todayKey: string): Ruleset {
  return rulesetFor(config, todayKey);
}

// ───────────────────────────── levels ─────────────────────────────

export type LevelInfo = {
  level: number;
  title: string;
  minXp: number;
  nextMinXp: number | null; // null at max level
  progressPct: number; // 0-100 towards the next level
};

/** Sorted ascending by minXp so a founder can add a level anywhere in the ladder. */
function ladder(levels: LevelDef[]): LevelDef[] {
  const list = levels.length ? levels : DEFAULT_LEVELS;
  return [...list].sort((a, b) => a.minXp - b.minXp);
}

export function levelForXp(xp: number, levels: LevelDef[] = DEFAULT_LEVELS): LevelInfo {
  const all = ladder(levels);
  let current = all[0];
  for (const l of all) if (xp >= l.minXp) current = l;
  return levelInfoFor(current, xp, all);
}

function levelInfoFor(current: LevelDef, xp: number, all: LevelDef[]): LevelInfo {
  const next = all.find((l) => l.minXp > current.minXp) ?? null;
  const span = next ? next.minXp - current.minXp : 0;
  const progressPct = next && span > 0 ? clampPct(((xp - current.minXp) / span) * 100) : 100;
  return {
    level: current.level,
    title: current.title,
    minXp: current.minXp,
    nextMinXp: next?.minXp ?? null,
    progressPct,
  };
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

// ───────────────────────────── quests ─────────────────────────────

export function questsForVariant(quests: QuestDef[], variant: DailyLogVariant | null): QuestDef[] {
  if (!variant) return [];
  return quests.filter((q) => q.enabled && (q.variant === "ANY" || q.variant === variant));
}

export type QuestProgress = QuestDef & { value: number; done: boolean; pct: number };

// ───────────────────────────── date helpers (UTC-keyed, IST-derived upstream) ──

const DAY_MS = 86400000;

export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekStartKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday=0
  return addDaysKey(dateKey, -dow);
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function isWeekday(dateKey: string): boolean {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function dayDiffKeys(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / DAY_MS);
}

export function lastDayOfMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Consecutive-day runs from a set of YYYY-MM-DD keys, oldest first. */
export function streakRuns(dateKeys: string[]): string[][] {
  const sorted = [...new Set(dateKeys)].sort();
  const runs: string[][] = [];
  let run: string[] = [];
  for (const k of sorted) {
    if (run.length && dayDiffKeys(k, run[run.length - 1]) === 1) run.push(k);
    else {
      if (run.length) runs.push(run);
      run = [k];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Current streak: run ending today, or yesterday while today is still pending. */
export function currentStreak(dateKeys: string[], todayKey: string): { streak: number; loggedToday: boolean } {
  const days = new Set(dateKeys);
  const loggedToday = days.has(todayKey);
  let cursor = loggedToday ? todayKey : addDaysKey(todayKey, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDaysKey(cursor, -1);
  }
  return { streak, loggedToday };
}

/** A dated counter series: `n` of something happened on `dateKey`. */
export type Increment = { dateKey: string; n: number };

/**
 * First date a dated counter series reaches its threshold — where the threshold
 * is itself a function of the date, because the founder may have moved the bar.
 * This is what makes badges ratchet: we test each day against the bar that was
 * standing THAT day, so a badge earned under the old rules stays earned.
 */
function unlockDateFor(increments: Increment[], thresholdAt: (dateKey: string) => number): string | null {
  let sum = 0;
  for (const inc of [...increments].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
    sum += inc.n;
    const threshold = thresholdAt(inc.dateKey);
    if (threshold > 0 && sum >= threshold) return inc.dateKey;
  }
  return null;
}

// ───────────────────────────── employee game inputs ─────────────────────────────

export type GameInputs = {
  todayKey: string;
  users: Array<{ userId: string; name: string; roleTitle: string; variant: DailyLogVariant | null }>;
  /** one per submitted daily log */
  logs: Array<{ userId: string; dateKey: string; values: Record<string, number> }>;
  /** lead stage transitions attributed to the user who made them */
  stageMoves: Array<{ userId: string; dateKey: string; toStage: string; leadName: string }>;
  /** discovery outcomes entered */
  outcomes: Array<{ userId: string; dateKey: string; highlyQualified: boolean }>;
  /** student milestone changes made by the user (previous null = first set) */
  milestoneMoves: Array<{
    userId: string; dateKey: string;
    previousMilestone: string | null; newMilestone: string; studentName: string;
  }>;
  /** signal changes made by the user */
  signalMoves: Array<{ userId: string; dateKey: string; previousSignal: string | null; newSignal: string | null }>;
  /** one row per OKR with its month + live completion % */
  okrs: Array<{ userId: string; monthKey: string; completionPct: number }>;
};

export type PlayerGame = {
  userId: string;
  name: string;
  roleTitle: string;
  variant: DailyLogVariant | null;
  xpTotal: number;
  xpWeek: number;
  xpMonth: number;
  level: LevelInfo;
  streak: number;
  loggedToday: boolean;
  badges: UnlockedBadge[]; // current catalogue with unlockedAt set where earned
  unlockedCount: number;
  quests: QuestProgress[]; // this week
  events: XpEvent[]; // newest first
  /** every day this player logged — reward rules read streaks off this */
  logDays: string[];
  /** dated counter series per metric — reward rules threshold over any window */
  counters: Record<CountableMetric, Increment[]>;
  /** every level-up, oldest first — reward rules fire on the day a level was reached */
  levelUps: Array<{ dateKey: string; level: number }>;
};

const MILESTONE_INDEX: Record<string, number> = Object.fromEntries(
  MILESTONE_ORDER.map((m, i) => [m, i]),
);

/** Human names for the lead stages XP can be earned on — also rendered by the console. */
export const STAGE_LABELS_SHORT: Record<string, string> = {
  DISCO_BOOKED: "Discovery call booked",
  SSS_BOOKED: "SSS call booked",
  SSS_COMPLETED: "SSS call completed",
  PROPOSAL_SENT: "Proposal sent",
  SENT_TO_WORKSHOP: "Sent to workshop",
  OFFER_FOLLOWUP: "Offer follow-up",
  WORKSHOP_FOLLOWUP: "Workshop follow-up",
  DEPOSIT_FOLLOWUP: "Deposit follow-up",
  DEPOSIT_PAID: "Deposit collected",
  WON: "Deal won",
};

/** metric → the daily-log field it sums. Metrics absent here are event-counted. */
const METRIC_LOG_FIELD: Partial<Record<EmployeeBadgeMetric, string>> = {
  discoveryCalls: "discoveryCallsCompleted",
  hqCalls: "highlyQualifiedCalls",
  appointments: "appointmentsSet",
  leadsContacted: "newLeadsContacted",
  sessions: "sessionsDelivered",
};

/** Build the full XP ledger + badges + quests for every player. Pure — feed it rows, get the game. */
export function computeTeamGame(
  inputs: GameInputs,
  config: GamificationConfig = DEFAULT_GAMIFICATION_CONFIG,
): { players: PlayerGame[] } {
  const { todayKey } = inputs;
  const thisWeekStart = weekStartKey(todayKey);
  const thisMonthKey = monthKeyOf(todayKey);
  const live = currentRuleset(config, todayKey);

  /** the rules that were standing on `dateKey` */
  const rulesOn = (dateKey: string) => rulesetFor(config, dateKey);

  const players = inputs.users.map((u) => {
    const logs = inputs.logs.filter((l) => l.userId === u.userId);
    const stageMoves = inputs.stageMoves.filter((s) => s.userId === u.userId);
    const outcomes = inputs.outcomes.filter((o) => o.userId === u.userId);
    const milestoneMoves = inputs.milestoneMoves.filter((m) => m.userId === u.userId);
    const signalMoves = inputs.signalMoves.filter((s) => s.userId === u.userId);
    const okrs = inputs.okrs.filter((o) => o.userId === u.userId);

    const events: XpEvent[] = [];
    const push = (dateKey: string, kind: string, label: string, xp: number, refKey?: string) =>
      events.push({ userId: u.userId, dateKey, kind, label, xp, refKey });

    // 1) Daily logs + streak bonuses
    const logDays = logs.map((l) => l.dateKey);
    const runs = streakRuns(logDays);
    for (const l of logs) push(l.dateKey, "log", "Daily log submitted", rulesOn(l.dateKey).xpRules.LOG_SUBMITTED);
    // Each day of a run is checked against that day's ladder, so a bonus tier the
    // founder adds today doesn't retro-pay a streak that ran last winter.
    for (const run of runs) {
      for (let i = 1; i <= run.length; i++) {
        const day = run[i - 1];
        const bonus = rulesOn(day).xpRules.STREAK_BONUS[String(i)];
        if (bonus) push(day, "streak", `${i}-day streak bonus`, bonus, String(i));
      }
    }
    const { streak, loggedToday } = currentStreak(logDays, todayKey);

    // 2) Pipeline stage moves
    for (const s of stageMoves) {
      const xp = rulesOn(s.dateKey).xpRules.STAGE_MOVED[s.toStage];
      if (!xp) continue;
      push(
        s.dateKey, "stage",
        `${STAGE_LABELS_SHORT[s.toStage] ?? s.toStage} · ${s.leadName}${s.toStage === "WON" ? " 🎉" : ""}`,
        xp, s.toStage,
      );
    }

    // 3) Discovery outcomes entered
    for (const o of outcomes) {
      const rules = rulesOn(o.dateKey).xpRules;
      push(
        o.dateKey, "outcome",
        o.highlyQualified ? "Highly-qualified call logged" : "Call outcome logged",
        rules.OUTCOME_LOGGED + (o.highlyQualified ? rules.OUTCOME_HQ_BONUS : 0),
      );
    }

    // 4) Student milestone moves (forward only — no XP for corrections backwards)
    const forwardMoves = milestoneMoves.filter(
      (m) => m.previousMilestone === null ||
        (MILESTONE_INDEX[m.newMilestone] ?? 0) > (MILESTONE_INDEX[m.previousMilestone] ?? 0),
    );
    for (const m of forwardMoves) {
      const rules = rulesOn(m.dateKey).xpRules;
      let xp = rules.MILESTONE_ADVANCED;
      let suffix = "";
      if (m.newMilestone === "OFFER_RECEIVED") { xp += rules.MILESTONE_OFFER_BONUS; suffix = " — offer! 🎉"; }
      if (m.newMilestone === "COMPLETED") { xp += rules.MILESTONE_COMPLETED_BONUS; suffix = " — journey complete"; }
      push(m.dateKey, "milestone", `Student milestone advanced · ${m.studentName}${suffix}`, xp, m.newMilestone);
    }

    // 5) Rescues: RED → GREEN
    const rescues = signalMoves.filter((s) => s.previousSignal === "RED" && s.newSignal === "GREEN");
    for (const r of rescues) push(r.dateKey, "rescue", "Student rescued: red → green", rulesOn(r.dateKey).xpRules.STUDENT_RESCUED);

    // 6) OKRs — settled past months pay on results; the running month pays only a confirmed 100%
    const okrHits: Increment[] = [];
    const okrsByMonth = new Map<string, number[]>();
    for (const o of okrs) {
      if (!okrsByMonth.has(o.monthKey)) okrsByMonth.set(o.monthKey, []);
      okrsByMonth.get(o.monthKey)!.push(o.completionPct);
      const settled = o.monthKey < thisMonthKey;
      const monthEnd = lastDayOfMonthKey(o.monthKey);
      if (o.completionPct >= 100) {
        const when = settled ? monthEnd : todayKey;
        push(when, "okr", "OKR completed at 100%", rulesOn(when).xpRules.OKR_HIT);
        okrHits.push({ dateKey: when, n: 1 });
      } else if (settled && o.completionPct >= 80) {
        push(monthEnd, "okr", "OKR closed above 80%", rulesOn(monthEnd).xpRules.OKR_NEAR);
      }
    }

    // 7) Weekly quests — banked for every week that met the bar (incl. this one),
    //    each week judged by the quest board that was live at the end of that week.
    const weekBuckets = new Map<string, { sums: Record<string, number>; weekdayLogs: number; lastLog: string }>();
    for (const l of logs) {
      const wk = weekStartKey(l.dateKey);
      if (!weekBuckets.has(wk)) weekBuckets.set(wk, { sums: {}, weekdayLogs: 0, lastLog: l.dateKey });
      const b = weekBuckets.get(wk)!;
      if (isWeekday(l.dateKey)) b.weekdayLogs++;
      if (l.dateKey > b.lastLog) b.lastLog = l.dateKey;
      for (const [f, v] of Object.entries(l.values)) b.sums[f] = (b.sums[f] ?? 0) + v;
    }
    const questValue = (q: QuestDef, b: { sums: Record<string, number>; weekdayLogs: number }) =>
      q.field === WEEKDAY_LOGS_FIELD ? b.weekdayLogs : (b.sums[q.field] ?? 0);
    for (const b of weekBuckets.values()) {
      for (const q of questsForVariant(rulesOn(b.lastLog).quests, u.variant)) {
        if (questValue(q, b) >= q.target) {
          push(b.lastLog, "quest", `Quest complete · ${q.icon} ${q.title}`, q.xp, q.key);
        }
      }
    }
    const thisWeek = weekBuckets.get(thisWeekStart) ?? { sums: {}, weekdayLogs: 0, lastLog: todayKey };
    const questProgress: QuestProgress[] = questsForVariant(live.quests, u.variant).map((q) => {
      const value = questValue(q, thisWeek);
      return { ...q, value, done: value >= q.target, pct: q.target > 0 ? clampPct((value / q.target) * 100) : 100 };
    });

    // totals
    const xpTotal = events.reduce((a, e) => a + e.xp, 0);
    const xpWeek = events.filter((e) => e.dateKey >= thisWeekStart).reduce((a, e) => a + e.xp, 0);
    const xpMonth = events.filter((e) => monthKeyOf(e.dateKey) === thisMonthKey).reduce((a, e) => a + e.xp, 0);

    // ── level, ratcheted ──
    // Walk the XP cumsum in order, grading each day against that day's ladder, and
    // remember the high-water mark. Then take the better of that and today's ladder,
    // so raising a threshold can never demote someone who already climbed past it.
    const chronological = [...events].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const levelUps: Array<{ dateKey: string; level: number }> = [];
    let cum = 0;
    let attained = ladder(live.levels)[0].level;
    for (const e of chronological) {
      cum += e.xp;
      const reached = levelForXp(cum, rulesOn(e.dateKey).levels).level;
      if (reached > attained) {
        attained = reached;
        levelUps.push({ dateKey: e.dateKey, level: reached });
      }
    }
    const liveLadder = ladder(live.levels);
    const byCurrentRules = levelForXp(xpTotal, liveLadder);
    const effectiveLevel = Math.max(attained, byCurrentRules.level);
    const levelDef =
      liveLadder.find((l) => l.level === effectiveLevel) ??
      liveLadder[liveLadder.length - 1];
    const level = levelInfoFor(levelDef, xpTotal, liveLadder);

    // ── counters: the dated series every badge and reward rule thresholds over ──
    const inc = (rows: Array<{ dateKey: string }>): Increment[] => rows.map((r) => ({ dateKey: r.dateKey, n: 1 }));
    const logField = (field: string): Increment[] =>
      logs.map((l) => ({ dateKey: l.dateKey, n: l.values[field] ?? 0 })).filter((i) => i.n > 0);

    // perfect month: any settled month with 2+ OKRs, all ≥100 (the jury is out on the running one)
    const perfectMonths: Increment[] = [...okrsByMonth.entries()]
      .filter(([mk, pcts]) => mk < thisMonthKey && pcts.length >= 2 && pcts.every((p) => p >= 100))
      .map(([mk]) => ({ dateKey: lastDayOfMonthKey(mk), n: 1 }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const counters: Record<CountableMetric, Increment[]> = {
      logs: inc(logs),
      wins: inc(stageMoves.filter((s) => s.toStage === "WON")),
      proposals: inc(stageMoves.filter((s) => s.toStage === "PROPOSAL_SENT")),
      discoveryCalls: logField(METRIC_LOG_FIELD.discoveryCalls!),
      hqCalls: logField(METRIC_LOG_FIELD.hqCalls!),
      appointments: logField(METRIC_LOG_FIELD.appointments!),
      leadsContacted: logField(METRIC_LOG_FIELD.leadsContacted!),
      sessions: logField(METRIC_LOG_FIELD.sessions!),
      milestoneMoves: inc(forwardMoves),
      studentOffers: inc(forwardMoves.filter((m) => m.newMilestone === "OFFER_RECEIVED")),
      rescues: inc(rescues),
      okrHits,
      okrPerfectMonths: perfectMonths,
    };

    // ── badges, ratcheted ──
    // `thresholdOn` answers "what did this badge cost on that day?" — falling back
    // to the live bar for a badge that didn't exist yet under the old ruleset.
    const thresholdOn = (badgeKey: string, dateKey: string, fallback: number): number => {
      const rule = rulesOn(dateKey).employeeBadges.find((b) => b.key === badgeKey);
      return rule?.enabled ? rule.threshold : fallback;
    };

    const streakUnlock = (badgeKey: string, fallback: number): string | null => {
      for (const run of runs) {
        for (let i = 1; i <= run.length; i++) {
          if (i >= thresholdOn(badgeKey, run[i - 1], fallback)) return run[i - 1];
        }
      }
      return null;
    };

    const levelUnlock = (badgeKey: string, fallback: number): string | null =>
      levelUps.find((l) => l.level >= thresholdOn(badgeKey, l.dateKey, fallback))?.dateKey ?? null;

    const badges: UnlockedBadge[] = live.employeeBadges
      .filter((b) => b.enabled)
      .map(({ metric, threshold, enabled: _enabled, ...def }) => {
        const unlockedAt =
          metric === "streak" ? streakUnlock(def.key, threshold)
          : metric === "level" ? levelUnlock(def.key, threshold)
          : unlockDateFor(counters[metric], (d) => thresholdOn(def.key, d, threshold));
        return { ...def, unlockedAt };
      });

    return {
      userId: u.userId,
      name: u.name,
      roleTitle: u.roleTitle,
      variant: u.variant,
      xpTotal, xpWeek, xpMonth, level, streak, loggedToday,
      badges,
      unlockedCount: badges.filter((b) => b.unlockedAt).length,
      quests: questProgress,
      events: events.sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
      logDays,
      counters,
      levelUps,
    };
  });

  return { players };
}

// ───────────────────────────── student journey ─────────────────────────────

export type StudentJourneyInput = {
  todayKey: string;
  status: string; // ACTIVE / COMPLETED / DROPPED / PAUSED
  enrollmentDateKey: string;
  currentMilestone: string;
  totalSessionsCompleted: number;
  applicationsSubmitted: number;
  interviewsReceived: number;
  lastSessionDateKey: string | null;
  signalColour: string | null;
  /** append-only histories, any order; empty arrays are fine (badges degrade gracefully) */
  milestoneLogs: Array<{ dateKey: string; previousMilestone: string | null; newMilestone: string }>;
  signalChanges: Array<{ dateKey: string; previousSignal: string | null; newSignal: string | null }>;
};

export type Momentum = "HOT" | "STEADY" | "COOLING" | "STALLED";

export type StudentJourney = {
  xp: number;
  journeyPct: number; // milestone weight covered, 0-100
  stageTitle: string; // Explorer … Alumni
  stageIndex: number; // 0-6
  momentum: Momentum | null; // null when not ACTIVE
  badges: UnlockedBadge[]; // catalogue with unlock dates
  unlockedCount: number;
};

/**
 * A student's journey is a SNAPSHOT of where they stand right now, not a ledger of
 * dated events — so unlike employee XP it is read against today's ruleset only.
 */
export function computeStudentJourney(
  input: StudentJourneyInput,
  config: GamificationConfig = DEFAULT_GAMIFICATION_CONFIG,
): StudentJourney {
  const cfg = currentRuleset(config, input.todayKey).student;
  const badgeRules = currentRuleset(config, input.todayKey).studentBadges;
  const idx = Math.max(0, MILESTONE_INDEX[input.currentMilestone] ?? 0);

  // journey XP: milestones covered + volume bonuses
  let milestoneXp = 0;
  for (let i = 0; i <= idx; i++) milestoneXp += cfg.milestoneXp[MILESTONE_ORDER[i]] ?? 0;
  const bonusXp =
    input.totalSessionsCompleted * cfg.bonusXp.perSession +
    input.applicationsSubmitted * cfg.bonusXp.perApplication +
    input.interviewsReceived * cfg.bonusXp.perInterview;
  const xp = milestoneXp + bonusXp;
  // The denominator is whatever the weights add up to, so the founder can reweight
  // milestones without the progress ring drifting off 100%.
  const totalMilestoneXp = MILESTONE_ORDER.reduce((a, m) => a + (cfg.milestoneXp[m] ?? 0), 0);
  const journeyPct = totalMilestoneXp > 0 ? clampPct((milestoneXp / totalMilestoneXp) * 100) : 0;

  // momentum: recency of visible activity (sessions or milestone moves)
  let momentum: Momentum | null = null;
  if (input.status === "ACTIVE") {
    const lastMilestoneMove = input.milestoneLogs.reduce<string | null>(
      (max, l) => (max === null || l.dateKey > max ? l.dateKey : max), null,
    );
    const lastActivity = [input.lastSessionDateKey, lastMilestoneMove, input.enrollmentDateKey]
      .filter((d): d is string => !!d)
      .sort()
      .pop()!;
    const idle = dayDiffKeys(input.todayKey, lastActivity);
    const { hot, steady, cooling } = cfg.momentumDays;
    momentum = idle <= hot ? "HOT" : idle <= steady ? "STEADY" : idle <= cooling ? "COOLING" : "STALLED";
  }

  const milestoneReachedAt = (m: string | null): string | null => {
    if (!m) return null;
    const target = MILESTONE_INDEX[m] ?? 99;
    if (idx < target) return null;
    const log = input.milestoneLogs
      .filter((l) => (MILESTONE_INDEX[l.newMilestone] ?? -1) >= target)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
    return log?.dateKey ?? input.todayKey; // reached but not logged (legacy rows) → today
  };
  const comebackAt = input.signalChanges
    .filter((c) => c.previousSignal === "RED" && c.newSignal === "GREEN")
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0]?.dateKey ?? null;

  const unlockFor = (rule: StudentBadgeRule): string | null => {
    switch (rule.metric) {
      case "milestoneReached":
        return milestoneReachedAt(rule.milestone);
      case "milestoneWithinDays": {
        const at = milestoneReachedAt(rule.milestone);
        return at && dayDiffKeys(at, input.enrollmentDateKey) <= rule.threshold ? at : null;
      }
      case "applications":
        return input.applicationsSubmitted >= rule.threshold ? input.todayKey : null;
      case "interviews":
        return input.interviewsReceived >= rule.threshold ? input.todayKey : null;
      case "sessions":
        return input.totalSessionsCompleted >= rule.threshold ? input.todayKey : null;
      case "comeback":
        return comebackAt;
      case "greenSignal":
        return input.signalColour === "GREEN" ? input.todayKey : null;
    }
  };

  const badges: UnlockedBadge[] = badgeRules
    .filter((b) => b.enabled)
    .map((rule) => {
      const { metric: _m, threshold: _t, milestone: _ms, enabled: _e, ...def } = rule;
      return { ...def, unlockedAt: unlockFor(rule) };
    });

  return {
    xp,
    journeyPct,
    stageTitle: cfg.stageTitles[idx] ?? MILESTONE_ORDER[idx],
    stageIndex: idx,
    momentum,
    badges,
    unlockedCount: badges.filter((b) => b.unlockedAt).length,
  };
}

export const MOMENTUM_META: Record<Momentum, { label: string; icon: string; color: string; soft: string }> = {
  HOT: { label: "Hot streak", icon: "🔥", color: "var(--good)", soft: "var(--good-bg)" },
  STEADY: { label: "Steady", icon: "🚶", color: "var(--primary)", soft: "var(--primary-soft)" },
  COOLING: { label: "Cooling", icon: "🌥️", color: "var(--warn)", soft: "var(--warn-bg)" },
  STALLED: { label: "Stalled", icon: "🧊", color: "var(--bad)", soft: "var(--bad-bg)" },
};
