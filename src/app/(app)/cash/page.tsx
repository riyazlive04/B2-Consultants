import {
  Gauge,
  Banknote,
  Clock,
  CreditCard,
  AlertTriangle,
  CalendarClock,
  BarChart3,
  PieChart,
  LineChart,
  ListOrdered,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { Columns, Donut } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/Tabs";
import { istToday, toDateInputValue } from "@/lib/dates";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { signalForRunway } from "@/lib/signals";
import { requireSection } from "@/lib/rbac";
import { getCashOverview } from "@/server/cash-metrics";
import { CashChart } from "./_components/CashChart";
import { CashPositionSection, GrowthOverrideForm, PayablesSection } from "./_components/CashClient";

export const dynamic = "force-dynamic";

const compact = (v: number) => formatInrMinor(v, { compact: true });

export default async function CashPage() {
  await requireSection("cash"); // Admin-only (PRD3 §2)
  const data = await getCashOverview();
  const { runway, receivables } = data;
  const today = toDateInputValue(istToday());
  const asOf = formatDate(istToday().toISOString());
  const runwayLevel = runway.runwayMonths === null ? null : signalForRunway(runway.runwayMonths);

  // The date the money actually runs out at this burn — a deadline lands harder
  // than "3.1 months". Approximate month = 30.44 days; rounded to the day.
  const cashOutDate =
    runway.runwayMonths === null
      ? null
      : formatDate(new Date(istToday().getTime() + runway.runwayMonths * 30.44 * 86400000).toISOString());

  // runway gauge geometry (ring fills toward a 12-month horizon)
  const gaugeR = 72;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeFrac = runway.runwayMonths === null ? 0 : Math.min(1, runway.runwayMonths / 12);
  const gaugeColor = runwayLevel ? `var(--${runwayLevel})` : "var(--muted)";
  // hero band coloured by the runway signal (green ≥6, amber 3–6, red <3) — soft bg, not a gradient
  const gaugeBand = runwayLevel ? `var(--${runwayLevel}-soft)` : "var(--surface-2)";

  // Receivables age analysis - balance by how late it is
  const inBucket = (lo: number, hi: number) => (r: { overdue: boolean; daysOverdue: number }) =>
    r.overdue && r.daysOverdue >= lo && r.daysOverdue <= hi;
  const bucketSum = (test: (r: (typeof receivables.rows)[number]) => boolean) =>
    receivables.rows.filter(test).reduce((s, r) => s + r.balanceInr, 0);
  const ageItems = [
    { label: "On schedule", value: bucketSum((r) => !r.overdue), color: "var(--ok)" },
    { label: "1-30d late", value: bucketSum(inBucket(1, 30)), color: "var(--chart-1)" },
    { label: "31-60d late", value: bucketSum(inBucket(31, 60)), color: "var(--chart-1)" },
    { label: "61-90d late", value: bucketSum(inBucket(61, 90)), color: "var(--chart-1)" },
    { label: "90d+ late", value: bucketSum(inBucket(91, Infinity)), color: "var(--chart-1)" },
  ].map((b) => ({ ...b, display: compact(b.value) }));

  // Receivables breakup - urgency split (signal colors carry their real meaning here)
  const laterInr = Math.max(0, receivables.totalInr - receivables.overdueInr - receivables.next30Inr);
  const breakupSlices = [
    { label: "Overdue", value: receivables.overdueInr, display: compact(receivables.overdueInr), color: "var(--risk)" },
    { label: "Due in 30 days", value: receivables.next30Inr, display: compact(receivables.next30Inr), color: "var(--watch)" },
    { label: "Scheduled later", value: laterInr, display: compact(laterInr), color: "var(--chart-1)" },
  ];

  // Top receivables by balance (design's "Top 10 customers" table)
  const topRows = [...receivables.rows].sort((a, b) => b.balanceInr - a.balanceInr).slice(0, 10);
  const maxBalance = Math.max(1, ...topRows.map((r) => r.balanceInr));

  const cashSpark = data.chart.map((p) => p.balanceInr);

  const kpiChip = (bg: string, color: string, icon: React.ReactNode) => (
    <span className="grid h-10 w-10 flex-none place-items-center rounded-field" style={{ background: bg, color }}>
      {icon}
    </span>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header strip - title left, as-of date right */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <Gauge size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Cash Health</h1>
            <p className="text-xs text-muted">
              Not transactions - survival. If no new money came in from today, how long does the business keep running?
            </p>
          </div>
        </div>
        <span className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted">
          As of {asOf}
        </span>
      </div>

      {/* KPI strip - five numbers in one band (design ref: icon + value + label) */}
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
          <div className="flex items-center gap-3">
            {kpiChip("var(--accent-soft)", "var(--accent)", <Banknote size={19} />)}
            <div className="min-w-0">
              <p className="font-display text-xl font-bold tracking-tight">
                {runway.cashInr === null ? "-" : compact(runway.cashInr)}
              </p>
              <p className="truncate text-xs text-muted">
                Cash in bank{runway.cashStale ? " · ⚠ stale" : runway.cashDate ? ` · ${formatDate(runway.cashDate)}` : ""}
              </p>
              {cashSpark.length >= 2 && (
                <div className="mt-1 w-24 text-accent">
                  <Sparkline data={cashSpark} stroke="var(--chart-1)" />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {kpiChip("var(--accent-soft)", "var(--accent)", <Clock size={19} />)}
            <div className="min-w-0">
              <p className="font-display text-xl font-bold tracking-tight">{compact(receivables.totalInr)}</p>
              <p className="truncate text-xs text-muted">Receivables · {receivables.countWithBalance} student(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {kpiChip("var(--risk-soft)", "var(--risk)", <AlertTriangle size={19} />)}
            <div className="min-w-0">
              <p className="font-display text-xl font-bold tracking-tight">{compact(receivables.overdueInr)}</p>
              <p className="truncate text-xs text-muted">
                Overdue{receivables.oldestOverdue ? ` · oldest ${receivables.oldestOverdue.daysOverdue}d` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {kpiChip("var(--ok-soft)", "var(--ok)", <CalendarClock size={19} />)}
            <div className="min-w-0">
              <p className="font-display text-xl font-bold tracking-tight">{compact(receivables.next30Inr)}</p>
              <p className="truncate text-xs text-muted">Expected in next 30 days</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {kpiChip("var(--watch-soft)", "var(--watch)", <CreditCard size={19} />)}
            <div className="min-w-0">
              <p className="font-display text-xl font-bold tracking-tight">{compact(data.dueThisMonthInr)}</p>
              <p className="truncate text-xs text-muted">Payables due this month</p>
            </div>
          </div>
        </div>
      </div>

      {/* Runway - THE number, as a gauge (PRD3 §4.4) */}
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div
          className="flex flex-col items-center gap-6 rounded-hero p-5 sm:flex-row sm:items-center sm:gap-8"
          style={{ background: gaugeBand }}
        >
          {/* gauge */}
          <div className="relative grid flex-none place-items-center">
            <svg width={180} height={180} viewBox="0 0 180 180" className="-rotate-90">
              <circle cx="90" cy="90" r={gaugeR} fill="none" stroke="var(--surface)" strokeWidth="14" />
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
                : `Cash ${compact(runway.cashInr)} ÷ burn ${compact(runway.burnInr)}/mo (avg last 3 months of expenses)`}
            </p>
            {cashOutDate && (
              <p className="tnum mt-1.5 text-sm font-semibold" style={{ color: gaugeColor }}>
                At this burn, cash reaches ₹0 around {cashOutDate}.
              </p>
            )}
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
            <p className="font-display text-lg font-semibold tnum">{compact(data.monthlyFixedInr)}</p>
          </div>
          <div>
            <p className="text-muted">This month vs break-even</p>
            <p className={`font-display text-lg font-semibold tnum ${data.revenueVsBreakEvenInr >= 0 ? "text-ok" : "text-risk"}`}>
              {data.revenueVsBreakEvenInr >= 0 ? "+" : ""}
              {compact(data.revenueVsBreakEvenInr)}
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

      {/* Analytics grid - aging, urgency breakup, balance trend, top balances */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <BarChart3 size={18} className="text-accent" /> Age analysis of due balance
          </h3>
          <p className="mt-0.5 text-xs text-muted">Receivable balances by how late they are.</p>
          <div className="mt-5">
            <Columns items={ageItems} height={170} />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <PieChart size={18} className="text-accent" /> Receivables breakup
          </h3>
          <p className="mt-0.5 text-xs text-muted">How urgent the outstanding money is.</p>
          <div className="mt-4">
            <Donut
              slices={breakupSlices}
              centerLabel="Outstanding"
              centerValue={compact(receivables.totalInr)}
              size={170}
              thickness={24}
            />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <LineChart size={18} className="text-accent" /> Bank balance - last 12 weeks
          </h3>
          <p className="mt-0.5 text-xs text-muted">Weekly cash position entries.</p>
          <div className="mt-4">
            <CashChart points={data.chart} />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ListOrdered size={18} className="text-accent" /> Top receivables by balance
          </h3>
          <p className="mt-0.5 text-xs text-muted">Largest outstanding student balances.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-muted">
                  <th className="py-2 pr-3 font-medium">Student</th>
                  <th className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th className="py-2 pr-3 font-medium">Next due</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="max-w-[140px] truncate py-2.5 pr-3 font-medium">{r.studentName}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center justify-end gap-2">
                        <span className="h-2 w-16 flex-none overflow-hidden rounded-full bg-surface-2 sm:w-24">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${(r.balanceInr / maxBalance) * 100}%`, background: "var(--chart-1)" }}
                          />
                        </span>
                        <span className="tnum">{formatInrMinor(r.balanceInr, { compact: true })}</span>
                      </span>
                    </td>
                    <td className="tnum py-2.5 pr-3 text-xs">{r.nextDueDate ? formatDate(r.nextDueDate) : "-"}</td>
                    <td className="py-2.5 text-xs">
                      {r.overdue ? (
                        <span className="font-medium text-risk">Overdue {r.daysOverdue}d</span>
                      ) : (
                        <span className="text-muted">On schedule</span>
                      )}
                    </td>
                  </tr>
                ))}
                {topRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted">No pending balances 🎉</td>
                  </tr>
                )}
              </tbody>
              {topRows.length > 0 && (
                <tfoot>
                  <tr className="text-sm font-semibold">
                    <td className="py-2.5 pr-3">Total ({receivables.countWithBalance})</td>
                    <td className="tnum py-2.5 pr-3 text-right">{formatInrMinor(receivables.totalInr, { compact: true })}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      <Tabs
        tabs={[
          {
            label: "Cash position",
            content: <CashPositionSection positions={data.positions} today={today} stale={runway.cashStale} />,
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
