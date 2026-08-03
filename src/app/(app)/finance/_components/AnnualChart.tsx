"use client";

import { TimeSeriesChart } from "@/components/ui/chart";
import { formatInrMinor, formatPct } from "@/lib/format";
import { SIGNAL_META, signalForPercent } from "@/lib/signals";
import type { AnnualPerformance } from "@/server/annual-metrics";

/**
 * Month-on-month, redesigned around four questions read in order: where the plan says we
 * should be, where we actually are, what share of the plan that is, and what it now takes to
 * still make the year. The chart and the sentence beneath it exist to answer that fourth
 * question in one read, rather than asking the founder to do the division themselves.
 *
 * WAS: a green target line and a blue achieved line racing each other with a shaded gap, which
 * answers "are we ahead or behind" but not "behind by how much, starting when, and what does it
 * take from here" — the questions this dashboard is actually for. Rebuilt on the shared
 * `TimeSeriesChart` (area mode) so plan, actual and the run-rate projection get the same
 * measured-pixel axis, wrapping legend and hover tooltip as every other chart on the page,
 * instead of a bespoke `viewBox` SVG with its own 9px text.
 *
 * Only the ACTUAL line gets the area fill (`TimeSeriesChart` never fills a `compare` series) —
 * plan and the projection are context, drawn dashed so they read as "not measured" at a glance.
 */
export function AnnualChart({ data }: { data: AnnualPerformance }) {
  const { year, months, achievedToDateInr, targetToDateInr, fullYearTargetInr, projectedYearEndInr } = data;
  const compact = (v: number) => formatInrMinor(v, { compact: true });

  const current = months.find((m) => m.isCurrent) ?? months[months.length - 1];
  const curIdx = current.month;
  const elapsed = months.filter((m) => !m.isFuture);
  const remainingMonths = months.length - 1 - curIdx;
  const gapInr = fullYearTargetInr - achievedToDateInr;

  const attainmentPct = targetToDateInr > 0 ? (achievedToDateInr / targetToDateInr) * 100 : 0;
  const attainmentTone = SIGNAL_META[signalForPercent(attainmentPct)].color;

  const neededPerMonthInr = remainingMonths > 0 ? Math.max(0, gapInr) / remainingMonths : 0;
  const nextLabel = remainingMonths > 0 ? months[curIdx + 1].label : null;
  const lastLabel = months[months.length - 1].label;

  const tiles: Array<{ label: string; value: string; tone?: string }> = [
    { label: `Plan pace by ${current.label}`, value: compact(targetToDateInr) },
    { label: "Actual", value: compact(achievedToDateInr) },
    { label: "Attainment", value: formatPct(attainmentPct), tone: attainmentTone },
    remainingMonths > 0
      ? { label: `Needed ${nextLabel}–${lastLabel}`, value: `${compact(neededPerMonthInr)}/mo` }
      : { label: "Gap to close", value: compact(Math.max(0, gapInr)) },
  ];

  // The one-paragraph "so what" beneath the chart — branches on the shape of the year rather
  // than always narrating a shortfall, so a business that is ahead of plan doesn't get told to
  // panic in red.
  const insight = (() => {
    if (gapInr <= 0) {
      return {
        tone: "ok" as const,
        text: `Already at ${compact(achievedToDateInr)} against a ${compact(fullYearTargetInr)} full-year plan, with ${remainingMonths} month${remainingMonths === 1 ? "" : "s"} still to run — ${compact(-gapInr)} ahead of pace.`,
      };
    }
    const peak = elapsed.reduce((top, m) => (m.achievedInr > top.achievedInr ? m : top), elapsed[0]);
    const recent = elapsed[elapsed.length - 1];
    const rate = recent.achievedInr > 0 ? neededPerMonthInr / recent.achievedInr : null;
    const multiple = rate !== null ? (rate < 10 ? `${Math.round(rate * 10) / 10}×` : `${Math.round(rate)}×`) : null;

    if (remainingMonths <= 0) {
      return {
        tone: "risk" as const,
        text: `${lastLabel} is the last month to close the ${compact(gapInr)} gap to the ${compact(fullYearTargetInr)} full-year plan.`,
      };
    }

    const trendPhrase =
      peak.month !== recent.month && peak.achievedInr > recent.achievedInr
        ? `Monthly intake peaked at ${compact(peak.achievedInr)} in ${peak.label} and has fallen to ${compact(recent.achievedInr)} in ${recent.label}.`
        : `Monthly intake stands at ${compact(recent.achievedInr)} in ${recent.label}.`;
    const closePhrase =
      multiple !== null
        ? `Closing the ${compact(gapInr)} gap needs about ${multiple} the recent monthly rate, every month, for the rest of the year.`
        : `Closing the ${compact(gapInr)} gap needs ${compact(neededPerMonthInr)}/mo from ${nextLabel} to ${lastLabel}.`;
    return { tone: "risk" as const, text: `${trendPhrase} ${closePhrase}` };
  })();

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((t) => (
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

      <TimeSeriesChart
        mode="area"
        height={280}
        points={months.map((m) => ({ label: m.label, fullLabel: `${m.label} ${year}` }))}
        series={[
          {
            key: "plan",
            label: "Plan",
            color: "var(--ink-3)",
            compare: true,
            values: months.map((m) => m.cumTargetInr),
          },
          {
            key: "actual",
            label: "Actual",
            color: "var(--primary)",
            values: months.map((m) => (m.isFuture ? null : m.cumAchievedInr)),
          },
          {
            key: "projected",
            label: "At current run rate",
            color: "var(--bad)",
            compare: true,
            // Starts AT the current month so the dotted tail visibly picks up exactly where the
            // solid actual line stops, rather than jumping in from a disconnected point.
            values: months.map((m, i) => (i >= curIdx ? m.cumProjectedInr : null)),
          },
        ]}
        formatValue={compact}
        formatTooltip={(v) => formatInrMinor(v)}
        extraTooltipRows={(i) => {
          const m = months[i];
          if (!m || m.isFuture) return [];
          const variance = m.cumAchievedInr - m.cumTargetInr;
          return [{ label: variance >= 0 ? "Ahead of plan" : "Behind plan", value: formatInrMinor(Math.abs(variance)) }];
        }}
        srCaption={`Cumulative revenue against plan for ${year}, with a projection at today's run rate`}
        emptyTitle="No revenue yet this year"
        emptyBody="Income entries added under the Income tab build this chart month by month."
      />

      <div
        className={`mt-4 rounded-card border p-4 text-sm ${
          insight.tone === "ok" ? "border-ok bg-ok-soft text-ok" : "border-risk bg-risk-soft text-risk"
        }`}
      >
        {insight.text}
      </div>
    </div>
  );
}
