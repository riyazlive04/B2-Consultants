import type { StageAging } from "@/server/pipeline-metrics";

/**
 * Pipeline "by time duration" view (issue 1.7) — how long open leads have sat in each stage.
 * Pure display, so it stays a server component (no client JS). Complements StageChart's
 * by-stage/by-value view: together they are the two pipeline views the doc asks for.
 */
export function AgingSection({ rows }: { rows: StageAging[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-sm text-ink-2">
        No open leads to age yet — every lead is either brand new or already closed.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-caption text-ink-3">
        Days each open lead has spent in its current stage. A high “oldest” is a lead going cold in
        the follow-up gap — work those first.
      </p>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-caption uppercase tracking-wide text-ink-3">
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 text-right font-medium">Leads</th>
              <th className="px-4 py-3 text-right font-medium">Avg&nbsp;days</th>
              <th className="px-4 py-3 text-right font-medium">Oldest</th>
              <th className="px-4 py-3 font-medium">Time in stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{r.label}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-2">{r.count}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-2">{r.avgDays}d</td>
                <td
                  className={`px-4 py-3 text-right font-medium tabular-nums ${
                    r.oldestDays > 14 ? "text-bad" : r.oldestDays > 7 ? "text-warn" : "text-ink-2"
                  }`}
                >
                  {r.oldestDays}d
                </td>
                <td className="px-4 py-3">
                  <AgeBar r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-3">
        <LegendDot color="var(--good)" label="0–3d" />
        <LegendDot color="var(--warn)" label="4–7d" />
        <LegendDot color="var(--bad)" opacity={0.5} label="8–14d" />
        <LegendDot color="var(--bad)" label="15d+" />
      </div>
    </div>
  );
}

// Colours come straight from the design tokens (globals.css) via inline CSS vars so a partial
// opacity ("stale") renders reliably — Tailwind's `/opacity` modifier is unreliable on
// var()-backed colours.
function AgeBar({ r }: { r: StageAging }) {
  const segments = [
    { n: r.fresh, color: "var(--good)", opacity: 1 },
    { n: r.warm, color: "var(--warn)", opacity: 1 },
    { n: r.stale, color: "var(--bad)", opacity: 0.5 },
    { n: r.cold, color: "var(--bad)", opacity: 1 },
  ].filter((s) => s.n > 0);
  return (
    <div className="flex h-2.5 w-40 overflow-hidden rounded-field bg-surface-2" title={`${r.count} leads`}>
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${(s.n / r.count) * 100}%`, backgroundColor: s.color, opacity: s.opacity }} />
      ))}
    </div>
  );
}

function LegendDot({ color, opacity = 1, label }: { color: string; opacity?: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, opacity }} />
      {label}
    </span>
  );
}
