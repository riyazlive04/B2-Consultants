import {
  TrendingUp,
  CreditCard,
  Wallet,
  Percent,
  PiggyBank,
  Package,
  Clock,
  CalendarRange,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { AreaChart } from "@/components/ui/AreaChart";
import { Tabs } from "@/components/ui/Tabs";
import { toDateInputValue, istToday } from "@/lib/dates";
import { formatDate, formatEurMinor, formatInrMinor, formatPct } from "@/lib/format";
import { PROGRAM_LEVEL_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getFinanceOverview } from "@/server/finance-metrics";
import { ExpenseSection } from "./_components/ExpenseSection";
import { IncomeSection } from "./_components/IncomeSection";
import { PendingSection } from "./_components/PendingSection";

export const dynamic = "force-dynamic";

const inr = (m: { inr: number }) => formatInrMinor(m.inr, { compact: true });
const eurLine = (m: { eur: number }) => `${formatEurMinor(m.eur, { compact: true })} aggregated`;

export default async function FinancePage() {
  await requireSection("finance");
  const { metrics, incomes, expenses, pendings } = await getFinanceOverview();
  const today = toDateInputValue(istToday());
  const studentOptions = (
    await prisma.student.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } })
  ).map((s) => ({ value: s.id, label: s.fullName }));

  const levelLine = [
    `Solo ${inr(metrics.byLevel.SOLO)}`,
    `Guided ${inr(metrics.byLevel.GUIDED)}`,
    `Elite ${inr(metrics.byLevel.ELITE)}`,
    `German Note ${inr(metrics.byLevel.GERMAN_NOTE)}`,
  ].join(" · ");

  // Merge income + expense entries into one recent-activity feed.
  const tx = [
    ...incomes.map((i) => ({
      id: `i-${i.id}`,
      date: i.date,
      dir: "in" as const,
      title: i.studentName,
      sub: PROGRAM_LEVEL_LABELS[i.programLevel] ?? i.programLevel,
      amount: i.agg.inr,
    })),
    ...expenses.map((e) => ({
      id: `e-${e.id}`,
      date: e.date,
      dir: "out" as const,
      title: e.vendor || EXPENSE_CATEGORY_LABELS[e.category] || e.category,
      sub: EXPENSE_CATEGORY_LABELS[e.category] ?? e.category,
      amount: e.agg.inr,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Finance</h1>
        <p className="mt-1 text-sm text-muted">
          This month, auto-calculated. Big number = INR aggregate (INR + EUR converted at each
          entry's stored rate); EUR aggregate beneath.
        </p>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Revenue this month"
          value={inr(metrics.revenue)}
          secondary={eurLine(metrics.revenue)}
          icon={<TrendingUp size={18} />}
        />
        <MetricCard
          label="Expenses this month"
          value={inr(metrics.expenses)}
          secondary={eurLine(metrics.expenses)}
          icon={<CreditCard size={18} />}
        />
        <MetricCard
          label="Net profit"
          value={inr(metrics.net)}
          secondary={eurLine(metrics.net)}
          tooltip="Net Profit = Revenue minus all costs including marketing and tools."
          signal={metrics.net.inr < 0 ? "risk" : "ok"}
          icon={<Wallet size={18} />}
        />
        <MetricCard
          label="Profit margin"
          value={formatPct(metrics.marginPct)}
          secondary="Net profit ÷ revenue × 100"
          signal={metrics.marginPct < 0 ? "risk" : undefined}
          progress={Math.max(0, Math.min(1, metrics.marginPct / 100))}
          icon={<Percent size={18} />}
        />
      </div>

      {/* Revenue trend + recent transactions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[13px] font-medium text-muted">Revenue this month</p>
              <p className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {inr(metrics.revenue)}
              </p>
            </div>
            <span className="text-xs text-muted">Daily, auto-calculated</span>
          </div>
          <div className="mt-4">
            <AreaChart data={metrics.revenueSpark} height={200} />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="mb-3 text-[13px] font-medium text-muted">Recent transactions</p>
          {tx.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No entries yet this period.</p>
          ) : (
            <ul className="divide-y divide-line">
              {tx.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className="grid h-9 w-9 flex-none place-items-center rounded-full"
                    style={{
                      background: t.dir === "in" ? "var(--ok-soft)" : "var(--risk-soft)",
                      color: t.dir === "in" ? "var(--ok)" : "var(--risk)",
                    }}
                  >
                    {t.dir === "in" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {t.sub} · {formatDate(t.date)}
                    </span>
                  </span>
                  <span
                    className="flex-none text-sm font-semibold tnum"
                    style={{ color: t.dir === "in" ? "var(--ok)" : "var(--risk)" }}
                  >
                    {t.dir === "in" ? "+" : "-"}
                    {formatInrMinor(t.amount, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Gross profit"
          value={inr(metrics.gross)}
          secondary={eurLine(metrics.gross)}
          tooltip="Gross Profit = Revenue minus only delivery costs (COGS)."
          signal={metrics.gross.inr < 0 ? "risk" : "ok"}
          icon={<PiggyBank size={18} />}
        />
        <MetricCard
          label="COGS this month"
          value={inr(metrics.cogs)}
          secondary={eurLine(metrics.cogs)}
          icon={<Package size={18} />}
        />
        <MetricCard
          label="Pending receivables"
          value={formatInrMinor(metrics.receivables.inr, { compact: true })}
          secondary={`${formatEurMinor(metrics.receivables.eur, { compact: true })} · active balances`}
          signal={metrics.receivables.inr > 0 ? "watch" : undefined}
          icon={<Clock size={18} />}
        />
        <MetricCard
          label="Yearly revenue to date"
          value={inr(metrics.ytdRevenue)}
          secondary={eurLine(metrics.ytdRevenue)}
          icon={<CalendarRange size={18} />}
        />
      </div>

      <p className="text-sm text-muted">
        <span className="font-medium text-ink">Revenue by level (this month):</span> {levelLine}
      </p>

      <Tabs
        tabs={[
          { label: "Income", content: <IncomeSection rows={incomes} today={today} studentOptions={studentOptions} /> },
          { label: "Expenses", content: <ExpenseSection rows={expenses} today={today} /> },
          {
            label: `Pending payments${pendings.some((p) => p.overdue) ? " ⚠" : ""}`,
            content: <PendingSection rows={pendings} />,
          },
        ]}
      />
    </div>
  );
}
