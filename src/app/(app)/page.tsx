import { redirect } from "next/navigation";
import {
  BellRing, ClipboardList, Gauge, GraduationCap, IndianRupee, Medal, ReceiptText, Trophy, Waypoints,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/kit";
import { WorkTracker } from "./_components/WorkTracker";
import { FounderPulse } from "./_components/FounderPulse";
import { getTodayInrPerEur } from "@/lib/fx";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { signalForRunway } from "@/lib/signals";
import { requireSession } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";
import { getMyGame, getTeamGame } from "@/server/gamification";
import { computeNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireSession();
  // Students land straight on their journey — the founder home is team-facing.
  if (session.role === "STUDENT") redirect("/my-journey");
  // Tutors only work inside the German Note section.
  if (session.role === "TUTOR") redirect("/german-note");
  const isAdmin = session.role === "ADMIN";

  const [fx, runway, notifications, game, teamGame, pipeline, pendingRows] = await Promise.all([
    getTodayInrPerEur(),
    isAdmin ? getRunwaySnapshot() : Promise.resolve(null),
    computeNotifications(session.role, session.user.id),
    getMyGame(session.user.id),
    isAdmin ? getTeamGame() : Promise.resolve(null),
    isAdmin ? getPipelineSnapshot() : Promise.resolve(null),
    isAdmin ? getPendingRows() : Promise.resolve(null),
  ]);

  // Attention card colour follows the most severe pending notification.
  const hasRisk = notifications.some((n) => n.severity === "risk");
  const hasWatch = notifications.some((n) => n.severity === "watch");
  const attnSignal = notifications.length === 0 ? "ok" : hasRisk ? "risk" : hasWatch ? "watch" : undefined;
  const top = notifications[0];

  const months = runway?.runwayMonths ?? null;

  // Overdue receivables — money already earned that hasn't arrived (Admin only).
  const overdueRows = (pendingRows ?? []).filter(
    (p) => p.status === "ACTIVE" && p.overdue && p.balance.inr > 0,
  );
  const overdueInr = overdueRows.reduce((a, p) => a + p.balance.inr, 0);
  const oldestOverdueDays = overdueRows.reduce((a, p) => Math.max(a, p.daysOverdue), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Primary"
        title={`Welcome back, ${session.user.name.split(" ")[0]}`}
        subtitle="Here is where things stand today."
      />

      {/* Admin sees business outcomes (pace + motion + alerts); team members keep
          the personal work-time tracker for their own day. */}
      {isAdmin ? <FounderPulse notifications={notifications} /> : <WorkTracker />}

      {/* At a glance: live, clickable KPIs */}
      <section>
        <h2 className="font-display text-lg font-semibold">At a glance</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isAdmin && (
            <MetricCard
              label="Cash runway"
              value={months == null ? "Not set" : `${months} mo`}
              target={months == null ? undefined : "goal 6 mo"}
              signal={months == null ? undefined : signalForRunway(months)}
              progress={months == null ? undefined : Math.min(1, months / 6)}
              tooltip="Months the bank balance lasts at the current burn: cash ÷ average monthly expenses over the last 3 months. Green ≥ 6, amber 3–6, red < 3."
              icon={<Gauge size={18} />}
              href="/cash"
            />
          )}

          {isAdmin && pipeline && (
            <MetricCard
              label="Pipeline value"
              value={
                pipeline.avgFeeKnown
                  ? formatInrMinor(pipeline.pipelineValueInr, { compact: true })
                  : `${pipeline.interestedLeads} deals`
              }
              secondary={
                !pipeline.avgFeeKnown
                  ? "No income history yet to price open deals"
                  : pipeline.forecast30Inr > 0
                    ? `${pipeline.interestedLeads} open deal${pipeline.interestedLeads === 1 ? "" : "s"} · ${formatInrMinor(pipeline.forecast30Inr, { compact: true })} expected in 30d`
                    : `${pipeline.interestedLeads} open deal${pipeline.interestedLeads === 1 ? "" : "s"} · no closes yet to forecast from`
              }
              tooltip="Open deals in strategy-call → deposit stages × the average program fee from real income history. The 30-day forecast applies this month's close rate. This is next month's revenue — before it happens."
              icon={<Waypoints size={18} />}
              href="/pipeline"
            />
          )}

          {isAdmin && pipeline && (
            <MetricCard
              label="Wins this month"
              value={String(pipeline.winsThisMonth)}
              secondary={
                pipeline.completedThisMonth > 0
                  ? `${formatPct(pipeline.closePct)} close rate · typical month ≈ 4 wins`
                  : "typical month ≈ 4 wins (2026 avg)"
              }
              tooltip="Deals moved to Won this month, with the close rate from completed discovery calls. The 2026 sheets average ~4 wins a month — the honest yardstick."
              icon={<Medal size={18} />}
              href="/pipeline"
            />
          )}

          {isAdmin && (
            <MetricCard
              label="Overdue receivables"
              value={overdueRows.length === 0 ? "None" : formatInrMinor(overdueInr, { compact: true })}
              signal={overdueRows.length === 0 ? "ok" : "risk"}
              secondary={
                overdueRows.length === 0
                  ? "All payments on schedule"
                  : `${overdueRows.length} payment${overdueRows.length > 1 ? "s" : ""} past due · oldest ${oldestOverdueDays}d`
              }
              tooltip="Money already earned that hasn't arrived. Collecting it costs nothing in ad spend or sales calls — chase this before chasing new leads."
              icon={<ReceiptText size={18} />}
              href="/finance"
            />
          )}

          <MetricCard
            label="Live FX (ECB)"
            value={`₹${fx.rate.toFixed(2)}`}
            secondary={`per €1 · ${formatDate(fx.date)}${fx.stale ? " · cached" : ""}`}
            icon={<IndianRupee size={18} />}
            href={isAdmin ? "/finance" : undefined}
          />

          {/* Non-admins keep the attention card here; the founder gets the full
              list inside the pulse above instead of a count behind a click. */}
          {!isAdmin && (
            <MetricCard
              label="Needs attention"
              value={
                notifications.length === 0
                  ? "All clear"
                  : `${notifications.length} item${notifications.length > 1 ? "s" : ""}`
              }
              secondary={top ? top.title : "Nothing needs you right now"}
              signal={attnSignal}
              icon={<BellRing size={18} />}
              href={top ? top.href : undefined}
            />
          )}

          {!isAdmin && (
            <MetricCard
              label="Your daily log"
              value="Log today"
              secondary="Add your numbers for today"
              icon={<ClipboardList size={18} />}
              href="/daily-log"
            />
          )}

          {/* Arena: my level + rank, or (Admin) the current weekly champion */}
          {!isAdmin && game && (
            <MetricCard
              label="Arena"
              value={`Lv ${game.me.level.level} · ${game.me.level.title}`}
              secondary={`#${game.me.rankWeek} this week · ${game.me.xpTotal.toLocaleString("en-IN")} XP · 🔥 ${game.me.streak}d`}
              icon={<Trophy size={18} />}
              href="/arena"
            />
          )}
          {isAdmin && teamGame && teamGame.players.length > 0 && (
            <MetricCard
              label="Arena — weekly leader"
              value={teamGame.players[0].name.split(" ")[0]}
              secondary={`${teamGame.players[0].xpWeek.toLocaleString("en-IN")} XP this week · Lv ${teamGame.players[0].level.level}`}
              icon={<Trophy size={18} />}
              href="/arena"
            />
          )}

          {session.role === "HEAD" && (
            <MetricCard
              label="Students"
              value="Open board"
              secondary="Journeys, signals and check-ins"
              icon={<GraduationCap size={18} />}
              href="/students"
            />
          )}
        </div>
      </section>
    </div>
  );
}
