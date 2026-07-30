import { Filter, TrendingDown } from "lucide-react";
import { SectionHeading, ViewAll } from "@/components/ui/kit";
import { formatPct } from "@/lib/format";
import type { FunnelHealth, StageRow } from "@/lib/funnel-health";

/**
 * Row 5 of the executive dashboard (rebuild spec §4) — nine outreach stages, this month against
 * the six-month average, with the single biggest leak as the headline.
 *
 * The headline is the whole point. Nine conversion percentages is a report; "you are losing 18
 * people a month at the show-up step, against a rate you agreed to hold" is a decision. The spec
 * says as much: the 62%-vs-80% show rate "is the largest single leak in the funnel and should be
 * the headline metric".
 *
 * Read-only, and deliberately outside the business-line switcher: this is the B2 outreach funnel,
 * so rendering it under the German Note view would attach it to the wrong business.
 */

const pct = (v: number | null) => (v === null ? "—" : formatPct(v * 100));

/** Fractional benchmarks are averages; a "213.5" would read as a miscount rather than a mean. */
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function DeltaBadge({ row }: { row: StageRow }) {
  if (row.rateDelta === null) return <span className="text-caption text-muted">—</span>;
  const better = row.rateDelta >= 0;
  return (
    <span
      className="tnum text-caption font-semibold"
      style={{ color: better ? "var(--good)" : "var(--bad)" }}
    >
      {better ? "▲" : "▼"} {formatPct(Math.abs(row.rateDelta * 100))}
    </span>
  );
}

export function FunnelHealthRow({ health }: { health: FunnelHealth }) {
  const { rows, leak, benchmarkSource, monthsOfHistory } = health;

  const vsTarget = leak?.against === "target";
  const rateLabel = vsTarget ? "agreed" : "benchmark";

  const benchmarkNote =
    benchmarkSource === "history"
      ? `Benchmark is this app's own ${monthsOfHistory}-month average.`
      : `Not enough history yet (${monthsOfHistory} month${monthsOfHistory === 1 ? "" : "s"} with traffic) — benchmark is the published target from the rebuild spec.`;

  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Filter size={18} />}
        title="Funnel health"
        description="This month against the six-month benchmark — where the funnel is leaking"
        action={<ViewAll href="/pipeline">View pipeline</ViewAll>}
      />

      {leak ? (
        <div
          className="rounded-card border p-4"
          style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}
        >
          <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide" style={{ color: "var(--bad)" }}>
            <TrendingDown size={14} /> Biggest leak
          </p>
          <p className="mt-1.5 font-display text-h3 text-ink">
            {leak.row.stage.label} — {pct(leak.row.rate)}
            <span className="text-ink-2">
              {" "}
              vs {pct(vsTarget ? (leak.row.stage.targetRate ?? null) : leak.row.benchmarkRate)} {rateLabel}
            </span>
          </p>
          <p className="mt-1 text-sm text-ink-2">
            About <span className="font-semibold tnum">{Math.round(leak.peopleLost)}</span> people lost here this
            month at the {rateLabel} rate
            {vsTarget && " — this is a rate the team committed to, not just a historical average"}.
            Owned by <span className="font-semibold">{leak.row.stage.owner}</span>.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-2">
            No stage is below its benchmark this month. {benchmarkNote}
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left">
              <th className="px-4 py-2.5 font-semibold text-ink-2">Stage</th>
              <th className="px-3 py-2.5 font-semibold text-ink-2">Owner</th>
              <th className="px-3 py-2.5 text-right font-semibold text-ink-2">This month</th>
              <th className="px-3 py-2.5 text-right font-semibold text-ink-2">Rate</th>
              <th className="px-3 py-2.5 text-right font-semibold text-ink-2">Benchmark</th>
              <th className="px-4 py-2.5 text-right font-semibold text-ink-2">vs benchmark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isLeak = leak?.row.stage.key === r.stage.key;
              return (
                <tr
                  key={r.stage.key}
                  className="border-b border-line last:border-0"
                  style={isLeak ? { background: "var(--bad-bg)" } : undefined}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{r.stage.label}</span>
                    {r.stage.targetRate !== undefined && (
                      <span className="ml-2 text-caption text-muted">
                        agreed {formatPct(r.stage.targetRate * 100)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.stage.owner}</td>
                  <td className="px-3 py-2.5 text-right tnum font-semibold text-ink">{r.count}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-2">{pct(r.rate)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-muted">
                    {num(r.benchmarkCount)}
                    {r.benchmarkRate !== null && <span className="ml-1">({pct(r.benchmarkRate)})</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DeltaBadge row={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-caption text-muted">
        Each rate is conversion from the stage above it. {benchmarkNote}
      </p>
    </section>
  );
}
