import "server-only";
import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { SectionHeading, ViewAll } from "@/components/ui/kit";

/**
 * Recent wins (Admin only) — a short, celebratory timeline of the last few good
 * things: deals closed, offers landed, journeys finished. It is the "recent
 * activity" glance, deliberately capped at the latest handful; the full history
 * lives on /pipeline and /students. Renders nothing at all when there's no news,
 * so an empty week never leaves a hollow heading on the page.
 */

const LEVEL_LABEL: Record<string, string> = {
  SOLO: "Solo",
  GUIDED: "Guided",
  ELITE: "Elite",
};

export async function RecentWins() {
  const today = istToday();
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  const [wonRecent, milestoneWins] = await Promise.all([
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

  if (wins.length === 0) return null;

  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<PartyPopper size={18} />}
        title="Recent wins"
        description="The latest good news across sales and delivery"
        action={<ViewAll href="/pipeline">View pipeline</ViewAll>}
      />
      <ol className="glass-card rise-in overflow-hidden rounded-card">
        {wins.map((w, i) => (
          <li key={i} className={i > 0 ? "border-t border-line" : ""}>
            <Link href={w.href} className="flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-surface-2">
              <span
                aria-hidden
                className="grid h-9 w-9 flex-none place-items-center rounded-full bg-good-soft text-base leading-none"
              >
                {w.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{w.title}</span>
                <span className="block truncate text-caption text-muted">{w.detail}</span>
              </span>
              <span className="tnum flex-none text-caption text-ink-3">{formatDate(w.when)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
