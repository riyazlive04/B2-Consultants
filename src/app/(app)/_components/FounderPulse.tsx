import "server-only";
import Link from "next/link";
import { Activity, PhoneCall, Send, Sparkles, Trophy, UserPlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { formatDate, formatInrMinor, formatMonth } from "@/lib/format";

/**
 * Founder home hero (Admin only) — replaces the personal work-time tracker,
 * which measures effort; a founder needs outcomes. Two cards, same grid slot:
 *   1. Business pulse — month collected vs target + the week's pipeline motion
 *   2. Latest wins    — deals closed and student offer/completion moments
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

  const [incomes, target, weekMoves, wonRecent, milestoneWins] = await Promise.all([
    prisma.income.findMany({
      where: { date: { gte: monthStart } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
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

  // Collected this month: each row uses its own stamped FX rate (EUR → INR).
  const collectedMinor = incomes.reduce(
    (sum, r) => sum + Number(r.amountInrMinor) + Number(r.amountEurMinor) * Number(r.fxRateUsed),
    0,
  );
  const targetMinor = Number(target?.targetInrMinor ?? 80000000n);
  const frac = targetMinor > 0 ? Math.min(1, collectedMinor / targetMinor) : 0;

  const moveCount = (stage: string) =>
    weekMoves.find((m) => m.toStage === stage)?._count._all ?? 0;
  const weekStats = [
    { label: "New leads", value: moveCount("NEW_LEAD"), icon: <UserPlus size={14} />, href: "/pipeline" },
    { label: "Calls done", value: moveCount("DISCO_COMPLETED"), icon: <PhoneCall size={14} />, href: "/pipeline" },
    { label: "Proposals", value: moveCount("PROPOSAL_SENT"), icon: <Send size={14} />, href: "/pipeline" },
    { label: "Wins", value: moveCount("WON"), icon: <Trophy size={14} />, href: "/pipeline" },
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Business pulse: month revenue vs target + this week's pipeline motion */}
      <div className="rise-in card-hover rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
              <Activity size={14} /> Business pulse · {formatMonth(monthStart)}
            </p>
            <p className="mt-1 font-display text-3xl font-bold tracking-tight">
              {formatInrMinor(collectedMinor)}
              <span className="ml-2 text-sm font-semibold text-muted">collected</span>
            </p>
          </div>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
            {Math.round(frac * 100)}% of {formatInrMinor(targetMinor, { compact: true })}
          </span>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.max(2, frac * 100)}%`,
              background: "linear-gradient(90deg, var(--accent), var(--ok))",
            }}
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {weekStats.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-field border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:border-accent"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                {s.icon} {s.label}
              </p>
              <p className="mt-0.5 font-display text-xl font-bold tabular-nums">{s.value}</p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted">Pipeline movement · last 7 days</p>
      </div>

      {/* Latest wins: momentum you can feel */}
      <div className="rise-in card-hover flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
          <Sparkles size={14} /> Latest wins
        </p>
        {wins.length === 0 ? (
          <div className="grid flex-1 place-items-center py-8 text-center">
            <div>
              <p className="text-2xl">🌱</p>
              <p className="mt-2 text-sm text-muted">
                Wins land here — close the next deal and it shows up first.
              </p>
            </div>
          </div>
        ) : (
          <ul className="mt-3 flex flex-1 flex-col gap-1">
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
  );
}
