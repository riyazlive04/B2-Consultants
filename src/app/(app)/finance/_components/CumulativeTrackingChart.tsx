"use client";

import { useState } from "react";
import { formatInrMinor } from "@/lib/format";
import type { AnnualPerformance } from "@/server/annual-metrics";

/**
 * Cumulative forecast vs actual (Error Log F1) — modelled on the client's own tracking sheet
 * ("Productivity / TCD Tracking", supplied as the reference screenshot).
 *
 * BARS, not lines. `AnnualChart` already plots the same two series as lines, and that is a
 * better read for trajectory — but the sheet the founder actually works from is a bar chart,
 * and the point of F1 is to replace that spreadsheet, not to offer a prettier alternative to
 * it. Both live on the page: bars for "where are we against plan", lines for "where is this
 * heading".
 *
 * The five elements the reference specifies, all present:
 *   • grey bars      — forecast (target) cumulative, every month of the year
 *   • dark blue bars — actual cumulative, elapsed months only
 *   • red dashed     — plan total for the year
 *   • green dashed   — actual total to date
 *   • blue dashed    — actual annualised, run-rate projected to year end
 *
 * FUTURE MONTHS RENDER NOTHING. The source spreadsheet shows `#WERT!` for months with no data
 * and F4 is explicit that we must not reproduce that — nor substitute a zero, which reads as
 * "achieved nothing" rather than "not yet". `isFuture` is the guard; the actual bar is simply
 * not drawn, and its label is omitted with it.
 */

const W = 860;
const H = 320;
const PAD_L = 56;
const PAD_R = 16;
const TOP = 26;
const BASE = H - 40;

export function CumulativeTrackingChart({ data }: { data: AnnualPerformance }) {
  const [hover, setHover] = useState<number | null>(null);
  const { months, fullYearTargetInr, achievedToDateInr, projectedYearEndInr } = data;

  // The scale must contain the tallest bar AND every dashed horizontal, or a line silently
  // falls outside the plot area.
  const yMax = Math.max(
    1,
    fullYearTargetInr,
    projectedYearEndInr,
    ...months.map((m) => Math.max(m.cumTargetInr, m.isFuture ? 0 : m.cumAchievedInr)),
  );

  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / months.length;
  const barW = Math.min(18, slot * 0.32);
  const y = (v: number) => TOP + (1 - v / yMax) * (BASE - TOP);
  const xSlot = (i: number) => PAD_L + i * slot;

  const compact = (v: number) => formatInrMinor(v, { compact: true });
  const h = hover !== null ? months[hover] : null;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 640, height: "auto" }}
        role="img"
        aria-label={`Cumulative forecast versus actual for ${data.year}. Plan total ${compact(
          fullYearTargetInr,
        )}, actual to date ${compact(achievedToDateInr)}, annualised ${compact(projectedYearEndInr)}.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* horizontal grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD_L} x2={W - PAD_R} y1={y(yMax * f)} y2={y(yMax * f)}
            stroke="var(--line)" strokeWidth="1"
          />
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={PAD_L - 8} y={y(yMax * f) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
            {compact(yMax * f)}
          </text>
        ))}

        {months.map((m, i) => {
          const cx = xSlot(i) + slot / 2;
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)}>
              {/* generous hover target — the bars are far too thin to aim at */}
              <rect x={xSlot(i)} y={TOP} width={slot} height={BASE - TOP} fill="transparent" />

              {/* forecast cumulative — grey, every month */}
              <rect
                x={cx - barW - 1} y={y(m.cumTargetInr)} width={barW}
                height={Math.max(0, BASE - y(m.cumTargetInr))}
                fill="var(--viz-ink)" opacity={hover === i ? 0.45 : 0.28}
              />
              {/* actual cumulative — dark blue, ELAPSED MONTHS ONLY (F4) */}
              {!m.isFuture && (
                <rect
                  x={cx + 1} y={y(m.cumAchievedInr)} width={barW}
                  height={Math.max(0, BASE - y(m.cumAchievedInr))}
                  fill="var(--primary)" opacity={hover === i ? 1 : 0.9}
                />
              )}

              {/* data label on every bar that exists — the reference prints them all */}
              {!m.isFuture && (
                <text
                  x={cx + 1 + barW / 2} y={y(m.cumAchievedInr) - 4}
                  textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--primary)"
                >
                  {compact(m.cumAchievedInr)}
                </text>
              )}

              <text x={cx} y={H - 22} textAnchor="middle" fontSize="9" fill="var(--muted)">
                {m.label}
              </text>
            </g>
          );
        })}

        {/* red dashed — plan total for the year */}
        <line
          x1={PAD_L} x2={W - PAD_R} y1={y(fullYearTargetInr)} y2={y(fullYearTargetInr)}
          stroke="var(--bad)" strokeWidth="1.5" strokeDasharray="6 4"
        />
        {/* green dashed — actual total to date */}
        <line
          x1={PAD_L} x2={W - PAD_R} y1={y(achievedToDateInr)} y2={y(achievedToDateInr)}
          stroke="var(--good)" strokeWidth="1.5" strokeDasharray="6 4"
        />
        {/* thin blue dashed — actual annualised at today's run rate */}
        <line
          x1={PAD_L} x2={W - PAD_R} y1={y(projectedYearEndInr)} y2={y(projectedYearEndInr)}
          stroke="var(--primary)" strokeWidth="1" strokeDasharray="3 3" opacity="0.8"
        />

        {hover !== null && h && (
          <g pointerEvents="none">
            <line
              x1={xSlot(hover) + slot / 2} x2={xSlot(hover) + slot / 2}
              y1={TOP} y2={BASE}
              stroke="var(--viz-ink)" strokeDasharray="3 3" strokeWidth="1"
            />
            {(() => {
              const boxW = 150;
              const tx = Math.min(Math.max(xSlot(hover) + slot / 2, PAD_L + boxW / 2), W - PAD_R - boxW / 2);
              return (
                <g transform={`translate(${tx - boxW / 2}, 2)`}>
                  <rect width={boxW} height={h.isFuture ? 32 : 44} rx="6" fill="var(--ink)" opacity="0.94" />
                  <text x={boxW / 2} y="13" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--on-accent)">
                    {h.label} {h.isFuture ? "(not yet)" : ""}
                  </text>
                  <text x={boxW / 2} y="25" textAnchor="middle" fontSize="9" fill="var(--on-accent)" opacity="0.85">
                    forecast {compact(h.cumTargetInr)}
                  </text>
                  {/* No "actual" line at all for a future month — never a zero (F4). */}
                  {!h.isFuture && (
                    <text x={boxW / 2} y="37" textAnchor="middle" fontSize="9" fill="var(--on-accent)" opacity="0.85">
                      actual {compact(h.cumAchievedInr)}
                    </text>
                  )}
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption font-medium text-ink-2">
        <Legend swatch={<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-ink)", opacity: 0.28 }} />}>
          forecast cumulative
        </Legend>
        <Legend swatch={<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--primary)" }} />}>
          actual cumulative
        </Legend>
        <Legend swatch={<Dash color="var(--bad)" />}>plan total {compact(fullYearTargetInr)}</Legend>
        <Legend swatch={<Dash color="var(--good)" />}>actual total {compact(achievedToDateInr)}</Legend>
        <Legend swatch={<Dash color="var(--primary)" thin />}>annualised {compact(projectedYearEndInr)}</Legend>
      </div>
    </div>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

function Dash({ color, thin = false }: { color: string; thin?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-4 border-dashed ${thin ? "border-t" : "border-t-2"}`}
      style={{ borderColor: color }}
    />
  );
}
