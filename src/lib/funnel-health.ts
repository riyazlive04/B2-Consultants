/**
 * Funnel health — the executive dashboard's Row 5 (rebuild spec §4).
 *
 * NOT the same funnel as `/funnel`. That screen is the PRD's five-stage weekly SNAPSHOT, typed in
 * by an admin (Awareness → Lead captured → Discovery call → Proposal sent → Enrolled). Row 5 is the
 * nine-stage OUTREACH funnel, measured from what actually happened — lead stage history, booking
 * confirmations and the discovery verdict. Two different questions; keeping them separate is
 * deliberate, because a hand-typed snapshot cannot answer "where are we leaking".
 *
 * The row exists to answer one question — WHERE IS THE FUNNEL LOSING THE MOST — so the headline is
 * a single leak, not nine percentages. The spec's own example is the discovery-call show rate: the
 * JD sets 80%, the six-month actual is 62%, and that gap is worth more than every other stage
 * combined.
 *
 * Pure module: every function here is arithmetic over counts, so it is unit-testable. The queries
 * live in `server/funnel-health.ts`.
 */

export type StageKey =
  | "leads"
  | "bookedDiscovery"
  | "bantQualified"
  | "confirmed"
  | "showed"
  | "qualifiedL3"
  | "confirmedL3"
  | "attendedL3"
  | "closed";

export type StageOwner = "Marketing" | "L1" | "L2" | "L3";

export type StageDef = {
  readonly key: StageKey;
  readonly label: string;
  readonly owner: StageOwner;
  /** The spec's published six-month benchmark count (§4 Row 5) — the fallback when the app has too little history of its own. */
  readonly specCount: number;
  /**
   * A rate this stage is HELD to, independent of history — currently only the discovery-call
   * show rate, which the JD fixes at 80%. A benchmark says "this is what we did"; a target says
   * "this is what we agreed to do". Missing the target matters even when history agrees with it.
   */
  readonly targetRate?: number;
};

/** In funnel order. Each stage's rate is measured against the stage above it. */
export const FUNNEL_STAGES: readonly StageDef[] = [
  { key: "leads", label: "Leads", owner: "Marketing", specCount: 650 },
  { key: "bookedDiscovery", label: "Booked discovery calls", owner: "L1", specCount: 213 },
  { key: "bantQualified", label: "BANT qualified", owner: "L1", specCount: 145 },
  { key: "confirmed", label: "Confirmed", owner: "L1", specCount: 108 },
  { key: "showed", label: "Showed", owner: "L2", specCount: 68, targetRate: 0.8 },
  { key: "qualifiedL3", label: "Qualified to L3", owner: "L2", specCount: 25 },
  { key: "confirmedL3", label: "Confirmed for L3", owner: "L2", specCount: 18 },
  { key: "attendedL3", label: "Attended L3", owner: "L3", specCount: 16 },
  { key: "closed", label: "Closed", owner: "L3", specCount: 5 },
];

export type StageCounts = Record<StageKey, number>;

/** Build a StageCounts by mapping each stage to a value — one place, no per-key spread. */
function countsFrom(valueOf: (s: StageDef) => number): StageCounts {
  return Object.fromEntries(FUNNEL_STAGES.map((s) => [s.key, valueOf(s)])) as StageCounts;
}

export function emptyCounts(): StageCounts {
  return countsFrom(() => 0);
}

/** The spec's published benchmark, as counts — used when the app has too little history of its own. */
export function specCounts(): StageCounts {
  return countsFrom((s) => s.specCount);
}

/**
 * Conversion into a stage, from the stage above it. `null` for the first stage (nothing feeds it)
 * and whenever the stage above is zero — a rate out of nothing is not 0%, it is unanswerable, and
 * showing 0% would read as a catastrophic leak on a quiet month.
 */
export function rateOf(counts: StageCounts, index: number): number | null {
  if (index <= 0) return null;
  const prev = counts[FUNNEL_STAGES[index - 1].key];
  if (prev <= 0) return null;
  return counts[FUNNEL_STAGES[index].key] / prev;
}

export type BenchmarkSource = "history" | "spec";

export type StageRow = {
  readonly stage: StageDef;
  readonly count: number;
  readonly rate: number | null;
  readonly benchmarkCount: number;
  readonly benchmarkRate: number | null;
  /** current rate minus benchmark rate; negative means worse than benchmark */
  readonly rateDelta: number | null;
  /** How many people this stage loses versus its benchmark rate. The unit the headline ranks on. */
  readonly peopleLostVsBenchmark: number;
  /** Same, against the agreed target where one exists. */
  readonly peopleLostVsTarget: number | null;
};

/**
 * How many months of real history are needed before the app's own average beats the spec's
 * published one. Two is the floor: a single month is not an average, it is last month.
 */
export const MIN_MONTHS_FOR_BENCHMARK = 2;

export function buildStageRows(current: StageCounts, benchmark: StageCounts): StageRow[] {
  return FUNNEL_STAGES.map((stage, i) => {
    const count = current[stage.key];
    const rate = rateOf(current, i);
    const benchmarkRate = rateOf(benchmark, i);
    const prev = i > 0 ? current[FUNNEL_STAGES[i - 1].key] : 0;

    // "People lost" is expressed in TODAY's traffic: how many more would have reached this stage
    // at the benchmark rate. A percentage-point gap on a stage almost nobody enters is noise;
    // this is what makes the ranking meaningful.
    const lostVsBenchmark =
      rate !== null && benchmarkRate !== null && benchmarkRate > rate ? (benchmarkRate - rate) * prev : 0;
    // Split once on "does this stage carry a target?" — a stage with no target has no target-shortfall
    // (null), one that has a target reports how many it lost against it (0 when meeting or beating it).
    const lostVsTarget =
      stage.targetRate === undefined
        ? null
        : rate !== null && stage.targetRate > rate
          ? (stage.targetRate - rate) * prev
          : 0;

    return {
      stage,
      count,
      rate,
      benchmarkCount: benchmark[stage.key],
      benchmarkRate,
      rateDelta: rate !== null && benchmarkRate !== null ? rate - benchmarkRate : null,
      peopleLostVsBenchmark: lostVsBenchmark,
      peopleLostVsTarget: lostVsTarget,
    };
  });
}

export type Leak = {
  readonly row: StageRow;
  /** Whether the gap is against the agreed target or merely against recent history. */
  readonly against: "target" | "benchmark";
  readonly peopleLost: number;
};

/**
 * The single stage to put in front of the founder.
 *
 * A shortfall against an AGREED TARGET outranks a shortfall against history, however large the
 * latter is: drifting below what the team committed to is a different kind of problem from being
 * below last quarter. Within each kind, rank by people lost, not by percentage points.
 */
export function biggestLeak(rows: StageRow[]): Leak | null {
  const vsTarget = rows
    .filter((r) => (r.peopleLostVsTarget ?? 0) > 0)
    .sort((a, b) => (b.peopleLostVsTarget ?? 0) - (a.peopleLostVsTarget ?? 0))[0];
  if (vsTarget) return { row: vsTarget, against: "target", peopleLost: vsTarget.peopleLostVsTarget ?? 0 };

  const vsBenchmark = rows
    .filter((r) => r.peopleLostVsBenchmark > 0)
    .sort((a, b) => b.peopleLostVsBenchmark - a.peopleLostVsBenchmark)[0];
  if (vsBenchmark) return { row: vsBenchmark, against: "benchmark", peopleLost: vsBenchmark.peopleLostVsBenchmark };

  return null;
}

export type FunnelHealth = {
  readonly rows: StageRow[];
  readonly leak: Leak | null;
  readonly benchmarkSource: BenchmarkSource;
  readonly monthsOfHistory: number;
};

/**
 * Assemble the row. When there is too little history to average, the spec's published benchmark
 * stands in and `benchmarkSource` says so — the alternative is comparing this month against one
 * other month and calling it a trend.
 */
export function buildFunnelHealth(
  current: StageCounts,
  history: StageCounts[],
): FunnelHealth {
  const monthsOfHistory = history.length;
  const useHistory = monthsOfHistory >= MIN_MONTHS_FOR_BENCHMARK;
  const benchmark = useHistory ? averageCounts(history) : specCounts();
  const rows = buildStageRows(current, benchmark);
  return {
    rows,
    leak: biggestLeak(rows),
    benchmarkSource: useHistory ? "history" : "spec",
    monthsOfHistory,
  };
}

/** Mean count per stage across the given months. Fractional on purpose — it is an average, not a tally. */
export function averageCounts(months: StageCounts[]): StageCounts {
  if (months.length === 0) return emptyCounts();
  return countsFrom((s) => months.reduce((sum, m) => sum + m[s.key], 0) / months.length);
}
