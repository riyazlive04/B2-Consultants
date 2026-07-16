import { Trophy } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import { getTeamGame } from "@/server/gamification";
import { ArenaClient } from "./_components/ArenaClient";

export const dynamic = "force-dynamic";

/**
 * The Arena — team gamification hub (leaderboard, quests, badges, XP feed).
 * Every number here is DERIVED from work already recorded elsewhere (daily
 * logs, pipeline moves, student milestones, OKRs) — there is nothing to enter
 * and nothing to game except doing the actual work.
 */
export default async function ArenaPage() {
  const session = await requireSection("arena");
  const game = await getTeamGame();

  // Slim payload: the client needs cards + feed, not every player's full ledger, nor the
  // dated counter series the badge/reward engines derive from.
  const players = game.players.map(
    ({ events: _e, counters: _c, logDays: _l, levelUps: _lu, ...p }) => p,
  );

  return (
    <div className="w-full space-y-8">
      <PageHeader
        icon={<Trophy size={20} />}
        title="Arena"
        subtitle="XP, levels, quests and badges — earned automatically from the work you already log. No extra data entry, no way to farm points except doing the job."
      />
      <ArenaClient
        players={players}
        feed={game.feed}
        meUserId={session.user.id}
        isAdmin={session.role === "ADMIN"}
        weekStart={game.weekStart}
        ruleset={game.ruleset}
      />
    </div>
  );
}
