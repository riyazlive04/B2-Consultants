"use client";

import { useState } from "react";
import { formatInrMinor } from "@/lib/format";
import type { AnnualMonth } from "@/server/annual-metrics";

/**
 * Jan→Dec cumulative target vs achieved, with a run-rate projection (§3.2/§3.3).
 *
 * Cumulative rather than per-month on purpose: the question is "will we make the year",
 * and a strong month means nothing if the year is still behind. The vertical gap between
 * the two lines IS the variance, shaded green when ahead and red when behind, so the answer
 * is readable without doing arithmetic.
 *
 * Beyond the current month the achieved line continues DASHED at today's run rate — clearly
 * a forecast, not a measurement.
 */
export function AnnualChart({
  months,
  currentMonth,
  height = 260,
}: {
  months: AnnualMonth[];
  currentMonth: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 280;
  const PAD_L = 52;
  const PAD_R = 14;
  const TOP = 16;
  const BASE = H - 34;

  const yMax = Math.max(
    1,
    ...months.map((m) => Math.max(m.cumTargetInr, m.cumAchievedInr, m.cumProjectedInr)),
  );
  const plotW = W - PAD_L - PAD_R;
  const x = (m: number) => PAD_L + (m / 11) * plotW;
  const y = (v: number) => TOP + (1 - v / yMax) * (BASE - TOP);

  const pts = (get: (m: AnnualMonth) => number, from = 0, to = 11) =>
    months
      .slice(from, to + 1)
      .map((m, i) => `${x(from + i).toFixed(1)},${y(get(m)).toFixed(1)}`)
      .join(" ");

  const targetLine = pts((m) => m.cumTargetInr);
  const achievedLine = pts((m) => m.cumAchievedInr, 0, currentMonth);
  const projectionLine = pts((m) => m.cumProjectedInr, currentMonth, 11);

  // Variance band: between the two cumulative lines, up to today only.
  const elapsed = months.slice(0, currentMonth + 1);
  const varianceArea =
    elapsed.length > 1
      ? `${elapsed.map((m, i) => `${x(i).toFixed(1)},${y(m.cumAchievedInr).toFixed(1)}`).join(" ")} ` +
        `${elapsed
          .map((m, i) => `${x(elapsed.length - 1 - i).toFixed(1)},${y(elapsed[elapsed.length - 1 - i].cumTargetInr).toFixed(1)}`)
          .join(" ")}`
      : "";

  const cur = months[currentMonth];
  const ahead = cur ? cur.cumAchievedInr >= cur.cumTargetInr : true;
  const h = hover !== null ? months[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((mx - PAD_L) / plotW) * 11);
    setHover(idx >= 0 && idx <= 11 ? idx : null);
  };

  const ticks = [0, yMax / 2, yMax];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height }}
        className="cursor-crosshair"
        role="img"
        aria-label="Cumulative revenue against target, January to December, with a run-rate projection"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--viz-ink)">
              {formatInrMinor(v, { compact: true })}
            </text>
          </g>
        ))}

        {/* the gap between the lines, tinted by whether it's a surplus or a shortfall */}
        {varianceArea && (
          <polygon
            points={varianceArea}
            fill={ahead ? "var(--good)" : "var(--bad)"}
            opacity="0.14"
          />
        )}

        {/* target — green */}
        <polyline
          points={targetLine}
          fill="none"
          stroke="var(--good)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* achieved — blue, solid only where there are actuals */}
        {currentMonth > 0 && (
          <polyline
            points={achievedLine}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* projection — same blue, dashed, so it reads as a forecast */}
        {currentMonth < 11 && (
          <polyline
            points={projectionLine}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinecap="round"
            opacity="0.75"
          />
        )}

        {months.map((m, i) => (
          <g key={m.month}>
            {!m.isFuture && (
              <circle cx={x(i)} cy={y(m.cumAchievedInr)} r={hover === i ? 4.5 : 2.5} fill="var(--primary)" />
            )}
            <text
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize="9"
              fontWeight={m.isCurrent ? 700 : 400}
              fill={m.isCurrent ? "var(--ink)" : "var(--viz-ink)"}
            >
              {m.label}
            </text>
          </g>
        ))}

        {h && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BASE} stroke="var(--viz-ink)" strokeDasharray="3 3" strokeWidth="1" />
            {(() => {
              const boxW = 156;
              const tx = Math.min(Math.max(x(hover), PAD_L + boxW / 2), W - PAD_R - boxW / 2);
              const variance = h.cumAchievedInr - h.cumTargetInr;
              return (
                <g transform={`translate(${tx - boxW / 2}, 4)`}>
                  <rect width={boxW} height={h.isFuture ? 40 : 52} rx="6" fill="var(--ink)" opacity="0.94" />
                  <text x={boxW / 2} y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
                    {h.label} {h.isFuture ? "(projected)" : ""}
                  </text>
                  <text x={boxW / 2} y="26" textAnchor="middle" fontSize="9" fill="#fff" opacity="0.8">
                    {h.isFuture
                      ? `on pace: ${formatInrMinor(h.cumProjectedInr, { compact: true })}`
                      : `achieved ${formatInrMinor(h.cumAchievedInr, { compact: true })}`}
                  </text>
                  <text x={boxW / 2} y="37" textAnchor="middle" fontSize="9" fill="#fff" opacity="0.8">
                    target {formatInrMinor(h.cumTargetInr, { compact: true })}
                  </text>
                  {!h.isFuture && (
                    <text
                      x={boxW / 2}
                      y="48"
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fill={variance >= 0 ? "#7ee2b0" : "#ff9ea2"}
                    >
                      {variance >= 0 ? "ahead " : "behind "}
                      {formatInrMinor(Math.abs(variance), { compact: true })}
                    </text>
                  )}
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption font-medium text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--primary)" }} />
          achieved (cumulative)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--good)" }} />
          target (cumulative)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block w-4 border-t-2 border-dashed"
            style={{ borderColor: "var(--primary)" }}
          />
          projected at today&rsquo;s run rate
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-4 rounded-sm"
            style={{ background: ahead ? "var(--good)" : "var(--bad)", opacity: 0.28 }}
          />
          variance
        </span>
      </div>
    </div>
  );
}
