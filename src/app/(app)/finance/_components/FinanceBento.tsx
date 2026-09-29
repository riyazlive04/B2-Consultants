"use client";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  PieChart,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { Donut } from "@/components/ui/charts";
import { RankedBars } from "@/components/ui/chart";
import { Card, CardTitle, EmptyState } from "@/components/ui/kit";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { sendPaymentReminderMsg } from "@/server/whatsapp-actions";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { formatDate, formatPct } from "@/lib/format";
import { money, moneyAlt, type MoneyAgg } from "@/lib/money-display";
import { signedColor } from "@/lib/signals";
import { RevenueChart, type RevenuePoint } from "./RevenueChart";
import { useFinanceCcy } from "./FinanceCurrency";

/**
 * The Finance bento grid - revenue hero, level mix, top payments, expense donut, money in/out.
 *
 * These five cards used to be rendered inline by the (server) Finance page, formatting every
 * figure as INR. That is why the ₹/€ toggle only ever flipped the KPI row: a server component
 * cannot read the client context the toggle lives in. Lifting them into one client component
 * makes the whole grid answer to the toggle, and keeps a single place where the page's money
 * formatting rule ("chosen currency leads, other beneath") is applied.
 *
 * Everything arrives as PLAIN DATA holding BOTH aggregates - no pre-formatted strings, or the
 * currency would be baked in on the server again. Nothing here converts: each figure already
 * carries its INR and EUR aggregate (lib/money.ts), and the toggle only picks which one leads.
 */

/**
 * "Revenue is exact for this line; shared costs add a further X" - the sentence that says which
 * half of a per-line P&L is measured and which half is apportioned. A client component purely so
 * its two money figures flip with the toggle instead of being baked to INR on the server.
 */
export function AllocationNote({
  lineLabel,
  directCost,
  sharedCost,
  revenueSharePct,
}: {
  lineLabel: string;
  directCost: MoneyAgg;
  sharedCost: MoneyAgg;
  revenueSharePct: number;
}) {
  const { ccy } = useFinanceCcy();
  const c = { compact: true } as const;
  return (
    <p className="text-caption text-muted">
      Revenue and receivables are exact for {lineLabel}. {money(directCost, ccy, c)} of costs are
      tagged to it directly; shared costs add a further {money(sharedCost, ccy, c)} at its{" "}
      {Math.round(revenueSharePct)}% share of revenue. Tag more costs on the Expenses tab to sharpen
      this.
    </p>
  );
}

/** A ranked/sliced row before a currency has been chosen. */
export type MixRow = {
  key: string;
  label: string;
  amount: MoneyAgg;
  compare?: MoneyAgg;
  color: string;
};

export type TopPayment = {
  id: string;
  studentName: string;
  studentCode?: string | null;
  levelLabel: string;
  methodLabel: string;
  date: string;
  agg: MoneyAgg;
};

/** A receivable worth chasing first - sorted most-overdue and largest-balance to the top. */
export type PriorityReceivable = {
  id: string;
  studentName: string;
  studentCode?: string | null;
  levelLabel: string;
  balance: MoneyAgg;
  dueDate: string | null;
  overdue: boolean;
  daysOverdue: number;
  wa: WhatsAppStatusCell | null;
};

export function FinanceBento({
  revenue,
  expenses,
  net,
  revenueSeries,
  momRevenuePct,
  prevNet,
  levelRows,
  categoryRows,
  topPayments,
  priorityReceivables,
}: {
  revenue: MoneyAgg;
  expenses: MoneyAgg;
  net: MoneyAgg;
  revenueSeries: RevenuePoint[];
  momRevenuePct: number | null;
  prevNet: MoneyAgg;
  levelRows: MixRow[];
  categoryRows: MixRow[];
  topPayments: TopPayment[];
  priorityReceivables: PriorityReceivable[];
}) {
  const { ccy } = useFinanceCcy();
  const c = { compact: true } as const;

  // Bar widths compare magnitudes within the chosen currency, so the two bars stay in the same
  // proportion whichever currency is showing.
  const pick = (m: MoneyAgg) => (ccy === "EUR" ? m.eur : m.inr);
  const flowMax = Math.max(1, pick(revenue), pick(expenses));

  const rank = (rows: MixRow[]) =>
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: pick(r.amount),
      display: money(r.amount, ccy, c),
      ...(r.compare
        ? { compareValue: pick(r.compare), compareDisplay: money(r.compare, ccy, c) }
        : {}),
      color: r.color,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title={<CardTitle icon={<TrendingUp size={16} />}>Revenue</CardTitle>}>
        <p className="font-display text-4xl font-bold tracking-tight">{money(revenue, ccy, c)}</p>
        <p className="mt-1 text-xs text-muted">
          {moneyAlt(revenue, ccy, c)} aggregated · daily, this month · hover or arrow-key any day for
          its breakdown
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
        {/* 210, not the old 170: past 200 the shared frame fits a fourth y tick, and three ticks
            across a month of daily bars left the middle of the range unlabelled. */}
        <div className="mt-4">
          <RevenueChart points={revenueSeries} height={210} />
        </div>
      </Card>

      <Card
        title={<CardTitle icon={<BarChart3 size={16} />}>Revenue by programme level</CardTitle>}
        subtitle="This month, ranked - with where each level stood by this day last month."
      >
        <RankedBars
          rows={rank(levelRows)}
          compareLabel="by this day last month"
          srCaption="Revenue this month by programme level, against the same days of last month"
          emptyTitle="No revenue yet this month"
          emptyBody="Income entries added under the Income tab appear here, split by programme level."
        />
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
                    <span className="truncate" title={p.studentName}>{p.studentName}</span>
                    {p.studentCode && (
                      <span className="tnum flex-none text-caption font-medium text-ink-3">{p.studentCode}</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {p.levelLabel} · {p.methodLabel} · {formatDate(p.date)}
                  </span>
                </span>
                <span className="flex-none text-right">
                  <span className="block font-display text-h2 font-bold text-ink">{money(p.agg, ccy, c)}</span>
                  <span className="tnum block text-caption text-muted">{moneyAlt(p.agg, ccy, c)}</span>
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
        <Donut
          slices={categoryRows.map((r) => ({
            label: r.label,
            value: pick(r.amount),
            display: money(r.amount, ccy, c),
            color: r.color,
          }))}
          centerLabel="This month"
          centerValue={money(expenses, ccy, c)}
        />
      </Card>

      <Card
        title={<CardTitle icon={<ArrowLeftRight size={16} />}>Money in vs money out</CardTitle>}
        subtitle="This month, on one scale - the gap is the profit."
      >
        <p
          className="font-display text-3xl font-bold tracking-tight"
          style={{ color: signedColor(net.inr) ?? "var(--ink)" }}
        >
          {money(net, ccy, c)}
        </p>
        <p className="text-xs text-muted">
          net this month · {moneyAlt(net, ccy, c)}
          {pick(prevNet) !== 0 && (
            <span className="tnum"> · was {money(prevNet, ccy, c)} by this day last month</span>
          )}
        </p>
        <div className="mt-5 space-y-4">
          {(
            [
              { label: "Money in", m: revenue, icon: <ArrowDownLeft size={16} />, color: "var(--ok)", soft: "var(--ok-soft)" },
              { label: "Money out", m: expenses, icon: <ArrowUpRight size={16} />, color: "var(--risk)", soft: "var(--risk-soft)" },
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
                  <span className="tnum text-sm font-semibold">{money(row.m, ccy, c)}</span>
                </div>
                <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(pick(row.m) / flowMax) * 100}%`, background: row.color }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        className="lg:col-span-3"
        title={<CardTitle icon={<AlertCircle size={16} />}>Priority collections</CardTitle>}
        subtitle="Students who still owe fees - most overdue and largest balances first. Collect with them first."
      >
        {priorityReceivables.length === 0 ? (
          <EmptyState
            title="Nothing pending"
            body="Every active receivable is fully collected. New balances from the Pending payments tab show up here."
          />
        ) : (
          <ol className="divide-y divide-line">
            {priorityReceivables.map((p, i) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 py-3.5 first:pt-0 sm:flex-nowrap"
              >
                <span
                  className={`grid h-9 w-9 flex-none place-items-center rounded-full font-display text-sm font-bold ${
                    p.overdue ? "bg-risk-soft text-risk" : "bg-primary-soft text-primary-strong"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-1.5 text-sm font-semibold">
                    <span className="truncate" title={p.studentName}>{p.studentName}</span>
                    {p.studentCode && (
                      <span className="tnum flex-none text-caption font-medium text-ink-3">{p.studentCode}</span>
                    )}
                    {p.overdue && <SignalBadge level="risk" size="sm" label={`${p.daysOverdue}d overdue`} />}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {p.levelLabel} · {p.dueDate ? `due ${formatDate(p.dueDate)}` : "no due date set"}
                  </span>
                </span>
                <span className="flex-none text-right">
                  <span className="block font-display text-h2 font-bold text-ink">{money(p.balance, ccy, c)}</span>
                  <span className="tnum block text-caption text-muted">{moneyAlt(p.balance, ccy, c)}</span>
                </span>
                <span className="flex flex-none items-center gap-2">
                  {p.wa && <WhatsAppStatusBadge status={p.wa.status} kind={p.wa.kind} at={p.wa.at} />}
                  <SendWhatsAppButton
                    action={() => sendPaymentReminderMsg(p.id)}
                    label="Remind"
                    variant="button"
                    lastSentAt={p.wa?.at ?? null}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
