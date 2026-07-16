import "server-only";
import Link from "next/link";
import {
  ArrowRight, BellRing, PhoneCall, Send, Sparkles, TrendingUp, Trophy, UserPlus,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { formatDate, formatInrMinor, formatMonth } from "@/lib/format";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";
import type { Notification } from "@/server/notifications";

/**
 * Founder home hero (Admin only) — answers the founder's four questions in one glance:
 *   1. Month so far (sky hero)  — collected, pace vs the monthly target for TODAY's
 *      date (not the raw month %), a path-to-target meter (collected + receivables
 *      due this month + pro-rated pipeline forecast → projected finish), and a
 *      pacing chart: this month's cumulative collections against the target-pace
 *      line and last month's path. Every element answers "will I hit the target,
 *      and where does the rest come from?" — no backward-looking trend noise
 *      (with ~4 lumpy deals a month, a monthly history chart is deal timing, not signal).
 *   2. Last 7 days (white card) — pipeline motion WITH week-over-week deltas and the
 *      2026 sheet benchmarks, so a number is never just a number.
 *   3. Needs attention (white card) — the top live alerts (overdue money, red
 *      students, stalled deals) promoted from the bell to the front page, plus the
 *      latest win underneath. Everything links to the page where you act on it.
 */

const LEVEL_LABEL: Record<string, string> = {
  SOLO: "Solo",
  GUIDED: "Guided",
  ELITE: "Elite",
};

const WEEK_STAGES = ["NEW_LEAD", "DISCO_COMPLETED", "PROPOSAL_SENT", "WON"] as const;

/** ₹ compact for chart caps: 1,47,000.00 minor → "₹1.5L". */
function inrShort(minor: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(minor / 100)}`;
}

/** Week-over-week movement chip. More motion is good for all four pipeline stats. */
function DeltaChip({ now, prev }: { now: number; prev: number }) {
  const diff = now - prev;
  if (diff === 0) {
    return <span className="text-caption font-medium text-ink-3">same as prior wk</span>;
  }
  const up = diff > 0;
  return (
    <span
      className="tnum inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-caption font-semibold"
      style={{
        background: up ? "var(--good-bg)" : "var(--bad-bg)",
        color: up ? "var(--good)" : "var(--bad)",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(diff)} vs prior wk
    </span>
  );
}

const SEVERITY_DOT: Record<Notification["severity"], string> = {
  risk: "var(--bad)",
  watch: "var(--warn)",
  info: "var(--primary)",
  win: "var(--good)",
};

// §7 / WCAG 1.4.1: severity is never carried by the dot colour alone — every row
// wears the plain-English word too (mirrors NotificationBell).
const SEVERITY_LABEL: Record<Notification["severity"], string> = {
  risk: "Act now",
  watch: "Watch",
  info: "FYI",
  win: "Win",
};

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

export async function FounderPulse({ notifications }: { notifications: Notification[] }) {
  const { start: monthStart, end: monthEnd } = istMonthRange();
  const today = istToday();
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);
  // income window: this month + last month — feeds the same-day delta and the pacing chart
  const prevMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));

  const [trendIncomes, target, fortnightMoves, wonRecent, milestoneWins, pendingRows, pipeline] = await Promise.all([
    prisma.income.findMany({
      where: { date: { gte: prevMonthStart } },
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.monthlyTarget.findUnique({ where: { month: monthStart } }),
    prisma.leadStageHistory.findMany({
      where: { changedAt: { gte: twoWeeksAgo }, toStage: { in: WEEK_STAGES as unknown as never[] } },
      select: { toStage: true, changedAt: true, leadId: true },
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "WON", changedAt: { gte: monthAgo } },
      orderBy: { changedAt: "desc" },
      take: 2,
      include: { lead: { select: { name: true, wonLevel: true } } },
    }),
    prisma.milestoneLog.findMany({
      where: { newMilestone: { in: ["OFFER_RECEIVED", "COMPLETED"] }, date: { gte: monthAgo } },
      orderBy: { date: "desc" },
      take: 2,
      include: { enrollment: { select: { student: { select: { fullName: true } } } } },
    }),
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

  // ── Last 7 days vs the 7 before: distinct leads reaching each stage ──
  const reached = { cur: new Map<string, Set<string>>(), prev: new Map<string, Set<string>>() };
  for (const m of fortnightMoves) {
    const bucket = m.changedAt >= weekAgo ? reached.cur : reached.prev;
    if (!bucket.has(m.toStage)) bucket.set(m.toStage, new Set());
    bucket.get(m.toStage)!.add(m.leadId);
  }
  const countOf = (win: "cur" | "prev", stage: string) => reached[win].get(stage)?.size ?? 0;
  const weekStats = [
    { label: "New leads", stage: "NEW_LEAD", icon: <UserPlus size={15} /> },
    { label: "Calls done", stage: "DISCO_COMPLETED", icon: <PhoneCall size={15} /> },
    { label: "Proposals", stage: "PROPOSAL_SENT", icon: <Send size={15} /> },
    { label: "Wins", stage: "WON", icon: <Trophy size={15} /> },
  ].map((s) => ({ ...s, now: countOf("cur", s.stage), prev: countOf("prev", s.stage) }));

  // ── Attention feed (risk first — computeNotifications already sorts) + latest win ──
  const attention = notifications.filter((n) => n.severity !== "win").slice(0, 4);
  const moreCount = Math.max(0, notifications.filter((n) => n.severity !== "win").length - attention.length);
  const wins = [
    ...wonRecent.map((w) => ({
      when: w.changedAt,
      emoji: "🏆",
      title: `${w.lead.name} enrolled`,
      detail: w.lead.wonLevel ? `${LEVEL_LABEL[w.lead.wonLevel] ?? w.lead.wonLevel} program` : "Deal won",
      href: "/pipeline",
    })),
    ...milestoneWins.map((m) => ({
      when: m.date,
      emoji: m.newMilestone === "COMPLETED" ? "🎓" : "🎉",
      title:
        m.newMilestone === "COMPLETED"
          ? `${m.enrollment.student.fullName} completed the program`
          : `${m.enrollment.student.fullName} got a job offer`,
      detail: m.newMilestone === "COMPLETED" ? "Journey finished" : "Offer received",
      href: "/students",
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, 2);

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
    /* Splits to 3 columns at `xl`, not `lg`. At `lg` (1024px) the side column was squeezed
       to ~300px once the sidebar and gutters were taken out, which collapsed its own 2-up
       stat grid into a single stack and made the panel read as broken. Below `xl` the hero
       takes the full width and the side column sits underneath it at a usable size. */
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Month so far — the sky hero strip (the one allowed gradient) */}
      <Link
        href="/finance"
        className="hero-sky rise-in card-hover relative flex flex-col self-start overflow-hidden rounded-hero p-6 xl:col-span-2"
      >
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <TrendingUp size={14} /> Month so far · {formatMonth(monthStart)}
            </p>
            <p className="mt-1.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {formatInrMinor(collectedMinor)}
            </p>
            <p className="tnum mt-0.5 text-sm text-ink-2">
              collected
              {momPct !== null && (
                <>
                  {" · "}
                  <span
                    className="font-semibold"
                    style={{ color: momPct >= 0 ? "var(--good)" : "var(--bad)" }}
                  >
                    {momPct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(momPct * 10) / 10)}%
                  </span>{" "}
                  vs same day last month
                </>
              )}
            </p>
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

        {/* Path to target: what's in (collected) + what's scheduled (receivables
            due before month-end) + what selling should add (pro-rated pipeline
            forecast), stacked against the target. Tick = where today should be. */}
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

        {/* Pacing chart: cumulative collections vs the target-pace line vs last
            month's path — trajectory, not backward-looking monthly noise */}
        <div className="relative mt-5">
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
      </Link>

      {/* Side column: weekly motion with deltas + the attention feed. Below `xl` this sits
          under the hero at full width, so the two cards go side by side from `md` rather
          than stacking into one very tall strip. At `xl` it becomes the true right column
          and they stack again. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1">
        {/* Last 7 days — every count carries its week-over-week movement */}
        <div className="glass-card rise-in relative overflow-hidden rounded-card p-5">
          <div className="relative flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
              <Sparkles size={14} className="text-primary" /> Last 7 days
            </p>
            <Link
              href="/pipeline"
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-on-accent transition-colors hover:bg-primary-strong"
              aria-label="Open pipeline"
            >
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="relative mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
            {weekStats.map((s) => (
              <Link
                key={s.label}
                href="/pipeline"
                className="rounded-field -mx-2 px-2 py-1 transition-colors hover:bg-surface-2"
              >
                <p className="flex items-center gap-1.5 text-caption font-medium text-ink-2">
                  {s.icon} {s.label}
                </p>
                <p className="mt-0.5 font-display text-2xl font-bold tabular-nums">{s.now}</p>
                <DeltaChip now={s.now} prev={s.prev} />
              </Link>
            ))}
          </div>
          {/* benchmark from the 2026 sales sheets (SALES-LOGIC §4) */}
          <p className="relative mt-3 border-t border-line pt-2.5 text-caption text-ink-3">
            Typical 2026 week: ~150 leads · ~1 win
          </p>
        </div>

        {/* Needs attention — the alerts themselves, not a count of them */}
        <div className="glass-card rise-in flex flex-1 flex-col rounded-card p-5">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <BellRing size={14} className="text-primary" /> Needs attention
          </p>
          {attention.length === 0 ? (
            <div className="grid flex-1 place-items-center py-4 text-center">
              <div>
                <p className="text-2xl">✅</p>
                <p className="mt-2 text-sm text-muted">All clear — nothing needs you right now.</p>
              </div>
            </div>
          ) : (
            <ul className="mt-2 flex flex-col gap-0.5">
              {attention.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    className="flex items-start gap-2.5 rounded-field px-2 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span
                      className="mt-0.5 inline-flex flex-none items-center gap-1 text-caption font-semibold"
                      style={{ color: SEVERITY_DOT[n.severity] }}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ background: SEVERITY_DOT[n.severity] }}
                      />
                      {SEVERITY_LABEL[n.severity]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{n.title}</span>
                      <span className="block truncate text-xs text-muted">{n.body}</span>
                    </span>
                  </Link>
                </li>
              ))}
              {moreCount > 0 && (
                <li className="px-2 pt-1 text-caption text-ink-3">+{moreCount} more in the bell</li>
              )}
            </ul>
          )}

          {wins.length > 0 && (
            <ul className="mt-auto flex flex-col gap-0.5 border-t border-line pt-2.5">
              {wins.map((w, i) => (
                <li key={i}>
                  <Link
                    href={w.href}
                    className="flex items-center gap-2.5 rounded-field px-2 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex-none text-base leading-none">{w.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{w.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {w.detail} · {formatDate(w.when)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
