import { redirect } from "next/navigation";
import {
  BellRing, ClipboardList, Gauge, GraduationCap, IndianRupee, Medal, ReceiptText, Trophy, Waypoints,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/kit";
import { OnboardingWalkthrough } from "@/components/onboarding/OnboardingWalkthrough";
import { WorkTracker } from "./_components/WorkTracker";
import { FounderPulse } from "./_components/FounderPulse";
import { KpiRangeSwitch } from "./_components/KpiRangeSwitch";
import { getTodayInrPerEur } from "@/lib/fx";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { signalForRunway } from "@/lib/signals";
import { parseKpiRange } from "@/lib/dates";
import { requireSession } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";
import { getMyGame, getTeamGame } from "@/server/gamification";
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

  const [fx, runway, notifications, game, teamGame, pipeline, pendingRows] = await Promise.all([
    getTodayInrPerEur(),
    isAdmin ? getRunwaySnapshot(range) : Promise.resolve(null),
    computeNotifications(session.role, session.user.id),
    getMyGame(session.user.id),
    isAdmin ? getTeamGame() : Promise.resolve(null),
    // Head gets the same pipeline read Admin does (they now have /pipeline access) —
    // NOT cash/finance data, which stays Admin-only below.
    isAdmin || isHead ? getPipelineSnapshot(range) : Promise.resolve(null),
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

  // Pipeline value / Wins — shared between Admin's "At a glance" grid and Head's home
  // hero (Head now has /pipeline access; hiding this on the dashboard while allowing it
  // on /pipeline itself would be inconsistent). Never shown to User.
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

  return (
    <div className="w-full space-y-8">
      <OnboardingWalkthrough
        userId={session.user.id}
        role={session.role}
        firstName={session.user.name.split(" ")[0]}
        initialOpen={searchParams.onboarding === "1"}
      />
      <PageHeader
        eyebrow="Primary"
        title={`Welcome back, ${session.user.name.split(" ")[0]}`}
        subtitle="Here is where things stand today."
      />

      {/* Admin sees business outcomes (pace + motion + alerts); Head sees the pipeline
          numbers their new /pipeline access already grants — never Cash/Finance; everyone
          else keeps the personal work-time tracker for their own day. */}
      {isAdmin ? (
        <FounderPulse notifications={notifications} />
      ) : isHead ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pipelineValueCard}
          {pipelineWinsCard}
        </div>
      ) : (
        <WorkTracker />
      )}

      {/* At a glance: live, clickable KPIs */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-h2 font-semibold">At a glance</h2>
          {/* Date-range control only matters where a figure below is actually range-scoped
              (Admin's runway/pipeline cards, Head's hero above) — User's tiles never change
              with it, so it stays hidden for User rather than offering a control that does
              nothing. */}
          {(isAdmin || isHead) && <KpiRangeSwitch active={range} />}
        </div>
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

          {isAdmin && pipelineValueCard}

          {isAdmin && pipelineWinsCard}

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

          {/* Head and User lead with the log: it is the only thing either role must
              do every day (§6.3 badges a missing log at 19:00 IST), so it takes the
              first slot rather than sitting third. */}
          {!isAdmin && (
            <MetricCard
              label="Your daily log"
              value="Log today"
              secondary="Add your numbers for today"
              icon={<ClipboardList size={18} />}
              href="/daily-log"
            />
          )}

          {/* FX is a finance tile, so it is Admin-only: §2.1 gives Head a home with
              "no finance tiles" and User no finance at all. Neither can act on a
              EUR rate, and for them it had no href either — a dead tile in the
              grid's first slot. */}
          {isAdmin && (
            <MetricCard
              label="Live FX (ECB)"
              value={`₹${fx.rate.toFixed(2)}`}
              secondary={`per €1 · ${formatDate(fx.date)}${fx.stale ? " · cached" : ""}`}
              icon={<IndianRupee size={18} />}
              href="/finance"
            />
          )}

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
