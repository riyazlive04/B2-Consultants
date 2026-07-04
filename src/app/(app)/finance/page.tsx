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
  ArrowLeftRight,
  BarChart3,
  PieChart,
  Trophy,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { AreaChart } from "@/components/ui/AreaChart";
import { BarRows, Donut } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/Tabs";
import { toDateInputValue, istToday } from "@/lib/dates";
import { formatDate, formatEurMinor, formatInrMinor, formatPct } from "@/lib/format";
import { PROGRAM_LEVEL_LABELS, PAYMENT_METHOD_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getFinanceOverview } from "@/server/finance-metrics";
import { getCommissionReport } from "@/server/commission-metrics";
import { CommissionSection } from "./_components/CommissionSection";
import { ExpenseSection } from "./_components/ExpenseSection";
import { IncomeSection } from "./_components/IncomeSection";
import { PendingSection } from "./_components/PendingSection";

export const dynamic = "force-dynamic";

const inr = (m: { inr: number }) => formatInrMinor(m.inr, { compact: true });
const eurLine = (m: { eur: number }) => `${formatEurMinor(m.eur, { compact: true })} aggregated`;

// Categorical chart palette (validated, fixed order); neutral gray tail for "Other".
const CAT_SHADES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#c7ccd6",
];

export default async function FinancePage() {
  await requireSection("finance");
  const [{ metrics, incomes, expenses, pendings }, commission] = await Promise.all([
    getFinanceOverview(),
    getCommissionReport(),
  ]);
  const today = toDateInputValue(istToday());
  const monthKey = today.slice(0, 7);
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(istToday());
  const studentOptions = (
    await prisma.student.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } })
  ).map((s) => ({ value: s.id, label: s.fullName }));

  // Revenue by program level - horizontal magnitude bars
  const levelItems = (
    [
      ["Solo", metrics.byLevel.SOLO],
      ["Guided", metrics.byLevel.GUIDED],
      ["Elite", metrics.byLevel.ELITE],
      ["German Note", metrics.byLevel.GERMAN_NOTE],
      ["Other", metrics.byLevel.OTHER],
    ] as const
  )
    .filter(([label, m]) => label !== "Other" || m.inr > 0)
    .map(([label, m]) => ({ label, value: m.inr, display: formatInrMinor(m.inr, { compact: true }) }));

  // Expenses by category (this month) - top 5 + Other tail
  const shortCat = (c: string) => (EXPENSE_CATEGORY_LABELS[c] ?? c).split(" (")[0].split(" - ")[0];
  const catTotals = new Map<string, number>();
  for (const e of expenses.filter((e) => e.date.slice(0, 7) === monthKey)) {
    catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.agg.inr);
  }
  const catSorted = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const catRest = catSorted.slice(5).reduce((s, [, v]) => s + v, 0);
  const catSlices = [
    ...catSorted.slice(0, 5).map(([c, v], i) => ({
      label: shortCat(c),
      value: v,
      display: formatInrMinor(v, { compact: true }),
      color: CAT_SHADES[i],
    })),
    ...(catRest > 0
      ? [{ label: "Other", value: catRest, display: formatInrMinor(catRest, { compact: true }), color: CAT_SHADES[5] }]
      : []),
  ];

  // Money in vs money out - semantic signal colors (in = ok-green, out = risk-red)
  const flowSlices = [
    { label: "Money in", value: metrics.revenue.inr, display: inr(metrics.revenue), color: "var(--ok)" },
    { label: "Money out", value: metrics.expenses.inr, display: inr(metrics.expenses), color: "var(--risk)" },
  ];
  const flowTotal = metrics.revenue.inr + metrics.expenses.inr;
  const pctIn = flowTotal > 0 ? Math.round((metrics.revenue.inr / flowTotal) * 100) : 0;

  // Top 5 payments this month by aggregated INR value
  const topPayments = incomes
    .filter((i) => i.date.slice(0, 7) === monthKey)
    .sort((a, b) => b.agg.inr - a.agg.inr)
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header strip - title left, reporting period right */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <Wallet size={20} />
          </span>
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Finance</h1>
            <p className="text-xs text-muted">
              Big number = INR aggregate (entry-stamped FX); EUR aggregate beneath.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted">
          This month · {monthLabel}
        </span>
      </div>

      {/* Bento grid - hero + breakdowns left, top payments right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <TrendingUp size={18} className="text-accent" /> Revenue
          </h3>
          <p className="mt-3 font-display text-4xl font-bold tracking-tight">{inr(metrics.revenue)}</p>
          <p className="mt-1 text-xs text-muted">{eurLine(metrics.revenue)} · daily, this month</p>
          <div className="mt-4">
            <AreaChart data={metrics.revenueSpark} height={140} />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <BarChart3 size={18} className="text-accent" /> Revenue by program level
          </h3>
          <p className="mt-0.5 text-xs text-muted">This month, share of total revenue.</p>
          <div className="mt-5">
            <BarRows items={levelItems} />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card lg:row-span-2">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Trophy size={18} className="text-accent" /> Top 5 payments
          </h3>
          <p className="mt-0.5 text-xs text-muted">Largest income entries this month.</p>
          {topPayments.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No income entries yet this month.</p>
          ) : (
            <ol className="mt-2 divide-y divide-line">
              {topPayments.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 py-3.5">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.studentName}</span>
                    <span className="block truncate text-xs text-muted">
                      {PROGRAM_LEVEL_LABELS[p.programLevel] ?? p.programLevel} ·{" "}
                      {PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod} · {formatDate(p.date)}
                    </span>
                  </span>
                  <span className="flex-none font-display text-lg font-bold text-accent">
                    {formatInrMinor(p.agg.inr, { compact: true })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <PieChart size={18} className="text-accent" /> Expenses by category
          </h3>
          <p className="mt-0.5 text-xs text-muted">This month, top categories.</p>
          <div className="mt-4">
            <Donut slices={catSlices} centerLabel="This month" centerValue={inr(metrics.expenses)} />
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ArrowLeftRight size={18} className="text-accent" /> Money in vs money out
          </h3>
          <p className="mt-0.5 text-xs text-muted">This month&apos;s cash flow split; centre = net profit.</p>
          <div className="mt-4">
            <Donut slices={flowSlices} centerLabel="Net profit" centerValue={inr(metrics.net)} legend={false} />
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 flex-none place-items-center rounded-full"
                style={{ background: "var(--ok-soft)", color: "var(--ok)" }}
              >
                <ArrowDownLeft size={16} />
              </span>
              <span className="flex-1 text-sm font-medium">Money in</span>
              <span className="text-sm font-semibold tnum">
                {inr(metrics.revenue)} <span className="font-normal text-muted">({pctIn}%)</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 flex-none place-items-center rounded-full"
                style={{ background: "var(--risk-soft)", color: "var(--risk)" }}
              >
                <ArrowUpRight size={16} />
              </span>
              <span className="flex-1 text-sm font-medium">Money out</span>
              <span className="text-sm font-semibold tnum">
                {inr(metrics.expenses)} <span className="font-normal text-muted">({flowTotal > 0 ? 100 - pctIn : 0}%)</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards - everything not already in the bento charts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Expenses this month"
          value={inr(metrics.expenses)}
          secondary={eurLine(metrics.expenses)}
          icon={<CreditCard size={18} />}
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

      <Tabs
        tabs={[
          { label: "Income", content: <IncomeSection rows={incomes} today={today} studentOptions={studentOptions} /> },
          { label: "Expenses", content: <ExpenseSection rows={expenses} today={today} /> },
          {
            label: `Pending payments${pendings.some((p) => p.overdue) ? " ⚠" : ""}`,
            content: <PendingSection rows={pendings} />,
          },
          { label: "Commission", content: <CommissionSection report={commission} /> },
        ]}
      />
    </div>
  );
}
