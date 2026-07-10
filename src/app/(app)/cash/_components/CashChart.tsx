"use client";

import { useState } from "react";
import { formatDate, formatInrMinor } from "@/lib/format";

/** 12-week bank-balance line chart (PRD3 §4.1) - plain SVG with hover tooltip. */
export function CashChart({ points }: { points: Array<{ date: string; balanceInr: number }> }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Add at least two weekly entries to see the trend.
      </p>
    );
  }
  const W = 720, H = 200, PAD = 44;
  const values = points.map((p) => p.balanceInr);
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => 12 + (1 - (v - min) / span) * (H - 40);
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.balanceInr).toFixed(1)}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((mx - PAD) / (W - PAD * 2)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const h = hover !== null ? points[hover] : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-crosshair"
      role="img"
      aria-label="Bank balance over the last 12 weeks"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {[min, (min + max) / 2, max].map((v) => (
        <g key={v}>
          <line x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeWidth="1" />
          <text x={PAD - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--viz-ink)">
            {formatInrMinor(v, { compact: true })}
          </text>
        </g>
      ))}

      {/* soft area under the line */}
      <polygon
        points={`${PAD},${H - 28} ${path} ${W - PAD},${H - 28}`}
        fill="var(--primary-tint)"
        opacity="0.45"
      />
      <polyline points={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p, i) => (
        <g key={p.date}>
          <circle
            cx={x(i)}
            cy={y(p.balanceInr)}
            r={hover === i ? 4.5 : 3}
            fill={hover === i ? "var(--ink)" : "var(--primary)"}
          />
          {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--viz-ink)">
              {formatDate(p.date)}
            </text>
          )}
        </g>
      ))}

      {/* hover tooltip */}
      {h && hover !== null && (
        <g pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={12} y2={H - 28} stroke="var(--viz-ink)" strokeDasharray="3 3" strokeWidth="1" />
          {(() => {
            const tx = Math.min(Math.max(x(hover), PAD + 60), W - PAD - 60);
            const ty = Math.max(y(h.balanceInr) - 34, 4);
            return (
              <g transform={`translate(${tx - 58}, ${ty})`}>
                <rect width="116" height="26" rx="6" fill="var(--ink)" opacity="0.92" />
                <text x="58" y="11" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff">
                  {formatInrMinor(h.balanceInr, { compact: true })}
                </text>
                <text x="58" y="21" textAnchor="middle" fontSize="8" fill="#fff" opacity="0.75">
                  {formatDate(h.date)}
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}
