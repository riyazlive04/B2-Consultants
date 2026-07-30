"use client";

import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Card, CardTitle, EmptyState } from "@/components/ui/kit";
import { StudentName } from "@/components/ui/StudentName";
import { formatInrMinor } from "@/lib/format";
import { AGE_BUCKETS, bucketForDaysOverdue, type AgeBucketKey } from "@/lib/ageing";

/**
 * Age analysis of the due balance (Error Log G1–G4).
 *
 * REPLACES a bucket-total column chart, which was wrong in two ways at once:
 *
 *   • G1 — the buckets were 1–30 / 31–60 / 61–90 / 90+ days. The collection cycle is at most
 *     a fortnight, so effectively every overdue receivable landed in the first column and the
 *     chart said nothing. They are weeks now.
 *
 *   • G2 — each bar was scaled to the LARGEST value in the set, so a student owing ₹75,000 of
 *     an agreed ₹1,25,000 rendered as a full bar and read as "owes everything". A bar is now
 *     scaled to that student's OWN agreed total, which is the only denominator that makes the
 *     length mean anything, and both figures are printed beside it.
 *
 * Per-student rows rather than one stacked bar per bucket (G3): a stacked segment could not say
 * who was inside it, which is the only thing this screen is consulted for. Each row carries the
 * student's ID next to their name — two students called "Anna Smith" is a real case here, and
 * has already caused a payment to be credited to the wrong one — and links to the record.
 *
 * "On schedule" is deliberately absent (G4). Money that is not late is not part of an ageing
 * analysis; it lives in the receivables list, and including it here made the one column nobody
 * needed dominate the chart.
 */

export type AgeRow = {
  /** PendingPayment id — the record a click opens. */
  id: string;
  studentName: string;
  studentId: string | null;
  /** Outstanding, in paise. */
  balanceInr: number;
  /** The full agreed amount, in paise — the denominator for this student's bar. */
  totalFeeInr: number;
  daysOverdue: number;
};

export function AgeAnalysis({
  rows,
  studentCodeById = {},
}: {
  rows: AgeRow[];
  studentCodeById?: Record<string, string>;
}) {
  // Only genuinely-late money, grouped by how late (G4).
  const byBucket = new Map<AgeBucketKey, AgeRow[]>();
  for (const r of rows) {
    if (r.daysOverdue <= 0 || r.balanceInr <= 0) continue;
    const key = bucketForDaysOverdue(r.daysOverdue);
    const list = byBucket.get(key) ?? [];
    list.push(r);
    byBucket.set(key, list);
  }

  const total = [...byBucket.values()].flat().reduce((s, r) => s + r.balanceInr, 0);
  const anything = byBucket.size > 0;

  return (
    <Card
      title={<CardTitle icon={<BarChart3 size={18} />}>Age analysis of due balance</CardTitle>}
      subtitle={
        anything
          ? `${formatInrMinor(total, { compact: true })} overdue · each bar shows what that student still owes against their agreed total`
          : "Nothing is overdue."
      }
    >
      {!anything ? (
        <EmptyState title="No overdue balances" body="Every receivable is within its due date." />
      ) : (
        <div className="space-y-5">
          {AGE_BUCKETS.map((bucket) => {
            const list = (byBucket.get(bucket.key) ?? []).sort((a, b) => b.balanceInr - a.balanceInr);
            if (list.length === 0) return null;
            const bucketTotal = list.reduce((s, r) => s + r.balanceInr, 0);

            return (
              <div key={bucket.key}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-label font-semibold uppercase" style={{ color: bucket.color }}>
                    {bucket.label}
                  </p>
                  <p className="tnum text-caption text-muted">
                    {list.length} student{list.length === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-ink">
                      {formatInrMinor(bucketTotal, { compact: true })}
                    </span>
                  </p>
                </div>

                <ul className="space-y-1.5">
                  {list.map((r) => {
                    // THE fix for G2. Guard the denominator: a receivable with no agreed total
                    // recorded would divide by zero, so it renders full — it owes everything
                    // that is known about it — rather than crashing or showing an empty bar.
                    const frac = r.totalFeeInr > 0 ? Math.min(1, r.balanceInr / r.totalFeeInr) : 1;
                    return (
                      <li key={r.id}>
                        <Link
                          href={`/finance?pending=${r.id}`}
                          className="group block rounded-field px-2 py-1.5 hover:bg-surface-2"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <span className="min-w-0 text-sm font-medium text-ink group-hover:underline">
                              <StudentName
                                name={r.studentName}
                                code={r.studentId ? studentCodeById[r.studentId] : null}
                              />
                            </span>
                            {/* Both figures, per G2 — the bar length is meaningless without them. */}
                            <span className="tnum flex-none text-caption text-muted">
                              <span className="font-semibold text-ink">
                                {formatInrMinor(r.balanceInr, { compact: true })}
                              </span>{" "}
                              of {formatInrMinor(r.totalFeeInr, { compact: true })} ·{" "}
                              {r.daysOverdue}d late
                            </span>
                          </div>
                          <div
                            className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2"
                            role="img"
                            aria-label={`${r.studentName} owes ${formatInrMinor(r.balanceInr)} of ${formatInrMinor(r.totalFeeInr)}, ${r.daysOverdue} days late`}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${frac * 100}%`, background: bucket.color }}
                            />
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
