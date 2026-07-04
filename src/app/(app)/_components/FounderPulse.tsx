import "server-only";
import Link from "next/link";
import { ArrowRight, PhoneCall, Send, Sparkles, TrendingUp, Trophy, UserPlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { formatDate, formatInrMinor, formatMonth } from "@/lib/format";
import { AreaChart } from "@/components/ui/AreaChart";

/**
 * Founder home hero (Admin only) — the signature "Overview" surface.
 *   1. Overview (violet gradient) — collected this month, a 6-month revenue
 *      trend, and three headline tiles (collected · target · to goal).
 *   2. This week (pink gradient)  — the week's pipeline motion.
 *   3. Latest wins (glass card)   — deals closed + student milestones.
 * Everything is pulled live from the same tables the deep pages use.
 */

const LEVEL_LABEL: Record<string, string> = {
  SOLO: "Solo",
  GUIDED: "Guided",
  ELITE: "Elite",
};

export async function FounderPulse() {
  const { start: monthStart } = istMonthRange();
  const today = istToday();
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);
  // six-month window (this month + five prior) for the revenue trend
  const trendStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 5, 1));

  const [trendIncomes, target, weekMoves, wonRecent, milestoneWins] = await Promise.all([
    prisma.income.findMany({
      where: { date: { gte: trendStart } },
      select: { date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.monthlyTarget.findUnique({ where: { month: monthStart } }),
    prisma.leadStageHistory.groupBy({
      by: ["toStage"],
      where: {
        changedAt: { gte: weekAgo },
        toStage: { in: ["NEW_LEAD", "DISCO_COMPLETED", "PROPOSAL_SENT", "WON"] },
      },
      _count: { _all: true },
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "WON", changedAt: { gte: monthAgo } },
      orderBy: { changedAt: "desc" },
      take: 3,
      include: { lead: { select: { name: true, wonLevel: true } } },
    }),
    prisma.milestoneLog.findMany({
      where: { newMilestone: { in: ["OFFER_RECEIVED", "COMPLETED"] }, date: { gte: monthAgo } },
      orderBy: { date: "desc" },
      take: 3,
      include: { enrollment: { select: { student: { select: { fullName: true } } } } },
    }),
  ]);

  const inrOf = (r: { amountInrMinor: bigint | number; amountEurMinor: bigint | number; fxRateUsed: unknown }) =>
    Number(r.amountInrMinor) + Number(r.amountEurMinor) * Number(r.fxRateUsed);

  // Bucket the six-month window into monthly INR-minor totals for the trend line.
  const buckets: { label: string; total: number; isCurrent: boolean }[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 5 + i, 1));
    return {
      label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(d),
      total: 0,
      isCurrent: i === 5,
    };
  });
  for (const r of trendIncomes) {
    const d = new Date(r.date);
    const idx = (d.getUTCFullYear() - monthStart.getUTCFullYear()) * 12 + (d.getUTCMonth() - monthStart.getUTCMonth()) + 5;
    if (idx >= 0 && idx < 6) buckets[idx].total += inrOf(r);
  }
  const series = buckets.map((b) => Math.round(b.total));
  const collectedMinor = buckets[5].total;

  const targetMinor = Number(target?.targetInrMinor ?? 80000000n);
  const frac = targetMinor > 0 ? Math.min(1, collectedMinor / targetMinor) : 0;

  const moveCount = (stage: string) => weekMoves.find((m) => m.toStage === stage)?._count._all ?? 0;
  const weekStats = [
    { label: "New leads", value: moveCount("NEW_LEAD"), icon: <UserPlus size={15} /> },
    { label: "Calls done", value: moveCount("DISCO_COMPLETED"), icon: <PhoneCall size={15} /> },
    { label: "Proposals", value: moveCount("PROPOSAL_SENT"), icon: <Send size={15} /> },
    { label: "Wins", value: moveCount("WON"), icon: <Trophy size={15} /> },
  ];

  // Merge deal + student wins into one feed, newest first.
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
    .slice(0, 4);

  const heroTiles = [
    { label: "Collected", value: formatInrMinor(collectedMinor, { compact: true }) },
    { label: "Target", value: formatInrMinor(targetMinor, { compact: true }) },
    { label: "To goal", value: `${Math.round(frac * 100)}%` },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Overview — the signature violet gradient hero */}
      <Link
        href="/finance"
        className="hero-violet hero-orb rise-in card-hover relative flex flex-col overflow-hidden rounded-card p-6 lg:col-span-2"
      >
        <div className="relative flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/70">
              <TrendingUp size={14} /> Business overview
            </p>
            <p className="mt-1.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {formatInrMinor(collectedMinor)}
            </p>
            <p className="mt-0.5 text-sm text-white/70">collected · {formatMonth(monthStart)}</p>
          </div>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
            {Math.round(frac * 100)}% of {formatInrMinor(targetMinor, { compact: true })}
          </span>
        </div>

        {/* 6-month revenue trend — white line/fill reads cleanly on violet */}
        <div className="relative mt-4" style={{ "--accent": "#ffffff" } as React.CSSProperties}>
          <AreaChart data={series} height={132} />
          <div className="mt-1 flex justify-between px-1 text-[11px] font-medium text-white/60">
            {buckets.map((b, i) => (
              <span key={i} className={b.isCurrent ? "text-white" : undefined}>
                {b.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-3 border-t border-white/15 pt-4">
          {heroTiles.map((t) => (
            <div key={t.label}>
              <p className="text-[11px] font-medium text-white/70">{t.label}</p>
              <p className="mt-0.5 font-display text-lg font-bold tracking-tight sm:text-xl">{t.value}</p>
            </div>
          ))}
        </div>
      </Link>

      {/* right column: pink pipeline card + wins feed */}
      <div className="flex flex-col gap-4">
        {/* This week — pink gradient motion card */}
        <div className="hero-pink hero-orb rise-in relative overflow-hidden rounded-card p-5">
          <div className="relative flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/80">
              <Sparkles size={14} /> This week
            </p>
            <Link
              href="/pipeline"
              className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
              aria-label="Open pipeline"
            >
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="relative mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/15 pt-4">
            {weekStats.map((s) => (
              <Link
                key={s.label}
                href="/pipeline"
                className="rounded-field -mx-2 px-2 py-1 transition-colors hover:bg-white/10"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/80">
                  {s.icon} {s.label}
                </p>
                <p className="mt-0.5 font-display text-2xl font-bold tabular-nums">{s.value}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Latest wins — glass card */}
        <div className="glass-card rise-in card-hover flex flex-1 flex-col rounded-card border border-white/80 p-5">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Trophy size={14} className="text-accent" /> Latest wins
          </p>
          {wins.length === 0 ? (
            <div className="grid flex-1 place-items-center py-6 text-center">
              <div>
                <p className="text-2xl">🌱</p>
                <p className="mt-2 text-sm text-muted">
                  Wins land here — close the next deal and it shows up first.
                </p>
              </div>
            </div>
          ) : (
            <ul className="mt-2 flex flex-1 flex-col gap-0.5">
              {wins.map((w, i) => (
                <li key={i}>
                  <Link
                    href={w.href}
                    className="flex items-center gap-3 rounded-field px-2 py-2 transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-base">
                      {w.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{w.title}</span>
                      <span className="block text-xs text-muted">
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
