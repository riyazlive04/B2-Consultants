import { redirect } from "next/navigation";
import {
  ClipboardList, Gauge, GraduationCap, IndianRupee, Languages, LayoutGrid, Medal, ReceiptText,
  Timer, Trophy, Wallet, Waypoints,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader, SectionHeading, ViewAll } from "@/components/ui/kit";
import { OnboardingWalkthrough } from "@/components/onboarding/OnboardingWalkthrough";
import { WorkTracker } from "./_components/WorkTracker";
import { MonthHero } from "./_components/MonthHero";
import { WeekMomentum } from "./_components/WeekMomentum";
import { RecentWins } from "./_components/RecentWins";
import { NeedsAttention } from "./_components/NeedsAttention";
import { KpiRangeSwitch } from "./_components/KpiRangeSwitch";
import { getTodayInrPerEur } from "@/lib/fx";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { signalForRunway } from "@/lib/signals";
import { parseKpiRange, istToday } from "@/lib/dates";
import { requireSession } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";
import { getMyGame, getTeamGame } from "@/server/gamification";
import { getGnHomeSnapshot } from "@/server/german-note-metrics";
import { computeNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: { range?: string; onboarding?: string };
}) {
  const session = await requireSession();
  // Post-invite first-touch walkthrough flag (OnboardingWalkthrough) — forward it
  // through the STUDENT/TUTOR redirects below since they never render this page.
  const onboardingQuery = searchParams.onboarding === "1" ? "?onboarding=1" : "";
  // Students land straight on their journey — the founder home is team-facing.
  if (session.role === "STUDENT") redirect(`/my-journey${onboardingQuery}`);
  // Tutors only work inside the German Note section.
  if (session.role === "TUTOR") redirect(`/german-note${onboardingQuery}`);
  const isAdmin = session.role === "ADMIN";
  // Head now has Pipeline visibility (sections.ts) — the home page should reflect that
  // instead of falling back to the generic personal WorkTracker (BUILD_CHECKLIST §2).
  const isHead = session.role === "HEAD";

  // KPI grid date-range control (This Month / Last Month / QTD) — a URL search param so
  // it works via a plain server-component re-render, no client state needed.
  const range = parseKpiRange(searchParams.range);
  const rangeLabel = range === "last-month" ? "Last Month" : range === "qtd" ? "QTD" : "This Month";

  const [fx, runway, notifications, game, teamGame, pipeline, pendingRows, gn] = await Promise.all([
    getTodayInrPerEur(),
    isAdmin ? getRunwaySnapshot(range) : Promise.resolve(null),
    computeNotifications(session.role, session.user.id),
    getMyGame(session.user.id),
    isAdmin ? getTeamGame() : Promise.resolve(null),
    // Head gets the same pipeline read Admin does (they now have /pipeline access) —
    // NOT cash/finance data, which stays Admin-only below.
    isAdmin || isHead ? getPipelineSnapshot(range) : Promise.resolve(null),
    isAdmin ? getPendingRows() : Promise.resolve(null),
    // Head oversees the LMS read-only (getGnAccess `isViewer`), so both roles get the tile.
    isAdmin || isHead ? getGnHomeSnapshot() : Promise.resolve(null),
  ]);

  const months = runway?.runwayMonths ?? null;

  // Overdue receivables — money already earned that hasn't arrived (Admin only).
  const overdueRows = (pendingRows ?? []).filter(
    (p) => p.status === "ACTIVE" && p.overdue && p.balance.inr > 0,
  );
  const overdueInr = overdueRows.reduce((a, p) => a + p.balance.inr, 0);
  const oldestOverdueDays = overdueRows.reduce((a, p) => Math.max(a, p.daysOverdue), 0);
  const firstName = session.user.name.split(" ")[0];

  // Pipeline value / Wins — shared between Admin's momentum grid and Head's pipeline
  // section (Head now has /pipeline access). Never shown to User.
  const pipelineValueCard = pipeline && (
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
  );
  const pipelineWinsCard = pipeline && (
    <MetricCard
      label={range === "this-month" ? "Wins this month" : `Wins · ${rangeLabel}`}
      value={String(pipeline.winsThisMonth)}
      secondary={
        pipeline.completedThisMonth > 0
          ? `${formatPct(pipeline.closePct)} close rate · typical month ≈ 4 wins`
          : "typical month ≈ 4 wins (2026 avg)"
      }
      tooltip="Deals moved to Won in the selected range, with the close rate from completed discovery calls. The 2026 sheets average ~4 wins a month — the honest yardstick."
      icon={<Medal size={18} />}
      href="/pipeline"
    />
  );

  // Arena tile — my level + rank (Head/User) or the weekly champion (Admin).
  const arenaMeCard = game && (
    <MetricCard
      label="Arena"
      value={`Lv ${game.me.level.level} · ${game.me.level.title}`}
      secondary={`#${game.me.rankWeek} this week · ${game.me.xpTotal.toLocaleString("en-IN")} XP · 🔥 ${game.me.streak}d`}
      icon={<Trophy size={18} />}
      href="/arena"
    />
  );
  const dailyLogCard = (
    <MetricCard
      label="Your daily log"
      value="Log today"
      secondary="Add your numbers for today"
      icon={<ClipboardList size={18} />}
      href="/daily-log"
    />
  );

  // German Note tile — Admin and Head only. Tutors/students are redirected to
  // /german-note above and never see this page.
  const germanNoteCard = gn && (
    <MetricCard
      label="German Note"
      value={`${gn.activeBatches} active batch${gn.activeBatches === 1 ? "" : "es"}`}
      secondary={
        gn.nextEvent
          ? `Next: ${gn.nextEvent.title} · ${gn.nextEvent.batch.name} · ${formatDate(gn.nextEvent.startsAt)}`
          : gn.learners > 0
            ? `${gn.learners} learner${gn.learners === 1 ? "" : "s"} · nothing scheduled`
            : "No learners enrolled yet"
      }
      tooltip="Live German Note batches, with the next scheduled class across all of them. Archived batches are excluded — their recordings stay available to students for lifetime."
      icon={<Languages size={18} />}
      href="/german-note"
    />
  );

  return (
    <div className="w-full space-y-8">
      <OnboardingWalkthrough
        userId={session.user.id}
        role={session.role}
        firstName={firstName}
        initialOpen={searchParams.onboarding === "1"}
      />
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName}`}
        subtitle={`Here is where things stand — ${formatDate(istToday())}.`}
        actions={(isAdmin || isHead) && <KpiRangeSwitch active={range} />}
      />

      {/* 1 — Actionable first: everything that needs a decision, lifted to the top. */}
      <NeedsAttention notifications={notifications} showWins={!isAdmin} />

      {isAdmin ? (
        <>
          {/* 2 — Money: the pace-to-target question that leads the day. */}
          <section className="space-y-4">
            <SectionHeading
              icon={<Wallet size={18} />}
              title="This month"
              description="Collections against target, and where the rest comes from"
              action={<ViewAll href="/finance">View finance</ViewAll>}
            />
            <MonthHero />
          </section>

          {/* 3 — Momentum: deals in motion and what they're worth. */}
          <section className="space-y-4">
            <SectionHeading
              icon={<Waypoints size={18} />}
              title="Pipeline momentum"
              description="This week's motion and the value of what's open"
              action={<ViewAll href="/pipeline">View pipeline</ViewAll>}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <WeekMomentum />
              {pipelineValueCard}
              {pipelineWinsCard}
            </div>
          </section>

          {/* 4 — At a glance: the standing figures you scan, not act on. */}
          <section className="space-y-4">
            <SectionHeading
              icon={<Gauge size={18} />}
              title="At a glance"
              description="Cash, receivables and today's rate"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <MetricCard
                label="Live FX (ECB)"
                value={`₹${fx.rate.toFixed(2)}`}
                secondary={`per €1 · ${formatDate(fx.date)}${fx.stale ? " · cached" : ""}`}
                icon={<IndianRupee size={18} />}
                href="/finance"
              />
              {teamGame && teamGame.players.length > 0 && (
                <MetricCard
                  label="Arena — weekly leader"
                  value={teamGame.players[0].name.split(" ")[0]}
                  secondary={`${teamGame.players[0].xpWeek.toLocaleString("en-IN")} XP this week · Lv ${teamGame.players[0].level.level}`}
                  icon={<Trophy size={18} />}
                  href="/arena"
                />
              )}
              {germanNoteCard}
            </div>
          </section>

          {/* 5 — Recent wins: the celebratory timeline (renders only when there's news). */}
          <RecentWins />
        </>
      ) : isHead ? (
        <>
          <section className="space-y-4">
            <SectionHeading
              icon={<Waypoints size={18} />}
              title="Your pipeline"
              description="Open deals and wins for the selected range"
              action={<ViewAll href="/pipeline">View pipeline</ViewAll>}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {pipelineValueCard}
              {pipelineWinsCard}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading icon={<LayoutGrid size={18} />} title="At a glance" description="Your day and standings" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dailyLogCard}
              <MetricCard
                label="Students"
                value="Open board"
                secondary="Journeys, signals and check-ins"
                icon={<GraduationCap size={18} />}
                href="/students"
              />
              {germanNoteCard}
              {arenaMeCard}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="space-y-4">
            <SectionHeading
              icon={<Timer size={18} />}
              title="Your day"
              description="Time tracked automatically while you work"
            />
            <WorkTracker />
          </section>

          <section className="space-y-4">
            <SectionHeading icon={<LayoutGrid size={18} />} title="At a glance" description="Today's task and your standing" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dailyLogCard}
              {arenaMeCard}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
