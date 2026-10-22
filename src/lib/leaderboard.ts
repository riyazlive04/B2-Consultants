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
  /**
   * How many students a cohort needs before its average may be shown at all.
   *
   * See `cohortPublishable` at the foot of this file for why this is not cosmetic: beneath the
   * floor, the cohort average next to your own score resolves into a named classmate's. Floored
   * at `HARD_MIN_COHORT` by the reader, so no setting can switch the protection off entirely.
   */
  minCohort: number;
};

export const DEFAULT_LEADERBOARD_CONFIG: LeaderboardConfig = {
  // Ships ON. Unlike the outbound engines there is nothing to blast: this is a read over
  // records that already exist, and its worst failure mode is an empty board.
  enabled: true,
  visibility: "NAMED",
  period: "SPRINT",
  scope: "BATCH",
  topN: 0,
  // Five, not two: small enough that a real B2 cohort (six to ten) gets its benchmark, large
  // enough that nobody can read an individual out of the average.
  minCohort: 5,
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

/* ────────────────────────────────────────────────────────────────────────────────────────
 * THE COHORT BENCHMARK - "how am I doing" without naming anybody.
 *
 * The founders asked for the same thing twice on the walkthrough call (@40:55, @41:29): a
 * student should see where they stand against the COHORT, and never against a named classmate.
 * The second half of that is already built - `viewFor` in server/leaderboard.ts replaces every
 * other student's name before the view is serialised - and this is the first half.
 *
 * ── Why it could not simply be computed in the browser ─────────────────────────────────
 * `viewFor` deliberately reduces a classmate's `breakdown` to `total` alone and trims the list
 * to `topN`. By the time a student's page holds the board, the per-metric numbers an average
 * needs have already been dropped and some of the rows are gone. That is the privacy design
 * working, so the average is computed on the server over the FULL cohort, before any of it is
 * taken away, and carried as its own field. The arithmetic lives here, pure, so the floor below
 * and the maths above it are arguable without a database.
 *
 * ── Mean AND median, not one of them ──────────────────────────────────────────────────
 * On a cohort of eight, one student with an offer and 300 applications drags the mean somewhere
 * nobody else in the room is. Showing only the mean tells seven students they are behind when
 * they are not; showing only the median hides a cohort that is genuinely racing ahead. Both are
 * cheap, and the pair is honest.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * THE FLOOR, in one place because two callers need the identical answer.
 *
 * ── The attack this is defending against ───────────────────────────────────────────────
 * An aggregate normally leaks nothing about an individual, but a student reading this board
 * knows their OWN per-metric line exactly. Given the cohort mean they can recover the sum of
 * everybody else's: `mean × size − mine`. So the real question is not how big the cohort is, it
 * is how big the cohort MINUS the reader is - and `size − 1 = 1` is not an aggregate at all, it
 * is one named classmate's exact breakdown with two arithmetic steps in front of it.
 *
 * Which is why the hard minimum is THREE, not two. A cohort of two publishes the other person;
 * a cohort of three publishes a pair, and a pair cannot be resolved into its members.
 *
 * `config.minCohort` ships at 5, well above this; the floor here is what no configured value
 * and no hand-edited `AppSetting` row can go under. Below it nothing is published at all - not
 * a rounded number, not a band. Both the per-metric averages and the pooled conversion ratio
 * ask this one function, so they can never disagree about whether a cohort is big enough.
 */
export const HARD_MIN_COHORT = 3;

export function cohortPublishable(size: number, minCohort: number): boolean {
  return size >= Math.max(HARD_MIN_COHORT, Math.floor(minCohort));
}

export type AggregateLine = {
  key: LeaderboardMetricKey;
  label: string;
  /** Cohort mean, one decimal place - "8.4 applications" is a fair summary, 8.428571 is not. */
  mean: number;
  median: number;
};

export type CohortAggregate = {
  /** How many enrolments went in - the whole cohort, not the `topN` list a student sees. */
  size: number;
  /** The floor that was applied, so the UI can say "needs 5" rather than a bare refusal. */
  minCohort: number;
  /** True when the cohort is too small to publish. Every number below is then zero. */
  suppressed: boolean;
  total: { mean: number; median: number };
  /** One line per ENABLED metric, in catalogue order. Empty when suppressed. */
  lines: AggregateLine[];
};

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

/** Even-length cohorts take the mean of the middle two, as a median conventionally does. */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}

/**
 * The cohort's own numbers, from every student's scored breakdown.
 *
 * Takes the BREAKDOWNS rather than the raw counts, so the average is over the same figure the
 * board shows: `counted`, after the weekly cap bit, not the raw self-reported count. An average
 * built from uncapped counts would be a benchmark nobody on the board was ever scored against -
 * a student who hit the cap would read as behind an average that includes the points the cap
 * refused them.
 *
 * Every student in the cohort counts, including the ones sitting on zero. Averaging only the
 * students who did something would turn "half the cohort has not started" into a benchmark that
 * says the cohort is flying.
 */
export function cohortAggregate(
  breakdowns: readonly ScoreBreakdown[],
  opts: { minCohort: number },
): CohortAggregate {
  const size = breakdowns.length;
  const minCohort = Math.max(HARD_MIN_COHORT, Math.floor(opts.minCohort));

  if (!cohortPublishable(size, minCohort)) {
    return { size, minCohort, suppressed: true, total: { mean: 0, median: 0 }, lines: [] };
  }

  const totals = breakdowns.map((b) => b.total);
  const lines: AggregateLine[] = [];

  for (const metric of LEADERBOARD_METRICS) {
    // Driven off a real breakdown's lines rather than the catalogue, because a metric the admin
    // switched off has no line and must not appear as a cohort average of zero.
    const present = breakdowns.some((b) => b.lines.some((l) => l.key === metric.key));
    if (!present) continue;
    const counts = breakdowns.map((b) => b.lines.find((l) => l.key === metric.key)?.counted ?? 0);
    lines.push({ key: metric.key, label: metric.label, mean: mean(counts), median: median(counts) });
  }

  return { size, minCohort, suppressed: false, total: { mean: mean(totals), median: median(totals) }, lines };
}

/**
 * How one student compares, line by line. Pure sugar over the two shapes above, so the UI never
 * does the subtraction itself and the sign convention is decided once.
 *
 * `delta` is the student MINUS the cohort mean: positive is ahead. Null overall when the cohort
 * is too small to have published an average at all.
 */
export type BenchmarkLine = AggregateLine & { mine: number; delta: number };

export function benchmarkAgainst(
  mine: ScoreBreakdown,
  aggregate: CohortAggregate,
): { total: { mine: number; delta: number }; lines: BenchmarkLine[] } | null {
  if (aggregate.suppressed) return null;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    total: { mine: mine.total, delta: round1(mine.total - aggregate.total.mean) },
    lines: aggregate.lines.map((a) => {
      const own = mine.lines.find((l) => l.key === a.key)?.counted ?? 0;
      return { ...a, mine: own, delta: round1(own - a.mean) };
    }),
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * THE CONVERSION RATIO - outreach in, interviews out (@40:55, @42:09).
 *
 * This is NOT a leaderboard metric and must never become one. `LeaderboardMetric` is a SCORING
 * type: `defaultPoints` times a count, capped per week. A ratio has no units, cannot be capped
 * and cannot be summed, so adding a key for it to `LEADERBOARD_METRIC_KEYS` would feed a
 * meaningless number straight into `scoreStudent` - and a student would be ranked on it.
 *
 * So it travels beside the board as an INSIGHT. Same server pass, separate field, and
 * `scoreStudent` never sees it.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * What counts as reaching out.
 *
 * Applications and accepted HR connections, because those are the two things the founders
 * described as the input side ("applications plus networking"). `application_reviewed` is
 * deliberately NOT in here: it is something a company did, not something the student did, and
 * putting it in the denominator would penalise a student whose applications got read.
 */
export const OUTREACH_KEYS: readonly LeaderboardMetricKey[] = ["application_submitted", "hr_connection"];
export const INTERVIEW_KEYS: readonly LeaderboardMetricKey[] = ["hr_interview"];

export type ConversionRatio = {
  outreach: number;
  interviews: number;
  /**
   * Interviews per 100 outreach actions, one decimal place - or NULL when there was no
   * outreach at all.
   *
   * Null rather than 0 on an empty denominator, and the difference is the whole point of the
   * insight: 0% says "you reached out and nothing came back", which is a problem to work on,
   * and a student who has not started yet must not be told that about themselves.
   */
  per100: number | null;
  /** Outreach actions per interview - the same fact the way a coach says it ("1 in 23"). */
  effortPerInterview: number | null;
};

export function conversionRatio(counts: MetricCounts): ConversionRatio {
  const sum = (keys: readonly LeaderboardMetricKey[]) =>
    keys.reduce((a, k) => a + Math.max(0, Math.round(counts[k] ?? 0)), 0);

  const outreach = sum(OUTREACH_KEYS);
  const interviews = sum(INTERVIEW_KEYS);
  if (outreach === 0) return { outreach, interviews, per100: null, effortPerInterview: null };

  return {
    outreach,
    interviews,
    per100: Math.round((interviews / outreach) * 1000) / 10,
    effortPerInterview: interviews === 0 ? null : Math.round((outreach / interviews) * 10) / 10,
  };
}

/**
 * The cohort's ratio, POOLED rather than averaged.
 *
 * Summing the cohort's outreach and its interviews and dividing once is not the same as
 * averaging each student's percentage, and pooling is the right one here: a student who sent
 * four applications and got one interview would otherwise contribute a 25% to the cohort
 * average with the same weight as a student who sent two hundred. The pooled figure answers
 * the question a coach is actually asking - "what does it take, on this cohort, to get an
 * interview" - and it is the figure a student's own ratio is comparable against.
 *
 * Returns null below the floor, for the reason in `cohortPublishable`: on a cohort of two,
 * the pooled outreach minus your own is one named classmate's.
 */
export function cohortConversionRatio(
  countsList: readonly MetricCounts[],
  opts: { minCohort: number },
): ConversionRatio | null {
  if (!cohortPublishable(countsList.length, opts.minCohort)) return null;
  const pooled: MetricCounts = {};
  for (const counts of countsList) {
    for (const key of [...OUTREACH_KEYS, ...INTERVIEW_KEYS]) {
      pooled[key] = (pooled[key] ?? 0) + Math.max(0, Math.round(counts[key] ?? 0));
    }
  }
  return conversionRatio(pooled);
}
