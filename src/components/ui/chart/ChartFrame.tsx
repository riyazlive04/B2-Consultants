"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { COMPARE_DASH } from "@/lib/chart";

/**
 * The chart shell every chart in the app draws inside (docs/DESIGN_SYSTEM.md §5.8).
 *
 * It owns the four things each hand-rolled chart used to re-solve, differently:
 *   1. **Measurement.** Children are handed a real PIXEL box, not a viewBox. That is what lets
 *      axis text be 12px - actually 12px, per §7's type floor - instead of a viewBox unit whose
 *      rendered size depended on how wide the card happened to be.
 *   2. **States.** loading / empty / error / ready. Charts previously returned a bare `<p>` for
 *      "no data" (three different sentences in three files) and had no error state at all.
 *   3. **Legend.** One implementation, so a dashed comparison series always reads the same.
 *   4. **Accessibility.** The SVG is `aria-hidden` and the *data* is exposed as a visually-hidden
 *      table. A screen reader gets the numbers, not a one-line `aria-label` summary of them -
 *      §7's "signal never carried by colour alone", applied to the chart as a whole.
 *
 * Deliberately NOT a card: callers wrap this in `<Card>`, which already owns the title, border
 * and padding. Composing keeps a chart droppable into any existing panel.
 */

// ───────────────────────────── measurement ─────────────────────────────

/**
 * Container width in CSS pixels, tracked across resize.
 *
 * `useLayoutEffect` for the first read so the chart never paints once at a guessed width and
 * again at the real one - that flash is the tell of a chart that was retrofitted into a
 * responsive layout. ResizeObserver (not a window listener) because the sidebar collapsing or a
 * tab panel opening changes the box without changing the window.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

// ───────────────────────────── legend ─────────────────────────────

export type LegendItem = {
  label: string;
  color: string;
  /** Comparison series - drawn dashed, so identity survives greyscale (§7). */
  dashed?: boolean;
  /** Optional figure shown after the label (a total, a share). */
  value?: string;
};

/**
 * Chart legend. Swatches are 10px lines for series and 10px squares for categories, which is the
 * cheapest way to say "this is a line on the chart" vs "this is a block on the chart".
 */
export function ChartLegend({
  items,
  onHover,
  activeIndex,
}: {
  items: readonly LegendItem[];
  /** Hovering a legend row can highlight its series. Optional - a static legend is fine. */
  onHover?: (index: number | null) => void;
  activeIndex?: number | null;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item, i) => (
        <li
          key={`${item.label}-${i}`}
          className="flex items-center gap-1.5 text-caption text-ink-2 transition-opacity"
          style={{ opacity: activeIndex == null || activeIndex === i ? 1 : 0.45 }}
          onMouseEnter={() => onHover?.(i)}
          onMouseLeave={() => onHover?.(null)}
        >
          <svg width="12" height="12" aria-hidden className="flex-none">
            {item.dashed ? (
              <line
                x1="0"
                y1="6"
                x2="12"
                y2="6"
                stroke={item.color}
                strokeWidth="2.5"
                strokeDasharray={COMPARE_DASH}
                strokeLinecap="round"
              />
            ) : (
              <rect x="1" y="3" width="10" height="6" rx="2" fill={item.color} />
            )}
          </svg>
          <span>{item.label}</span>
          {item.value && <span className="tnum font-semibold text-ink">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── tooltip ─────────────────────────────

export type TooltipRow = { label: string; value: string; color?: string; muted?: boolean };

/**
 * Hover readout. HTML, not SVG `<text>`.
 *
 * Three reasons, all of them bugs in the charts this replaces:
 *   - SVG text can't use the type tokens, so `CashChart` shipped `fontSize="9.5"` against a
 *     stated 12px floor (§7).
 *   - It hardcoded `fill="#fff"` on a `var(--ink)` surface. `--ink` is near-WHITE in dark mode,
 *     so that tooltip was white-on-white - the exact failure §1.4 calls out.
 *   - SVG can't wrap, clip or elevate; an HTML box gets `e-2`, real padding and `r-sm` free.
 *
 * Positioned by the caller in container pixels; this flips itself away from the edges so the
 * box never leaves the card.
 */
export function ChartTooltip({
  x,
  y,
  width,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  /** Container width, so the box can decide which side of the cursor to sit on. */
  width: number;
  title: string;
  rows: readonly TooltipRow[];
  footer?: string;
}) {
  const BOX = 176;
  // Flip to the left of the cursor when the right edge would clip, and clamp so it can never
  // escape the container on a narrow card.
  const left = Math.max(4, Math.min(width - BOX - 4, x + 12 + BOX > width ? x - BOX - 12 : x + 12));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-field bg-ink px-3 py-2 shadow-soft"
      style={{ left, top: Math.max(4, y - 8), width: BOX }}
    >
      <p className="text-caption font-semibold text-surface">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="flex items-center gap-1.5 text-caption">
            {r.color && (
              <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: r.color }} />
            )}
            <span className="min-w-0 flex-1 truncate text-surface-2 opacity-80" title={r.label}>{r.label}</span>
            <span className="tnum flex-none font-semibold text-surface">{r.value}</span>
          </li>
        ))}
      </ul>
      {footer && <p className="mt-1 text-caption text-surface-2 opacity-70">{footer}</p>}
    </div>
  );
}

// ───────────────────────────── accessible data table ─────────────────────────────

export type ChartData = {
  /** Column headers; the first is the category/time axis. */
  columns: readonly string[];
  /** Display strings - already formatted, so the reader hears "₹3,50,000", not "350000". */
  rows: readonly (readonly string[])[];
};

/**
 * The chart's data as a real table, visually hidden.
 *
 * `sr-only`, never `display:none` - the same rule §5.5 states for checkboxes, for the same
 * reason: hidden-but-present keeps it in the accessibility tree. An `aria-label` saying
 * "revenue trend chart" tells a screen-reader user that a chart exists and nothing about what
 * it says; this tells them the numbers.
 *
 * THE WRAPPER IS LOAD-BEARING - `sr-only` cannot hide a `<table>` on its own. It works by pinning
 * the box to 1×1 and clipping, but on a table `width: 1px` is only a MINIMUM: auto table layout
 * still grows to its content, and the clip merely stops it being painted. The table stayed ~550px
 * wide (wider still on a many-column chart), and because `sr-only` is `position: absolute` that
 * width joined the page's scrollable area - every charted screen scrolled ~200px to the right into
 * blank space, on a table nobody could see. A `<div>` honours `width: 1px` + `overflow: hidden`,
 * and clipped overflow never reaches an ancestor's scroll region, so the table is free to be its
 * natural size inside a box that contains it.
 */
export function ChartSrTable({ caption, data }: { caption: string; data: ChartData }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {data.columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={c}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────── frame ─────────────────────────────

export type ChartState = "ready" | "loading" | "empty" | "error";

/**
 * Measures, states, legend, SR table - then hands the child a pixel box to draw in.
 *
 * The child is a render prop rather than `children`, because it cannot be rendered until the
 * width is known and re-rendering it on every resize is the whole point.
 */
export function ChartFrame({
  height = 220,
  state = "ready",
  legend,
  onLegendHover,
  activeSeries,
  emptyTitle = "No data yet",
  emptyBody,
  errorBody = "This chart could not be loaded. Refresh the page to try again.",
  footnote,
  srCaption,
  data,
  toolbar,
  children,
}: {
  height?: number;
  state?: ChartState;
  legend?: readonly LegendItem[];
  onLegendHover?: (index: number | null) => void;
  activeSeries?: number | null;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  errorBody?: ReactNode;
  /** One line under the plot: what powers it, how fresh it is (§3 wants a rate/`as of` note). */
  footnote?: ReactNode;
  srCaption: string;
  data?: ChartData;
  /** Controls that belong to this chart specifically (a mode switch, a measure picker). */
  toolbar?: ReactNode;
  children: (box: { width: number; height: number }) => ReactNode;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const hasLegend = Boolean(legend && legend.length > 0);

  return (
    <figure className="m-0 w-full">
      {(hasLegend || toolbar) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {hasLegend ? (
            <ChartLegend items={legend!} onHover={onLegendHover} activeIndex={activeSeries} />
          ) : (
            <span />
          )}
          {toolbar}
        </div>
      )}

      <div ref={ref} className="relative w-full" style={{ height }}>
        {state === "loading" && (
          <div className="skeleton h-full w-full" aria-busy="true" aria-label={`Loading ${srCaption}`} />
        )}

        {state === "error" && (
          <div className="grid h-full place-items-center rounded-field border border-dashed border-risk bg-risk-soft px-6 text-center">
            <p className="max-w-sm text-sm text-risk">{errorBody}</p>
          </div>
        )}

        {state === "empty" && (
          <div className="grid h-full place-items-center rounded-field border border-dashed border-primary-tint bg-sky px-6 text-center">
            <div>
              <p className="font-display text-h3 text-ink">{emptyTitle}</p>
              {emptyBody && <p className="mt-1 max-w-sm text-sm text-ink-2">{emptyBody}</p>}
            </div>
          </div>
        )}

        {/* Nothing draws until the box is measured - a chart painted at width 0 and again at the
            real width is a visible flash, not a progressive render. */}
        {state === "ready" && width > 0 && children({ width, height })}
      </div>

      {footnote && <figcaption className="mt-2.5 text-caption text-ink-3">{footnote}</figcaption>}
      {state === "ready" && data && <ChartSrTable caption={srCaption} data={data} />}
    </figure>
  );
}

// ───────────────────────────── keyboard cursor ─────────────────────────────

/**
 * Arrow-key navigation over a chart's data points.
 *
 * §7 requires every interactive element to be keyboard reachable, and a hover-only tooltip is
 * the classic chart accessibility hole: the numbers exist but only a mouse can get at them.
 * The plot takes focus, arrows walk the series, Home/End jump to the ends, Escape drops the
 * cursor. Returns the props to spread onto the focusable element.
 */
export function useChartCursor(count: number, onChange: (index: number | null) => void) {
  const [index, setIndex] = useState<number | null>(null);

  const set = useCallback(
    (next: number | null) => {
      setIndex(next);
      onChange(next);
    },
    [onChange],
  );

  // A shrinking dataset (a filter narrowed the range) must not leave the cursor past the end.
  useEffect(() => {
    if (index !== null && index > count - 1) set(count > 0 ? count - 1 : null);
  }, [count, index, set]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return;
      const current = index ?? -1;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          e.preventDefault();
          set(Math.min(count - 1, current + 1));
          break;
        case "ArrowLeft":
        case "ArrowDown":
          e.preventDefault();
          set(Math.max(0, current <= 0 ? 0 : current - 1));
          break;
        case "Home":
          e.preventDefault();
          set(0);
          break;
        case "End":
          e.preventDefault();
          set(count - 1);
          break;
        case "Escape":
          if (index !== null) {
            e.preventDefault();
            set(null);
          }
          break;
      }
    },
    [count, index, set],
  );

  return {
    index,
    set,
    /** Spread onto the focusable plot element. */
    props: {
      tabIndex: 0,
      onKeyDown,
      onBlur: () => set(null),
    },
  };
}
