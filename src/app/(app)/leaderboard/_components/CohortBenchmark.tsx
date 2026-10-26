import { Minus, TrendingDown, TrendingUp, Users } from "lucide-react";
import { benchmarkAgainst } from "@/lib/leaderboard";
import type { LeaderboardView } from "@/server/leaderboard";
import { Card, Hint, Panel, Pill } from "@/components/ui/kit";

/**
 * YOU vs THE COHORT - the comparison the founders asked for twice (@40:55, @41:29).
 *
 * ── Why this is a separate card and not a column on the board ──────────────────────────
 * The board ranks. This answers a different question - "is where I am normal" - and a student
 * on 4th of 8 reads those two things completely differently. Putting an average into the table
 * would also have meant a column that is the same number on every row, which is how a table
 * tells you it is carrying something that is not a row-level fact.
 *
 * ── Nobody is named here, by construction ──────────────────────────────────────────────
 * Every figure on this card is a cohort aggregate computed server-side over the full cohort
 * (`getLeaderboard`), before `viewFor` strips names and trims rows. There is no per-classmate
 * value in the payload to leak, and below `config.minCohort` the server sends no aggregate at
 * all - which is the case this component renders as the suppression notice rather than as
 * zeroes. See `cohortPublishable` in lib/leaderboard.ts.
 *
 * Server component: it only reads a view the page already has, and it holds no state.
 */

/** A signed delta as a student should read it: ahead, behind, or level. */
function Delta({ delta, unit }: { delta: number; unit?: string }) {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-caption font-semibold text-muted">
        <Minus size={12} aria-hidden /> level with the cohort
      </span>
    );
  }
  const ahead = rounded > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-caption font-semibold ${
        ahead ? "text-good" : "text-warn"
      }`}
    >
      {ahead ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
      {ahead ? "+" : "-"}
      {Math.abs(rounded).toLocaleString("en-IN")}
      {unit ? ` ${unit}` : ""} {ahead ? "ahead" : "behind"}
    </span>
  );
}

/**
 * The ratio, in both directions.
 *
 * A percentage is the comparable figure; "1 interview per 23 outreach" is how a coach actually
 * says it on a call. Both come off the same `ConversionRatio`, so they cannot disagree.
 */
function RatioLine({
  label,
  ratio,
}: {
  label: string;
  ratio: { outreach: number; interviews: number; per100: number | null; effortPerInterview: number | null };
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        {ratio.per100 === null ? (
          // Not 0%. A student who has not sent anything yet has no conversion rate, and telling
          // them it is zero reads as "you tried and nothing came back".
          <span className="text-sm text-muted">no outreach logged yet</span>
        ) : (
          <>
            <span className="font-display text-[15px] font-semibold tabular-nums text-ink">
              {ratio.per100}%
            </span>
            <span className="text-caption tabular-nums text-muted">
              {ratio.interviews.toLocaleString("en-IN")} interview
              {ratio.interviews === 1 ? "" : "s"} from {ratio.outreach.toLocaleString("en-IN")}
              {" "}application{ratio.outreach === 1 ? "" : "s"} &amp; connections
              {ratio.effortPerInterview !== null && ` · 1 in ${ratio.effortPerInterview}`}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

export function CohortBenchmark({
  view,
  isStudent,
}: {
  view: LeaderboardView;
  isStudent: boolean;
}) {
  const { aggregate, cohortRatio, me } = view;

  /**
   * The suppression case, rendered as a sentence rather than hidden.
   *
   * A card that silently vanished on a small cohort would read as a bug to the coach who set
   * the floor, and to the student it would read as nothing at all. Saying why is also the only
   * way the number is ever going to appear: somebody has to seat more students.
   */
  if (aggregate.suppressed) {
    return (
      <Card title="You vs the cohort">
        <Hint>
          {aggregate.size === 0
            ? "No active enrolment on this cohort yet, so there is nothing to average."
            : `There ${aggregate.size === 1 ? "is" : "are"} ${aggregate.size} student${
                aggregate.size === 1 ? "" : "s"
              } on this cohort and the average needs ${aggregate.minCohort}. On a cohort this small an "average" is close enough to one classmate's own score to name them, so it is not shown.`}
        </Hint>
      </Card>
    );
  }

  const mine = isStudent && me ? benchmarkAgainst(me.breakdown, aggregate) : null;
  const myRatio = isStudent ? me?.ratio ?? null : null;

  /**
   * ONE row shape for both audiences, rather than two lists rendered by one loop.
   *
   * A student gets their own figure and a delta; staff get the cohort column alone, because
   * "you" means nothing on a coach's screen. Flattening the two into one shape here keeps the
   * markup below from having to ask which audience it is rendering for on every cell.
   */
  type Row = { key: string; label: string; mean: number; mine: number | null; delta: number | null };
  const lines: Row[] = mine
    ? mine.lines.map((l) => ({ key: l.key, label: l.label, mean: l.mean, mine: l.mine, delta: l.delta }))
    : aggregate.lines.map((l) => ({ key: l.key, label: l.label, mean: l.mean, mine: null, delta: null }));

  return (
    <Card
      title={isStudent ? "You vs the cohort" : "Cohort averages"}
      subtitle={`Across all ${aggregate.size} students on this cohort · same period as the board above`}
      actions={
        <Pill tone="neutral">
          <Users size={12} aria-hidden /> nobody named
        </Pill>
      }
    >
      <div className="space-y-4">
        {/* The headline: total points, which is the number the board itself ranks on. */}
        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-label font-semibold uppercase text-ink-3">Cohort average</p>
              <p className="tnum mt-0.5 font-display text-h2 tracking-tight text-ink">
                {aggregate.total.mean.toLocaleString("en-IN")}
                <span className="ml-1 text-sm font-normal text-muted">points</span>
              </p>
              {/*
                The median is shown beside the mean, not instead of it. One student with an
                offer (200 points) pulls an eight-person mean up by 25 on its own, and a
                student reading only the mean would conclude they were behind a cohort that is
                in fact mostly level with them.
              */}
              <p className="mt-0.5 text-caption text-muted">
                Typical student (median): {aggregate.total.median.toLocaleString("en-IN")}
              </p>
            </div>
            {mine && (
              <div className="min-w-0 text-right">
                <p className="text-label font-semibold uppercase text-ink-3">You</p>
                <p className="tnum mt-0.5 font-display text-h2 tracking-tight text-primary">
                  {mine.total.mine.toLocaleString("en-IN")}
                </p>
                <p className="mt-0.5">
                  <Delta delta={mine.total.delta} unit="points" />
                </p>
              </div>
            )}
          </div>
        </Panel>

        {/* Metric by metric. The same `counted` figures the board scored, so the two agree. */}
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <li
              key={line.key}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-line py-1.5 last:border-0"
            >
              <span className="text-sm text-ink-2">{line.label}</span>
              <span className="ml-auto flex flex-wrap items-baseline gap-x-3">
                {line.mine !== null && (
                  <span className="text-sm tabular-nums text-ink">
                    you <span className="font-semibold">{line.mine.toLocaleString("en-IN")}</span>
                  </span>
                )}
                <span className="text-sm tabular-nums text-muted">
                  cohort <span className="font-semibold text-ink-2">{line.mean}</span>
                </span>
                {line.delta !== null && <Delta delta={line.delta} />}
              </span>
            </li>
          ))}
        </ul>

        {/*
          THE CONVERSION RATIO (@42:09). Beside the board, never in it: a ratio has no units,
          cannot be capped and cannot be summed, so it is not a thing anyone can be ranked on.
        */}
        <div className="rounded-field border border-line bg-surface-2 p-3.5">
          <p className="text-sm font-semibold text-ink">Outreach that turned into interviews</p>
          <Hint>
            Applications sent plus HR connections accepted, against interviews secured. This one
            is an observation, not a score - nothing on the board moves because of it.
          </Hint>
          <div className="mt-2.5 space-y-2">
            {myRatio && <RatioLine label="You" ratio={myRatio} />}
            {cohortRatio ? (
              <RatioLine label="This cohort, pooled" ratio={cohortRatio} />
            ) : (
              <p className="text-caption text-muted">
                The cohort figure needs {aggregate.minCohort} students.
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
