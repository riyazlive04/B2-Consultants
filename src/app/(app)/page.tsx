import { redirect } from "next/navigation";
import { Gauge, IndianRupee, BellRing, ClipboardList, GraduationCap, Trophy } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { WorkTracker } from "./_components/WorkTracker";
import { FounderPulse } from "./_components/FounderPulse";
import { getTodayInrPerEur } from "@/lib/fx";
import { formatDate } from "@/lib/format";
import { signalForRunway } from "@/lib/signals";
import { requireSession } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getMyGame, getTeamGame } from "@/server/gamification";
import { computeNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireSession();
  // Students land straight on their journey — the founder home is team-facing.
  if (session.role === "STUDENT") redirect("/my-journey");
  const isAdmin = session.role === "ADMIN";

  const [fx, runway, notifications, game, teamGame] = await Promise.all([
    getTodayInrPerEur(),
    isAdmin ? getRunwaySnapshot() : Promise.resolve(null),
    computeNotifications(session.role, session.user.id),
    getMyGame(session.user.id),
    isAdmin ? getTeamGame() : Promise.resolve(null),
  ]);

  // Attention card colour follows the most severe pending notification.
  const hasRisk = notifications.some((n) => n.severity === "risk");
  const hasWatch = notifications.some((n) => n.severity === "watch");
  const attnSignal = notifications.length === 0 ? "ok" : hasRisk ? "risk" : hasWatch ? "watch" : undefined;
  const top = notifications[0];

  const months = runway?.runwayMonths ?? null;

  return (
    <div>
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        Welcome back, {session.user.name.split(" ")[0]}
      </h1>
      <p className="mt-2 text-muted">Here is where things stand today.</p>

      {/* Admin sees business outcomes (pulse + wins); team members keep the
          personal work-time tracker for their own day. */}
      <div className="mt-8">{isAdmin ? <FounderPulse /> : <WorkTracker />}</div>

      {/* At a glance: live, clickable KPIs */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">At a glance</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isAdmin && (
            <MetricCard
              label="Cash runway"
              value={months == null ? "Not set" : `${months} mo`}
              target={months == null ? undefined : "goal 6 mo"}
              signal={months == null ? undefined : signalForRunway(months)}
              progress={months == null ? undefined : Math.min(1, months / 6)}
              icon={<Gauge size={18} />}
              href="/cash"
            />
          )}

          <MetricCard
            label="Live FX (ECB)"
            value={`₹${fx.rate.toFixed(2)}`}
            secondary={`per €1 · ${formatDate(fx.date)}${fx.stale ? " · cached" : ""}`}
            icon={<IndianRupee size={18} />}
            href={isAdmin ? "/finance" : undefined}
          />

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
          {game && (
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
