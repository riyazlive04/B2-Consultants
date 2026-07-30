"use client";

import { ChevronDown, TrendingUp } from "lucide-react";
import { formatDate, formatMonth } from "@/lib/format";
import { money, moneyAlt, type MoneyAgg } from "@/lib/money-display";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { Gauge, type GaugeBand } from "@/components/ui/Gauge";
import { InfoHint } from "@/components/ui/InfoHint";
import { useCcy } from "@/components/ui/CurrencyToggle";

/**
 * The presentation half of the "This month" money hero.
 *
 * MonthHero itself stays a server component (it does the DB reads); everything visual moved here
 * so the whole hero answers the ₹/€ toggle. It used to render inline in a server component, which
 * is exactly why it stayed in rupees while the toggle said EUR.
 *
 * TWO KINDS OF EUR FIGURE, and the difference matters:
 *   - Collections, receivables and last month's comparator are REAL aggregates, summed from each
 *     record's own stamped rate. They are exact and never move.
 *   - The monthly TARGET and the pipeline forecast have no EUR counterpart in the database
 *     (`MonthlyTarget` stores rupees only), so their EUR figures are converted at today's ECB
 *     rate. They are marked "≈" and the caption names the rupee original, because a converted
 *     target genuinely does drift as the rate moves.
 *
 * Every PERCENTAGE — pace, % of target, the gauge needle, the meter widths — is computed on the
 * INR basis upstream and passed in. So switching currency changes the words on screen and never
 * the judgement: "68% of target" says 68% in both.
 */

export type HeroFigures = {
  collected: MoneyAgg;
  target: MoneyAgg;
  expected: MoneyAgg;
  paceDelta: MoneyAgg;
  prevSameDay: MoneyAgg;
  dueThisMonth: MoneyAgg;
  forecast: MoneyAgg;
  projected: MoneyAgg;
  /** Cumulative daily paths for the trend chart, per currency. */
  curCum: { inr: number[]; eur: number[] };
  prevCum: { inr: number[]; eur: number[] };
};

export type HeroRatios = {
  monthFrac: number;
  dayOfMonth: number;
  daysInMonth: number;
  pacePct: number | null;
  paceSignal: SignalLevel | null;
  momPct: number | null;
  projectedPct: number | null;
  projectedSignal: SignalLevel | null;
  projectedFrac: number;
  collectedPctOfTarget: number | null;
};

export type HeroLabels = {
  monthStart: string;
  monthShort: string;
  prevMonthShort: string;
  prevSameDayLabel: string;
  lineLabel: string | null;
  /** ECB date behind the converted target — so the approximation is auditable. */
  fxDate: string;
  fxRate: number;
};

/** Compact form of the chart-legend amounts; follows the toggle like everything else. */
const SEG_COLORS = {
  collected: "var(--chart-1)",
  due: "var(--chart-2)",
  forecast: "var(--chart-3)",
} as const;

function PaceChart({
  cur,
  prev,
  targetMinor,
  daysInMonth,
  height = 150,
}: {
  cur: number[];
  prev: number[];
  targetMinor: number;
  daysInMonth: number;
  height?: number;
}) {
  const W = 640;
  const H = 190;
  const pad = 10;
  const yMax = Math.max(targetMinor, cur[cur.length - 1] ?? 0, prev[prev.length - 1] ?? 0, 1);
  const x = (day: number) => pad + (Math.min(day, daysInMonth) / daysInMonth) * (W - pad * 2);
  const y = (v: number) => pad + (1 - v / yMax) * (H - pad * 2);
  const line = (arr: number[]) =>
    [`${x(0).toFixed(1)},${y(0).toFixed(1)}`, ...arr.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)].join(" ");
  const curLine = line(cur);
  const ex = x(cur.length);
  const ey = y(cur[cur.length - 1] ?? 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      role="img"
      aria-label="Cumulative collections this month vs target pace and last month"
    >
      <line
        x1={x(0)} y1={y(0)} x2={x(daysInMonth)} y2={y(targetMinor)}
        stroke="var(--viz-ink)" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={line(prev)}
        fill="none" stroke="var(--primary-tint)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
      />
      <polygon points={`${pad},${H - pad} ${curLine} ${ex.toFixed(1)},${H - pad}`} fill="var(--primary)" opacity="0.08" />
      <polyline
        points={curLine}
        fill="none" stroke="var(--primary)" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
      />
      <circle cx={ex} cy={ey} r="4.5" fill="var(--primary)" stroke="var(--bg-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MonthHeroView({
  figures: f,
  ratios: r,
  labels: l,
  segmented,
}: {
  figures: HeroFigures;
  ratios: HeroRatios;
  labels: HeroLabels;
  segmented: boolean;
}) {
  const { ccy } = useCcy();
  const c = { compact: true } as const;
  const pick = (m: MoneyAgg) => (ccy === "EUR" ? m.eur : m.inr);
  const isEur = ccy === "EUR";

  /** The target is a rupee commitment — say so whenever it is being shown in euros. */
  const approx = (m: MoneyAgg) => (isEur ? `≈ ${money(m, ccy, c)}` : money(m, ccy, c));
  const targetOrigin = isEur
    ? ` The target is set in rupees (${money(f.target, "INR", c)}); the euro figure is converted at today's ECB rate, ${l.fxRate.toFixed(2)}/€ on ${formatDate(l.fxDate)}.`
    : "";

  const paceMeta = r.paceSignal ? SIGNAL_META[r.paceSignal] : null;
  const projMeta = r.projectedSignal ? SIGNAL_META[r.projectedSignal] : null;

  // Meter segments — each money source keeps one identity colour everywhere. Widths come from
  // the chosen currency so the bar and the legend beside it agree.
  const targetPick = pick(f.target);
  let segUsed = 0;
  const segments = (
    [
      { key: "collected", label: "Collected (in the bank)", m: f.collected },
      { key: "due", label: "Instalments owed, due before month-end", m: f.dueThisMonth },
      { key: "forecast", label: "Forecast from open pipeline", m: f.forecast },
    ] as const
  )
    .map((s) => {
      const frac = targetPick > 0 ? pick(s.m) / targetPick : 0;
      const w = Math.max(0, Math.min(frac, 1 - segUsed));
      segUsed += w;
      return { ...s, w, color: SEG_COLORS[s.key] };
    })
    .filter((s) => pick(s.m) > 0);

  const heroTiles = [
    {
      label: "Collected so far",
      value: money(f.collected, ccy, c),
      color: undefined as string | undefined,
      hint: "Money actually received this month — the sum of every income entry dated in this month.",
    },
    {
      label: "Forecast month-end",
      value:
        r.projectedPct === null
          ? "—"
          : `${money(f.projected, ccy, c)} · ${Math.round(r.projectedPct)}% of target`,
      color: projMeta?.color,
      hint:
        "Where the month is expected to END: what's collected so far, plus instalments already owed and due before month-end, plus a pro-rated forecast from the open pipeline. " +
        `The percentage is of the ${money(f.target, "INR", c)} monthly target.${targetOrigin}`,
    },
    {
      label: "Monthly target",
      value: approx(f.target),
      color: undefined,
      hint: `The revenue goal for this month, set under Pipeline → target.${targetOrigin}`,
    },
  ];

  const gaugeBands: GaugeBand[] = [
    { upTo: 0.5, color: "var(--bad)" },
    { upTo: 0.9, color: "var(--warn)" },
    { upTo: 1, color: "var(--good)" },
  ];

  const forecastMarkerTitle =
    r.projectedPct === null
      ? undefined
      : `Forecast month-end: ${money(f.projected, ccy)} · ${Math.round(r.projectedPct)}% of the ${approx(
          f.target,
        )} monthly target`;

  return (
    <div className="hero-sky rise-in relative overflow-hidden rounded-hero p-6">
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
        {/* The dial is a TARGET instrument, so it only appears for the combined view. There is
            one MonthlyTarget for the whole business; pointing a needle at German Note's share
            of it would sit at ~6% inside the red band and read as catastrophic failure. */}
        {!segmented && (
          <div className="flex justify-center lg:flex-none">
            <Gauge
              // Needle position is the INR ratio in both currencies — the judgement must not
              // change because a rate moved. Only the labels are currency-dependent.
              value={pick(f.collected)}
              max={targetPick}
              valueText={money(f.collected, ccy, c)}
              maxText={approx(f.target)}
              label={`Collected · ${formatMonth(l.monthStart)}`}
              caption={
                r.collectedPctOfTarget === null
                  ? undefined
                  : `${Math.round(r.collectedPctOfTarget)}% of the ${approx(f.target)} monthly target`
              }
              marker={r.monthFrac}
              markerLabel={`Target to reach by today: ${money(f.expected, ccy, c)}`}
              bands={gaugeBands}
            />
          </div>
        )}

        {/* Headline: collected + same-day delta · ahead/behind-pace chip */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
                <TrendingUp size={14} /> Collected · {formatMonth(l.monthStart)}
                {segmented && l.lineLabel && <> · {l.lineLabel}</>}
              </p>
              <p className="mt-1.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {money(f.collected, ccy)}
              </p>
              {/* The other currency, so the exact figure is never more than a glance away. */}
              <p className="tnum text-sm text-ink-2">{moneyAlt(f.collected, ccy)}</p>
              {r.momPct !== null && (
                <p className="tnum mt-0.5 flex flex-wrap items-center gap-1 text-sm text-ink-2">
                  <span className="font-semibold" style={{ color: r.momPct >= 0 ? "var(--good)" : "var(--bad)" }}>
                    {r.momPct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(r.momPct * 10) / 10)}%
                  </span>{" "}
                  {r.momPct >= 0 ? "more" : "less"} than the same day last month ({l.prevSameDayLabel})
                  <InfoHint
                    text={`Compares the same number of days into each month: ${money(
                      f.collected,
                      ccy,
                      c,
                    )} by day ${r.dayOfMonth} this month, against ${money(f.prevSameDay, ccy, c)} by ${
                      l.prevSameDayLabel
                    } last month. This is last MONTH, not last year.`}
                  />
                </p>
              )}
            </div>
            {!segmented && paceMeta && (
              <span
                className="tnum flex flex-none items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: paceMeta.soft, color: paceMeta.color }}
              >
                {pick(f.paceDelta) >= 0 ? "▲" : "▼"}{" "}
                {money({ inr: Math.abs(f.paceDelta.inr), eur: Math.abs(f.paceDelta.eur) }, ccy, c)}{" "}
                {pick(f.paceDelta) >= 0 ? "ahead of" : "behind"} target pace
                <InfoHint
                  text={`The gap between what's collected (${money(
                    f.collected,
                    ccy,
                    c,
                  )}) and the straight-line pace for hitting target by month-end (${money(
                    f.expected,
                    ccy,
                    c,
                  )} by day ${r.dayOfMonth}).${targetOrigin}`}
                />
              </span>
            )}
          </div>
        </div>
      </div>

      {segmented ? (
        <p className="relative mt-5 text-caption text-ink-2">
          Showing <span className="font-semibold">{l.lineLabel}</span> collections only. Pace, forecast
          and the path-to-target meter are hidden because the {approx(f.target)} monthly target is set
          for the whole business — there is no separate B2 or German Note target to measure a single
          line against.
        </p>
      ) : (
        <>
          {/* Path to target: what's in + what's scheduled + what selling should add. */}
          <div className="relative mt-5">
            <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-surface/70">
              {segments.map((s) => (
                <div key={s.key} className="h-full" style={{ width: `${s.w * 100}%`, background: s.color }} />
              ))}
            </div>
            <span
              aria-hidden
              className="absolute -top-1 h-4 w-0.5 rounded-full"
              style={{ left: `calc(${r.monthFrac * 100}% - 1px)`, background: "var(--ink-2)" }}
              title={`Target to reach by today: ${money(f.expected, ccy, c)}`}
            />
            {r.projectedPct !== null && pick(f.projected) > 0 && (
              <span
                aria-hidden
                className="absolute -top-[9px] flex h-[22px] w-4 flex-col items-center"
                style={{ left: `calc(${Math.min(1, r.projectedFrac) * 100}% - 8px)` }}
                title={forecastMarkerTitle}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--good)", boxShadow: "0 0 0 1px var(--bg-surface)" }}
                />
                <span
                  className="w-0.5 flex-1 rounded-full"
                  style={{ background: "var(--good)", boxShadow: "0 0 0 1px var(--bg-surface)" }}
                />
              </span>
            )}
            <div className="tnum mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption font-medium text-ink-2">
              <span className="flex items-center gap-1">
                Day {r.dayOfMonth} of {r.daysInMonth} · ▎target to reach by today{" "}
                {money(f.expected, ccy, c)}
                <InfoHint
                  text={`Straight-line pace, not a forecast: ${money(f.target, ccy, c)} target ÷ ${
                    r.daysInMonth
                  } days × ${r.dayOfMonth} days elapsed = ${money(
                    f.expected,
                    ccy,
                    c,
                  )}. Hitting this every day lands exactly on target at month-end.${targetOrigin}`}
                />
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {segments.map((s) => (
                  <span key={s.key} className="flex items-center gap-1">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label} {money(s.m, ccy, c)}
                  </span>
                ))}
                {r.projectedPct !== null && pick(f.projected) > 0 && (
                  <span className="flex items-center gap-1" title={forecastMarkerTitle}>
                    <span aria-hidden className="flex h-3.5 w-2 flex-col items-center">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--good)" }} />
                      <span className="w-0.5 flex-1 rounded-full" style={{ background: "var(--good)" }} />
                    </span>
                    forecast month-end {money(f.projected, ccy, c)}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Summary tiles — the three numbers the meter resolves to */}
          <div className="relative mt-5 grid grid-cols-3 gap-3 border-t border-primary-tint pt-4">
            {heroTiles.map((t) => (
              <div key={t.label}>
                <p className="flex items-center gap-1 text-caption font-medium text-ink-2">
                  {t.label}
                  <InfoHint text={t.hint} />
                </p>
                <p
                  className="tnum mt-0.5 font-display text-h2 font-bold tracking-tight sm:text-xl"
                  style={t.color ? { color: t.color } : undefined}
                >
                  {t.value}
                </p>
              </div>
            ))}
          </div>

          {/* Day-by-day trajectory — detail, tucked behind a disclosure. */}
          <details className="group relative mt-4 border-t border-primary-tint pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-caption font-semibold text-ink-2 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              <span className="group-open:hidden">Show 30-day trend</span>
              <span className="hidden group-open:inline">Hide 30-day trend</span>
            </summary>
            <div className="mt-3">
              <PaceChart
                cur={isEur ? f.curCum.eur : f.curCum.inr}
                prev={isEur ? f.prevCum.eur : f.prevCum.inr}
                targetMinor={targetPick}
                daysInMonth={r.daysInMonth}
                height={140}
              />
              <div className="tnum mt-1 flex justify-between px-1 text-caption font-medium text-ink-2" aria-hidden>
                <span>1 {l.monthShort}</span>
                <span>{Math.round(r.daysInMonth / 2)} {l.monthShort}</span>
                <span>{r.daysInMonth} {l.monthShort}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption font-medium text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--primary)" }} />
                  {l.monthShort} so far · {money(f.collected, ccy, c)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--primary-tint)" }} />
                  {l.prevMonthShort} full month ·{" "}
                  {money(
                    {
                      inr: f.prevCum.inr[f.prevCum.inr.length - 1] ?? 0,
                      eur: f.prevCum.eur[f.prevCum.eur.length - 1] ?? 0,
                    },
                    ccy,
                    c,
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "var(--viz-ink)" }} />
                  target pace
                </span>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
