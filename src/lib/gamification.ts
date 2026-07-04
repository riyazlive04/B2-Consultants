/**
 * Gamification engine — PURE and isomorphic (no prisma, no server-only).
 *
 * Design rule (same spirit as LTV / runway / funnel): every score is DERIVED at
 * read time from the append-only history the app already keeps — daily logs,
 * lead stage history, discovery outcomes, milestone logs, signal changes, OKRs.
 * Nothing is stored, so XP is retroactive from day one, can never drift out of
 * sync with the real work, and can't be edited — you earn it by doing the work
 * that is already audited.
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

// ───────────────────────────── levels ─────────────────────────────

export const LEVELS = [
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
] as const;

export type LevelInfo = {
  level: number;
  title: string;
  minXp: number;
  nextMinXp: number | null; // null at max level
  progressPct: number; // 0-100 towards the next level
};

export function levelForXp(xp: number): LevelInfo {
  let current: (typeof LEVELS)[number] = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.minXp) current = l;
  const next = LEVELS.find((l) => l.minXp > current.minXp) ?? null;
  const progressPct = next
    ? Math.min(100, ((xp - current.minXp) / (next.minXp - current.minXp)) * 100)
    : 100;
  return { level: current.level, title: current.title, minXp: current.minXp, nextMinXp: next?.minXp ?? null, progressPct };
}

// ───────────────────────────── XP rules ─────────────────────────────
// One table, shown verbatim on the Arena "How XP works" panel — no hidden math.

export const XP_RULES = {
  LOG_SUBMITTED: 20,
  STREAK_BONUS: { 7: 40, 14: 90, 30: 250, 60: 450, 90: 700 } as Record<number, number>,
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
  } as Record<string, number>,
  OUTCOME_LOGGED: 5,
  OUTCOME_HQ_BONUS: 10,
  MILESTONE_ADVANCED: 15,
  MILESTONE_OFFER_BONUS: 50, // student reached "Offer received"
  MILESTONE_COMPLETED_BONUS: 35,
  STUDENT_RESCUED: 50, // signal RED → GREEN
  OKR_HIT: 120, // ≥100% completion
  OKR_NEAR: 60, // ≥80% at month close
} as const;

export const STREAK_MILESTONES = [7, 14, 30, 60, 90] as const;

// ───────────────────────────── weekly quests ─────────────────────────────
// Auto-assigned by daily-log variant. Progress = this ISO week's daily-log sums,
// so the quest board needs zero extra data entry. Completing a quest pays XP —
// historically too (past weeks that met the bar are already banked).

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
};

export const QUESTS: QuestDef[] = [
  {
    key: "steady-week", title: "Steady Week", icon: "🗓️", field: "__weekdayLogs",
    description: "Submit your daily log on all five weekdays.", target: 5, xp: 60, variant: "ANY",
  },
  // Discovery specialist
  {
    key: "call-blitz", title: "Call Blitz", icon: "☎️", field: "discoveryCallsCompleted",
    description: "Complete 15 discovery calls this week.", target: 15, xp: 80, variant: "DISCOVERY_SPECIALIST",
  },
  {
    key: "diamond-week", title: "Diamond Week", icon: "💎", field: "highlyQualifiedCalls",
    description: "Mark 5 calls Highly Qualified this week.", target: 5, xp: 70, variant: "DISCOVERY_SPECIALIST",
  },
  {
    key: "paper-trail", title: "Paper Trail", icon: "📨", field: "proposalsSent",
    description: "Send 5 proposals this week.", target: 5, xp: 70, variant: "DISCOVERY_SPECIALIST",
  },
  // Appointment setter
  {
    key: "calendar-filler", title: "Calendar Filler", icon: "📅", field: "appointmentsSet",
    description: "Set 10 appointments this week.", target: 10, xp: 80, variant: "APPOINTMENT_SETTER",
  },
  {
    key: "outreach-wave", title: "Outreach Wave", icon: "📣", field: "newLeadsContacted",
    description: "Contact 40 new leads this week.", target: 40, xp: 70, variant: "APPOINTMENT_SETTER",
  },
  {
    key: "pipeline-builder", title: "Pipeline Builder", icon: "🧱", field: "leadsAddedToPipeline",
    description: "Add 15 leads to the pipeline this week.", target: 15, xp: 60, variant: "APPOINTMENT_SETTER",
  },
  // Delivery coach
  {
    key: "session-marathon", title: "Session Marathon", icon: "🎓", field: "sessionsDelivered",
    description: "Deliver 8 coaching sessions this week.", target: 8, xp: 80, variant: "DELIVERY_COACH",
  },
  {
    key: "pulse-check", title: "Pulse Check", icon: "🤝", field: "studentsCheckedInOn",
    description: "Check in on 10 students this week.", target: 10, xp: 70, variant: "DELIVERY_COACH",
  },
  {
    key: "red-pen", title: "Red Pen", icon: "✍️", field: "assignmentsReviewed",
    description: "Review 10 assignments this week.", target: 10, xp: 60, variant: "DELIVERY_COACH",
  },
];

export function questsForVariant(variant: DailyLogVariant | null): QuestDef[] {
  if (!variant) return [];
  return QUESTS.filter((q) => q.variant === "ANY" || q.variant === variant);
}

export type QuestProgress = QuestDef & { value: number; done: boolean; pct: number };

// ───────────────────────────── employee badges ─────────────────────────────

export const EMPLOYEE_BADGES: BadgeDef[] = [
  { key: "first-log", name: "First Steps", icon: "👣", tier: "bronze", description: "Submitted your first daily log." },
  { key: "streak-7", name: "On Fire", icon: "🔥", tier: "bronze", description: "7-day logging streak." },
  { key: "streak-14", name: "Unstoppable", icon: "⚡", tier: "silver", description: "14-day logging streak." },
  { key: "streak-30", name: "Iron Discipline", icon: "🛡️", tier: "gold", description: "30-day logging streak." },
  { key: "streak-60", name: "Habit Machine", icon: "⚙️", tier: "gold", description: "60-day logging streak." },
  { key: "streak-90", name: "Relentless", icon: "🌋", tier: "legend", description: "90-day logging streak." },
  { key: "logs-100", name: "Century Logger", icon: "💯", tier: "gold", description: "100 daily logs submitted." },
  { key: "first-win", name: "First Win", icon: "🏁", tier: "bronze", description: "Closed your first deal (lead → Won)." },
  { key: "closer-5", name: "Closer", icon: "🤝", tier: "silver", description: "5 deals closed." },
  { key: "rainmaker-15", name: "Rainmaker", icon: "🌧️", tier: "gold", description: "15 deals closed." },
  { key: "proposals-25", name: "Proposal Pro", icon: "📨", tier: "silver", description: "25 proposals sent." },
  { key: "calls-100", name: "Call Centurion", icon: "☎️", tier: "gold", description: "100 discovery calls completed." },
  { key: "hq-25", name: "Quality Hunter", icon: "💎", tier: "silver", description: "25 calls marked Highly Qualified." },
  { key: "appointments-50", name: "Booking Machine", icon: "📅", tier: "silver", description: "50 appointments set." },
  { key: "leads-500", name: "Outreach Army", icon: "📣", tier: "gold", description: "500 new leads contacted." },
  { key: "sessions-50", name: "Coach's Whistle", icon: "🎓", tier: "silver", description: "50 coaching sessions delivered." },
  { key: "milestones-25", name: "Milestone Mover", icon: "🚀", tier: "silver", description: "Advanced student milestones 25 times." },
  { key: "offers-5", name: "Offer Factory", icon: "💼", tier: "gold", description: "5 students moved to Offer received." },
  { key: "rescues-3", name: "Lifeguard", icon: "🛟", tier: "gold", description: "Turned 3 red-signal students green." },
  { key: "okr-100", name: "Bullseye", icon: "🎯", tier: "silver", description: "Completed an OKR at 100%." },
  { key: "okr-perfect-month", name: "Perfect Month", icon: "🌕", tier: "gold", description: "All OKRs (2+) at 100% in one month." },
  { key: "level-5", name: "Halfway to Legend", icon: "⭐", tier: "silver", description: "Reached level 5 — Mentor." },
  { key: "level-10", name: "Living Legend", icon: "👑", tier: "legend", description: "Reached level 10 — Legend." },
];

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

/** First date a dated counter series reaches a threshold (for badge unlock dates). */
function unlockDateFor(increments: Array<{ dateKey: string; n: number }>, threshold: number): string | null {
  if (threshold <= 0) return null;
  let sum = 0;
  for (const inc of [...increments].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
    sum += inc.n;
    if (sum >= threshold) return inc.dateKey;
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
  signalMoves: Array<{ userId: string; dateKey: string; previousSignal: string | null; newSignal: string }>;
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
  badges: UnlockedBadge[]; // full catalogue with unlockedAt set where earned
  unlockedCount: number;
  quests: QuestProgress[]; // this week
  events: XpEvent[]; // newest first
};

export const MILESTONE_ORDER = [
  "ONBOARDING", "RESUME_BUILD", "LINKEDIN_OPTIMISATION", "APPLICATIONS",
  "INTERVIEWS", "OFFER_RECEIVED", "COMPLETED",
] as const;

const MILESTONE_INDEX: Record<string, number> = Object.fromEntries(
  MILESTONE_ORDER.map((m, i) => [m, i]),
);

const STAGE_LABELS_SHORT: Record<string, string> = {
  DISCO_BOOKED: "Discovery call booked",
  SSS_BOOKED: "SSS call booked",
  SSS_COMPLETED: "SSS call completed",
  PROPOSAL_SENT: "Proposal sent",
  SENT_TO_WORKSHOP: "Sent to workshop",
  WORKSHOP_FOLLOWUP: "Workshop follow-up",
  OFFER_FOLLOWUP: "Offer follow-up",
  DEPOSIT_FOLLOWUP: "Deposit follow-up",
  DEPOSIT_PAID: "Deposit collected",
  WON: "Deal won",
};

/** Build the full XP ledger + badges + quests for every player. Pure — feed it rows, get the game. */
export function computeTeamGame(inputs: GameInputs): { players: PlayerGame[] } {
  const { todayKey } = inputs;
  const thisWeekStart = weekStartKey(todayKey);
  const thisMonthKey = monthKeyOf(todayKey);

  const players = inputs.users.map((u) => {
    const logs = inputs.logs.filter((l) => l.userId === u.userId);
    const stageMoves = inputs.stageMoves.filter((s) => s.userId === u.userId);
    const outcomes = inputs.outcomes.filter((o) => o.userId === u.userId);
    const milestoneMoves = inputs.milestoneMoves.filter((m) => m.userId === u.userId);
    const signalMoves = inputs.signalMoves.filter((s) => s.userId === u.userId);
    const okrs = inputs.okrs.filter((o) => o.userId === u.userId);

    const events: XpEvent[] = [];
    const push = (dateKey: string, kind: string, label: string, xp: number) =>
      events.push({ userId: u.userId, dateKey, kind, label, xp });

    // 1) Daily logs + streak bonuses
    const logDays = logs.map((l) => l.dateKey);
    for (const l of logs) push(l.dateKey, "log", "Daily log submitted", XP_RULES.LOG_SUBMITTED);
    for (const run of streakRuns(logDays)) {
      for (const m of STREAK_MILESTONES) {
        if (run.length >= m) push(run[m - 1], "streak", `${m}-day streak bonus`, XP_RULES.STREAK_BONUS[m]);
      }
    }
    const { streak, loggedToday } = currentStreak(logDays, todayKey);

    // 2) Pipeline stage moves
    for (const s of stageMoves) {
      const xp = XP_RULES.STAGE_MOVED[s.toStage];
      if (!xp) continue;
      push(s.dateKey, "stage", `${STAGE_LABELS_SHORT[s.toStage] ?? s.toStage} · ${s.leadName}${s.toStage === "WON" ? " 🎉" : ""}`, xp);
    }

    // 3) Discovery outcomes entered
    for (const o of outcomes) {
      push(o.dateKey, "outcome", o.highlyQualified ? "Highly-qualified call logged" : "Call outcome logged",
        XP_RULES.OUTCOME_LOGGED + (o.highlyQualified ? XP_RULES.OUTCOME_HQ_BONUS : 0));
    }

    // 4) Student milestone moves (forward only — no XP for corrections backwards)
    const forwardMoves = milestoneMoves.filter(
      (m) => m.previousMilestone === null ||
        (MILESTONE_INDEX[m.newMilestone] ?? 0) > (MILESTONE_INDEX[m.previousMilestone] ?? 0),
    );
    for (const m of forwardMoves) {
      let xp = XP_RULES.MILESTONE_ADVANCED;
      let suffix = "";
      if (m.newMilestone === "OFFER_RECEIVED") { xp += XP_RULES.MILESTONE_OFFER_BONUS; suffix = " — offer! 🎉"; }
      if (m.newMilestone === "COMPLETED") { xp += XP_RULES.MILESTONE_COMPLETED_BONUS; suffix = " — journey complete"; }
      push(m.dateKey, "milestone", `Student milestone advanced · ${m.studentName}${suffix}`, xp);
    }

    // 5) Rescues: RED → GREEN
    const rescues = signalMoves.filter((s) => s.previousSignal === "RED" && s.newSignal === "GREEN");
    for (const r of rescues) push(r.dateKey, "rescue", "Student rescued: red → green", XP_RULES.STUDENT_RESCUED);

    // 6) OKRs — settled past months pay on results; the running month pays only a confirmed 100%
    const okrHits: Array<{ dateKey: string; n: number }> = [];
    const okrsByMonth = new Map<string, number[]>();
    for (const o of okrs) {
      if (!okrsByMonth.has(o.monthKey)) okrsByMonth.set(o.monthKey, []);
      okrsByMonth.get(o.monthKey)!.push(o.completionPct);
      const settled = o.monthKey < thisMonthKey;
      const monthEnd = lastDayOfMonthKey(o.monthKey);
      if (o.completionPct >= 100) {
        const when = settled ? monthEnd : todayKey;
        push(when, "okr", "OKR completed at 100%", XP_RULES.OKR_HIT);
        okrHits.push({ dateKey: when, n: 1 });
      } else if (settled && o.completionPct >= 80) {
        push(monthEnd, "okr", "OKR closed above 80%", XP_RULES.OKR_NEAR);
      }
    }

    // 7) Weekly quests — banked for every week that met the bar (incl. this one)
    const quests = questsForVariant(u.variant);
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
      q.field === "__weekdayLogs" ? b.weekdayLogs : (b.sums[q.field] ?? 0);
    for (const b of weekBuckets.values()) {
      for (const q of quests) {
        if (questValue(q, b) >= q.target) {
          push(b.lastLog, "quest", `Quest complete · ${q.icon} ${q.title}`, q.xp);
        }
      }
    }
    const thisWeek = weekBuckets.get(thisWeekStart) ?? { sums: {}, weekdayLogs: 0, lastLog: todayKey };
    const questProgress: QuestProgress[] = quests.map((q) => {
      const value = questValue(q, thisWeek);
      return { ...q, value, done: value >= q.target, pct: Math.min(100, (value / q.target) * 100) };
    });

    // totals + level
    const xpTotal = events.reduce((a, e) => a + e.xp, 0);
    const xpWeek = events.filter((e) => e.dateKey >= thisWeekStart).reduce((a, e) => a + e.xp, 0);
    const xpMonth = events.filter((e) => monthKeyOf(e.dateKey) === thisMonthKey).reduce((a, e) => a + e.xp, 0);
    const level = levelForXp(xpTotal);

    // ── badges ──
    const inc = (rows: Array<{ dateKey: string }>) => rows.map((r) => ({ dateKey: r.dateKey, n: 1 }));
    const logField = (field: string) => logs.map((l) => ({ dateKey: l.dateKey, n: l.values[field] ?? 0 }));
    const wins = stageMoves.filter((s) => s.toStage === "WON");
    const proposals = stageMoves.filter((s) => s.toStage === "PROPOSAL_SENT");
    const offers = forwardMoves.filter((m) => m.newMilestone === "OFFER_RECEIVED");

    // streak badge unlock dates: first run that reached each milestone
    const streakUnlock: Record<number, string | null> = {};
    for (const m of STREAK_MILESTONES) {
      streakUnlock[m] = null;
      for (const run of streakRuns(logDays)) {
        if (run.length >= m) { streakUnlock[m] = run[m - 1]; break; }
      }
    }

    // perfect month: any month with 2+ OKRs, all ≥100 (settled months only — the jury is out on the running one)
    let perfectMonthAt: string | null = null;
    for (const [mk, pcts] of [...okrsByMonth.entries()].sort()) {
      if (mk < thisMonthKey && pcts.length >= 2 && pcts.every((p) => p >= 100)) {
        perfectMonthAt = lastDayOfMonthKey(mk);
        break;
      }
    }

    // level unlock dates from the XP cumsum
    const levelUnlock = (minXp: number): string | null => {
      let sum = 0;
      for (const e of [...events].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
        sum += e.xp;
        if (sum >= minXp) return e.dateKey;
      }
      return null;
    };

    const badgeDates: Record<string, string | null> = {
      "first-log": unlockDateFor(inc(logs), 1),
      "streak-7": streakUnlock[7], "streak-14": streakUnlock[14], "streak-30": streakUnlock[30],
      "streak-60": streakUnlock[60], "streak-90": streakUnlock[90],
      "logs-100": unlockDateFor(inc(logs), 100),
      "first-win": unlockDateFor(inc(wins), 1),
      "closer-5": unlockDateFor(inc(wins), 5),
      "rainmaker-15": unlockDateFor(inc(wins), 15),
      "proposals-25": unlockDateFor(inc(proposals), 25),
      "calls-100": unlockDateFor(logField("discoveryCallsCompleted"), 100),
      "hq-25": unlockDateFor(logField("highlyQualifiedCalls"), 25),
      "appointments-50": unlockDateFor(logField("appointmentsSet"), 50),
      "leads-500": unlockDateFor(logField("newLeadsContacted"), 500),
      "sessions-50": unlockDateFor(logField("sessionsDelivered"), 50),
      "milestones-25": unlockDateFor(inc(forwardMoves), 25),
      "offers-5": unlockDateFor(inc(offers), 5),
      "rescues-3": unlockDateFor(inc(rescues), 3),
      "okr-100": unlockDateFor(okrHits, 1),
      "okr-perfect-month": perfectMonthAt,
      "level-5": xpTotal >= LEVELS[4].minXp ? levelUnlock(LEVELS[4].minXp) : null,
      "level-10": xpTotal >= LEVELS[9].minXp ? levelUnlock(LEVELS[9].minXp) : null,
    };

    const badges: UnlockedBadge[] = EMPLOYEE_BADGES.map((b) => ({ ...b, unlockedAt: badgeDates[b.key] ?? null }));

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
    };
  });

  return { players };
}

function lastDayOfMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ───────────────────────────── student journey ─────────────────────────────

/** Milestone weights — sum to 1000 "journey XP". Bonus XP on top for volume. */
export const STUDENT_MILESTONE_XP: Record<string, number> = {
  ONBOARDING: 60,
  RESUME_BUILD: 120,
  LINKEDIN_OPTIMISATION: 120,
  APPLICATIONS: 180,
  INTERVIEWS: 220,
  OFFER_RECEIVED: 200,
  COMPLETED: 100,
};

export const STUDENT_STAGE_TITLES = [
  "Explorer", "Builder", "Connector", "Applicant", "Interviewer", "Offer Holder", "Alumni",
] as const;

export const STUDENT_BADGES: BadgeDef[] = [
  { key: "fast-starter", name: "Fast Starter", icon: "🚀", tier: "bronze", description: "Reached Resume build within 14 days of enrolling." },
  { key: "linkedin-live", name: "Visible", icon: "🔗", tier: "bronze", description: "LinkedIn optimisation reached." },
  { key: "first-application", name: "In the Game", icon: "📄", tier: "bronze", description: "First application submitted." },
  { key: "sprinter-20", name: "Application Sprinter", icon: "🏃", tier: "silver", description: "20+ applications submitted." },
  { key: "first-interview", name: "Foot in the Door", icon: "🎤", tier: "silver", description: "First interview received." },
  { key: "interview-magnet", name: "Interview Magnet", icon: "🧲", tier: "gold", description: "3+ interviews received." },
  { key: "sessions-10", name: "Committed", icon: "📚", tier: "silver", description: "10+ coaching sessions completed." },
  { key: "comeback", name: "Comeback Story", icon: "💪", tier: "gold", description: "Bounced back from red signal to green." },
  { key: "green-zone", name: "In the Zone", icon: "🟢", tier: "bronze", description: "Currently on a green signal." },
  { key: "offer-champion", name: "Offer Champion", icon: "🏆", tier: "legend", description: "Received a job offer in Germany." },
  { key: "finisher", name: "Finisher", icon: "🎓", tier: "gold", description: "Completed the full program journey." },
];

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
  signalChanges: Array<{ dateKey: string; previousSignal: string | null; newSignal: string }>;
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

export function computeStudentJourney(input: StudentJourneyInput): StudentJourney {
  const idx = Math.max(0, MILESTONE_INDEX[input.currentMilestone] ?? 0);

  // journey XP: milestones covered + volume bonuses
  let milestoneXp = 0;
  for (let i = 0; i <= idx; i++) milestoneXp += STUDENT_MILESTONE_XP[MILESTONE_ORDER[i]] ?? 0;
  const bonusXp =
    input.totalSessionsCompleted * 8 +
    input.applicationsSubmitted * 4 +
    input.interviewsReceived * 20;
  const xp = milestoneXp + bonusXp;
  const journeyPct = Math.min(100, (milestoneXp / 1000) * 100);

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
    momentum = idle <= 7 ? "HOT" : idle <= 14 ? "STEADY" : idle <= 21 ? "COOLING" : "STALLED";
  }

  // badge unlock dates
  const milestoneReachedAt = (m: string): string | null => {
    const target = MILESTONE_INDEX[m] ?? 99;
    if (idx < target) return null;
    const log = input.milestoneLogs
      .filter((l) => (MILESTONE_INDEX[l.newMilestone] ?? -1) >= target)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
    return log?.dateKey ?? input.todayKey; // reached but not logged (legacy rows) → today
  };
  const resumeAt = milestoneReachedAt("RESUME_BUILD");
  const comebackAt = input.signalChanges
    .filter((c) => c.previousSignal === "RED" && c.newSignal === "GREEN")
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0]?.dateKey ?? null;

  const dates: Record<string, string | null> = {
    "fast-starter":
      resumeAt && dayDiffKeys(resumeAt, input.enrollmentDateKey) <= 14 ? resumeAt : null,
    "linkedin-live": milestoneReachedAt("LINKEDIN_OPTIMISATION"),
    "first-application": input.applicationsSubmitted >= 1 ? input.todayKey : null,
    "sprinter-20": input.applicationsSubmitted >= 20 ? input.todayKey : null,
    "first-interview": input.interviewsReceived >= 1 ? input.todayKey : null,
    "interview-magnet": input.interviewsReceived >= 3 ? input.todayKey : null,
    "sessions-10": input.totalSessionsCompleted >= 10 ? input.todayKey : null,
    comeback: comebackAt,
    "green-zone": input.signalColour === "GREEN" ? input.todayKey : null,
    "offer-champion": milestoneReachedAt("OFFER_RECEIVED"),
    finisher: milestoneReachedAt("COMPLETED"),
  };

  const badges: UnlockedBadge[] = STUDENT_BADGES.map((b) => ({ ...b, unlockedAt: dates[b.key] ?? null }));

  return {
    xp,
    journeyPct,
    stageTitle: STUDENT_STAGE_TITLES[idx],
    stageIndex: idx,
    momentum,
    badges,
    unlockedCount: badges.filter((b) => b.unlockedAt).length,
  };
}

/** What the student should focus on at each milestone — shown on their portal as
 *  "quests" for the current stage. Static coaching guidance, no AI, no storage. */
export const STUDENT_NEXT_STEPS: Record<string, { focus: string; steps: string[] }> = {
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
};

export const MOMENTUM_META: Record<Momentum, { label: string; icon: string; color: string; soft: string }> = {
  HOT: { label: "Hot streak", icon: "🔥", color: "var(--ok)", soft: "var(--ok-soft, #e7f6ec)" },
  STEADY: { label: "Steady", icon: "🚶", color: "var(--accent)", soft: "var(--accent-soft)" },
  COOLING: { label: "Cooling", icon: "🌥️", color: "var(--watch)", soft: "var(--watch-soft)" },
  STALLED: { label: "Stalled", icon: "🧊", color: "var(--risk)", soft: "var(--risk-soft)" },
};
