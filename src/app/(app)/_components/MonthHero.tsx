import "server-only";
import { ChevronDown, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { formatInrMinor, formatMonth } from "@/lib/format";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";

/**
 * "This month" money hero (Admin only) — the one question that leads the founder's
 * day: am I on pace to hit the target, and where does the rest come from?
 *
 * It answers with a big collected figure, a same-day-vs-last-month delta, an
 * ahead/behind-pace chip, and a path-to-target meter (collected + receivables due
 * before month-end + pro-rated pipeline forecast) with a tick at where today should
 * be. The day-by-day pacing chart — trajectory detail, not first-glance signal —
 * lives behind a "Show 30-day trend" disclosure so the hero stays calm.
 */

/** ₹ compact for chart caps: 1,47,000.00 minor → "₹1.5L". */
function inrShort(minor: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(minor / 100)}`;
}

/**
 * Pacing chart: cumulative collections this month (primary) vs the straight
 * target-pace line (dashed gray) vs last month's cumulative path (tint).
 * The vertical gap between the blue line and the pace line IS the pace deficit;
 * a flat stretch means nothing landed. Both lines start at (day 0, ₹0).
 */
function PaceChart({
  cur,
  prev,
  targetMinor,
  daysInMonth,
  height = 150,
}: {
  cur: number[]; // cumulative ₹minor, index = day-1, up to today
  prev: number[]; // last month's cumulative path, full month
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
      {/* target pace: ₹0 on day 0 → full target on the last day */}
      <line
        x1={x(0)} y1={y(0)} x2={x(daysInMonth)} y2={y(targetMinor)}
        stroke="var(--viz-ink)" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"
      />
      {/* last month's path — context, deliberately quiet */}
      <polyline
        points={line(prev)}
        fill="none" stroke="var(--primary-tint)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
      />
      {/* this month */}
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

export async function MonthHero() {
  const { start: monthStart, end: monthEnd } = istMonthRange();
  const today = istToday();
  // income window: this month + last month — feeds the same-day delta and the pacing chart
  const prevMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));

  const [trendIncomes, target, pendingRows, pipeline] = await Promise.all([
    prisma.income.findMany({
      where: { date: { gte: prevMonthStart } },
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.monthlyTarget.findUnique({ where: { month: monthStart } }),
    getPendingRows(), // React-cached — shared with notifications, no extra cost
    getPipelineSnapshot(),
  ]);

  const inrOf = (r: { amountInrMinor: bigint | number; amountEurMinor: bigint | number; fxRateUsed: unknown }) =>
    Number(r.amountInrMinor) + Number(r.amountEurMinor) * Number(r.fxRateUsed);

  const collectedMinor = trendIncomes.filter((r) => r.date >= monthStart).reduce((a, r) => a + inrOf(r), 0);

  // ── Pace vs target: compare to where the month SHOULD be today, not to 100% ──
  const targetMinor = Number(target?.targetInrMinor ?? 80000000n);
  const dayOfMonth = today.getUTCDate();
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000);
  const monthFrac = Math.min(1, dayOfMonth / daysInMonth);
  const expectedMinor = targetMinor * monthFrac;
  const paceDeltaMinor = collectedMinor - expectedMinor;
  const pacePct = expectedMinor > 0 ? (collectedMinor / expectedMinor) * 100 : null;
  // Green ONLY at/ahead of pace — a chip that says "behind pace" must never wear green.
  const paceSignal: SignalLevel | null =
    pacePct === null ? null : pacePct >= 100 ? "ok" : pacePct >= 75 ? "watch" : "risk";
  const paceMeta = paceSignal ? SIGNAL_META[paceSignal] : null;

  // ── Same-day comparison vs last month (day 1..N of each) ──
  const prevCutoffMs = Math.min(
    Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), dayOfMonth + 1),
    monthStart.getTime(),
  );
  const prevSameDayMinor = trendIncomes
    .filter((r) => r.date >= prevMonthStart && r.date.getTime() < prevCutoffMs)
    .reduce((a, r) => a + inrOf(r), 0);
  const momPct = prevSameDayMinor > 0 ? ((collectedMinor - prevSameDayMinor) / prevSameDayMinor) * 100 : null;

  // ── Daily cumulative paths for the pacing chart ──
  const prevDaysInMonth = Math.round((monthStart.getTime() - prevMonthStart.getTime()) / 86400000);
  const cumOf = (rows: typeof trendIncomes, start: Date, days: number) => {
    const daily = new Array<number>(days).fill(0);
    for (const r of rows) {
      const idx = Math.floor((r.date.getTime() - start.getTime()) / 86400000);
      if (idx >= 0 && idx < days) daily[idx] += inrOf(r);
    }
    let acc = 0;
    return daily.map((v) => (acc += v));
  };
  const curCum = cumOf(trendIncomes.filter((r) => r.date >= monthStart), monthStart, dayOfMonth);
  const prevCum = cumOf(
    trendIncomes.filter((r) => r.date >= prevMonthStart && r.date < monthStart),
    prevMonthStart,
    prevDaysInMonth,
  );
  const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(monthStart);
  const prevMonthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(prevMonthStart);

  // ── Projected finish: collected + receivables due before month-end + the
  //    pipeline forecast pro-rated to the days left. "Will I hit ₹8L?" gets a number.
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
  const dueThisMonthMinor = pendingRows
    .filter(
      (p) =>
        p.status === "ACTIVE" && p.balance.inr > 0 && p.nextDueDate &&
        new Date(p.nextDueDate) >= today && new Date(p.nextDueDate) < monthEnd,
    )
    .reduce((a, p) => a + p.balance.inr, 0);
  const forecastMinor = pipeline.avgFeeKnown ? pipeline.forecast30Inr * Math.min(1, remainingDays / 30) : 0;
  const projectedMinor = collectedMinor + dueThisMonthMinor + forecastMinor;
  const projectedPct = targetMinor > 0 ? (projectedMinor / targetMinor) * 100 : null;
  const projectedSignal: SignalLevel | null =
    projectedPct === null ? null : projectedPct >= 100 ? "ok" : projectedPct >= 80 ? "watch" : "risk";
  const projMeta = projectedSignal ? SIGNAL_META[projectedSignal] : null;

  // Meter segments — each money source keeps one identity colour everywhere
  let segUsed = 0;
  const segments = [
    { key: "collected", label: "collected", minor: collectedMinor, color: "var(--chart-1)" },
    { key: "due", label: "due this month", minor: dueThisMonthMinor, color: "var(--chart-2)" },
    { key: "forecast", label: "pipeline forecast", minor: forecastMinor, color: "var(--chart-3)" },
  ]
    .map((s) => {
      const frac = targetMinor > 0 ? s.minor / targetMinor : 0;
      const w = Math.max(0, Math.min(frac, 1 - segUsed));
      segUsed += w;
      return { ...s, w };
    })
    .filter((s) => s.minor > 0);

  const heroTiles = [
    { label: "Collected", value: formatInrMinor(collectedMinor, { compact: true }), color: undefined },
    {
      label: "Projected finish",
      value:
        projectedPct === null
          ? "—"
          : `${formatInrMinor(projectedMinor, { compact: true })} · ${Math.round(projectedPct)}%`,
      color: projMeta?.color,
    },
    { label: "Target", value: formatInrMinor(targetMinor, { compact: true }), color: undefined },
  ];

  return (
    <div className="hero-sky rise-in relative overflow-hidden rounded-hero p-6">
      {/* Headline: collected + same-day delta (left) · ahead/behind-pace chip (right) */}
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
            <TrendingUp size={14} /> Collected · {formatMonth(monthStart)}
          </p>
          <p className="mt-1.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {formatInrMinor(collectedMinor)}
          </p>
          {momPct !== null && (
            <p className="tnum mt-0.5 text-sm text-ink-2">
              <span className="font-semibold" style={{ color: momPct >= 0 ? "var(--good)" : "var(--bad)" }}>
                {momPct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(momPct * 10) / 10)}%
              </span>{" "}
              vs same day last month
            </p>
          )}
        </div>
        {paceMeta && (
          <span
            className="tnum flex-none rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: paceMeta.soft, color: paceMeta.color }}
          >
            {paceDeltaMinor >= 0 ? "▲" : "▼"} {formatInrMinor(Math.abs(paceDeltaMinor), { compact: true })}{" "}
            {paceDeltaMinor >= 0 ? "ahead of" : "behind"} pace
          </span>
        )}
      </div>

      {/* Path to target: what's in (collected) + what's scheduled (receivables due
          before month-end) + what selling should add (pro-rated pipeline forecast),
          stacked against the target. Tick = where today should be. */}
      <div className="relative mt-5">
        <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-surface/70">
          {segments.map((s) => (
            <div key={s.key} className="h-full" style={{ width: `${s.w * 100}%`, background: s.color }} />
          ))}
        </div>
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-0.5 rounded-full"
          style={{ left: `calc(${monthFrac * 100}% - 1px)`, background: "var(--ink-2)" }}
          title={`Expected by today: ${formatInrMinor(expectedMinor, { compact: true })}`}
        />
        <div className="tnum mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption font-medium text-ink-2">
          <span>
            Day {dayOfMonth} of {daysInMonth} · ▎expected by today {formatInrMinor(expectedMinor, { compact: true })}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {segments.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label} {inrShort(s.minor)}
              </span>
            ))}
          </span>
        </div>
      </div>

      {/* Summary tiles — the three numbers the meter resolves to */}
      <div className="relative mt-5 grid grid-cols-3 gap-3 border-t border-primary-tint pt-4">
        {heroTiles.map((t) => (
          <div key={t.label}>
            <p className="text-caption font-medium text-ink-2">{t.label}</p>
            <p
              className="tnum mt-0.5 font-display text-h2 font-bold tracking-tight sm:text-xl"
              style={t.color ? { color: t.color } : undefined}
            >
              {t.value}
            </p>
          </div>
        ))}
      </div>

      {/* Day-by-day trajectory — detail, tucked behind a disclosure so the hero stays
          calm. Native <details>: keyboard-reachable and works with no client JS. */}
      <details className="group relative mt-4 border-t border-primary-tint pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-caption font-semibold text-ink-2 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          <span className="group-open:hidden">Show 30-day trend</span>
          <span className="hidden group-open:inline">Hide 30-day trend</span>
        </summary>
        <div className="mt-3">
          <PaceChart cur={curCum} prev={prevCum} targetMinor={targetMinor} daysInMonth={daysInMonth} height={140} />
          <div className="tnum mt-1 flex justify-between px-1 text-caption font-medium text-ink-2" aria-hidden>
            <span>1 {monthShort}</span>
            <span>{Math.round(daysInMonth / 2)} {monthShort}</span>
            <span>{daysInMonth} {monthShort}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption font-medium text-ink-2">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--primary)" }} />
              {monthShort} so far · {inrShort(collectedMinor)}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--primary-tint)" }} />
              {prevMonthShort} full month · {inrShort(prevCum[prevCum.length - 1] ?? 0)}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "var(--viz-ink)" }} />
              target pace
            </span>
          </div>
        </div>
      </details>
    </div>
  );
}
