"use client";

import { useState } from "react";
import type { ClientMovementMonth } from "@/server/annual-metrics";

/**
 * Clients gained (green, up) vs lost (red, down) against the active-client baseline (§3.4).
 *
 * A diverging bar chart rather than two separate series: gains and losses belong on one axis
 * because what matters is the NET, and stacking them apart hides exactly the month where four
 * joined and four left. The baseline is the running count of active enrolments, so the bars can
 * be read as what moved it.
 *
 * The base gets its OWN band above the bars (Error Log F5). It used to be overlaid on the same
 * axis, which put it in the y-range 126–202 — below the zero line and squarely inside the red
 * churn bars, so the one thing the movement is supposed to be read against was buried under the
 * movement itself, and drifted into the month labels whenever the roster was small. Two stacked
 * panels on a shared x-axis keep "how big is the base" and "what moved it" legible at once.
 */

const W = 720;
const H = 286;
const PAD_L = 40;
const PAD_R = 14;

// Recurring-base panel.
const BASE_TOP = 18;
const BASE_BOT = 108;

// Diverging bars panel — MID is their zero line, BAR_MAX the tallest bar each way.
const MID = 190;
const BAR_MAX = 64;

export function ClientMovementChart({
  months,
  height = 268,
}: {
  months: ClientMovementMonth[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / 12;
  const barW = Math.min(20, slot * 0.42);
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.gained, m.lost)));
  const scale = BAR_MAX / maxBar;

  const xC = (i: number) => PAD_L + slot * (i + 0.5);

  const elapsed = months.filter((m) => !m.isFuture);
  const maxActive = Math.max(1, ...elapsed.map((m) => m.activeEnd));
  const yBase = (v: number) => BASE_BOT - (v / maxActive) * (BASE_BOT - BASE_TOP);

  // Indexed by m.month, not by position in `elapsed` — future months only ever fall at the end
  // today, but keying off the real month survives that ordering changing.
  const pt = (m: ClientMovementMonth) => `${xC(m.month).toFixed(1)},${yBase(m.activeEnd).toFixed(1)}`;
  const baseline = elapsed.map(pt).join(" ");
  const area = elapsed.length
    ? `M${xC(elapsed[0].month).toFixed(1)},${BASE_BOT} L${elapsed.map(pt).join(" L")} L${xC(
        elapsed[elapsed.length - 1].month,
      ).toFixed(1)},${BASE_BOT} Z`
    : "";
  const current = elapsed.length ? elapsed[elapsed.length - 1].activeEnd : 0;

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
        aria-label={`Clients gained and lost each month against the active client baseline, currently ${current} active clients`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* recurring base — its own band, with a scale so the number is readable without hovering */}
        <line x1={PAD_L} x2={W - PAD_R} y1={BASE_TOP} y2={BASE_TOP} stroke="var(--line)" strokeWidth="1" />
        <line x1={PAD_L} x2={W - PAD_R} y1={BASE_BOT} y2={BASE_BOT} stroke="var(--line)" strokeWidth="1" />
        <text x={PAD_L - 8} y={BASE_TOP + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
          {maxActive}
        </text>
        <text x={PAD_L - 8} y={BASE_BOT + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
          0
        </text>

        {elapsed.length > 0 && (
          <>
            <path d={area} fill="var(--primary)" opacity="0.12" />
            <polyline
              points={baseline}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* dots carry the single-elapsed-month case, where a polyline draws nothing at all */}
            {elapsed.map((m) => (
              <circle
                key={m.month}
                cx={xC(m.month)}
                cy={yBase(m.activeEnd)}
                r={hover === m.month ? 3.5 : 2}
                fill="var(--primary)"
              />
            ))}
          </>
        )}

        <line x1={PAD_L} x2={W - PAD_R} y1={MID} y2={MID} stroke="var(--border-strong)" strokeWidth="1" />

        {months.map((m, i) => {
          const gH = m.gained * scale;
          const lH = m.lost * scale;
          const on = hover === i;
          return (
            <g key={m.month}>
              <rect x={PAD_L + slot * i} y={BASE_TOP} width={slot} height={MID + BAR_MAX - BASE_TOP} fill="transparent" />
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
              <text x={xC(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--viz-ink)">
                {m.label}
              </text>
            </g>
          );
        })}

        {/* guide ties a month's bars back to the point it moved on the base above */}
        {h && hover !== null && !h.isFuture && (
          <line
            x1={xC(hover)}
            x2={xC(hover)}
            y1={BASE_TOP}
            y2={MID + BAR_MAX}
            stroke="var(--viz-ink)"
            strokeWidth="1"
            strokeDasharray="3 3"
            pointerEvents="none"
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
                  {/* --on-accent, not #fff: --ink inverts between themes, so the label has to invert with it */}
                  <text x={boxW / 2} y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--on-accent)">
                    {h.label}
                  </text>
                  <text x={boxW / 2} y="26" textAnchor="middle" fontSize="9" fill="var(--good-on-ink)">
                    +{h.gained} joined
                  </text>
                  <text x={boxW / 2} y="36" textAnchor="middle" fontSize="9" fill="var(--bad-on-ink)">
                    −{h.lost} left
                  </text>
                  <text x={boxW / 2} y="46" textAnchor="middle" fontSize="9" fill="var(--on-accent)" opacity="0.8">
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
          <span aria-hidden className="inline-block w-4 border-t-2" style={{ borderColor: "var(--primary)" }} />
          active clients — {current} now
        </span>
      </div>
    </div>
  );
}
