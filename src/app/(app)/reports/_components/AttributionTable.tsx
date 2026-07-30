import { PERFORMANCE_LABELS } from "@/lib/attribution";
import type { AttributionRow } from "@/server/insights-metrics";

/**
 * Campaign attribution (ER v2 Track F) — the diagram's `INSIGHT` entity, rendered rather
 * than stored.
 *
 * Two presentation rules carry the meaning:
 *   · a null ratio renders as "—", never as ₹0. A campaign with no spend recorded is not a
 *     campaign with a free lead, and showing 0 would sort it to the top of "cheapest
 *     acquisition" and get the budget moved onto it.
 *   · performance is banded against the PERIOD'S OWN MEDIAN, not a fixed threshold, so the
 *     column keeps meaning something when the market moves and nobody re-tunes a constant.
 */

const inr = (paise: number | null) =>
  paise === null ? "—" : `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * §5.7 status badge tones.
 *
 * These were `text-ok-ink`, `text-warn-ink` and `bg-surface-3` — none of which exist in
 * tailwind.config.ts (`ok`/`warn` expose only `DEFAULT` and `soft`; `surface` only `DEFAULT`
 * and `2`). Tailwind emits nothing for a class it cannot resolve, so the "vs median" badge was
 * shipping as unstyled text on three of its four states: the column that decides where ad budget
 * goes had no colour at all.
 */
const BAND_STYLE: Record<string, string> = {
  high: "bg-ok-soft text-ok",
  low: "bg-warn-soft text-warn",
  mid: "bg-surface-2 text-ink-2",
  unrated: "bg-surface-2 text-ink-3",
};

export default function AttributionTable({ rows }: { rows: AttributionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-sm text-ink-3">
        No campaigns yet. Add a marketing source and tag leads with it to see cost per lead,
        cost per acquisition and ROAS per campaign.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-caption uppercase text-ink-3">
            <th className="px-4 py-3 font-medium">Campaign</th>
            <th className="px-4 py-3 text-right font-medium">Spend</th>
            <th className="px-4 py-3 text-right font-medium">Leads</th>
            <th className="px-4 py-3 text-right font-medium">Enrolled</th>
            <th className="px-4 py-3 text-right font-medium">Conv %</th>
            <th className="px-4 py-3 text-right font-medium">CPL</th>
            <th className="px-4 py-3 text-right font-medium">CAC</th>
            <th className="px-4 py-3 text-right font-medium">Revenue</th>
            <th className="px-4 py-3 text-right font-medium">ROAS</th>
            <th className="px-4 py-3 font-medium">vs median</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.sourceId}>
              <td className="px-4 py-3">
                <div className="font-medium text-ink">{r.campaign}</div>
                <div className="text-caption text-ink-3">{r.channel.replace(/_/g, " ").toLowerCase()}</div>
              </td>
              <td className="px-4 py-3 text-right text-ink-2">{inr(Number(r.spendInrMinor))}</td>
              <td className="px-4 py-3 text-right text-ink-2">{r.leads}</td>
              <td className="px-4 py-3 text-right text-ink-2">{r.enrolments}</td>
              <td className="px-4 py-3 text-right text-ink-2">{r.conversionPct}%</td>
              <td className="px-4 py-3 text-right text-ink-2">{inr(r.cplInrMinor)}</td>
              <td className="px-4 py-3 text-right text-ink-2">{inr(r.cacInrMinor)}</td>
              <td className="px-4 py-3 text-right text-ink-2">{inr(Number(r.revenueInrMinor))}</td>
              <td className="px-4 py-3 text-right font-semibold text-ink">
                {r.roas === null ? "—" : `${r.roas}×`}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-caption font-medium ${BAND_STYLE[r.performance]}`}>
                  {PERFORMANCE_LABELS[r.performance]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-caption text-ink-3">
        Leads and spend are counted inside the window; revenue is not. A lead captured in March
        that enrolls in May earned its campaign that money — clipping revenue to the window
        would make every recent campaign look like a failure.
      </p>
    </div>
  );
}
