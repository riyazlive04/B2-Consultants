import Link from "next/link";
import { CircleUser } from "lucide-react";
import { requireSession } from "@/lib/rbac";
import { getMyGame } from "@/server/gamification";
import { BadgeStrip, LevelRing, XpBar } from "@/components/ui/gamification";
import { Card, PageHeader } from "@/components/ui/kit";
import { ProfileClient } from "./_components/ProfileClient";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  HEAD: "Team Head",
  USER: "Team Member",
  STUDENT: "Student",
  TUTOR: "Tutor",
};

export default async function ProfilePage() {
  const session = await requireSession();
  const game = await getMyGame(session.user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        icon={<CircleUser size={20} />}
        title="Your profile"
        subtitle="Update your photo and display name. This is how you appear across the dashboard."
      />

      {/* Player card — level, XP and badges from the Arena */}
      {game && (
        <Card>
          <div className="flex flex-wrap items-center gap-5">
            <LevelRing level={game.me.level} size={72} />
            <div className="min-w-52 flex-1">
              <XpBar xp={game.me.xpTotal} level={game.me.level} />
              <p className="mt-2 text-xs text-muted">
                🔥 {game.me.streak}-day streak · #{game.me.rankWeek} of {game.playerCount} this week ·{" "}
                {game.me.unlockedCount}/{game.me.badges.length} badges ·{" "}
                <Link href="/arena" className="font-semibold text-accent hover:underline">
                  open the Arena
                </Link>
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <BadgeStrip badges={game.me.badges} max={12} />
          </div>
        </Card>
      )}

      <ProfileClient
        user={{
          name: session.user.name,
          email: session.user.email,
          image: (session.user as { image?: string | null }).image ?? null,
          roleLabel: ROLE_LABELS[session.role] ?? session.role,
        }}
      />
    </div>
  );
}
