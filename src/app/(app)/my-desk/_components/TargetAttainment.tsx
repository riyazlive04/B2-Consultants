"use client";

import { RankedBars, type RankedRow } from "@/components/ui/chart";
import { attainmentPct } from "@/lib/chart";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import type { TargetSpec } from "@/lib/outreach-sla";

/**
 * JD target attainment, ranked worst-first - the specialist's triage list.
 *
 * ── THE DEFECT THIS REPLACES ─────────────────────────────────────────────────────────────────
 * Both desks rendered their targets as a flat grid of KPI cards, each with its own progress bar
 * scaled to its OWN target. So "25" against a 30-call floor (83% of target - nearly there) and
 * "25" against a 100% requirement (a crisis) drew **the same length bar**, side by side, in
 * identical cards. The screen could show eight numbers but could not answer the question a
 * specialist actually opens it with at 4pm: *which of these can I still fix today?*
 *
 * ── THE FIX ──────────────────────────────────────────────────────────────────────────────────
 * Normalise every metric to **percent of its own target** (`attainmentPct`) so all of them share
 * one scale, then rank worst-first so the answer is the top row. A tick at 100% is the target and
 * a tick at the amber threshold is the floor, which makes each bar a bullet chart: position
 * against the ticks is the verdict, and no axis reading is required.
 *
 * ── WHAT IS DELIBERATELY PRESERVED ───────────────────────────────────────────────────────────
 * Replacing KPI cards must not cost information, so every row still carries:
 *   · the REAL figure (`display`) - attainment is the comparator, not the number being reported
 *   · the target, inline
 *   · the signal colour, from the same `signalForTarget` the cards used, so red still means red
 *   · the plain-English definition, via `hint` → `InfoHint` (§5.3 requires one on every rate)
 *
 * ── HONESTY NOTES ────────────────────────────────────────────────────────────────────────────
 * Attainment is UNCAPPED: 140% of a 30-call floor is a good day and clamping it to "done" would
 * hide the best performer. And a null metric is NOT 0% - it means nothing happened yet, which is
 * not a failure, so those rows sort to the bottom and say so rather than showing a red zero the
 * specialist can do nothing about.
 */
export function TargetAttainment<K extends string>({
  specs,
  values,
  signalFor,
  order,
}: {
  specs: Record<K, TargetSpec>;
  values: Record<K, number | null>;
  /** The desk's own signal rule, so the bar colour matches what the cards showed. */
  signalFor: (k: K, value: number | null) => SignalLevel | null;
  /**
   * Fallback order for rows that cannot be ranked (nothing measured yet). Defaults to the spec
   * object's own key order, which is the JD order - deriving it beats a second hand-kept list
   * that can silently drift out of step with the specs.
   */
  order?: readonly K[];
}) {
  const keys = order ?? (Object.keys(specs) as K[]);
  const rows: RankedRow[] = keys.map((k) => {
    const spec = specs[k];
    const value = values[k];
    const isPct = spec.unit === "pct";
    const attained = attainmentPct(value, spec.green);
    const signal = signalFor(k, value);
    const unit = isPct ? "%" : "";

    return {
      key: k,
      label: spec.label,
      // Sort key and bar length are the same thing: progress toward this metric's own target.
      value: attained ?? 0,
      // The REAL figure, not the attainment - attainment is how the rows are made comparable,
      // it is not the number being reported.
      display: value === null ? "-" : `${Math.round(value)}${unit}`,
      // Always the target, never "nothing measured yet": the value column already shows "-" for
      // an unmeasured metric, so the long form said the same thing twice and was the only string
      // here wide enough to truncate. The target is the fact the reader still needs.
      meta: `of ${spec.green}${unit}`,
      hint: spec.tooltip,
      barColor: signal ? SIGNAL_META[signal].color : "var(--border-strong)",
      markers:
        value === null
          ? undefined
          : [
              { value: 100, label: "Target", color: "var(--ink)" },
              // The amber floor, expressed on the same normalised scale. Below this tick the
              // metric is red - so the two ticks bracket "acceptable".
              {
                value: (spec.amber / spec.green) * 100,
                label: `Amber floor (${spec.amber}${unit})`,
                color: "var(--warn)",
              },
            ],
    };
  });

  // Worst first - that ordering IS the recommendation. Unmeasured rows go last: they are not
  // failures and must not occupy the position reserved for "fix this now".
  // Keyed off the source value rather than the rendered "-", so a formatting change to `display`
  // can never silently reshuffle the ranking.
  const ranked = [...rows].sort((a, b) => {
    const aNull = values[a.key as K] === null;
    const bNull = values[b.key as K] === null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    return a.value - b.value;
  });

  return (
    <RankedBars
      rows={ranked}
      // Attainment percentages do not sum, so a "share of total" column would be meaningless.
      showShare={false}
      srCaption="Progress toward each job-description target, worst first"
      emptyTitle="No targets to show"
      emptyBody="Your targets appear here once your team profile is linked."
      footnote="Each bar is progress toward that metric's own target, so metrics scored out of 30 and out of 100 can be compared. The dark tick is target; the amber tick is the floor below which the metric turns red."
    />
  );
}
