import Link from "next/link";
import { Medal, Trophy } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getLeaderboard, viewFor } from "@/server/leaderboard";
import { getMySprintLog, getCoachSprintFeed } from "@/server/sprint-log";
import { LeaderboardTable } from "./_components/LeaderboardTable";
import { CohortBenchmark } from "./_components/CohortBenchmark";
import { SprintLogPanel } from "./_components/SprintLogPanel";
import { CoachReviewFeed } from "./_components/CoachReviewFeed";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

/**
 * THE SPRINT LEADERBOARD.
 *
 * One page, two audiences, and the difference is handled on the SERVER rather than by hiding
 * things in the markup:
 *   · a student gets their own cohort, their own breakdown, and a box to log what the app
 *     cannot see for itself. Their classmates' names arrive only if the admin's `visibility`
 *     allows it - `viewFor` replaces them before the view is serialised.
 *   · staff get the named board for any cohort they run, plus the review feed where a
 *     self-reported entry can be corrected or taken off.
 *
 * Gated on the `leaderboard` section, so the founder can take it away from either audience in
 * Console → Sections without a deploy - which matters more here than on most screens, because
 * this is the one page where a student sees another student.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ batch?: string }>;
}) {
  const session = await requireSection("leaderboard");
  const params = (await searchParams) ?? {};
  const isStudent = session.role === "STUDENT";

  /**
   * Which cohort. A student never chooses - it is theirs, resolved from their enrollment.
   * Staff may pass `?batch=`, and it is checked against the cohorts they actually run rather
   * than trusted: a batch id in a query string is not authorisation.
   */
  let batchId: string | null = null;
  let pickable: { id: string; name: string }[] = [];

  if (isStudent) {
    const mine = await prisma.enrollment.findFirst({
      where: { student: { userId: session.user.id }, status: "ACTIVE" },
      select: { batchId: true },
      orderBy: { enrollmentDate: "desc" },
    });
    batchId = mine?.batchId ?? null;
  } else {
    const supervises =
      session.role === "ADMIN" || session.role === "HEAD";
    pickable = await prisma.batch.findMany({
      where: supervises
        ? { status: "ACTIVE", line: "B2" }
        : { status: "ACTIVE", OR: [{ tutorId: session.user.id }, { enrollments: { some: { coachId: session.user.id } } }] },
      select: { id: true, name: true },
      orderBy: [{ startDate: "desc" }, { name: "asc" }],
      take: 50,
    });
    const asked = params.batch ?? null;
    batchId = asked && pickable.some((b) => b.id === asked) ? asked : pickable[0]?.id ?? null;
  }

  const full = await getLeaderboard(batchId, isStudent ? session.user.id : null);
  const view = viewFor(full, isStudent ? "STUDENT" : "STAFF");

  if (!view.config.enabled) {
    return (
      <div className="w-full space-y-6">
        <PageHeader icon={<Medal size={20} />} title="Leaderboard" />
        <Card>
          <p className="text-sm text-muted">
            The leaderboard is switched off in Console → Leaderboard.
          </p>
        </Card>
      </div>
    );
  }

  const [myLog, feed] = await Promise.all([
    isStudent ? getMySprintLog(session.user.id) : Promise.resolve(null),
    isStudent ? Promise.resolve(null) : getCoachSprintFeed(batchId),
  ]);

  const periodLine =
    view.period.basis === "SPRINT"
      ? `Sprint week ${view.period.weeks} · counting from ${formatDate(view.period.fromYmd)}`
      : view.period.basis === "SPRINT_NOT_STARTED"
        ? `The sprint hasn't started yet, so this counts the whole programme from ${formatDate(view.period.fromYmd)}`
        : `Whole programme · from ${formatDate(view.period.fromYmd)}`;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Trophy size={20} />}
        title="Leaderboard"
        titleSuffix={
          view.config.visibility === "ANONYMISED" && isStudent ? (
            <Pill tone="neutral">Names hidden</Pill>
          ) : undefined
        }
        subtitle={`${view.batchName ?? "Your cohort"} · ${periodLine}`}
        actions={
          pickable.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {pickable.map((b) => (
                <Link
                  key={b.id}
                  href={`/leaderboard?batch=${b.id}`}
                  className={`press inline-flex h-9 items-center rounded-field border px-3 text-sm font-semibold ${
                    b.id === batchId
                      ? "border-primary bg-primary-tint text-primary"
                      : "border-line-strong text-ink hover:bg-surface-2"
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />

      {view.rows.length === 0 ? (
        <EmptyState
          icon={<Trophy size={22} />}
          title="Nothing to rank yet"
          body={
            isStudent
              ? "Your board fills itself from your attendance, coursework and applications - and from whatever you log below."
              : "No active enrollment in this cohort yet. The board appears as soon as somebody is seated in it."
          }
        />
      ) : (
        <LeaderboardTable view={view} isStudent={isStudent} />
      )}

      {/*
        The benchmark sits BELOW the ranking and above the log box, which is the order the
        founders described the screen in: where am I, how does that compare, what do I add.
        It renders its own "cohort too small" sentence rather than being conditioned away here,
        so a coach who set the floor can see that the floor is what they are looking at.
      */}
      {view.rows.length > 0 && <CohortBenchmark view={view} isStudent={isStudent} />}

      {isStudent && myLog && <SprintLogPanel entries={myLog} />}
      {!isStudent && feed && feed.length > 0 && <CoachReviewFeed entries={feed} />}
    </div>
  );
}
