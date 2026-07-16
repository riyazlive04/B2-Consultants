"use client";

import { BarChart3 } from "lucide-react";
import { Card, CardTitle, EmptyState, Grid, Panel, Stat } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatPct } from "@/lib/format";
import { groupByLabel, objectLabel, type ReportObject, type ReportResult, type ReportRow } from "@/lib/reports";

const SUM_LABEL: Record<ReportObject, string> = {
  contacts: "Total",
  opportunities: "Pipeline value",
  invoices: "Total amount",
};

export default function ReportTable({
  object,
  groupBy,
  result,
}: {
  object: ReportObject;
  groupBy: string;
  result: ReportResult;
}) {
  const hasSum = result.totalSumInr !== null;
  const hasWinRate = result.overallWinRatePct !== null;
  const groupLabel = groupByLabel(object, groupBy);

  const columns: Column<ReportRow>[] = [
    { key: "label", header: groupLabel, cell: (r) => <span className="font-medium text-ink">{r.label}</span>, value: (r) => r.label },
    { key: "count", header: "Count", align: "right", cell: (r) => r.count.toLocaleString("en-IN"), value: (r) => r.count },
    ...(hasSum
      ? [
          {
            key: "sum",
            header: SUM_LABEL[object],
            align: "right" as const,
            cell: (r: ReportRow) => r.sumInr ?? "—",
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
            cell: (r: ReportRow) => (r.winRatePct != null ? formatPct(r.winRatePct) : "—"),
            value: (r: ReportRow) => r.winRatePct,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Grid cols={hasSum && hasWinRate ? 3 : 2}>
        <Panel>
          <Stat label={`${objectLabel(object)} matched`} value={result.totalCount.toLocaleString("en-IN")} />
        </Panel>
        {hasSum && (
          <Panel>
            <Stat label={`Total ${SUM_LABEL[object].toLowerCase()}`} value={result.totalSumInr!} />
          </Panel>
        )}
        {hasWinRate && (
          <Panel>
            <Stat label="Overall win rate" value={formatPct(result.overallWinRatePct!)} />
          </Panel>
        )}
      </Grid>

      <Card title={<CardTitle icon={<BarChart3 size={17} />}>{objectLabel(object)} by {groupLabel.toLowerCase()}</CardTitle>} flush>
        {result.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<BarChart3 size={22} />} title="No records to group" body="Nothing matches this object yet." />
          </div>
        ) : (
          <DataTable
            rows={result.rows}
            columns={columns}
            csvName={`report-${object}-${groupBy}`}
            filterPlaceholder={`Filter ${groupLabel.toLowerCase()}…`}
          />
        )}
      </Card>
    </div>
  );
}
