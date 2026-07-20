"use client";

import { useState } from "react";
import type { ClientMovementMonth } from "@/server/annual-metrics";

/**
 * Clients gained (green, up) vs lost (red, down) against the active-client baseline (§3.4).
 *
 * A diverging bar chart rather than two separate series: gains and losses belong on one axis
 * because what matters is the NET, and stacking them apart hides exactly the month where four
 * joined and four left. The baseline line is the running count of active enrolments, so the
 * bars can be read as what moved it.
 */
export function ClientMovementChart({
  months,
  height = 200,
}: {
  months: ClientMovementMonth[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 210;
  const PAD_L = 34;
  const PAD_R = 14;
  const MID = 118; // zero line for the diverging bars
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.gained, m.lost)));
  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / 12;
  const barW = Math.min(20, slot * 0.42);
  const scale = 76 / maxBar;

  const xC = (i: number) => PAD_L + slot * (i + 0.5);

  const maxActive = Math.max(1, ...months.map((m) => m.activeEnd));
  const yActive = (v: number) => MID + 84 - (v / maxActive) * 76;
  const elapsed = months.filter((m) => !m.isFuture);
  const baseline = elapsed.map((m, i) => `${xC(i).toFixed(1)},${yActive(m.activeEnd).toFixed(1)}`).join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor((mx - PAD_L) / slot);
    setHover(idx >= 0 && idx < 12 ? idx : null);
  };

  const h = hover !== null ? months[hover] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height }}
        className="cursor-crosshair"
        role="img"
        aria-label="Clients gained and lost each month against the active client baseline"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={PAD_L} x2={W - PAD_R} y1={MID} y2={MID} stroke="var(--border-strong)" strokeWidth="1" />

        {months.map((m, i) => {
          const gH = m.gained * scale;
          const lH = m.lost * scale;
          const on = hover === i;
          return (
            <g key={m.month}>
              <rect x={PAD_L + slot * i} y={8} width={slot} height={H - 30} fill="transparent" />
              {m.gained > 0 && (
                <rect
                  x={xC(i) - barW / 2}
                  y={MID - gH}
                  width={barW}
                  height={gH}
                  rx="2"
                  fill="var(--good)"
                  opacity={on ? 1 : 0.85}
                />
              )}
              {m.lost > 0 && (
                <rect
                  x={xC(i) - barW / 2}
                  y={MID}
                  width={barW}
                  height={lH}
                  rx="2"
                  fill="var(--bad)"
                  opacity={on ? 1 : 0.85}
                />
              )}
              <text x={xC(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--viz-ink)">
                {m.label}
              </text>
            </g>
          );
        })}

        {/* active-client baseline */}
        {elapsed.length > 1 && (
          <polyline
            points={baseline}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeDasharray="4 3"
            strokeLinejoin="round"
            opacity="0.85"
          />
        )}

        {h && hover !== null && !h.isFuture && (
          <g pointerEvents="none">
            {(() => {
              const boxW = 128;
              const tx = Math.min(Math.max(xC(hover), PAD_L + boxW / 2), W - PAD_R - boxW / 2);
              const net = h.gained - h.lost;
              return (
                <g transform={`translate(${tx - boxW / 2}, 2)`}>
                  <rect width={boxW} height="50" rx="6" fill="var(--ink)" opacity="0.94" />
                  <text x={boxW / 2} y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
                    {h.label}
                  </text>
                  <text x={boxW / 2} y="26" textAnchor="middle" fontSize="9" fill="#7ee2b0">
                    +{h.gained} joined
                  </text>
                  <text x={boxW / 2} y="36" textAnchor="middle" fontSize="9" fill="#ff9ea2">
                    −{h.lost} left
                  </text>
                  <text x={boxW / 2} y="46" textAnchor="middle" fontSize="9" fill="#fff" opacity="0.8">
                    net {net >= 0 ? "+" : ""}{net} · {h.activeEnd} active
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption font-medium text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--good)" }} />
          clients gained
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--bad)" }} />
          clients lost (dropped)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "var(--primary)" }} />
          active clients
        </span>
      </div>
    </div>
  );
}
