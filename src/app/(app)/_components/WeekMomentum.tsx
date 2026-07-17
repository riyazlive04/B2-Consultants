import "server-only";
import Link from "next/link";
import { PhoneCall, Send, Trophy, UserPlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";

/**
 * Last-7-days pipeline motion (Admin only) — the four stages a deal moves through,
 * each carrying its week-over-week delta so a number is never just a number, plus the
 * 2026 sheet benchmark as the honest yardstick. A concise widget, not a feed: the
 * detail lives one click away on /pipeline.
 */

const WEEK_STAGES = ["NEW_LEAD", "DISCO_COMPLETED", "PROPOSAL_SENT", "WON"] as const;

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

export async function WeekMomentum() {
  const today = istToday();
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 86400000);

  const fortnightMoves = await prisma.leadStageHistory.findMany({
    where: { changedAt: { gte: twoWeeksAgo }, toStage: { in: WEEK_STAGES as unknown as never[] } },
    select: { toStage: true, changedAt: true, leadId: true },
  });

  // Last 7 days vs the 7 before: distinct leads reaching each stage.
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

  return (
    <div className="glass-card rise-in flex flex-col rounded-card p-5">
      <p className="text-label uppercase text-ink-3">Last 7 days</p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
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
      <p className="mt-auto border-t border-line pt-2.5 text-caption text-ink-3">
        Typical 2026 week: ~150 leads · ~1 win
      </p>
    </div>
  );
}
