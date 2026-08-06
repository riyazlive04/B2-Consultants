import { redirect } from "next/navigation";
import {
  ClipboardList, Gauge, GraduationCap, IndianRupee, Languages, LayoutGrid, Medal, ReceiptText,
  Timer, Trophy, Wallet, Waypoints,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { CurrencyToggle, Money } from "@/components/ui/CurrencyToggle";
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
import { getBusinessLineView } from "@/server/business-line-view";
import type { BusinessLineView } from "@/lib/business-line";
import { DashboardSwitcher } from "./_components/DashboardSwitcher";
import { FunnelHealthRow } from "./_components/FunnelHealthRow";
import { getFunnelHealth } from "@/server/funnel-health";
import { HeadCoachStudents } from "./_components/HeadCoachStudents";
import { getHeadCoachSnapshot } from "@/server/head-coach-snapshot";
import { GermanNoteDashboard } from "./_components/GermanNoteDashboard";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getPendingRows } from "@/server/finance-metrics";
import { getPipelineSnapshot } from "@/server/pipeline-metrics";
import { getMyGame, getTeamGame } from "@/server/gamification";
import { getGnHomeSnapshot } from "@/server/german-note-metrics";
import { computeNotifications } from "@/server/notifications";
import { getMyWorkTime, istWeekKeys } from "@/server/work-time";

export const dynamic = "force-dynamic";

/**
 * The "This month" money block, for one business line.
 *
 * Rendered once per line so DashboardSwitcher can flip between Combined and B2 with no server
 * round-trip — the two differ only in these figures, and MonthHero's own reads are small
 * (its heavy dependencies are all React-cached and therefore shared between the two).
 */
function MoneySection({ line }: { line: BusinessLineView }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Wallet size={18} />}
        title="This month"
        description="Collections against target, and where the rest comes from"
        action={<ViewAll href="/finance">View finance</ViewAll>}
      />
      <MonthHero line={line} />
    </section>
  );
}

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
  // Sticky across navigation (Error Log E1/E4). Only the money section reads it — pipeline,
  // arena and the German Note tile are not segmented figures.
  const line = await getBusinessLineView();
  const rangeLabel = range === "last-month" ? "Last Month" : range === "qtd" ? "QTD" : "This Month";

  const [fx, runway, notifications, game, teamGame, pipeline, pendingRows, gn, funnelHealth, headCoach] = await Promise.all([
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
    // Row 5 (spec §4). Admin only — §3 gives the funnel to Owner/Admin, and it carries
    // stage-by-stage conversion the telecaller tiers are not meant to see across the whole team.
    isAdmin ? getFunnelHealth() : Promise.resolve(null),
    // Head Coach dashboard (spec §5). Carries no money — §5 forbids it and §3 keeps Finance
    // away from the head.
    isHead ? getHeadCoachSnapshot() : Promise.resolve(null),
  ]);

  // Day-wise work time (WorkDay). Accrual itself happens app-wide in the layout's
  // headless tracker; this is just the history the widget renders from.
  const workTime = await getMyWorkTime(session.user.id);

  const months = runway?.runwayMonths ?? null;
  const cashOnHandInr = runway?.cashInr ?? null;
  const avgBurnInr = runway?.burnInr ?? 0;
  const cashAsOf = runway?.cashDate ?? null;

  /**
   * Pipeline value is priced from an INR average fee (and a rupee founder fallback), so it has no
   * stored EUR counterpart. Pair it at today's rate so the card still follows the ₹/€ toggle —
   * it is an estimate of future revenue either way, not a recorded amount.
   */
  const inrOnly = (inr: number) => ({ inr, eur: Number(fx.rate) > 0 ? inr / Number(fx.rate) : 0 });

  // Overdue receivables — money already earned that hasn't arrived (Admin only).
  const overdueRows = (pendingRows ?? []).filter(
    (p) => p.status === "ACTIVE" && p.overdue && p.balance.inr > 0,
  );
  // Both aggregates: this card follows the ₹/€ toggle, and every receivable already carries
  // its EUR figure from its own stamped rate — so nothing is converted at read time.
  const overdue = overdueRows.reduce(
    (a, p) => ({ inr: a.inr + p.balance.inr, eur: a.eur + p.balance.eur }),
    { inr: 0, eur: 0 },
  );
  const oldestOverdueDays = overdueRows.reduce((a, p) => Math.max(a, p.daysOverdue), 0);
  const firstName = session.user.name.split(" ")[0];

  // Pipeline value / Wins — shared between Admin's momentum grid and Head's pipeline
  // section (Head now has /pipeline access). Never shown to User.
  const pipelineValueCard = pipeline && (
    <MetricCard
      label="Pipeline value"
      value={
        pipeline.avgFeeKnown
          ? <Money amount={inrOnly(pipeline.pipelineValueInr)} />
          : `${pipeline.interestedLeads} deals`
      }
      secondary={
        !pipeline.avgFeeKnown
          ? "No income history yet to price open deals"
          : pipeline.forecast30Inr > 0
            ? <>
                {pipeline.interestedLeads} open deal{pipeline.interestedLeads === 1 ? "" : "s"} ·{" "}
                <Money amount={inrOnly(pipeline.forecast30Inr)} /> expected in 30d
              </>
            : `${pipeline.interestedLeads} open deal${pipeline.interestedLeads === 1 ? "" : "s"} · no closes yet to forecast from`
      }
      tooltip="Open deals in strategy-call → deposit stages × the average program fee from real income history. The 30-day forecast applies this month's close rate. This is next month's revenue — before it happens."
      icon={<Waypoints size={18} />}
      href="/pipeline"
      detail={{
        rows: [
          ...pipeline.byStage.map((s) => ({ label: s.label, value: s.count })),
          ...(pipeline.avgFeeKnown
            ? [{ label: "Avg. program fee used", value: <Money amount={inrOnly(pipeline.avgFeeInr)} /> }]
            : []),
        ],
      }}
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
      detail={{
        rows: [
          { label: "Solo", value: pipeline.winsByLevel.SOLO },
          { label: "Guided", value: pipeline.winsByLevel.GUIDED },
          { label: "Elite", value: pipeline.winsByLevel.ELITE },
          ...(pipeline.winsByLevel.OTHER > 0 ? [{ label: "Other", value: pipeline.winsByLevel.OTHER }] : []),
          { label: "Completed discovery calls", value: pipeline.completedThisMonth },
        ],
      }}
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
      detail={{
        rows: [
          { label: "XP this week", value: game.me.xpWeek.toLocaleString("en-IN") },
          { label: "XP this month", value: game.me.xpMonth.toLocaleString("en-IN") },
          { label: "Rank this month", value: `#${game.me.rankMonth}` },
          { label: "Rank all-time", value: `#${game.me.rankAll}` },
          { label: "Badges unlocked", value: game.me.unlockedCount },
        ],
      }}
    />
  );
  const dailyLogCard = (
    <MetricCard
      label="Your daily log"
      value="Log today"
      secondary="Add your numbers for today"
      icon={<ClipboardList size={18} />}
      href="/daily-log"
      detail={
        game
          ? {
              rows: [
                { label: "Logged today", value: game.me.loggedToday ? "Yes" : "Not yet" },
                { label: "Current streak", value: `${game.me.streak}d` },
                { label: "XP this week", value: game.me.xpWeek.toLocaleString("en-IN") },
              ],
            }
          : undefined
      }
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
      detail={{
        rows: [
          { label: "Active batches", value: gn.activeBatches },
          { label: "Learners enrolled", value: gn.learners },
          ...(gn.nextEvent
            ? [{
                label: "Next class",
                value: `${gn.nextEvent.title} · ${gn.nextEvent.batch.name} · ${formatDate(gn.nextEvent.startsAt)}`,
              }]
            : []),
        ],
      }}
    />
  );

  return (
    /* The ₹/€ provider lives in the (app) layout — one instance for the whole shell, so the
       toggle here and the notification bell above it are never on different currencies. */
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
        actions={
          (isAdmin || isHead) && (
            <div className="flex flex-wrap items-center gap-3">
              <KpiRangeSwitch active={range} />
              {/* Same preference as Finance (one storage key), so the currency you picked there
                  is the currency this page opens in. */}
              {isAdmin && <CurrencyToggle label={false} />}
            </div>
          )
        }
      />

      {/* 1 — Actionable first: everything that needs a decision, lifted to the top. */}
      <NeedsAttention notifications={notifications} showWins={!isAdmin} />

      {isAdmin ? (
        <>
          {/* 2 — The business switch (Error Log E1/E3/E4). All three views are built here, on
              the server, and DashboardSwitcher shows one — so changing business is instant
              rather than a round-trip. The choice persists in a cookie. */}
          <DashboardSwitcher
            initial={line}
            combined={<MoneySection line="ALL" />}
            b2={<MoneySection line="B2" />}
            germanNote={<GermanNoteDashboard />}
            shared={
              <>
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
                detail={{
                  rows: [
                    {
                      label: "Cash on hand",
                      value: cashOnHandInr != null ? <Money amount={inrOnly(cashOnHandInr)} /> : "Not recorded",
                    },
                    { label: "Avg. monthly burn", value: <Money amount={inrOnly(avgBurnInr)} /> },
                    { label: "As of", value: cashAsOf ? formatDate(cashAsOf) : "—" },
                  ],
                }}
              />
              <MetricCard
                label="Overdue receivables"
                value={overdueRows.length === 0 ? "None" : <Money amount={overdue} />}
                signal={overdueRows.length === 0 ? "ok" : "risk"}
                secondary={
                  overdueRows.length === 0
                    ? "All payments on schedule"
                    : `${overdueRows.length} payment${overdueRows.length > 1 ? "s" : ""} past due · oldest ${oldestOverdueDays}d`
                }
                tooltip="Money already earned that hasn't arrived. Collecting it costs nothing in ad spend or sales calls — chase this before chasing new leads."
                icon={<ReceiptText size={18} />}
                href="/finance"
                detail={{
                  rows:
                    overdueRows.length === 0
                      ? [{ label: "Status", value: "All payments on schedule" }]
                      : [...overdueRows]
                          .sort((a, b) => b.balance.inr - a.balance.inr)
                          .slice(0, 5)
                          .map((p) => ({
                            label: p.studentName,
                            value: <>{p.daysOverdue}d overdue · <Money amount={p.balance} /></>,
                          })),
                }}
              />
              <MetricCard
                label="Live FX (ECB)"
                value={`₹${fx.rate.toFixed(2)}`}
                secondary={`per €1 · ${formatDate(fx.date)}${fx.stale ? " · cached" : ""}`}
                icon={<IndianRupee size={18} />}
                href="/finance"
                detail={{
                  rows: [
                    { label: "1 EUR", value: `₹${fx.rate.toFixed(2)}` },
                    { label: "1 INR", value: `€${(1 / Number(fx.rate)).toFixed(4)}` },
                    { label: "Source", value: fx.stale ? "Cached (ECB API unavailable)" : "Live (ECB via frankfurter.app)" },
                  ],
                }}
              />
              {teamGame && teamGame.players.length > 0 && (
                <MetricCard
                  label="Arena — weekly leader"
                  value={teamGame.players[0].name.split(" ")[0]}
                  secondary={`${teamGame.players[0].xpWeek.toLocaleString("en-IN")} XP this week · Lv ${teamGame.players[0].level.level}`}
                  icon={<Trophy size={18} />}
                  href="/arena"
                  detail={{
                    rows: teamGame.players.slice(0, 3).map((p, i) => ({
                      label: `#${i + 1} ${p.name}`,
                      value: `${p.xpWeek.toLocaleString("en-IN")} XP`,
                    })),
                  }}
                />
              )}
              {germanNoteCard}
            </div>
          </section>

          {/* 5 — Recent wins: the celebratory timeline (renders only when there's news). */}
          <RecentWins />
              </>
            }
          />

          {/* 6 — Funnel health (spec §4 Row 5). OUTSIDE the switcher on purpose: this is the B2
              outreach funnel, so showing it under the German Note view would attach it to the
              wrong business. */}
          {funnelHealth && <FunnelHealthRow health={funnelHealth} />}
        </>
      ) : isHead ? (
        <>
          {/* Spec §5 opens on "which students need me?" — so that comes before the pipeline,
              which is oversight rather than the head's own work. */}
          {headCoach && <HeadCoachStudents snapshot={headCoach} />}

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
            {/* The static "Students — Open board" tile that sat here is gone: the section above
                now carries real student numbers and names, so keeping it would say the same
                thing twice, worse. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dailyLogCard}
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
            <WorkTracker byDay={workTime.byDay} weekKeys={istWeekKeys()} today={workTime.today} />
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
