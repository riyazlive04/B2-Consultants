"use client";

import { useState } from "react";

/** Horizontal magnitude bars (single accent hue) - label left, value + share right. */
export function BarRows({
  items,
}: {
  items: { label: string; value: number; display: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) {
    return <p className="py-10 text-center text-sm text-muted">No entries yet this month.</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const pct = Math.round((it.value / total) * 100);
        return (
          <div key={it.label} className="flex items-center gap-3" title={`${it.label}: ${it.display} (${pct}%)`}>
            <span className="w-20 flex-none truncate text-xs font-medium text-muted sm:w-28 sm:text-sm">
              {it.label}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-surface-2">
              <div
                className="h-full rounded-r transition-all"
                style={{ width: `${(it.value / max) * 100}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="w-14 flex-none text-right text-sm font-semibold tnum">{it.display}</span>
            <span className="w-9 flex-none text-right text-xs text-muted tnum">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical column chart - value on the cap, category label beneath, single baseline. */
export function Columns({
  items,
  height = 150,
}: {
  items: { label: string; value: number; display: string; color?: string }[];
  height?: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.every((i) => i.value <= 0)) {
    return <p className="py-10 text-center text-sm text-muted">Nothing to show yet.</p>;
  }
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height }}>
        {items.map((it) => (
          <div
            key={it.label}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            title={`${it.label}: ${it.display}`}
          >
            <span className="text-[11px] font-semibold tnum">{it.display}</span>
            <div
              className="w-full max-w-[28px] rounded-t"
              style={{
                height: Math.max(it.value > 0 ? 3 : 1, (it.value / max) * (height - 24)),
                background: it.color ?? "var(--chart-1)",
                opacity: it.value > 0 ? 1 : 0.25,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 border-t border-line pt-1.5">
        {items.map((it) => (
          <span key={it.label} className="flex-1 text-center text-[10px] font-medium leading-tight text-muted">
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export type DonutSlice = { label: string; value: number; display: string; color: string };

/**
 * Donut chart (SVG strokes, 2px surface gaps between slices). Hovering a slice or
 * legend row highlights it and swaps the centre readout; identity is carried by the
 * legend + tooltips, never color alone.
 */
export function Donut({
  slices,
  centerLabel,
  centerValue,
  size = 184,
  thickness = 26,
  legend = true,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  size?: number;
  thickness?: number;
  legend?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const drawn = slices.map((s, i) => ({ ...s, i })).filter((s) => s.value > 0);
  if (total <= 0 || drawn.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No entries yet this month.</p>;
  }

  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = drawn.length > 1 ? 2.5 : 0;
  const shown = active !== null ? slices[active] : null;

  let acc = 0;
  const arcs = drawn.map((s) => {
    const frac = s.value / total;
    const len = Math.max(0.5, frac * C - gap);
    const arc = (
      <circle
        key={s.i}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={thickness}
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-(acc + gap / 2)}
        opacity={active === null || active === s.i ? 1 : 0.3}
        style={{ transition: "opacity 140ms ease" }}
        onMouseEnter={() => setActive(s.i)}
        onMouseLeave={() => setActive(null)}
      >
        <title>{`${s.label}: ${s.display}`}</title>
      </circle>
    );
    acc += frac * C;
    return arc;
  });

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {arcs}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="max-w-[110px] truncate text-[11px] font-medium text-muted">
              {shown ? shown.label : centerLabel}
            </p>
            <p className="font-display text-lg font-bold tracking-tight">
              {shown ? shown.display : centerValue}
            </p>
          </div>
        </div>
      </div>

      {legend && (
        <ul className="mt-4 w-full space-y-1">
          {slices.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-field px-2 py-1 text-sm transition-colors hover:bg-surface-2"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-xs text-muted sm:text-[13px]">{s.label}</span>
              <span className="flex-none text-xs font-semibold tnum">{s.display}</span>
              <span className="w-9 flex-none text-right text-xs text-muted tnum">
                {Math.round((s.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
