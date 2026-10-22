/**
 * THE SPRINT LEADERBOARD - what counts, what it is worth, and how ties break.
 *
 * ── Where this sits in the programme ────────────────────────────────────────────────────
 * Four weeks of taught classes, then a 90-day (Guided) or 120-day (Elite) sprint. The taught
 * weeks are measured by attendance and coursework; the sprint is measured by what a student
 * actually does with them - applications, recruiter connections, interviews. This board spans
 * both, because a student who attended nothing and then applied to forty roles and a student
 * who attended everything and applied to none are both in trouble, and only one number that
 * includes both can say so.
 *
 * ── Two layers, exactly like lib/sections.ts ────────────────────────────────────────────
 *   1. `LEADERBOARD_METRICS` - CODE TRUTH. A metric exists because something computes it. The
 *      admin cannot invent one, because there would be nothing to count.
 *   2. `LeaderboardConfig` - the ADMIN's layer, persisted as JSON in AppSetting. Which metrics
 *      count, what each is worth, weekly caps, the period, and who may see the board. Unknown
 *      keys are ignored (a metric was removed); missing keys fall back to the catalogue (a
 *      metric was added). That is what "configured by the admin" means here: the arithmetic is
 *      theirs, the plumbing is not.
 *
 * ── Why DERIVED and LOGGED are marked ──────────────────────────────────────────────────
 * Most of this board is read from records that already exist - the register, the watch rows,
 * the coursework ticks, the application tracker. Those are marked `derived` and a student
 * cannot type them in. Re-logging them would be a second copy of the same fact, free to
 * disagree with the screen that owns it; a leaderboard whose attendance column contradicts the
 * attendance page is worse than no leaderboard.
 *
 * The `logged` ones are the handful the app has no other way of knowing: a German HR contact
 * accepting a connection, an interview that arrived through a channel we never saw, a win. Those
 * score the moment a student writes them, and the coach's feed is a correction surface rather
 * than a gate - a board that only moves when a coach gets round to it is a board nobody checks.
 *
 * Pure and dependency-free, like lib/attendance.ts and lib/recording-access.ts beside it. These
 * are the numbers that will rank named people against their classmates, so they have to be
 * arguable and checkable without a database.
 */

/** Every metric the board can score. Adding one here means teaching the reader to count it. */
export const LEADERBOARD_METRIC_KEYS = [
  "class_attended",
  "recording_watched",
  "task_completed",
  "sprint_week_achieved",
  "application_submitted",
  "application_reviewed",
  "hr_connection",
  "hr_interview",
  "application_selected",
  "win",
] as const;

export type LeaderboardMetricKey = (typeof LEADERBOARD_METRIC_KEYS)[number];

export type LeaderboardMetric = {
  key: LeaderboardMetricKey;
  label: string;
  /** What one unit is, in the sentence a student reads: "12 classes attended". */
  unit: string;
  /**
   * `derived` - computed from a record elsewhere; nobody can type it in.
   * `logged`  - self-reported into `SprintLogEntry`; scores at once, coach can correct.
   */
  source: "derived" | "logged";
  /** Where the number comes from, so a disputed score has an answer. */
  from: string;
  defaultPoints: number;
  /**
   * Default ceiling on how many units count in one calendar week, or null for none.
   *
   * CAPS EXIST BECAUSE QUANTITY IS SELF-REPORTED. One `SprintLogEntry` may carry a quantity of
   * nine - which it must, or a student catching up on a week of connection requests would have
   * to add nine rows - and without a ceiling that is simply a number box wired to the top of
   * the leaderboard. The derived metrics need no cap: you cannot attend a class twice.
   */
  defaultWeeklyCap: number | null;
};

export const LEADERBOARD_METRICS: readonly LeaderboardMetric[] = [
  {
    key: "class_attended",
    label: "Class attended",
    unit: "classes",
    source: "derived",
    from: "The register - PRESENT or LATE on a live class. Late still counts: they were in the room.",
    defaultPoints: 10,
    defaultWeeklyCap: null,
  },
  {
    key: "recording_watched",
    label: "Recording watched",
    unit: "recordings",
    source: "derived",
    from: "Tracked watch progress at or above 90%. The tracked figure wins over a self-reported tick, so a 40% tick scores nothing.",
    defaultPoints: 5,
    defaultWeeklyCap: null,
  },
  {
    key: "task_completed",
    label: "Coursework completed",
    unit: "tasks",
    source: "derived",
    from: "A task the coach set, ticked off by the student.",
    defaultPoints: 10,
    defaultWeeklyCap: null,
  },
  {
    key: "sprint_week_achieved",
    label: "Sprint week hit",
    unit: "weeks",
    source: "derived",
    from: "A sprint week the coach marked ACHIEVED at the weekend check-in.",
    defaultPoints: 25,
    defaultWeeklyCap: null,
  },
  {
    key: "application_submitted",
    label: "Application sent",
    unit: "applications",
    source: "derived",
    from: "The application tracker. Counted on the day it was applied, not when it was typed in.",
    defaultPoints: 5,
    defaultWeeklyCap: null,
  },
  {
    key: "application_reviewed",
    label: "Application reviewed",
    unit: "applications",
    source: "logged",
    from: "Self-reported: a recruiter viewed it, replied, or screened you. There is no REVIEWED status in the tracker - applying is in our gift, being read is not.",
    defaultPoints: 15,
    defaultWeeklyCap: 20,
  },
  {
    key: "hr_connection",
    label: "HR connection accepted",
    unit: "connections",
    source: "logged",
    from: "Self-reported: a German HR contact or hiring manager accepted your request.",
    defaultPoints: 10,
    defaultWeeklyCap: 25,
  },
  {
    key: "hr_interview",
    label: "HR interview secured",
    unit: "interviews",
    source: "logged",
    from: "Self-reported, plus any application the tracker has at INTERVIEW. Counted once per interview.",
    defaultPoints: 50,
    defaultWeeklyCap: 10,
  },
  {
    key: "application_selected",
    label: "Offer received",
    unit: "offers",
    source: "derived",
    from: "An application the tracker has at SELECTED.",
    defaultPoints: 200,
    defaultWeeklyCap: null,
  },
  {
    key: "win",
    label: "Win shared",
    unit: "wins",
    source: "logged",
    from: "Self-reported: anything else worth telling the cohort about.",
    defaultPoints: 5,
    defaultWeeklyCap: 5,
  },
];

export const METRIC_BY_KEY: Record<LeaderboardMetricKey, LeaderboardMetric> = Object.fromEntries(
  LEADERBOARD_METRICS.map((m) => [m.key, m]),
) as Record<LeaderboardMetricKey, LeaderboardMetric>;

/** How students see each other. The founders chose NAMED; the setting stays so it is theirs. */
export type LeaderboardVisibility = "NAMED" | "ANONYMISED" | "STAFF_ONLY";

/**
 * Which stretch of the programme is scored.
 *
 * `SPRINT` counts from the day the sprint starts, which is what the founders described - the
 * board is a sprint board. `PROGRAMME` counts from enrolment, which includes the four taught
 * weeks. A cohort still inside its taught weeks has no sprint yet, and `SPRINT` would score
 * every one of them at zero - so the reader falls back to enrolment until the sprint begins
 * rather than showing a board of noughts.
 */
export type LeaderboardPeriod = "SPRINT" | "PROGRAMME";

export type MetricRule = {
  enabled: boolean;
  points: number;
  /** Null = uncapped. Applies per calendar week of the period. */
  weeklyCap: number | null;
};

export type LeaderboardConfig = {
  enabled: boolean;
  visibility: LeaderboardVisibility;
  period: LeaderboardPeriod;
  /**
   * Rank within the student's own cohort, or across every active enrollment.
   *
   * BATCH by default, and not a cosmetic choice: a student in sprint week 12 and one in their
   * first taught week are not comparable, and a single global board would put every new cohort
   * permanently at the bottom of a list they cannot catch up with. Nobody stays motivated by a
   * race that was decided before they joined.
   */
  scope: "BATCH" | "ALL";
  metrics: Record<LeaderboardMetricKey, MetricRule>;
  /** Show at most this many rows to a student. 0 = the whole cohort. */
  topN: number;
};

export const DEFAULT_LEADERBOARD_CONFIG: LeaderboardConfig = {
  // Ships ON. Unlike the outbound engines there is nothing to blast: this is a read over
  // records that already exist, and its worst failure mode is an empty board.
  enabled: true,
  visibility: "NAMED",
  period: "SPRINT",
  scope: "BATCH",
  topN: 0,
  metrics: Object.fromEntries(
    LEADERBOARD_METRICS.map((m) => [
      m.key,
      { enabled: true, points: m.defaultPoints, weeklyCap: m.defaultWeeklyCap },
    ]),
  ) as Record<LeaderboardMetricKey, MetricRule>,
};

/** Raw counts for one student, keyed by metric. Missing keys read as zero. */
export type MetricCounts = Partial<Record<LeaderboardMetricKey, number>>;

export type MetricScore = {
  key: LeaderboardMetricKey;
  label: string;
  count: number;
  /** Units that actually scored - below `count` when a weekly cap bit. */
  counted: number;
  points: number;
};

export type ScoreBreakdown = {
  total: number;
  lines: MetricScore[];
  /** True when any cap reduced a count - the UI says so rather than quietly losing points. */
  capped: boolean;
};

/**
 * Score one student.
 *
 * `weeks` is how many calendar weeks of the period have elapsed (at least 1), and it is what
 * turns a per-week cap into a total ceiling. Passing the elapsed weeks rather than the period's
 * full length matters: a cap of 25/week over a 13-week sprint must not let a student in week one
 * bank 325 connections in an afternoon.
 */
export function scoreStudent(
  counts: MetricCounts,
  config: LeaderboardConfig,
  weeks: number,
): ScoreBreakdown {
  const elapsed = Math.max(1, Math.floor(weeks));
  const lines: MetricScore[] = [];
  let total = 0;
  let capped = false;

  for (const metric of LEADERBOARD_METRICS) {
    const rule = config.metrics[metric.key];
    if (!rule || !rule.enabled) continue;

    const count = Math.max(0, Math.round(counts[metric.key] ?? 0));
    const ceiling = rule.weeklyCap === null ? null : Math.max(0, rule.weeklyCap) * elapsed;
    const counted = ceiling === null ? count : Math.min(count, ceiling);
    if (counted < count) capped = true;

    const points = counted * rule.points;
    total += points;
    lines.push({ key: metric.key, label: metric.label, count, counted, points });
  }

  return { total, lines, capped };
}

export type RankedRow<T> = T & {
  /** 1-based. Equal totals SHARE a rank. */
  rank: number;
  total: number;
};

/**
 * Rank, with ties sharing a place.
 *
 * Two students on 388 points are both 2nd, and the next one is 4th - standard competition
 * ranking. Breaking a genuine tie on something arbitrary (whoever enrolled first) would invent
 * a difference the students can see is not real, on a board that names them.
 *
 * The secondary sort is the NAME, purely so the order is stable between reads. It does not
 * change anyone's rank.
 */
export function rankRows<T extends { total: number; name: string }>(rows: T[]): RankedRow<T>[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const out: RankedRow<T>[] = [];
  let lastTotal: number | null = null;
  let lastRank = 0;

  sorted.forEach((row, i) => {
    const rank = lastTotal !== null && row.total === lastTotal ? lastRank : i + 1;
    lastTotal = row.total;
    lastRank = rank;
    out.push({ ...row, rank, total: row.total });
  });

  return out;
}

/** "1st" / "2nd" / "11th" - the ordinal on a student's own card. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * How a peer is labelled when the admin has anonymised the board.
 *
 * Positional, NOT a hash of the name: "Student C" is the third row, and stays the third row's
 * label whoever is in it. Deriving it from the person would make the pseudonym stable across
 * weeks, and a stable pseudonym on a six-person cohort is not anonymous for long - everyone
 * would work out who Student C is by week three.
 */
export function anonLabel(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const i = Math.max(0, index);
  return i < letters.length
    ? `Student ${letters[i]}`
    : `Student ${Math.floor(i / letters.length)}${letters[i % letters.length]}`;
}

/** Whole calendar weeks elapsed between two days, at least 1. */
export function weeksElapsed(startYmd: string, nowYmd: string): number {
  const start = Date.parse(`${startYmd}T00:00:00Z`);
  const now = Date.parse(`${nowYmd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(now) || now <= start) return 1;
  return Math.max(1, Math.ceil((now - start) / (7 * 86_400_000)));
}
