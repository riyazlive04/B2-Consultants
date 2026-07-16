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
import { Card, CardTitle, EmptyState, PageHeader, Pill } from "@/components/ui/kit";
import { toDateInputValue, istToday } from "@/lib/dates";
import { formatDate, formatEurMinor, formatInrMinor, formatMonth, formatPct } from "@/lib/format";
import { PROGRAM_LEVEL_LABELS, PAYMENT_METHOD_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getTodayInrPerEur } from "@/lib/fx";
import { getFinanceOverview } from "@/server/finance-metrics";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
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
  "var(--border-strong)",
];

export default async function FinancePage() {
  await requireSection("finance");
  const [{ metrics, incomes, expenses, pendings }, commission, fx] = await Promise.all([
    getFinanceOverview(),
    getCommissionReport(),
    // Same rate the server actions stamp on save, so the form's ₹↔€ preview
    // matches what actually gets stored.
    getTodayInrPerEur(),
  ]);
  const fxRate = Number(fx.rate);
  const waByPending = await getWhatsAppStatusMap("pendingPaymentId", pendings.map((p) => p.id));
  const today = toDateInputValue(istToday());
  const monthKey = today.slice(0, 7);
  const monthLabel = formatMonth(istToday());
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

  // Money in vs money out - two magnitude bars on a shared scale (a 2-slice donut
  // hides the comparison; bars on one axis ARE the comparison)
  const flowMax = Math.max(1, metrics.revenue.inr, metrics.expenses.inr);

  // Honest MoM deltas: this month-to-date vs the SAME days of last month
  const momRevenuePct =
    metrics.prevSameDay.revenueInr > 0
      ? ((metrics.revenue.inr - metrics.prevSameDay.revenueInr) / metrics.prevSameDay.revenueInr) * 100
      : null;

  // Top 5 payments this month by aggregated INR value
  const topPayments = incomes
    .filter((i) => i.date.slice(0, 7) === monthKey)
    .sort((a, b) => b.agg.inr - a.agg.inr)
    .slice(0, 5);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Wallet size={20} />}
        title="Finance"
        subtitle="Big number = INR aggregate (entry-stamped FX); EUR aggregate beneath."
        actions={<Pill>This month · {monthLabel}</Pill>}
      />

      {/* KPI cards first: §4.4 names nine figures this section must show, and six of
          them (gross profit, margin, COGS, expenses, receivables, YTD) used to sit
          below the fold behind the bento charts. Numbers lead, charts explain. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Net profit"
          value={inr(metrics.net)}
          secondary={eurLine(metrics.net)}
          target={`was ${formatInrMinor(metrics.prevSameDay.netInr, { compact: true })} by this day last mo`}
          tooltip="Net Profit = Revenue minus all costs including marketing and tools. The comparison is to the same day of last month, so a part-month is never judged against a full one."
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

      {/* Bento grid - hero + breakdowns left, top payments right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={<CardTitle icon={<TrendingUp size={16} />}>Revenue</CardTitle>}>
          <p className="font-display text-4xl font-bold tracking-tight">{inr(metrics.revenue)}</p>
          <p className="mt-1 text-xs text-muted">
            {eurLine(metrics.revenue)} · daily, this month
            {momRevenuePct !== null && (
              <>
                {" · "}
                <span
                  className="tnum font-semibold"
                  style={{ color: momRevenuePct >= 0 ? "var(--ok)" : "var(--risk)" }}
                >
                  {momRevenuePct >= 0 ? "▲" : "▼"} {formatPct(Math.abs(momRevenuePct))}
                </span>{" "}
                vs same day last month
              </>
            )}
          </p>
          <div className="mt-4">
            <AreaChart data={metrics.revenueSpark} height={140} />
          </div>
        </Card>

        <Card
          title={<CardTitle icon={<BarChart3 size={16} />}>Revenue by program level</CardTitle>}
          subtitle="This month, share of total revenue."
        >
          <BarRows items={levelItems} />
        </Card>

        <Card
          className="lg:row-span-2"
          title={<CardTitle icon={<Trophy size={16} />}>Top 5 payments</CardTitle>}
          subtitle="Largest income entries this month."
        >
          {topPayments.length === 0 ? (
            <EmptyState title="No income yet this month" body="Entries you add under the Income tab show up here." />
          ) : (
            <ol className="divide-y divide-line">
              {topPayments.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 py-3.5 first:pt-0">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-primary-soft font-display text-sm font-bold text-primary-strong">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.studentName}</span>
                    <span className="block truncate text-xs text-muted">
                      {PROGRAM_LEVEL_LABELS[p.programLevel] ?? p.programLevel} ·{" "}
                      {PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod} · {formatDate(p.date)}
                    </span>
                  </span>
                  <span className="flex-none font-display text-h2 font-bold text-ink">
                    {formatInrMinor(p.agg.inr, { compact: true })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card
          title={<CardTitle icon={<PieChart size={16} />}>Expenses by category</CardTitle>}
          subtitle="This month, top categories."
        >
          <Donut slices={catSlices} centerLabel="This month" centerValue={inr(metrics.expenses)} />
        </Card>

        <Card
          title={<CardTitle icon={<ArrowLeftRight size={16} />}>Money in vs money out</CardTitle>}
          subtitle="This month, on one scale — the gap is the profit."
        >
          <p
            className="font-display text-3xl font-bold tracking-tight"
            style={{ color: metrics.net.inr < 0 ? "var(--risk)" : "var(--ink)" }}
          >
            {inr(metrics.net)}
          </p>
          <p className="text-xs text-muted">
            net this month · {metrics.prevSameDay.netInr !== 0 && (
              <span className="tnum">
                was {formatInrMinor(metrics.prevSameDay.netInr, { compact: true })} by this day last month
              </span>
            )}
          </p>
          <div className="mt-5 space-y-4">
            {(
              [
                { label: "Money in", value: metrics.revenue.inr, icon: <ArrowDownLeft size={16} />, color: "var(--ok)", soft: "var(--ok-soft)" },
                { label: "Money out", value: metrics.expenses.inr, icon: <ArrowUpRight size={16} />, color: "var(--risk)", soft: "var(--risk-soft)" },
              ] as const
            ).map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span
                  className="grid h-9 w-9 flex-none place-items-center rounded-full"
                  style={{ background: row.soft, color: row.color }}
                >
                  {row.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{row.label}</span>
                    <span className="text-sm font-semibold tnum">{formatInrMinor(row.value, { compact: true })}</span>
                  </div>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(row.value / flowMax) * 100}%`, background: row.color }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Tabs
        tabs={[
          {
            label: "Income",
            content: (
              <IncomeSection
                rows={incomes}
                today={today}
                studentOptions={studentOptions}
                fxRate={fxRate}
                fxStale={fx.stale}
              />
            ),
          },
          {
            label: "Expenses",
            content: <ExpenseSection rows={expenses} today={today} fxRate={fxRate} fxStale={fx.stale} />,
          },
          {
            label: `Pending payments${pendings.some((p) => p.overdue) ? " ⚠" : ""}`,
            content: <PendingSection rows={pendings} waStatus={waByPending} fxRate={fxRate} fxStale={fx.stale} />,
          },
          { label: "Commission", content: <CommissionSection report={commission} /> },
        ]}
      />
    </div>
  );
}
