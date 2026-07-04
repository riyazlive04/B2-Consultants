import {
  UserPlus,
  CalendarClock,
  PhoneCall,
  PhoneOff,
  Percent,
  Award,
  Wallet,
  TrendingUp,
  Trophy,
  Phone,
  AlertTriangle,
  Workflow,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { istToday, toDateInputValue } from "@/lib/dates";
import { formatInrMinor, formatPct } from "@/lib/format";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { getPipelineOverview } from "@/server/pipeline-metrics";
import { LeadSection } from "./_components/LeadSection";
import { OutcomeSection } from "./_components/OutcomeSection";
import { TargetBar } from "./_components/TargetBar";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await requireSection("pipeline");
  const isAdmin = session.role === "ADMIN";
  const { metrics, target, leads, outcomes, leadOptions, assignees, callFirst, riskDeals } =
    await getPipelineOverview(session.user.id, isAdmin);
  const today = toDateInputValue(istToday());

  const conv = metrics.conversionsByLevel;

  // Live stage distribution: where every lead sits right now (Section B stages).
  const STAGE_ORDER = [
    "NEW_LEAD", "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED",
    "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT", "WON", "LOST", "NO_SHOW",
  ] as const;
  const stageColor = (s: string) =>
    s === "WON" ? "var(--ok)"
    : s === "LOST" || s === "NO_SHOW" ? "var(--risk)"
    : s === "DISCO_NOT_BOOKED" ? "var(--watch)"
    : "var(--accent)";
  const stageCounts = STAGE_ORDER.map((s) => ({
    key: s,
    label: LEAD_STAGE_LABELS[s] ?? s,
    count: leads.filter((l) => l.stage === s).length,
  }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Pipeline</h1>
        <p className="mt-1 text-sm text-muted">
          {isAdmin
            ? "Every lead from first contact to paid student - this month, auto-calculated."
            : "Enter leads and discovery call outcomes. You see only your own entries."}
        </p>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Leads this week" value={metrics.leadsThisWeek} icon={<UserPlus size={18} />} />
            <MetricCard label="Leads this month" value={metrics.leadsThisMonth} icon={<CalendarClock size={18} />} />
            <MetricCard label="Calls booked" value={metrics.booked} icon={<PhoneCall size={18} />} />
            <MetricCard label="Calls completed" value={metrics.completed} icon={<PhoneCall size={18} />} />
            <MetricCard
              label="Show-up rate"
              value={formatPct(metrics.showUpPct)}
              secondary="Completed ÷ booked"
              progress={metrics.showUpPct / 100}
              icon={<Percent size={18} />}
              signal={metrics.booked === 0 ? undefined : metrics.showUpPct >= 80 ? "ok" : metrics.showUpPct >= 50 ? "watch" : "risk"}
            />
            <MetricCard
              label="Close rate"
              value={formatPct(metrics.closePct)}
              secondary="Won ÷ calls completed"
              progress={metrics.closePct / 100}
              icon={<Award size={18} />}
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
              label="Pipeline value"
              value={formatInrMinor(metrics.pipelineValueInr, { compact: true })}
              secondary={
                metrics.avgFeeKnown
                  ? "Open leads × avg program fee"
                  : "Needs income history to learn average program fee"
              }
              icon={<Wallet size={18} />}
            />
            <MetricCard
              label="30-day revenue forecast"
              value={formatInrMinor(metrics.forecast30Inr, { compact: true })}
              secondary="Pipeline value × close rate"
              icon={<TrendingUp size={18} />}
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

          {/* Live pipeline funnel: where every lead sits, first contact to closed */}
          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Workflow size={18} className="text-accent" /> Pipeline by stage
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              Every lead by its current stage - spot where deals pile up or leak.
            </p>
            <div className="mt-4 space-y-2">
              {stageCounts.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-28 flex-none truncate text-xs font-medium text-muted sm:w-44 sm:text-sm">
                    {s.label}
                  </span>
                  <div className="h-6 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="flex h-full items-center justify-end rounded-full px-2 transition-all"
                      style={{ width: `${Math.max(s.count ? 8 : 0, (s.count / maxStage) * 100)}%`, background: stageColor(s.key) }}
                    >
                      {s.count > 0 && <span className="text-[11px] font-bold text-white">{s.count}</span>}
                    </div>
                  </div>
                  <span className="w-6 flex-none text-right text-sm font-semibold tnum">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Prioritisation + deal-risk (report §3.A) - rule-based on live pipeline data */}
      {isAdmin && (callFirst.length > 0 || riskDeals.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
