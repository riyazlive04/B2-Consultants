"use client";

import Link from "next/link";
import { ArrowUpRight, Table2 } from "lucide-react";
import { Card, CardTitle, EmptyState } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { pctChange } from "@/lib/chart";
import { formatInrMinor, formatPct } from "@/lib/format";
import { groupByLabel, objectLabel, type ReportObject, type ReportResult, type ReportRow } from "@/lib/reports";

/**
 * The full result, every row and every measure - the chart's evidence.
 *
 * The chart shows ONE measure and at most twelve bars; this shows all of them, sorted, filterable
 * and exportable. That division is the point: the picture answers "which and how much", the table
 * answers "exactly, and what else is in here". Neither replaces the other, and rolling the long
 * tail into "Other" on the chart is only defensible because nothing is missing from here.
 *
 * Deltas render as a chip inside their measure's own cell rather than as separate Δ columns -
 * six columns of alternating figure/percentage is a table nobody scans. `value` is set on every
 * column so sorting and the CSV export use the raw number, not the rendered string.
 */
export default function ReportTable({
  object,
  groupBy,
  result,
  compareLabel,
  sumLabel,
}: {
  object: ReportObject;
  groupBy: string;
  result: ReportResult;
  compareLabel: string;
  sumLabel: string;
}) {
  const hasSum = result.totalSumMinor !== null;
  const hasWinRate = result.overallWinRatePct !== null;
  const hasCompare = compareLabel !== "";
  const groupLabel = groupByLabel(object, groupBy);

  const columns: Column<ReportRow>[] = [
    {
      key: "label",
      header: groupLabel,
      cell: (r) =>
        r.href ? (
          <Link
            href={r.href}
            className="group inline-flex items-center gap-1 font-medium text-ink hover:text-primary"
          >
            {r.label}
            <ArrowUpRight
              size={13}
              aria-hidden
              className="text-ink-3 transition-transform group-hover:-translate-y-0.5 group-hover:text-primary"
            />
            <span className="sr-only">- open the filtered list</span>
          </Link>
        ) : (
          <span className="font-medium text-ink">{r.label}</span>
        ),
      value: (r) => r.label,
    },
    {
      key: "count",
      header: "Count",
      align: "right",
      cell: (r) => (
        <Cell figure={r.count.toLocaleString("en-IN")} current={r.count} previous={r.prevCount} show={hasCompare} />
      ),
      value: (r) => r.count,
    },
    ...(hasSum
      ? [
          {
            key: "sum",
            header: sumLabel,
            align: "right" as const,
            cell: (r: ReportRow) => (
              <Cell
                figure={formatInrMinor(r.sumMinor ?? 0)}
                current={r.sumMinor ?? 0}
                previous={r.prevSumMinor}
                show={hasCompare}
              />
            ),
            value: (r: ReportRow) => r.sumMinor,
          },
        ]
      : []),
    ...(hasWinRate
      ? [
          {
            key: "winRate",
            header: "Win rate",
            align: "right" as const,
            cell: (r: ReportRow) => (
              <Cell
                figure={r.winRatePct != null ? formatPct(r.winRatePct) : "-"}
                current={r.winRatePct ?? 0}
                previous={r.prevWinRatePct}
                show={hasCompare}
              />
            ),
            value: (r: ReportRow) => r.winRatePct,
          },
        ]
      : []),
  ];

  return (
    <Card
      title={
        <CardTitle icon={<Table2 size={17} />}>
          Every {objectLabel(object).toLowerCase()} group
        </CardTitle>
      }
      subtitle={
        hasCompare
          ? `Each figure carries its change ${compareLabel}. Export includes the raw numbers.`
          : "All time - no previous period to compare against."
      }
      flush
    >
      {result.rows.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={<Table2 size={22} />}
            title="No records in this period"
            body="Nothing of this object was created inside the selected period. Widen the period, or pick a different object."
          />
        </div>
      ) : (
        <DataTable
          rows={result.rows}
          columns={columns}
          csvName={`report-${object}-${groupBy}`}
          filterPlaceholder={`Filter ${groupLabel.toLowerCase()}…`}
          // Chronological results arrive already ordered and must SAY so, or a reader assumes
          // the order is arbitrary and re-sorts a series that was already correct.
          defaultSort={result.chronological ? { key: "label", dir: "asc" } : undefined}
        />
      )}
    </Card>
  );
}

/** A figure with its period-on-period change beneath it. */
function Cell({
  figure,
  current,
  previous,
  show,
}: {
  figure: string;
  current: number;
  previous: number | null;
  show: boolean;
}) {
  const delta = show && previous != null ? pctChange(current, previous) : null;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tnum">{figure}</span>
      {show &&
        (delta === null ? (
          // "new" and "0%" are different facts. A group with no previous records did not hold
          // steady - it did not exist.
          <span className="text-caption text-ink-3">{previous ? "-" : "new"}</span>
        ) : (
          <span className={`text-caption font-semibold ${delta >= 0 ? "text-ok" : "text-risk"}`}>
            <span aria-hidden>{delta >= 0 ? "▲" : "▼"}</span>
            <span className="sr-only">{delta >= 0 ? "up" : "down"} </span>
            <span className="tnum">{Math.abs(delta).toFixed(1)}%</span>
          </span>
        ))}
    </span>
  );
}
