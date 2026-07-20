import {
  TrendingUp,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  BarChart3,
  PieChart,
  Trophy,
  CalendarRange,
  Users,
} from "lucide-react";
import { BarRows, Donut } from "@/components/ui/charts";
import { RevenueChart } from "./_components/RevenueChart";
import { BusinessLineSwitch } from "./_components/BusinessLineSwitch";
import { AnnualChart } from "./_components/AnnualChart";
import { getAnnualPerformance, getClientMovement } from "@/server/annual-metrics";
import { ClientMovementChart } from "./_components/ClientMovementChart";
import { BUSINESS_LINE_LABELS, lineForKind, type BusinessLineView } from "@/lib/business-line";
import { Tabs } from "@/components/ui/Tabs";
import { Card, CardTitle, EmptyState, PageHeader, Pill } from "@/components/ui/kit";
import { toDateInputValue, istToday } from "@/lib/dates";
import { formatDate, formatEurMinor, formatInrMinor, formatMonth, formatPct } from "@/lib/format";
import { PROGRAM_LEVEL_LABELS, PAYMENT_METHOD_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { signedColor } from "@/lib/signals";
import { prisma } from "@/lib/prisma";
import { getTodayInrPerEur } from "@/lib/fx";
import { getFinanceOverview } from "@/server/finance-metrics";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { getCommissionReport } from "@/server/commission-metrics";
import { getActiveLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { CommissionSection } from "./_components/CommissionSection";
import { ExpenseSection } from "./_components/ExpenseSection";
import { IncomeSection } from "./_components/IncomeSection";
import { PendingSection } from "./_components/PendingSection";
import { FinanceKpis, type Kpi } from "./_components/FinanceKpis";
import { ArchivedGroups } from "@/components/ui/ArchivedGroups";
import { getArchivedIncomes, getArchivedExpenses, getArchivedPendingPayments } from "@/server/archive-metrics";
import {
  restoreIncome, purgeIncome, restoreExpense, purgeExpense, restorePendingPayment, purgePendingPayment,
} from "@/server/finance-actions";

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

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: { record?: string; line?: string };
}) {
  const session = await requireSection("finance");
  // Deep-link from the top-bar "+ Record" CTA lands on Income (0) or Expenses (1).
  const initialTab = searchParams?.record === "expense" ? 1 : 0;
  const [{ metrics, incomes, expenses, pendings }, commission, fx, archIncomes, archExpenses, archPendings] =
    await Promise.all([
      getFinanceOverview(),
      getCommissionReport(),
      // Same rate the server actions stamp on save, so the form's ₹↔€ preview
      // matches what actually gets stored.
      getTodayInrPerEur(),
      getArchivedIncomes(),
      getArchivedExpenses(),
      getArchivedPendingPayments(),
    ]);
  const fxRate = Number(fx.rate);
  const fxDate = fx.date.toISOString();
  const archivedCount = archIncomes.length + archExpenses.length + archPendings.length;
  const canPurge = session.role === "ADMIN";
  const waByPending = await getWhatsAppStatusMap("pendingPaymentId", pendings.map((p) => p.id));
  const today = toDateInputValue(istToday());
  const monthKey = today.slice(0, 7);
  const monthLabel = formatMonth(istToday());
  // §6.1: the code rides as a `hint` — visible in the dropdown and searchable, but never
  // written into the name field (see ComboBox). `studentCodeById` lets the tables below
  // show the same code beside a denormalised studentName.
  const studentRows = await prisma.student.findMany({
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, code: true },
  });
  const studentOptions = studentRows.map((s) => ({
    value: s.id,
    label: s.fullName,
    hint: s.code ?? undefined,
  }));
  const studentCodeById: Record<string, string> = Object.fromEntries(
    studentRows.flatMap((s) => (s.code ? [[s.id, s.code] as const] : [])),
  );
  const activeLevels = await getActiveLevels();
  const levelOpts = levelOptions(activeLevels); // income/pending accept any level (incl. bundles)

  // ── Business line (§1). "ALL" stays the default so the page is unchanged for
  //    anyone who never touches the switch. An unknown ?line= falls back to ALL.
  const kindByLevel = new Map(activeLevels.map((l) => [l.code, l.kind as string]));
  const lineOfLevel = (code: string) => lineForKind(kindByLevel.get(code));
  const requested = searchParams?.line;
  const line: BusinessLineView =
    requested === "B2" || requested === "GERMAN_NOTE" ? requested : "ALL";
  const seg = line === "ALL" ? null : metrics.segments[line];
  const [annual, clientMovement] = await Promise.all([
    getAnnualPerformance(line === "ALL" ? null : line),
    getClientMovement(),
  ]);

  // The figures every card below reads — combined, or the selected line's slice.
  const view = {
    revenue: seg ? seg.revenue : metrics.revenue,
    expenses: seg ? seg.expenses : metrics.expenses,
    cogs: seg ? seg.cogs : metrics.cogs,
    gross: seg ? seg.gross : metrics.gross,
    net: seg ? seg.net : metrics.net,
    marginPct: seg ? seg.marginPct : metrics.marginPct,
    receivables: seg ? seg.receivables : metrics.receivables,
    ytdRevenue: seg ? seg.ytdRevenue : metrics.ytdRevenue,
    revenueSeries: seg ? seg.revenueSeries : metrics.revenueSeries,
  };
  const lineTotals: Record<BusinessLineView, number> = {
    ALL: metrics.revenue.inr,
    B2: metrics.segments.B2.revenue.inr,
    GERMAN_NOTE: metrics.segments.GERMAN_NOTE.revenue.inr,
  };
  // Say plainly which part of this P&L is measured and which part is an estimate.
  const allocNote =
    seg &&
    `Revenue and receivables are exact for this line. ${formatInrMinor(seg.directCostInr, {
      compact: true,
    })} of costs are tagged to it directly; shared costs add a further ${formatInrMinor(
      seg.sharedCostInr,
      { compact: true },
    )} at its ${Math.round(seg.revenueSharePct)}% share of revenue. Tag more costs on the Expenses tab to sharpen this.`;

  // Revenue by programme level - horizontal magnitude bars
  const levelItems = (
    [
      ["Solo", metrics.byLevel.SOLO],
      ["Guided", metrics.byLevel.GUIDED],
      ["Elite", metrics.byLevel.ELITE],
      ["German Note", metrics.byLevel.GERMAN_NOTE],
      ["Other", metrics.byLevel.OTHER],
    ] as const
  )
    // A German-Note view has no Solo/Guided/Elite rows, and vice versa.
    .filter(([label]) =>
      line === "ALL" ? true : line === "GERMAN_NOTE" ? label === "German Note" : label !== "German Note",
    )
    .filter(([label, m]) => label !== "Other" || m.inr > 0)
    .map(([label, m]) => ({ label, value: m.inr, display: formatInrMinor(m.inr, { compact: true }) }));

  // Expenses by category (this month) - top 5 + Other tail
  const shortCat = (c: string) => (EXPENSE_CATEGORY_LABELS[c] ?? c).split(" (")[0].split(" - ")[0];
  const catTotals = new Map<string, number>();
  for (const e of expenses.filter((e) => e.date.slice(0, 7) === monthKey)) {
    catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.agg.inr);
  }
  // With a line selected, categories are scaled by the same revenue share as the
  // allocated expense total, so the donut still sums to the number on the card.
  const catShare = seg ? seg.revenueSharePct / 100 : 1;
  for (const [k, v] of catTotals) catTotals.set(k, v * catShare);
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
  const flowMax = Math.max(1, view.revenue.inr, view.expenses.inr);

  // Honest MoM deltas: this month-to-date vs the SAME days of last month
  // Only meaningful on the combined view — prevSameDay is not split by line.
  const momRevenuePct =
    line === "ALL" && metrics.prevSameDay.revenueInr > 0
      ? ((metrics.revenue.inr - metrics.prevSameDay.revenueInr) / metrics.prevSameDay.revenueInr) * 100
      : null;

  // Top 5 payments this month by aggregated INR value
  const topPayments = incomes
    .filter((i) => i.date.slice(0, 7) === monthKey)
    .filter((i) => (line === "ALL" ? true : lineOfLevel(i.programLevel) === line))
    .sort((a, b) => b.agg.inr - a.agg.inr)
    .slice(0, 5);

  // KPI cards: raw dual-currency figures + the breakdown behind each, handed to a client
  // component that owns the ₹/€ toggle and the click-to-expand popups.
  const kpis: Kpi[] = [
    {
      key: "net", label: "Net profit", iconName: "wallet",
      inrMinor: view.net.inr, eurMinor: view.net.eur,
      signal: view.net.inr < 0 ? "risk" : "ok",
      signedValue: view.net.inr,
      tooltip: "Net Profit = Revenue minus all costs including marketing and tools.",
      detailTitle: "Net profit — this month",
      detailNote: "Net = revenue − all costs (COGS, marketing, tools, ops).",
      detailRows: [
        { label: "Revenue (money in)", inrMinor: view.revenue.inr, eurMinor: view.revenue.eur },
        { label: "All costs (money out)", inrMinor: view.revenue.inr - view.net.inr, eurMinor: view.revenue.eur - view.net.eur },
        { label: "Net by this day last month", text: formatInrMinor(metrics.prevSameDay.netInr, { compact: true }) },
      ],
    },
    {
      key: "margin", label: "Profit margin", iconName: "percent",
      valueText: formatPct(view.marginPct),
      signal: view.marginPct < 0 ? "risk" : undefined,
      signedValue: view.marginPct,
      detailTitle: "Profit margin",
      detailNote: "Margin = net profit ÷ revenue × 100.",
      detailRows: [
        { label: "Net profit", inrMinor: view.net.inr, eurMinor: view.net.eur },
        { label: "Revenue", inrMinor: view.revenue.inr, eurMinor: view.revenue.eur },
        { label: "Margin", text: formatPct(view.marginPct) },
      ],
    },
    {
      key: "gross", label: "Gross profit", iconName: "piggy",
      inrMinor: view.gross.inr, eurMinor: view.gross.eur,
      signal: view.gross.inr < 0 ? "risk" : "ok",
      signedValue: view.gross.inr,
      tooltip: "Gross Profit = Revenue minus only delivery costs (COGS).",
      detailTitle: "Gross profit — this month",
      detailNote: "Gross = revenue − COGS (direct delivery).",
      detailRows: [
        { label: "Revenue", inrMinor: metrics.revenue.inr, eurMinor: metrics.revenue.eur },
        { label: "COGS (delivery)", inrMinor: view.cogs.inr, eurMinor: view.cogs.eur },
      ],
    },
    {
      key: "cogs", label: "COGS this month", iconName: "package",
      inrMinor: view.cogs.inr, eurMinor: view.cogs.eur,
      detailTitle: "Cost of delivery — this month",
      detailNote: "The slice of expenses tagged as a direct cost of delivering the program.",
      detailRows: [{ label: "Direct delivery cost", inrMinor: view.cogs.inr, eurMinor: view.cogs.eur }],
    },
    {
      key: "expenses", label: "Expenses this month", iconName: "card",
      inrMinor: view.expenses.inr, eurMinor: view.expenses.eur,
      detailTitle: "Expenses — this month",
      detailNote: "By category, largest first.",
      detailRows: catSlices.length
        ? catSlices.map((c) => ({ label: c.label, text: c.display }))
        : [{ label: "No expenses yet this month", text: "—" }],
    },
    {
      key: "receivables", label: "Pending receivables", iconName: "clock",
      inrMinor: view.receivables.inr, eurMinor: view.receivables.eur,
      signal: view.receivables.inr > 0 ? "watch" : undefined,
      detailTitle: "Pending receivables",
      detailNote: "Active unpaid balances owed to the business.",
      detailRows: [
        { label: "Open balances", text: String(pendings.length) },
        { label: "Overdue", text: String(pendings.filter((p) => p.overdue).length) },
      ],
    },
    {
      key: "ytd", label: "Yearly revenue to date", iconName: "calendar",
      inrMinor: view.ytdRevenue.inr, eurMinor: view.ytdRevenue.eur,
      detailTitle: "Revenue this year to date",
      detailNote: "Programme-level revenue mix (this month).",
      detailRows: levelItems.length
        ? levelItems.map((l) => ({ label: l.label, text: l.display }))
        : [{ label: "No revenue yet", text: "—" }],
    },
  ];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Wallet size={20} />}
        title="Finance"
        subtitle="Big number = INR aggregate (entry-stamped FX); EUR aggregate beneath."
        actions={
          <Pill>
            {line === "ALL" ? "" : `${BUSINESS_LINE_LABELS[line]} · `}This month · {monthLabel}
          </Pill>
        }
      />

      {/* KPI cards: §4.4's nine figures, now with a ₹/€ primary-currency toggle and a
          click-to-expand breakdown behind each number (FinanceKpis owns both). */}
      <div className="space-y-2">
        <BusinessLineSwitch active={line} totals={lineTotals} />
        {allocNote && <p className="text-caption text-muted">{allocNote}</p>}
      </div>

      <FinanceKpis kpis={kpis} />

      {/* Bento grid - hero + breakdowns left, top payments right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={<CardTitle icon={<TrendingUp size={16} />}>Revenue</CardTitle>}>
          <p className="font-display text-4xl font-bold tracking-tight">{inr(view.revenue)}</p>
          <p className="mt-1 text-xs text-muted">
            {eurLine(view.revenue)} · daily, this month · hover any day for the amount
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
            <RevenueChart points={view.revenueSeries} height={170} />
          </div>
        </Card>

        <Card
          title={<CardTitle icon={<BarChart3 size={16} />}>Revenue by programme level</CardTitle>}
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
                    <span className="flex items-baseline gap-1.5 truncate text-sm font-semibold">
                      <span className="truncate">{p.studentName}</span>
                      {p.studentId && studentCodeById[p.studentId] && (
                        <span className="tnum flex-none text-caption font-medium text-ink-3">
                          {studentCodeById[p.studentId]}
                        </span>
                      )}
                    </span>
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
          <Donut slices={catSlices} centerLabel="This month" centerValue={inr(view.expenses)} />
        </Card>

        <Card
          title={<CardTitle icon={<ArrowLeftRight size={16} />}>Money in vs money out</CardTitle>}
          subtitle="This month, on one scale — the gap is the profit."
        >
          <p
            className="font-display text-3xl font-bold tracking-tight"
            style={{ color: signedColor(view.net.inr) ?? "var(--ink)" }}
          >
            {inr(view.net)}
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
                { label: "Money in", value: view.revenue.inr, icon: <ArrowDownLeft size={16} />, color: "var(--ok)", soft: "var(--ok-soft)" },
                { label: "Money out", value: view.expenses.inr, icon: <ArrowUpRight size={16} />, color: "var(--risk)", soft: "var(--risk-soft)" },
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

      {/* §3.2/§3.3 — the year view the dashboard never had: cumulative target vs
          achieved across Jan–Dec, with a run-rate projection to year-end. */}
      <Card
        title={<CardTitle icon={<CalendarRange size={16} />}>Month on month — {annual.year}</CardTitle>}
        subtitle="Cumulative target vs achieved, with a projection to year-end. Hover any month."
      >
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Achieved to date", value: formatInrMinor(annual.achievedToDateInr, { compact: true }), tone: undefined },
            { label: "Target to date", value: formatInrMinor(annual.targetToDateInr, { compact: true }), tone: undefined },
            {
              label: annual.varianceInr >= 0 ? "Ahead of target" : "Behind target",
              value: formatInrMinor(Math.abs(annual.varianceInr), { compact: true }),
              tone: signedColor(annual.varianceInr),
            },
            {
              label: "Projected year-end",
              value: formatInrMinor(annual.projectedYearEndInr, { compact: true }),
              tone: signedColor(annual.projectedYearEndInr - annual.fullYearTargetInr),
            },
          ].map((t) => (
            <div key={t.label}>
              <p className="text-caption font-medium text-ink-2">{t.label}</p>
              <p
                className="tnum mt-0.5 font-display text-h2 font-bold tracking-tight"
                style={t.tone ? { color: t.tone } : undefined}
              >
                {t.value}
              </p>
            </div>
          ))}
        </div>
        <AnnualChart months={annual.months} currentMonth={istToday().getUTCMonth()} />
      </Card>

      {/* §3.4 — recurring-revenue movement: is the client base under the revenue
          growing or shrinking? Not split by line: an enrolment's level maps to a
          programme, but churn is counted per student across the whole roster. */}
      <Card
        title={<CardTitle icon={<Users size={16} />}>Client movement — {annual.year}</CardTitle>}
        subtitle="Clients gained and lost each month against the active client base."
      >
        <ClientMovementChart months={clientMovement} />
      </Card>

      <Tabs
        initial={initialTab}
        tabs={[
          {
            label: "Income",
            content: (
              <IncomeSection
                rows={incomes}
                today={today}
                studentOptions={studentOptions}
                studentCodeById={studentCodeById}
                levelOptions={levelOpts}
                fxRate={fxRate}
                fxStale={fx.stale}
                fxDate={fxDate}
              />
            ),
          },
          {
            label: "Expenses",
            content: <ExpenseSection rows={expenses} today={today} fxRate={fxRate} fxStale={fx.stale} fxDate={fxDate} />,
          },
          {
            label: `Pending payments${pendings.some((p) => p.overdue) ? " ⚠" : ""}`,
            content: <PendingSection rows={pendings} studentCodeById={studentCodeById} waStatus={waByPending} levelOptions={levelOpts} fxRate={fxRate} fxStale={fx.stale} fxDate={fxDate} />,
          },
          { label: "Commission", content: <CommissionSection report={commission} /> },
          {
            label: `Archived${archivedCount ? ` (${archivedCount})` : ""}`,
            content: (
              <ArchivedGroups
                canPurge={canPurge}
                groups={[
                  { label: "Income", noun: "income entry", rows: archIncomes, restore: restoreIncome, purge: purgeIncome },
                  { label: "Expenses", noun: "expense", rows: archExpenses, restore: restoreExpense, purge: purgeExpense },
                  { label: "Pending payments", noun: "receivable", rows: archPendings, restore: restorePendingPayment, purge: purgePendingPayment },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
