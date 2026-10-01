import { Wallet, BarChart3, CalendarRange, Users } from "lucide-react";
import { AllocationNote, FinanceBento } from "./_components/FinanceBento";
import { BusinessLineSwitch } from "./_components/BusinessLineSwitch";
import { FinanceCurrencyProvider, CurrencyToggle } from "./_components/FinanceCurrency";
import { AnnualChart } from "./_components/AnnualChart";
import { CumulativeTrackingChart } from "./_components/CumulativeTrackingChart";
import { getAnnualPerformance, getClientMovement } from "@/server/annual-metrics";
import { ClientMovementChart } from "./_components/ClientMovementChart";
import { BUSINESS_LINE_LABELS, lineForKind, type BusinessLineView } from "@/lib/business-line";
import { Tabs } from "@/components/ui/Tabs";
import { Card, CardTitle, PageHeader, Pill } from "@/components/ui/kit";
import { toDateInputValue, istToday } from "@/lib/dates";
import { parsePeriod, resolvePeriod } from "@/lib/period";
import { PeriodBar } from "@/components/ui/PeriodBar";
import { ExportButton } from "@/components/ui/ExportButton";
import { formatMonth, formatPct } from "@/lib/format";
import { PROGRAM_LEVEL_LABELS, PAYMENT_METHOD_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getTodayInrPerEur } from "@/lib/fx";
import { getFinanceOverview } from "@/server/finance-metrics";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { getCommissionReport } from "@/server/commission-metrics";
import { getActiveLevels } from "@/server/levels";
import { resolveBusinessLine } from "@/server/business-line-view";
import { levelOptions } from "@/lib/levels";
import { CommissionSection } from "./_components/CommissionSection";
import { ExpenseSection } from "./_components/ExpenseSection";
import { IncomeSection } from "./_components/IncomeSection";
import { PendingSection } from "./_components/PendingSection";
import { FinanceKpis, type Kpi } from "./_components/FinanceKpis";
import { RecognitionCard } from "./_components/RecognitionCard";
import { getRecognition, recognitionConfidence } from "@/server/revenue-recognition";
import { ArchivedGroups } from "@/components/ui/ArchivedGroups";
import { getArchivedIncomes, getArchivedExpenses, getArchivedPendingPayments } from "@/server/archive-metrics";
import {
  restoreIncome, purgeIncome, restoreExpense, purgeExpense, restorePendingPayment, purgePendingPayment,
} from "@/server/finance-actions";

export const dynamic = "force-dynamic";

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
  searchParams?: { record?: string; line?: string; period?: string; on?: string; from?: string; to?: string };
}) {
  const session = await requireSection("finance");
  // Deep-link from the top-bar "+ Record" CTA lands on Income (0) or Expenses (1).
  const initialTab = searchParams?.record === "expense" ? 1 : 0;
  /**
   * WHICH window this page reports on. Previously there was none - every figure was the current
   * calendar month, hardcoded, with no way to ask for last month or a custom range and therefore
   * no way to export one either. `parsePeriod` is total: a malformed URL falls back to this month
   * rather than erroring.
   */
  const periodSpec = parsePeriod(searchParams ?? {});
  const period = resolvePeriod(periodSpec);
  // Everything that does not depend on another result goes in this one wave. Each query is a
  // round trip to the database, and these used to run one after another.
  const [
    { metrics, incomes, expenses, pendings },
    commission,
    fx,
    archIncomes,
    archExpenses,
    archPendings,
    studentRows,
    activeLevels,
    line,
  ] = await Promise.all([
    getFinanceOverview(period),
    getCommissionReport(),
    // Same rate the server actions stamp on save, so the form's ₹↔€ preview
    // matches what actually gets stored.
    getTodayInrPerEur(),
    getArchivedIncomes(),
    getArchivedExpenses(),
    getArchivedPendingPayments(),
    prisma.student.findMany({
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, code: true },
    }),
    getActiveLevels(),
    // Sticky across navigation via cookie, but an explicit `?line=` in the URL still wins -
    // linking a colleague a specific view was a deliberate property of the old design
    // (Error Log E1/E4). See server/business-line-view.ts.
    resolveBusinessLine(searchParams?.line) as Promise<BusinessLineView>,
  ]);
  const fxRate = Number(fx.rate);
  const fxDate = fx.date.toISOString();
  const archivedCount = archIncomes.length + archExpenses.length + archPendings.length;
  const canPurge = session.role === "ADMIN";
  const isAdmin = session.role === "ADMIN";
  const today = toDateInputValue(istToday());
  const monthKey = today.slice(0, 7);
  // Follows the SELECTED window, not today - a page showing June that says "July" is worse
  // than one with no label at all.
  const monthLabel = period.label;
  // §6.1: the code rides as a `hint` - visible in the dropdown and searchable, but never
  // written into the name field (see ComboBox). `studentCodeById` lets the tables below
  // show the same code beside a denormalised studentName.
  const studentOptions = studentRows.map((s) => ({
    value: s.id,
    label: s.fullName,
    hint: s.code ?? undefined,
  }));
  /**
   * ── Payers with no student record ────────────────────────────────────────────────
   * The "Student name" box only ever offered rows from the `Student` table, so on an install
   * where nobody has minted student records it suggests NOTHING - the operator types the same
   * name from scratch every month, spells it differently once, and that month's money files
   * itself under a second payer.
   *
   * So the names we have actually been paid by join the list, marked as having no record yet.
   * They carry no id (picking one links nothing, exactly as typing it by hand does not), which
   * is what keeps the "Create a student record for X" offer below intact: that offer tests the
   * STUDENT list, not this one, and it remains the way the missing record gets created.
   */
  const nameKeyOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const studentNameKeys = new Set(studentRows.map((s) => nameKeyOf(s.fullName)));
  const payerOptions = [
    ...new Map(
      incomes
        .filter((i) => !i.studentId && i.studentName.trim())
        .map((i) => [nameKeyOf(i.studentName), i.studentName.trim()] as const)
        .filter(([key]) => !studentNameKeys.has(key)),
    ).values(),
  ]
    .sort((a, b) => a.localeCompare(b))
    // A roster-sized cap: the dropdown is a convenience, not a second ledger.
    .slice(0, 200)
    .map((label) => ({ value: "", label, hint: "no record yet" }));
  // The same map getStudentCodeMap builds for Cash Health, taken from the rows already loaded
  // above rather than reading the whole Student table a second time.
  const studentCodeById: Record<string, string> = Object.fromEntries(
    studentRows.flatMap((s) => (s.code ? [[s.id, s.code] as const] : [])),
  );
  /**
   * The instalment dates still to come, per student - so the income row that STARTED a plan can
   * say when the rest of it falls due. Built from the receivables already loaded above rather
   * than a second query: the dates were written down on the income entry, and the whole point of
   * writing them down is that somebody can see them afterwards without opening another tab.
   *
   * Keyed by student id where there is one and by normalised name where there isn't, which is
   * exactly how the balance maths already pairs a payment with its receivable.
   */
  const upcomingByStudent: Record<string, { dueDate: string; inr: number; eur: number }[]> = {};
  for (const p of pendings) {
    if (p.status === "PAID_IN_FULL" || p.status === "DROPPED") continue;
    const due = p.instalments
      .filter((i) => i.status !== "PAID")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => ({ dueDate: i.dueDate, inr: i.inr, eur: i.eur }));
    if (!due.length) continue;
    const key = p.studentId ?? p.studentName.trim().toLowerCase().replace(/\s+/g, " ");
    upcomingByStudent[key] = [...(upcomingByStudent[key] ?? []), ...due];
  }

  /**
   * The same dates as one flat, date-ordered list - the in-app reminder itself.
   *
   * The notification centre already carries "instalments due soon", but a founder recording
   * today's payments is looking at Finance, not at the bell, and a due date nobody sees until it
   * is missed is the reason the dunning ladder ever has work to do. Overdue rows lead, because
   * those are the ones that stopped being a reminder and started being a problem.
   */
  const upcomingInstalments = pendings
    .filter((p) => p.status !== "PAID_IN_FULL" && p.status !== "DROPPED")
    .flatMap((p) =>
      p.instalments
        .filter((i) => i.status !== "PAID")
        .map((i) => ({ studentName: p.studentName, dueDate: i.dueDate, inr: i.inr, eur: i.eur })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8);

  const levelOpts = levelOptions(activeLevels); // income/pending accept any level (incl. bundles)

  // ── Business line (§1). "ALL" stays the default so the page is unchanged for
  //    anyone who never touches the switch. An unknown ?line= falls back to ALL.
  const kindByLevel = new Map(activeLevels.map((l) => [l.code, l.kind as string]));
  const lineOfLevel = (code: string) => lineForKind(kindByLevel.get(code));
  /**
   * The same derivation, handed to the income form so it can SAY which book an entry lands in.
   * The page's Combined / B2 / German Note switch filters what is being read; the programme
   * level is what decides where the money being typed actually goes, and those two had no
   * relationship on screen.
   */
  const levelLines = Object.fromEntries(levelOpts.map((o) => [o.value, lineOfLevel(o.value)]));
  const seg = line === "ALL" ? null : metrics.segments[line];
  const { start: monthStart, endExclusive: monthEndExclusive } = period;
  const monthEndInclusive = new Date(monthEndExclusive.getTime() - 86_400_000);
  const [waByPending, annual, clientMovement, recognition] = await Promise.all([
    getWhatsAppStatusMap("pendingPaymentId", pendings.map((p) => p.id)),
    getAnnualPerformance(line === "ALL" ? null : line),
    getClientMovement(),
    // Deliberately NOT segmented by business line. Recognition is about time, not about which
    // business a level belongs to, and a per-line split would need the same enrollment link the
    // confidence note already says is mostly missing - a finer cut of a coarse number.
    //
    // `istMonthRange` is HALF-OPEN ([1st, 1st of next month)) while a recognition window's `to`
    // is INCLUSIVE, so the end is pulled back a day. Passing it straight through would earn one
    // extra day of every active program into this month, every month.
    getRecognition(monthStart, monthEndInclusive),
  ]);

  // The figures every card below reads - combined, or the selected line's slice.
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
  const lineTotalsInr: Record<BusinessLineView, number> = {
    ALL: metrics.revenue.inr,
    B2: metrics.segments.B2.revenue.inr,
    GERMAN_NOTE: metrics.segments.GERMAN_NOTE.revenue.inr,
  };
  const lineTotalsEur: Record<BusinessLineView, number> = {
    ALL: metrics.revenue.eur,
    B2: metrics.segments.B2.revenue.eur,
    GERMAN_NOTE: metrics.segments.GERMAN_NOTE.revenue.eur,
  };
  // Which part of this P&L is measured and which part is an estimate. Rendered by
  // <AllocationNote> (a client component) so its figures follow the ₹/€ toggle.

  // Revenue by programme level - ranked bars, each carrying where that level stood by this same
  // day last month. Programme colours are FIXED app-wide (§1.3) so the eye learns them: the bar
  // for Guided is the same violet as the Guided chip everywhere else.
  // Raw dual-currency rows: the ₹/€ formatting happens in FinanceBento, which can read the
  // toggle. Pre-formatting here is what used to pin this card to INR.
  const levelItems = (
    [
      ["Solo", metrics.byLevel.SOLO, metrics.prevByLevel.SOLO, "var(--lvl-solo)"],
      ["Guided", metrics.byLevel.GUIDED, metrics.prevByLevel.GUIDED, "var(--lvl-guided)"],
      ["Elite", metrics.byLevel.ELITE, metrics.prevByLevel.ELITE, "var(--lvl-elite)"],
      ["German Note", metrics.byLevel.GERMAN_NOTE, metrics.prevByLevel.GERMAN_NOTE, "var(--lvl-gn)"],
      // "Other" is a residue bucket, not a programme - it gets the neutral, so it can never be
      // mistaken for a fifth product line.
      ["Other", metrics.byLevel.OTHER, metrics.prevByLevel.OTHER, "var(--ink-3)"],
    ] as const
  )
    // A German-Note view has no Solo/Guided/Elite rows, and vice versa.
    .filter(([label]) =>
      line === "ALL" ? true : line === "GERMAN_NOTE" ? label === "German Note" : label !== "German Note",
    )
    .filter(([label, m]) => label !== "Other" || m.inr > 0)
    .map(([label, m, prev, color]) => ({
      key: label,
      label,
      amount: { inr: m.inr, eur: m.eur },
      compare: { inr: prev.inr, eur: prev.eur },
      color,
    }));

  // Expenses by category (this month) - top 5 + Other tail
  const shortCat = (c: string) => (EXPENSE_CATEGORY_LABELS[c] ?? c).split(" (")[0].split(" - ")[0];
  // Both aggregates are carried through so the donut can flip currency with the toggle.
  const catTotals = new Map<string, { inr: number; eur: number }>();
  for (const e of expenses.filter((e) => e.date.slice(0, 7) === monthKey)) {
    const cur = catTotals.get(e.category) ?? { inr: 0, eur: 0 };
    catTotals.set(e.category, { inr: cur.inr + e.agg.inr, eur: cur.eur + e.agg.eur });
  }
  // With a line selected, categories are scaled by the same revenue share as the
  // allocated expense total, so the donut still sums to the number on the card.
  const catShare = seg ? seg.revenueSharePct / 100 : 1;
  for (const [k, v] of catTotals) catTotals.set(k, { inr: v.inr * catShare, eur: v.eur * catShare });
  const catSorted = [...catTotals.entries()].sort((a, b) => b[1].inr - a[1].inr);
  const catRest = catSorted.slice(5).reduce(
    (s, [, v]) => ({ inr: s.inr + v.inr, eur: s.eur + v.eur }),
    { inr: 0, eur: 0 },
  );
  const catSlices = [
    ...catSorted.slice(0, 5).map(([c, v], i) => ({
      key: c,
      label: shortCat(c),
      amount: v,
      color: CAT_SHADES[i],
    })),
    ...(catRest.inr > 0
      ? [{ key: "__other", label: "Other", amount: catRest, color: CAT_SHADES[5] }]
      : []),
  ];

  // COGS by category (this month) - same shape as catSlices, restricted to isCogs expenses,
  // so the "COGS this month" card's popup breaks the figure down instead of repeating it.
  const cogsCatTotals = new Map<string, { inr: number; eur: number }>();
  for (const e of expenses.filter((e) => e.isCogs && e.date.slice(0, 7) === monthKey)) {
    const cur = cogsCatTotals.get(e.category) ?? { inr: 0, eur: 0 };
    cogsCatTotals.set(e.category, { inr: cur.inr + e.agg.inr, eur: cur.eur + e.agg.eur });
  }
  for (const [k, v] of cogsCatTotals) cogsCatTotals.set(k, { inr: v.inr * catShare, eur: v.eur * catShare });
  const cogsCatSlices = [...cogsCatTotals.entries()]
    .sort((a, b) => b[1].inr - a[1].inr)
    .map(([c, v]) => ({ label: shortCat(c), amount: v }));

  // Honest MoM deltas: this month-to-date vs the SAME days of last month
  // Only meaningful on the combined view - prevSameDay is not split by line.
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

  // Receivables worth chasing first: still owed, most overdue days first, then largest
  // balance. Mirrors the KPI card's "active + still owing" filter (§ receivables above).
  const priorityReceivables = pendings
    .filter((p) => (p.status === "ACTIVE" || p.status === "OVERDUE") && p.balance.inr > 0)
    .filter((p) => (line === "ALL" ? true : lineOfLevel(p.programLevel) === line))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
      return b.balance.inr - a.balance.inr;
    })
    .slice(0, 6);

  // KPI cards: raw dual-currency figures + the breakdown behind each, handed to a client
  // component that owns the ₹/€ toggle and the click-to-expand popups.
  const kpis: Kpi[] = [
    {
      key: "net", label: "Net profit", iconName: "wallet",
      inrMinor: view.net.inr, eurMinor: view.net.eur,
      signal: view.net.inr < 0 ? "risk" : "ok",
      signedValue: view.net.inr,
      tooltip: "Net Profit = Revenue minus all costs including marketing and tools.",
      detailTitle: "Net profit - this month",
      detailNote: "Net = revenue − all costs (COGS, marketing, tools, ops).",
      detailRows: [
        { label: "Revenue (money in)", inrMinor: view.revenue.inr, eurMinor: view.revenue.eur },
        { label: "All costs (money out)", inrMinor: view.revenue.inr - view.net.inr, eurMinor: view.revenue.eur - view.net.eur },
        // Dual-currency, so the popup flips with the toggle like every other row in it.
        { label: "Net by this day last month", inrMinor: metrics.prevSameDay.netInr, eurMinor: metrics.prevSameDay.netEur },
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
      detailTitle: "Gross profit - this month",
      detailNote: "Gross = revenue − COGS (direct delivery).",
      detailRows: [
        { label: "Revenue", inrMinor: metrics.revenue.inr, eurMinor: metrics.revenue.eur },
        { label: "COGS (delivery)", inrMinor: view.cogs.inr, eurMinor: view.cogs.eur },
      ],
    },
    {
      key: "cogs", label: "COGS this month", iconName: "package",
      inrMinor: view.cogs.inr, eurMinor: view.cogs.eur,
      detailTitle: "Cost of delivery - this month",
      detailNote: "By category, largest first.",
      detailRows: cogsCatSlices.length
        ? cogsCatSlices.map((c) => ({ label: c.label, inrMinor: c.amount.inr, eurMinor: c.amount.eur }))
        : [{ label: "No COGS-tagged expenses yet this month", text: "-" }],
    },
    {
      key: "expenses", label: "Expenses this month", iconName: "card",
      inrMinor: view.expenses.inr, eurMinor: view.expenses.eur,
      detailTitle: "Expenses - this month",
      detailNote: "By category, largest first.",
      detailRows: catSlices.length
        ? catSlices.map((c) => ({ label: c.label, inrMinor: c.amount.inr, eurMinor: c.amount.eur }))
        : [{ label: "No expenses yet this month", text: "-" }],
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
        ? levelItems.map((l) => ({ label: l.label, inrMinor: l.amount.inr, eurMinor: l.amount.eur }))
        : [{ label: "No revenue yet", text: "-" }],
    },
  ];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Wallet size={20} />}
        title="Finance"
        subtitle="Every figure carries both currencies - the ₹/€ toggle picks which one leads; the other sits beneath."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {line !== "ALL" && <Pill>{BUSINESS_LINE_LABELS[line]}</Pill>}
            {/* A real control, not a label. The old `<Pill>This month</Pill>` looked like one
                and did nothing - the page could only ever show the current calendar month. */}
            <PeriodBar spec={periodSpec} />
            <ExportButton entity="income" label="Income CSV" />
            <ExportButton entity="expenses" label="Expenses CSV" />
          </div>
        }
      />

      {/* The ₹/€ toggle heads the page and now wraps EVERYTHING below it - the business-line
          totals, the KPI cards, the bento grid AND the Income / Expenses / Pending / Commission
          tables. It began life inside the KPI header (only the KPIs flipped), then covered the
          top block; a figure that stayed in rupees while the toggle said EUR was the complaint.

          The two ANNUAL cards are the deliberate exception and stay in ₹: they plot a target, and
          `MonthlyTarget` stores `targetInrMinor` only, so converting it at today's rate would make
          a fixed target drift every time the ECB moves. Their cards say so. Making them flip
          honestly needs a EUR target column - a decision, not a formatting change.

          The provider emits no DOM node, so widening it changes no layout. */}
      <FinanceCurrencyProvider>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BusinessLineSwitch active={line} totalsInr={lineTotalsInr} totalsEur={lineTotalsEur} />
            <CurrencyToggle />
          </div>
          {seg && (
            <AllocationNote
              lineLabel={BUSINESS_LINE_LABELS[line]}
              directCost={{ inr: seg.directCostInr, eur: seg.directCostEur }}
              sharedCost={{ inr: seg.sharedCostInr, eur: seg.sharedCostEur }}
              revenueSharePct={seg.revenueSharePct}
            />
          )}
        </div>

        <FinanceKpis kpis={kpis} />

        {/* ENTRY FIRST - the day-to-day job here is typing a payment in, not reading a chart.
            The tabbed forms and their tables sit directly under the KPI row so they are reachable
            without scrolling past three annual charts; the charts are review material and follow. */}
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
                  canCreateStudent={isAdmin}
                  upcomingByStudent={upcomingByStudent}
                  upcomingInstalments={upcomingInstalments}
                  levelLines={levelLines}
                  payerOptions={payerOptions}
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

        {/* Reframes the KPI row above: every figure there is cash, and this says how much of it
            has actually been earned yet. Reads after the entry tabs, with the rest of the review
            material. */}
        <RecognitionCard
          monthLabel={monthLabel}
          cashInrMinor={recognition.cashInrMinor}
          recognisedInrMinor={recognition.recognisedInrMinor}
          deferredInrMinor={recognition.deferredInrMinor}
          confidence={recognitionConfidence(recognition)}
        />

        {/* Bento grid - hero + breakdowns left, top payments right. A client component, so every
            figure in it answers to the ₹/€ toggle (it used to be inline here and therefore INR). */}
        <FinanceBento
          revenue={view.revenue}
          expenses={view.expenses}
          net={view.net}
          revenueSeries={view.revenueSeries}
          momRevenuePct={momRevenuePct}
          prevNet={{ inr: metrics.prevSameDay.netInr, eur: metrics.prevSameDay.netEur }}
          levelRows={levelItems}
          categoryRows={catSlices}
          topPayments={topPayments.map((p) => ({
            id: p.id,
            studentName: p.studentName,
            studentCode: p.studentId ? studentCodeById[p.studentId] ?? null : null,
            levelLabel: PROGRAM_LEVEL_LABELS[p.programLevel] ?? p.programLevel,
            methodLabel: PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod,
            date: p.date,
            agg: p.agg,
          }))}
          priorityReceivables={priorityReceivables.map((p) => ({
            id: p.id,
            studentName: p.studentName,
            studentCode: p.studentId ? studentCodeById[p.studentId] ?? null : null,
            levelLabel: PROGRAM_LEVEL_LABELS[p.programLevel] ?? p.programLevel,
            balance: p.balance,
            dueDate: p.nextDueDate,
            overdue: p.overdue,
            daysOverdue: p.daysOverdue,
            wa: waByPending[p.id] ?? null,
          }))}
        />

      {/* §3.2/§3.3 - the year view the dashboard never had: cumulative target vs
          achieved across Jan–Dec, with a run-rate projection to year-end. */}
      <Card
        title={<CardTitle icon={<CalendarRange size={16} />}>Month on month - {annual.year}</CardTitle>}
        subtitle="Plan pace, actual and what it now takes to still make the year. Hover any month. Shown in ₹ - the monthly target is set in rupees."
      >
        <AnnualChart data={annual} />
      </Card>

      {/* F1 - the founder's own tracking sheet, rebuilt. Bars against plan, with the three
          reference horizontals (plan total, actual total, annualised run rate). Sits beside
          the line chart above on purpose: lines answer "where is this heading", bars answer
          "where are we against plan" - the sheet this replaces is a bar chart. */}
      <Card
        title={<CardTitle icon={<BarChart3 size={16} />}>Cumulative tracking - {annual.year}</CardTitle>}
        subtitle="Forecast vs actual, month by month. Months still to come are left blank rather than shown as zero. Shown in ₹ - the plan is set in rupees."
      >
        <CumulativeTrackingChart data={annual} />
      </Card>

      {/* §3.4 - recurring-revenue movement: is the client base under the revenue
          growing or shrinking? Not split by line: an enrolment's level maps to a
          programme, but churn is counted per student across the whole roster. */}
      <Card
        title={<CardTitle icon={<Users size={16} />}>Client movement - {annual.year}</CardTitle>}
        subtitle="Clients gained and lost each month against the active client base."
      >
        <ClientMovementChart months={clientMovement} />
      </Card>

      </FinanceCurrencyProvider>
    </div>
  );
}
