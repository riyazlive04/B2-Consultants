"use client";

import { useState } from "react";
import { formatDate, formatInrMinor } from "@/lib/format";

/**
 * Daily revenue for the current month, one bar per calendar day (§3.1).
 *
 * Replaces a smoothed area chart that plotted only the days which happened to have
 * income — so a dead week looked exactly like three good days in a row — and carried
 * no readable values at all. Here every day gets a slot (gaps are visible as gaps),
 * and hovering any day reveals that day's takings AND the running month total, which
 * is the number actually being chased.
 *
 * Hand-rolled SVG to match the rest of the app (no charting dependency).
 */
export function RevenueChart({
  points,
  height = 200,
}: {
  points: Array<{ date: string; inr: number; cumulativeInr: number }>;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No income recorded yet this month.</p>;
  }

  const W = 720;
  const H = 220;
  const PAD_L = 46;
  const PAD_R = 12;
  const TOP = 14;
  const BASE = H - 30; // baseline, leaving room for date labels

  const max = Math.max(1, ...points.map((p) => p.inr));
  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(22, slot * 0.62));

  const xCentre = (i: number) => PAD_L + slot * (i + 0.5);
  const y = (v: number) => TOP + (1 - v / max) * (BASE - TOP);

  // Three gridlines is enough to read magnitude without turning into a ledger.
  const ticks = [0, max / 2, max];

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor((mx - PAD_L) / slot);
    setHover(idx >= 0 && idx < points.length ? idx : null);
  };

  const h = hover !== null ? points[hover] : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height }}
      className="cursor-crosshair"
      role="img"
      aria-label={`Daily revenue for this month. Highest day ${formatInrMinor(max, { compact: true })}.`}
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

      {points.map((p, i) => {
        const isHover = hover === i;
        const barH = p.inr > 0 ? Math.max(2, BASE - y(p.inr)) : 0;
        return (
          <g key={p.date}>
            {/* full-height hit target so thin bars and zero days are still hoverable */}
            <rect x={PAD_L + slot * i} y={TOP} width={slot} height={BASE - TOP} fill="transparent" />
            {barH > 0 && (
              <rect
                x={xCentre(i) - barW / 2}
                y={BASE - barH}
                width={barW}
                height={barH}
                rx="2"
                fill={isHover ? "var(--primary)" : "var(--chart-1)"}
              />
            )}
            {/* label the 1st, middle and last day only — a label per day is unreadable */}
            {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
              <text x={xCentre(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--viz-ink)">
                {new Date(p.date).getUTCDate()}
              </text>
            )}
          </g>
        );
      })}

      <line x1={PAD_L} x2={W - PAD_R} y1={BASE} y2={BASE} stroke="var(--border-strong)" strokeWidth="1" />

      {h && hover !== null && (
        <g pointerEvents="none">
          <line
            x1={xCentre(hover)}
            x2={xCentre(hover)}
            y1={TOP}
            y2={BASE}
            stroke="var(--viz-ink)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          {(() => {
            const boxW = 132;
            const tx = Math.min(Math.max(xCentre(hover), PAD_L + boxW / 2), W - PAD_R - boxW / 2);
            const ty = Math.max(y(h.inr) - 46, 2);
            return (
              <g transform={`translate(${tx - boxW / 2}, ${ty})`}>
                <rect width={boxW} height="40" rx="6" fill="var(--ink)" opacity="0.94" />
                <text x={boxW / 2} y="13" textAnchor="middle" fontSize="10" fill="#fff" opacity="0.75">
                  {formatDate(h.date)}
                </text>
                <text x={boxW / 2} y="25" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">
                  {formatInrMinor(h.inr, { compact: true })} that day
                </text>
                <text x={boxW / 2} y="35" textAnchor="middle" fontSize="8.5" fill="#fff" opacity="0.75">
                  {formatInrMinor(h.cumulativeInr, { compact: true })} month to date
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}
