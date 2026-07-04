import Link from "next/link";
import { requireSection } from "@/lib/rbac";
import { getMyDailyLogView } from "@/server/people-metrics";
import { getMyGame } from "@/server/gamification";
import { LevelRing, XpBar, BadgeStrip } from "@/components/ui/gamification";
import { DailyLogClient } from "./_components/DailyLogClient";

export const dynamic = "force-dynamic";

export default async function DailyLogPage() {
  const session = await requireSection("daily-log");
  const [view, game] = await Promise.all([
    getMyDailyLogView(session.user.id),
    getMyGame(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">My Daily Log</h1>
        <p className="mt-1 text-sm text-muted">
          {view.fullName ? `${view.fullName} - ` : ""}log your key numbers for today. One entry per day.
        </p>
      </div>

      {/* Player strip: level, XP and badges — the log below is where the XP comes from */}
      {game && (
        <div className="rise-in flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <LevelRing level={game.me.level} size={64} />
          <div className="min-w-52 flex-1">
            <XpBar xp={game.me.xpTotal} level={game.me.level} />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <BadgeStrip badges={game.me.badges} max={5} />
            <Link href="/arena" className="text-xs font-semibold text-accent hover:underline">
              #{game.me.rankWeek} of {game.playerCount} this week → Arena
            </Link>
          </div>
        </div>
      )}

      {view.variant ? (
        <DailyLogClient view={view} quests={game?.me.quests ?? []} />
      ) : (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-muted shadow-card">
          Your team profile isn’t set up yet - ask Admin to create it in the People section.
        </div>
      )}
    </div>
  );
}
