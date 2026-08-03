"use client";

import { useState } from "react";
import { ChartFrame } from "@/components/ui/chart";
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
 *
 * DRAWN IN MEASURED PIXELS, NOT A `viewBox` (§5.8). It used to be `viewBox="0 0 720 286"`
 * stretched to the card with `fontSize="9"` — but a viewBox unit is only 9px when the card is
 * 720px wide. In the Finance column on a 320px phone the card is 238px, so every label rendered
 * at 9 × (238/720) = **3px**: the Jan–Dec axis was a row of grey dashes. Taking the width from
 * `ChartFrame` means one SVG unit is one CSS pixel, so the 12px below is actually 12px at every
 * size — the same fix `AnnualChart` and `CashChart` already had.
 */

const PAD_R = 14;
/** §7's type floor. Real pixels now, so it survives a narrow card. */
const AXIS_FONT = 12;
/** Room under the plot for the month row. */
const AXIS_H = 20;

export function ClientMovementChart({
  months,
  height = 268,
}: {
  months: ClientMovementMonth[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const elapsed = months.filter((m) => !m.isFuture);
  const maxActive = Math.max(1, ...elapsed.map((m) => m.activeEnd));
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.gained, m.lost)));
  const current = elapsed.length ? elapsed[elapsed.length - 1].activeEnd : 0;

  return (
    <ChartFrame
      height={height}
      state={months.length === 0 ? "empty" : "ready"}
      emptyTitle="No client movement yet"
      emptyBody="Enrolments and drops will chart here once the first one is recorded."
      srCaption="Clients gained and lost each month against the active client baseline"
      legend={[
        { label: "clients gained", color: "var(--good)" },
        { label: "clients lost (dropped)", color: "var(--bad)" },
        { label: "active clients", color: "var(--primary)", value: `${current} now` },
      ]}
      data={{
        columns: ["Month", "Gained", "Lost", "Net", "Active at end"],
        rows: elapsed.map((m) => [
          m.label,
          String(m.gained),
          String(m.lost),
          String(m.gained - m.lost),
          String(m.activeEnd),
        ]),
      }}
    >
      {({ width: W, height: H }) => (
        <Plot
          months={months}
          elapsed={elapsed}
          maxActive={maxActive}
          maxBar={maxBar}
          W={W}
          H={H}
          hover={hover}
          setHover={setHover}
        />
      )}
    </ChartFrame>
  );
}

function Plot({
  months,
  elapsed,
  maxActive,
  maxBar,
  W,
  H,
  hover,
  setHover,
}: {
  months: ClientMovementMonth[];
  elapsed: ClientMovementMonth[];
  maxActive: number;
  maxBar: number;
  W: number;
  H: number;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  // The gutter only has to hold the two base-band figures ("0" and the peak), so it shrinks on a
  // narrow card instead of spending 40px of a 238px chart on whitespace.
  const PAD_L = W < 380 ? 28 : 40;

  const plotH = H - AXIS_H;
  const BASE_TOP = 14;
  const BASE_BOT = Math.round(plotH * 0.38);
  const MID = Math.round(plotH * 0.72);
  const BAR_MAX = Math.max(24, Math.round(plotH * 0.24));

  const plotW = Math.max(1, W - PAD_L - PAD_R);
  const slot = plotW / 12;
  const barW = Math.max(4, Math.min(20, slot * 0.42));
  const scale = BAR_MAX / maxBar;

  const xC = (i: number) => PAD_L + slot * (i + 0.5);
  const yBase = (v: number) => BASE_BOT - (v / maxActive) * (BASE_BOT - BASE_TOP);

  // Twelve months at a readable 12px need ~26px each; below that the labels would collide, so
  // the axis thins to every 2nd or 3rd month rather than shrinking the type past the floor.
  const every = slot >= 26 ? 1 : slot >= 17 ? 2 : 3;

  // Indexed by m.month, not by position in `elapsed` — future months only ever fall at the end
  // today, but keying off the real month survives that ordering changing.
  const pt = (m: ClientMovementMonth) => `${xC(m.month).toFixed(1)},${yBase(m.activeEnd).toFixed(1)}`;
  const baseline = elapsed.map(pt).join(" ");
  const area = elapsed.length
    ? `M${xC(elapsed[0].month).toFixed(1)},${BASE_BOT} L${elapsed.map(pt).join(" L")} L${xC(
        elapsed[elapsed.length - 1].month,
      ).toFixed(1)},${BASE_BOT} Z`
    : "";

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
        width={W}
        height={H}
        className="cursor-crosshair"
        aria-hidden
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* recurring base — its own band, with a scale so the number is readable without hovering */}
        <line x1={PAD_L} x2={W - PAD_R} y1={BASE_TOP} y2={BASE_TOP} stroke="var(--line)" strokeWidth="1" />
        <line x1={PAD_L} x2={W - PAD_R} y1={BASE_BOT} y2={BASE_BOT} stroke="var(--line)" strokeWidth="1" />
        <text x={PAD_L - 6} y={BASE_TOP + 4} textAnchor="end" fontSize={AXIS_FONT} fill="var(--muted)">
          {maxActive}
        </text>
        <text x={PAD_L - 6} y={BASE_BOT + 4} textAnchor="end" fontSize={AXIS_FONT} fill="var(--muted)">
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
              {i % every === 0 && (
                <text x={xC(i)} y={H - 6} textAnchor="middle" fontSize={AXIS_FONT} fill="var(--viz-ink)">
                  {m.label}
                </text>
              )}
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
              // Clamped to the plot so the bubble cannot hang off a narrow card — at 238px wide
              // the old fixed 128px box left no room to sit either side of a late-year month.
              const boxW = Math.min(128, Math.max(96, W - 16));
              const half = boxW / 2;
              const tx = Math.min(Math.max(xC(hover), PAD_L + half), Math.max(PAD_L + half, W - PAD_R - half));
              const net = h.gained - h.lost;
              return (
                <g transform={`translate(${tx - half}, 2)`}>
                  <rect width={boxW} height="56" rx="6" fill="var(--ink)" opacity="0.94" />
                  {/* --on-accent, not #fff: --ink inverts between themes, so the label has to invert with it */}
                  <text x={half} y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--on-accent)">
                    {h.label}
                  </text>
                  <text x={half} y="29" textAnchor="middle" fontSize="11" fill="var(--good-on-ink)">
                    +{h.gained} joined
                  </text>
                  <text x={half} y="40" textAnchor="middle" fontSize="11" fill="var(--bad-on-ink)">
                    −{h.lost} left
                  </text>
                  <text x={half} y="51" textAnchor="middle" fontSize="11" fill="var(--on-accent)" opacity="0.8">
                    net {net >= 0 ? "+" : ""}{net} · {h.activeEnd} active
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
