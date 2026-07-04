import {
  UserPlus,
  PhoneCall,
  PhoneOff,
  Percent,
  Award,
  TrendingUp,
  Trophy,
  Phone,
  AlertTriangle,
  Workflow,
  BarChart3,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Columns } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/Tabs";
import { istToday, toDateInputValue } from "@/lib/dates";
import { formatInrMinor, formatPct } from "@/lib/format";
import { requireSection } from "@/lib/rbac";
import { getPipelineOverview } from "@/server/pipeline-metrics";
import { getFirstCallSplit } from "@/server/assignment";
import { LeadSection } from "./_components/LeadSection";
import { OutcomeSection } from "./_components/OutcomeSection";
import { StageChart } from "./_components/StageChart";
import { TargetBar } from "./_components/TargetBar";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await requireSection("pipeline");
  const isAdmin = session.role === "ADMIN";
  const { metrics, target, leads, outcomes, leadOptions, assignees, callFirst, riskDeals } =
    await getPipelineOverview(session.user.id, isAdmin);
  const callSplit = isAdmin ? await getFirstCallSplit() : null;
  const today = toDateInputValue(istToday());

  const conv = metrics.conversionsByLevel;
  const wonCount = conv.SOLO + conv.GUIDED + conv.ELITE;

  // Lead flow, one column per day for the last 7 days (+ delta vs the 7 before)
  const t = istToday();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const countOn = (k: string) => leads.filter((l) => l.dateIn.slice(0, 10) === k).length;
  const dayItems = Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(t);
    d.setUTCDate(t.getUTCDate() - (6 - idx));
    const count = countOn(dayKey(d));
    return {
      label: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d),
      value: count,
      display: String(count),
    };
  });
  const last7 = dayItems.reduce((s, i) => s + i.value, 0);
  let prior7 = 0;
  for (let i = 13; i >= 7; i--) {
    const d = new Date(t);
    d.setUTCDate(t.getUTCDate() - i);
    prior7 += countOn(dayKey(d));
  }
  const weekDeltaPct = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;

  // close-rate gauge (ring fills with close rate; centre = won count)
  const gaugeR = 62;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeFrac = Math.max(0, Math.min(1, metrics.closePct / 100));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header strip - title left, reporting period right */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <Workflow size={20} />
          </span>
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Pipeline</h1>
            <p className="text-xs text-muted">
              {isAdmin
                ? "Every lead from first contact to paid student - this month, auto-calculated."
                : "Enter leads and discovery call outcomes. You see only your own entries."}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted">
          This month
        </span>
      </div>

      {isAdmin && (
        <>
          <TargetBar
            month={target.month}
            targetInrMinor={target.targetInrMinor}
            revenueInrMinor={target.revenueInrMinor}
            pct={target.pct}
            isAdmin
          />

          {/* Hero bento - value cards, completion progress, close-rate gauge */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4">
              <div className="flex-1 rounded-card p-5 shadow-card" style={{ background: "var(--ink)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-white/70">Pipeline value</p>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white">
                    <TrendingUp size={11} className="mr-1 inline" />
                    {formatInrMinor(metrics.forecast30Inr, { compact: true })} 30-day forecast
                  </span>
                </div>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
                  {formatInrMinor(metrics.pipelineValueInr, { compact: true })}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {metrics.avgFeeKnown ? "Open leads × avg program fee" : "Needs income history to learn avg fee"}
                </p>
              </div>
              <div className="flex-1 rounded-card border border-line bg-surface p-5 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-muted">Leads this month</p>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                    +{metrics.leadsThisWeek} this week
                  </span>
                </div>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight">{metrics.leadsThisMonth}</p>
                <p className="mt-1 text-xs text-muted">First contact to closed, all sources</p>
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                <PhoneCall size={18} className="text-accent" /> Calls completed
              </h3>
              <p className="mt-4 font-display text-4xl font-bold tracking-tight">
                {metrics.completed}
                <span className="ml-2 align-middle text-sm font-medium text-muted">of {metrics.booked} booked</span>
              </p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${metrics.booked > 0 ? Math.min(100, (metrics.completed / metrics.booked) * 100) : 0}%`,
                    background: "linear-gradient(90deg, var(--chart-1), var(--chart-4))",
                  }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>Show-up rate {formatPct(metrics.showUpPct)}</span>
                <span>No-show {formatPct(metrics.noShowPct)}</span>
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                <Trophy size={18} className="text-accent" /> Won this month
              </h3>
              <div className="mt-2 flex flex-col items-center">
                <div className="relative grid place-items-center">
                  <svg width={156} height={156} viewBox="0 0 156 156" className="-rotate-90">
                    <circle cx="78" cy="78" r={gaugeR} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
                    <circle
                      cx="78"
                      cy="78"
                      r={gaugeR}
                      fill="none"
                      stroke="var(--ok)"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={gaugeC}
                      strokeDashoffset={gaugeC * (1 - gaugeFrac)}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="font-display text-4xl font-bold tracking-tight">{wonCount}</span>
                    <span className="text-xs font-medium text-muted">new students</span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Close rate {formatPct(metrics.closePct)} · Solo {conv.SOLO} · Guided {conv.GUIDED} · Elite {conv.ELITE}
                </p>
              </div>
            </div>
          </div>

          {/* Lead flow by day + hottest leads */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <BarChart3 size={18} className="text-accent" /> New leads - last 7 days
                </h3>
                {weekDeltaPct !== null && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{
                      background: weekDeltaPct >= 0 ? "var(--ok-soft)" : "var(--risk-soft)",
                      color: weekDeltaPct >= 0 ? "var(--ok)" : "var(--risk)",
                    }}
                  >
                    {weekDeltaPct >= 0 ? "+" : ""}
                    {weekDeltaPct}% vs prior week
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">{last7} lead(s) in the last 7 days.</p>
              <div className="mt-5">
                <Columns items={dayItems} height={150} />
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                <Phone size={18} className="text-accent" /> Call these first
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Ranked by BANT, qualification, stage and freshness - the hottest open leads.
              </p>
              <ol className="mt-3 space-y-2">
                {callFirst.map((l, i) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
                    <span className="font-display font-semibold text-muted">{i + 1}.</span>
                    <span className="font-semibold">{l.name}</span>
                    <span className="tnum text-xs text-muted">{l.phone}</span>
                    <span className="ml-auto flex flex-wrap gap-1">
                      {l.reasons.map((r) => (
                        <span key={r} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                          {r}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
                {callFirst.length === 0 && <p className="text-sm text-muted">No open leads to rank.</p>}
              </ol>
            </div>
          </div>

          {/* Live funnel + deal risk */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <StageChart leads={leads} />
            </div>
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                <AlertTriangle size={18} className="text-risk" /> Deals at risk
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Ghosted, stalled or aging - recover these before they die in the follow-up gap.
              </p>
              <ul className="mt-3 space-y-2">
                {riskDeals.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-field px-3 py-2 text-sm" style={{ background: "var(--risk-soft)" }}>
                    <span className="font-semibold">{l.name}</span>
                    <span className="tnum text-xs text-muted">{l.phone}</span>
                    <span className="ml-auto text-xs font-medium text-risk">{l.risk}</span>
                  </li>
                ))}
                {riskDeals.length === 0 && <p className="text-sm text-muted">Nothing at risk right now. 🌿</p>}
              </ul>
            </div>
          </div>

          {/* Remaining KPIs not already on a bento card */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Leads this week" value={metrics.leadsThisWeek} icon={<UserPlus size={18} />} />
            <MetricCard label="Calls booked" value={metrics.booked} icon={<PhoneCall size={18} />} />
            <MetricCard
              label="Show-up rate"
              value={formatPct(metrics.showUpPct)}
              secondary="Completed ÷ booked"
              progress={metrics.showUpPct / 100}
              icon={<Percent size={18} />}
              signal={metrics.booked === 0 ? undefined : metrics.showUpPct >= 80 ? "ok" : metrics.showUpPct >= 50 ? "watch" : "risk"}
            />
            <MetricCard
              label="No-show rate"
              value={formatPct(metrics.noShowPct)}
              secondary="No shows ÷ booked"
              progress={metrics.noShowPct / 100}
              icon={<PhoneOff size={18} />}
              signal={metrics.booked === 0 ? undefined : metrics.noShowPct <= 20 ? "ok" : metrics.noShowPct <= 40 ? "watch" : "risk"}
            />
            <MetricCard
              label="Highly qualified rate"
              value={formatPct(metrics.hqPct)}
              secondary="HQ calls ÷ completed"
              progress={metrics.hqPct / 100}
              icon={<Award size={18} />}
            />
            <MetricCard
              label="Conversions by level"
              value={
                <span className="text-2xl">
                  {conv.SOLO} · {conv.GUIDED} · {conv.ELITE}
                </span>
              }
              secondary="Won this month: Solo · Guided · Elite"
              icon={<Trophy size={18} />}
            />
          </div>

          {/* First-call split - target vs actual per the assignment rules (client notes) */}
          {callSplit && (
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <PhoneCall size={18} className="text-accent" /> First-call split - last {callSplit.lookbackDays} days
                </h3>
                {callSplit.isSaturday && callSplit.members.some((m) => m.offToday) && (
                  <span className="rounded-full bg-watch-soft px-2 py-0.5 text-[11px] font-semibold text-watch">
                    Saturday - {callSplit.members.filter((m) => m.offToday).map((m) => m.name).join(", ")} off today
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                New leads are auto-assigned toward each person&apos;s target share; reassign any lead below.
                Configure shares on People → team profiles.
              </p>
              {callSplit.members.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  No one is in the first-call rotation yet - set a &quot;First-call share %&quot; on a team profile.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {callSplit.members.map((m) => (
                    <div key={m.userId} className="flex items-center gap-3">
                      <span className="w-24 flex-none truncate text-sm font-medium sm:w-32">{m.name}</span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, m.actualPct)}%`, background: "var(--accent)" }}
                        />
                        <span
                          aria-hidden
                          title={`Target ${m.sharePct}%`}
                          className="absolute top-[-2px] h-4 w-0.5 rounded bg-ink/50"
                          style={{ left: `${Math.min(100, m.sharePct)}%` }}
                        />
                      </div>
                      <span className="w-40 flex-none text-right text-xs text-muted tnum">
                        {Math.round(m.actualPct)}% actual · {m.sharePct}% target · {m.assigned30d} lead{m.assigned30d === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Tabs
        tabs={[
          {
            label: "Leads",
            content: <LeadSection rows={leads} today={today} isAdmin={isAdmin} assignees={assignees} />,
          },
          {
            label: "Discovery call outcomes",
            content: (
              <OutcomeSection rows={outcomes} leadOptions={leadOptions} today={today} isAdmin={isAdmin} />
            ),
          },
        ]}
      />
    </div>
  );
}
