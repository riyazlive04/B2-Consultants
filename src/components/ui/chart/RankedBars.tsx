"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { pctChange } from "@/lib/chart";
import { InfoHint } from "../InfoHint";
import { ChartSrTable } from "./ChartFrame";

/**
 * Ranked horizontal bars — "which of these is biggest, and is it growing?" (§5.8 "Bar").
 *
 * WHY HORIZONTAL, AND WHY NOT A PIE.
 * The categories this app ranks are named things with long labels — "Ghosted Blueprint",
 * "Instagram Reels", "Referral — existing student". Vertical columns give a label the bar's own
 * width (~40px) and it truncates or rotates; a horizontal bar gives it a whole line. And the
 * question here is *ranking*, not *share*: a pie answers "what fraction" and forces an angle
 * comparison for everything else, which is the slowest read in visualisation. Share is available
 * as a column for the cases where it matters, without spending the whole chart on it.
 *
 * COMPARISON IS A BULLET MARKER, NOT A SECOND BAR.
 * The previous period shows as a tick on the same track (Few's bullet chart) rather than a
 * paired ghost bar. A paired bar doubles the chart's height and makes the reader compare two
 * lengths in different rows; a marker puts "where you were" directly on "where you are", so the
 * gap between them IS the answer, read in one movement.
 *
 * HTML, not SVG — unlike the trend charts. Rows here are text-led and often clickable, and HTML
 * gives real truncation, real links, real focus rings and free keyboard order. SVG would mean
 * re-implementing all four.
 */

export type RankedRow = {
  key: string;
  label: string;
  value: number;
  /** Pre-formatted for display — money, count and percent format differently (§3). */
  display: string;
  /** Same measure, previous period. `null` means "this group did not exist then". */
  compareValue?: number | null;
  compareDisplay?: string;
  /** Fixed category colour (program levels are fixed app-wide, §1.3). Defaults to the primary series. */
  color?: string;
  /** Drill-down: the row becomes a link to the filtered list behind the number. */
  href?: string;
  /** One extra fact shown after the label — a win rate, a count behind a sum. */
  meta?: string;
  /**
   * Extra reference ticks on this row's track — a target, a threshold, a benchmark.
   *
   * `compareValue` above is the special case "where this was last period". This is the general
   * one, and it is what turns the chart into a proper bullet chart: the L1 desk needs "target"
   * and "amber threshold" markers, neither of which is a previous value.
   */
  markers?: Array<{ value: number; label: string; color?: string }>;
  /** Overrides the row's own bar colour — e.g. signal-coloured by whether it met target. */
  barColor?: string;
  /**
   * Plain-English definition, revealed on hover AND keyboard focus via `InfoHint`.
   *
   * Needed so a bullet chart can REPLACE a grid of KPI cards rather than sit beside it: §5.3
   * requires a definition affordance on every rate, and dropping it would trade one real defect
   * for another.
   */
  hint?: string;
};

export function RankedBars({
  rows,
  showShare = true,
  compareLabel,
  positiveIsGood = true,
  srCaption,
  emptyTitle = "Nothing to rank yet",
  emptyBody,
  footnote,
  maxRows,
}: {
  rows: readonly RankedRow[];
  /** Adds a "% of total" column. Turn OFF for measures that don't sum — averages, rates. */
  showShare?: boolean;
  /** e.g. "vs previous 30 days". Presence of this is what turns the comparison markers on. */
  compareLabel?: string;
  /** Expenses going up is bad; revenue going up is good. Colour follows the decision (§1.2). */
  positiveIsGood?: boolean;
  srCaption: string;
  emptyTitle?: string;
  emptyBody?: string;
  footnote?: React.ReactNode;
  /** Cap the drawn rows. The caller keeps the full set in its table — nothing is lost, only deferred. */
  maxRows?: number;
}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const total = rows.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0);
  // Scale to the largest bar, including every marker — a marker past the end of its own track
  // would otherwise be clipped and silently read as "no change" (or, for a target marker, as
  // "target met", which is the worst possible misreading).
  const max = Math.max(
    1,
    ...shown.map((r) =>
      Math.max(r.value, r.compareValue ?? 0, ...(r.markers ?? []).map((m) => m.value)),
    ),
  );

  if (shown.length === 0) {
    return (
      <div className="grid place-items-center rounded-field border border-dashed border-primary-tint bg-sky px-6 py-10 text-center">
        <div>
          <p className="font-display text-h3 text-ink">{emptyTitle}</p>
          {emptyBody && <p className="mt-1 max-w-sm text-sm text-ink-2">{emptyBody}</p>}
        </div>
      </div>
    );
  }

  return (
    <figure className="m-0">
      {/* `.bar-rows` opens a CSS container (globals.css) so the columns below respond to THIS
          list's width, not the window's. See the note there — viewport breakpoints silently
          broke this component inside narrow cards. */}
      <ul className="bar-rows space-y-1">
        {shown.map((r, i) => {
          const color = r.barColor ?? r.color ?? "var(--viz-1)";
          const pct = max > 0 ? (Math.max(0, r.value) / max) * 100 : 0;
          const comparePct =
            r.compareValue != null && max > 0 ? (Math.max(0, r.compareValue) / max) * 100 : null;
          const delta = r.compareValue != null ? pctChange(r.value, r.compareValue) : null;
          const share = total > 0 ? (r.value / total) * 100 : 0;
          const good = delta == null ? false : delta >= 0 === positiveIsGood;

          const body = (
            <>
              <span className="bar-row__label flex-none truncate text-body-strong text-ink" title={r.label}>
                {r.label}
                {r.meta && <span className="ml-1.5 font-normal text-caption text-ink-3">{r.meta}</span>}
                {r.hint && <InfoHint className="ml-1" text={r.hint} />}
              </span>

              {/* min-w keeps the track a track: without it the flex columns either side can
                  collapse it to nothing inside a narrow card, which is exactly what happened
                  on Finance's one-third-width bento cell. */}
              <span className="relative h-6 min-w-[3rem] flex-1 overflow-hidden rounded-field bg-surface-2">
                <span
                  className="absolute inset-y-0 left-0 rounded-field"
                  style={{ width: `${pct}%`, background: color }}
                />
                {/* Bullet marker: where this group stood last period. */}
                {comparePct !== null && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1 w-0.5 rounded-full"
                    style={{ left: `calc(${comparePct}% - 1px)`, background: "var(--ink-2)" }}
                    title={r.compareDisplay ? `Previous: ${r.compareDisplay}` : undefined}
                  />
                )}

                {/* Reference markers — target, threshold, benchmark. Full-height so they read as
                    a line the bar is measured against, rather than as part of the bar. */}
                {(r.markers ?? []).map((m, mi) => {
                  const left = max > 0 ? (Math.max(0, m.value) / max) * 100 : 0;
                  return (
                    <span
                      key={mi}
                      aria-hidden
                      className="absolute inset-y-0 w-[2px]"
                      style={{ left: `calc(${left}% - 1px)`, background: m.color ?? "var(--ink)" }}
                      title={`${m.label}: ${m.value}`}
                    />
                  );
                })}
              </span>

              <span className="tnum w-20 flex-none text-right text-body-strong text-ink">
                {r.display}
              </span>

              {showShare && (
                <span className="bar-row__share tnum w-11 flex-none text-right text-caption text-ink-3">
                  {share.toFixed(share >= 10 ? 0 : 1)}%
                </span>
              )}

              {compareLabel && (
                <span className="bar-row__delta w-16 flex-none justify-end">
                  {delta === null ? (
                    // `pctChange` returns null when the base is zero or non-finite. A group with
                    // no records last period is NEW, not unchanged — and this must read exactly
                    // as the table does, or the same fact appears twice on one screen under two
                    // different words.
                    <span className="text-caption text-ink-3">
                      {!r.compareValue ? "new" : "—"}
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption font-semibold ${
                        good ? "bg-ok-soft text-ok" : "bg-risk-soft text-risk"
                      }`}
                    >
                      {/* Arrow is decorative; direction is spoken, so the chip never relies on
                          colour alone (§7). */}
                      <span aria-hidden>{delta >= 0 ? "▲" : "▼"}</span>
                      <span className="sr-only">{delta >= 0 ? "up" : "down"} </span>
                      <span className="tnum">{Math.abs(delta).toFixed(0)}%</span>
                    </span>
                  )}
                </span>
              )}

              {r.href && (
                <ChevronRight
                  size={15}
                  aria-hidden
                  className="bar-row__chev flex-none text-ink-3 transition-transform group-hover:translate-x-0.5"
                />
              )}
            </>
          );

          const rowClass =
            "row-lift flex items-center gap-3 rounded-field border border-transparent px-2.5 py-1.5";

          return (
            <li key={r.key} className="row-in" style={{ ["--i" as string]: i }}>
              {r.href ? (
                <Link href={r.href} className={`group ${rowClass}`}>
                  {body}
                </Link>
              ) : (
                <div className={rowClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {(footnote || compareLabel || (maxRows && rows.length > maxRows)) && (
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-3">
          {compareLabel && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-ink-2" />
              {compareLabel}
            </span>
          )}
          {maxRows && rows.length > maxRows && (
            <span>
              Top {maxRows} of {rows.length} — the full set is in the table below.
            </span>
          )}
          {footnote}
        </figcaption>
      )}

      <ChartSrTable
        caption={srCaption}
        data={{
          columns: [
            "Group",
            "Value",
            ...(showShare ? ["Share of total"] : []),
            ...(compareLabel ? ["Previous", "Change"] : []),
          ],
          rows: shown.map((r) => {
            const delta = r.compareValue != null ? pctChange(r.value, r.compareValue) : null;
            const share = total > 0 ? (r.value / total) * 100 : 0;
            return [
              r.label,
              r.display,
              ...(showShare ? [`${share.toFixed(1)}%`] : []),
              ...(compareLabel
                ? [
                    r.compareDisplay ?? (r.compareValue == null ? "No data" : String(r.compareValue)),
                    delta === null
                      ? !r.compareValue
                        ? "New this period"
                        : "Not comparable"
                      : `${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)}%`,
                  ]
                : []),
            ];
          }),
        }}
      />
    </figure>
  );
}
