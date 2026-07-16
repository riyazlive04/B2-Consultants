import Link from "next/link";
import { CalendarClock, CheckCircle2, ExternalLink, Languages, Settings, Users, Video } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getGnOverview } from "@/server/german-note-metrics";
import { OnboardingWalkthrough } from "@/components/onboarding/OnboardingWalkthrough";
import { CommunityFeed } from "./_components/CommunityFeed";
import { Leaderboard } from "./_components/Leaderboard";
import { LevelChip, StatusChip } from "./_components/LevelChip";
import { formatDateTimeInZone, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GermanNotePage({
  searchParams,
}: {
  searchParams?: { onboarding?: string };
}) {
  const session = await requireSection("german-note");
  const { access, batches, feed, leaderboard, levelProgress, upcomingEvents, mentionCandidates } =
    await getGnOverview(session.role, session.user.id);

  const isParticipant = access.isAdmin || access.isTutor || batches.length > 0;

  return (
    <div className="w-full space-y-8">
      {/* Home forwards ?onboarding=1 here for TUTOR before it can redirect this far. */}
      <OnboardingWalkthrough
        userId={session.user.id}
        role={session.role}
        firstName={session.user.name.split(" ")[0]}
        initialOpen={searchParams?.onboarding === "1"}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">German Note</h1>
          <p className="mt-1 text-sm text-muted">
            Your German course home — class recordings from your batch (yours for lifetime) and the community.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isParticipant && (
            <Link
              href="/german-note/members"
              className="inline-flex items-center gap-1.5 rounded-btn border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-surface-2"
            >
              <Users size={15} /> Members
            </Link>
          )}
          {access.isAdmin && (
            <Link
              href="/german-note/manage"
              className="inline-flex items-center gap-1.5 rounded-btn border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-surface-2"
            >
              <Settings size={15} /> Manage
            </Link>
          )}
        </div>
      </div>

      {!isParticipant ? (
        <div className="rounded-card border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
          <Languages size={28} className="mx-auto text-[var(--lvl-gn)]" />
          <p className="mt-3 font-display text-h2 font-semibold">You&apos;re not in a German Note batch yet</p>
          <p className="mt-1 text-sm text-muted">
            Once you join a batch, your class recordings and the community appear here. Ask your admin.
          </p>
        </div>
      ) : (
        <>
          {/* batches */}
          {batches.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {batches.map((b) => {
                const pct = b.watchedCount !== null && b.recordingCount > 0
                  ? (b.watchedCount / b.recordingCount) * 100
                  : null;
                return (
                  <Link
                    key={b.id}
                    href={`/german-note/${b.id}`}
                    className="card-hover rounded-card border border-line bg-surface p-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-h3">{b.name}</span>
                      <LevelChip level={b.level} />
                      <StatusChip status={b.status} />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {b.tutorName ? `Tutor: ${b.tutorName}` : "No tutor assigned yet"}
                    </p>
                    <p className="mt-2 flex items-center gap-4 text-xs text-muted">
                      <span className="inline-flex items-center gap-1"><Video size={13} /> {b.recordingCount} recording{b.recordingCount === 1 ? "" : "s"}</span>
                      <span className="inline-flex items-center gap-1"><Users size={13} /> {b.memberCount} member{b.memberCount === 1 ? "" : "s"}</span>
                    </p>
                    {pct !== null && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-caption text-muted">
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-[var(--lvl-gn)]" /> {b.watchedCount}/{b.recordingCount} watched
                          </span>
                          <span className="tnum">{formatPct(pct)}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-[var(--lvl-gn)]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
          {batches.length === 0 && (access.isAdmin || access.isTutor) && (
            <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-sm text-muted">
              {access.isAdmin ? (
                <>No batches yet — create one under <Link href="/german-note/manage" className="font-medium text-accent hover:underline">Manage</Link>.</>
              ) : (
                "No batches assigned to you yet — your admin assigns batches to tutors."
              )}
            </p>
          )}

          {/* upcoming live classes across the viewer's batches */}
          {upcomingEvents.length > 0 && (
            <div className="rounded-card border border-line bg-surface p-4 shadow-card">
              <h2 className="flex items-center gap-2 font-display text-h3">
                <CalendarClock size={16} className="text-[var(--lvl-gn)]" /> Upcoming classes
              </h2>
              <ul className="mt-3 space-y-2">
                {upcomingEvents.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
                    <span className="font-semibold">{e.title}</span>
                    {e.batchName && <span className="rounded-full bg-lvl-gn/10 px-2 py-0.5 text-caption font-semibold text-ink">{e.batchName}</span>}
                    <span className="text-xs text-muted">{formatDateTimeInZone(e.startsAt, "Asia/Kolkata")} IST</span>
                    {e.joinUrl && (
                      <a href={e.joinUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                        <ExternalLink size={12} /> Join
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* community + rail (level meter + leaderboard) */}
          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold">Community</h2>
              <p className="mb-4 mt-0.5 text-xs text-muted">
                Shared by every German Note student and tutor. Questions about a specific class go in that
                batch&apos;s Discussion tab.
              </p>
              <CommunityFeed batchId={null} posts={feed} canPost={access.isParticipant} candidates={mentionCandidates} />
            </div>
            <aside className="space-y-4 lg:sticky lg:top-4 lg:h-fit">
              {levelProgress && (
                <div className="rounded-card border border-line bg-surface p-4 shadow-card">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-bold text-on-accent">{levelProgress.level}</span>
                    <div>
                      <p className="text-sm font-semibold">Level {levelProgress.level}</p>
                      <p className="text-xs text-muted">{levelProgress.points} community points</p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${levelProgress.pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-caption text-muted">
                    {levelProgress.ceil === null
                      ? "Max level reached 🏆"
                      : `${levelProgress.toNext} more point${levelProgress.toNext === 1 ? "" : "s"} to level ${levelProgress.level + 1}`}
                  </p>
                </div>
              )}
              {leaderboard && <Leaderboard data={leaderboard} />}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
