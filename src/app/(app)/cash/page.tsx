import { Gauge, Banknote, Clock, CreditCard } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { Tabs } from "@/components/ui/Tabs";
import { istToday, toDateInputValue } from "@/lib/dates";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { signalForRunway } from "@/lib/signals";
import { requireSection } from "@/lib/rbac";
import { getCashOverview } from "@/server/cash-metrics";
import { CashChart } from "./_components/CashChart";
import { CashPositionSection, GrowthOverrideForm, PayablesSection } from "./_components/CashClient";

export const dynamic = "force-dynamic";

export default async function CashPage() {
  await requireSection("cash"); // Admin-only (PRD3 §2)
  const data = await getCashOverview();
  const { runway, receivables } = data;
  const today = toDateInputValue(istToday());
  const runwayLevel = runway.runwayMonths === null ? null : signalForRunway(runway.runwayMonths);

  // runway gauge geometry (ring fills toward a 12-month horizon)
  const gaugeR = 72;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeFrac = runway.runwayMonths === null ? 0 : Math.min(1, runway.runwayMonths / 12);
  const gaugeColor = runwayLevel
    ? `var(--${runwayLevel})`
    : "var(--muted)";

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Cash Health</h1>
        <p className="mt-1 text-sm text-muted">
          Not transactions - survival. If no new money came in from today, how long does the
          business keep running?
        </p>
      </div>

      {/* Runway - THE number, as a gauge (PRD3 §4.4) */}
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          {/* gauge */}
          <div className="relative grid flex-none place-items-center">
            <svg width={180} height={180} viewBox="0 0 180 180" className="-rotate-90">
              <circle cx="90" cy="90" r={gaugeR} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
              <circle
                cx="90"
                cy="90"
                r={gaugeR}
                fill="none"
                stroke={gaugeColor}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={gaugeC}
                strokeDashoffset={gaugeC * (1 - gaugeFrac)}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="font-display text-4xl font-bold tracking-tight" style={{ color: gaugeColor }}>
                {runway.runwayMonths === null ? "-" : runway.runwayMonths}
              </span>
              <span className="text-xs font-medium text-muted">months runway</span>
            </div>
          </div>

          {/* summary */}
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted sm:justify-start">
              <Gauge size={15} /> Cash runway
            </p>
            <p className="mt-2 text-sm text-muted">
              {runway.cashInr === null
                ? "Enter a weekly bank balance to compute runway."
                : `Cash ${formatInrMinor(runway.cashInr, { compact: true })} ÷ burn ${formatInrMinor(runway.burnInr, { compact: true })}/mo (avg last 3 months of expenses)`}
            </p>
            {runwayLevel && (
              <div className="mt-3 flex justify-center sm:justify-start">
                <SignalBadge
                  level={runwayLevel}
                  label={
                    runwayLevel === "ok" ? "Safe - focus on growth"
                    : runwayLevel === "watch" ? "Monitor closely - reduce non-essential spend"
                    : "Urgent - increase revenue or cut costs now"
                  }
                />
              </div>
            )}
            <p className="mt-2 text-xs text-muted">Green ≥ 6 mo · Amber 3-6 mo · Red &lt; 3 mo</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted">Break-even revenue / month</p>
            <p className="font-display text-lg font-semibold tnum">{formatInrMinor(data.monthlyFixedInr, { compact: true })}</p>
          </div>
          <div>
            <p className="text-muted">This month vs break-even</p>
            <p className={`font-display text-lg font-semibold tnum ${data.revenueVsBreakEvenInr >= 0 ? "text-ok" : "text-risk"}`}>
              {data.revenueVsBreakEvenInr >= 0 ? "+" : ""}
              {formatInrMinor(data.revenueVsBreakEvenInr, { compact: true })}
            </p>
          </div>
          <div>
            <p className="text-muted">Months to ₹8L / month</p>
            <p className="font-display text-lg font-semibold tnum">
              {data.growth.monthsToTarget === null ? "-" : data.growth.monthsToTarget === 0 ? "Reached" : data.growth.monthsToTarget}
            </p>
            <p className="text-xs text-muted">
              growth {data.growth.effectiveGrowthPct === null ? "unknown" : formatPct(data.growth.effectiveGrowthPct)}
              {data.growth.growthOverridePct !== null ? " (override)" : " (auto)"}
            </p>
          </div>
          <div className="flex items-end">
            <GrowthOverrideForm overridePct={data.growth.growthOverridePct} />
          </div>
        </div>
      </div>

      {/* Summary card - four numbers before anything else (PRD3 §4.5) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Cash in bank right now"
          value={runway.cashInr === null ? "-" : formatInrMinor(runway.cashInr, { compact: true })}
          secondary={runway.cashDate ? `entered ${formatDate(runway.cashDate)}${runway.cashStale ? " · ⚠ stale" : ""}` : "no entry yet"}
          signal={runway.cashStale ? "watch" : undefined}
          icon={<Banknote size={18} />}
        />
        <MetricCard
          label="Total receivables"
          value={formatInrMinor(receivables.totalInr, { compact: true })}
          secondary={`${receivables.countWithBalance} student(s) with balance`}
          icon={<Clock size={18} />}
        />
        <MetricCard
          label="Payables due this month"
          value={formatInrMinor(data.dueThisMonthInr, { compact: true })}
          secondary="already committed"
          icon={<CreditCard size={18} />}
        />
        <MetricCard
          label="Runway"
          value={runway.runwayMonths === null ? "-" : `${runway.runwayMonths} mo`}
          signal={runwayLevel ?? undefined}
          icon={<Gauge size={18} />}
        />
      </div>

      <Tabs
        tabs={[
          {
            label: "Cash position",
            content: (
              <div className="space-y-4">
                <div className="rounded-card border border-line bg-surface p-5 shadow-card">
                  <h3 className="mb-2 font-display text-lg font-semibold">Bank balance - last 12 weeks</h3>
                  <CashChart points={data.chart} />
                </div>
                <CashPositionSection positions={data.positions} today={today} stale={runway.cashStale} />
              </div>
            ),
          },
          {
            label: `Receivables${receivables.oldestOverdue && receivables.oldestOverdue.daysOverdue > 14 ? " ⚠" : ""}`,
            content: (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <MetricCard label="Total receivables" value={formatInrMinor(receivables.totalInr, { compact: true })} />
                  <MetricCard
                    label="Overdue"
                    value={formatInrMinor(receivables.overdueInr, { compact: true })}
                    signal={receivables.overdueInr > 0 ? "risk" : undefined}
                  />
                  <MetricCard label="Expected in next 30 days" value={formatInrMinor(receivables.next30Inr, { compact: true })} />
                  <MetricCard
                    label="Oldest overdue"
                    value={
                      receivables.oldestOverdue ? (
                        <span className="text-2xl">{receivables.oldestOverdue.name}</span>
                      ) : ("-")
                    }
                    secondary={receivables.oldestOverdue ? `${receivables.oldestOverdue.daysOverdue} days overdue` : "none"}
                    signal={receivables.oldestOverdue && receivables.oldestOverdue.daysOverdue > 14 ? "risk" : undefined}
                  />
                </div>
                <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2">
                      <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                        <th className="px-4 py-2.5 font-medium">Student</th>
                        <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                        <th className="px-4 py-2.5 font-medium">Next due</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receivables.rows.map((r) => (
                        <tr key={r.id} className={`border-b border-line last:border-b-0 ${r.overdue ? "bg-risk-soft" : ""}`}>
                          <td className="px-4 py-2.5">{r.studentName}</td>
                          <td className="tnum px-4 py-2.5 text-right">{formatInrMinor(r.balanceInr)}</td>
                          <td className="tnum px-4 py-2.5">{r.nextDueDate ? formatDate(r.nextDueDate) : "-"}</td>
                          <td className="px-4 py-2.5">{r.overdue ? `Overdue ${r.daysOverdue}d` : "On schedule"}</td>
                        </tr>
                      ))}
                      {receivables.rows.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No pending balances 🎉</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">
                  Auto-pulled from Finance → Pending Payments. Update there; this view follows.
                </p>
              </div>
            ),
          },
          { label: "Payables", content: <PayablesSection payables={data.payables} /> },
        ]}
      />
    </div>
  );
}
