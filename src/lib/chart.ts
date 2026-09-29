/**
 * Chart maths - the pure half of the charting layer (docs/DESIGN_SYSTEM.md §5.8).
 *
 * Isomorphic and side-effect free, so every number a chart draws is testable without a DOM
 * (`src/lib/__tests__/chart.test.ts`). The React half in `components/ui/chart/` does nothing
 * but turn these values into SVG.
 *
 * WHY THIS FILE EXISTS
 * Before it, every chart in the app carried its own copy of "pick some gridlines, map a value
 * to a y, build a polyline" - CashChart, AreaChart, Columns, BarRows and Sparkline each had a
 * slightly different one. Four consequences, all of them shipped:
 *   1. Axis ticks were `[min, mid, max]` (CashChart), which puts gridlines on numbers no reader
 *      recognises - "₹3,47,912" instead of "₹3,50,000".
 *   2. `AreaChart` used `preserveAspectRatio="none"`, so its stroke width and any text inside it
 *      distorted with the container's aspect ratio.
 *   3. Text sizes were viewBox units (`fontSize="9"`), which are NOT pixels - the rendered size
 *      depended on how wide the card happened to be, so the 12px floor in §7 could not be
 *      honoured or even measured.
 *   4. Nothing was reusable, so a new chart meant new geometry bugs.
 * The fix is to make geometry a pure function of a MEASURED PIXEL BOX. Callers pass real pixel
 * dimensions; nothing here scales.
 */

// ───────────────────────────── palette ─────────────────────────────

/**
 * Series colour slots, in the order §1.3 prescribes them. Chart code must index this rather
 * than naming a `--viz-*` directly, so "the 3rd series" is one decision made in one place.
 *
 * These are var() references, never hex - §1 "no hardcoded hex anywhere" is what keeps dark
 * mode working for free.
 */
export const SERIES_COLORS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--chart-6)",
] as const;

/** Colour for series `i`, wrapping past the palette's end. */
export function seriesColor(i: number): string {
  return SERIES_COLORS[((i % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];
}

/**
 * Dash pattern marking a COMPARISON series (the previous period drawn behind the current one).
 *
 * §7 forbids carrying meaning by colour alone, and a comparison line is exactly that risk: two
 * blues, one lighter. The dash makes "this is the old number" survive greyscale and colour
 * blindness, and it is why the legend can say "Previous" without a colour swatch doing the work.
 */
export const COMPARE_DASH = "5 4";

// ───────────────────────────── axis ticks ─────────────────────────────

/**
 * "Nice" axis ticks over [min, max] - the 1 / 2 / 5 × 10ⁿ ladder.
 *
 * A reader does not verify a chart against its data; they read the gridline labels and trust the
 * shape. So the labels have to be numbers a human recognises at a glance - 0, 50k, 100k - because
 * a gridline at ₹3,47,912 costs a beat of arithmetic on every single read.
 *
 * `target` is a HINT, not a promise: rounding outward to whole steps can yield one tick either
 * side of it. That is the correct trade - honest, round numbers beat an exact tick count.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max < min) [min, max] = [max, min];

  // A flat series (every value identical) has no span to divide. Give it a single labelled
  // line at its own value rather than an invented range, which would draw a flat line through
  // the middle of a fake axis and imply variation that isn't there.
  if (min === max) return [min];

  const rawStep = (max - min) / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  // Decimal places implied by the step, so 0.1 + 0.2 never surfaces as 0.30000000000000004 in
  // an axis label. Steps ≥ 1 need none.
  const dp = Math.max(0, -Math.floor(Math.log10(step)));
  const round = (v: number) => Number(v.toFixed(dp));

  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  const out: number[] = [];
  // Walk by index rather than accumulating `v += step`: accumulation drifts on non-decimal
  // steps and can either drop the last tick or emit a phantom one past `end`.
  const count = Math.round((end - start) / step);
  for (let i = 0; i <= count; i++) out.push(round(start + i * step));
  return out;
}

/**
 * The y-domain a chart should actually draw, given its data.
 *
 * Baselines at zero unless the data goes negative, because a bar or area chart whose baseline
 * floats exaggerates every difference - the single most common way a truthful dataset produces
 * a misleading picture. Line charts may opt out via `zeroBased: false`, where the question is
 * "which way is it moving" rather than "how big is it" (a cash balance hovering around ₹4L
 * shows no movement at all when the axis starts at zero).
 */
export function domainFor(
  values: number[],
  opts?: { zeroBased?: boolean; target?: number },
): { min: number; max: number; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 1] };

  const zeroBased = opts?.zeroBased ?? true;
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);

  if (zeroBased) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  // All-zero data still needs a drawable box, or every scale divides by zero.
  if (lo === hi) hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.1;

  const ticks = niceTicks(lo, hi, opts?.target ?? 4);
  // Extend the domain to the outermost ticks so no gridline is clipped and no datum sits
  // outside the plot box.
  return { min: Math.min(lo, ...ticks), max: Math.max(hi, ...ticks), ticks };
}

// ───────────────────────────── scales ─────────────────────────────

/** Continuous value → pixel mapper. `invert` is what makes a y-axis point up. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/**
 * Categorical index → pixel band (bar charts).
 *
 * `padding` is the share of each band left as gap. 0.3 is the house value: enough air that bars
 * read as separate objects, not so much that a 12-bar chart turns into pinstripes.
 */
export function bandScale(
  count: number,
  range: readonly [number, number],
  padding = 0.3,
): { band: (i: number) => number; width: number; center: (i: number) => number } {
  const [r0, r1] = range;
  const total = r1 - r0;
  const step = count > 0 ? total / count : total;
  const width = Math.max(1, step * (1 - padding));
  const offset = (step - width) / 2;
  return {
    band: (i) => r0 + i * step + offset,
    width,
    center: (i) => r0 + i * step + step / 2,
  };
}

/**
 * Evenly-spaced points for a line/area chart.
 *
 * A single point gets centred rather than pinned to the left edge - one datum drawn at x=0 with
 * nothing after it reads as a rendering failure rather than as "one week of data".
 */
export function pointScale(count: number, range: readonly [number, number]): (i: number) => number {
  const [r0, r1] = range;
  if (count <= 1) return () => (r0 + r1) / 2;
  return (i) => r0 + (i / (count - 1)) * (r1 - r0);
}

// ───────────────────────────── path builders ─────────────────────────────

export type Pt = { x: number; y: number };

/** Polyline through the points. Rounded to 0.1px - sub-pixel precision only bloats the DOM. */
export function linePath(points: readonly Pt[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/** The same line, closed down to a baseline - the fill under an area chart. */
export function areaPath(points: readonly Pt[], baselineY: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${last.x.toFixed(1)} ${baselineY.toFixed(1)} L${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

/**
 * A rect path with only its two leading corners rounded - bar tops (§5.8 "rounded bar tops (4px)").
 *
 * Hand-built rather than `<rect rx>` because `rx` rounds all four corners, which lifts a bar off
 * its own baseline and makes a zero-height bar render as a floating lozenge.
 *
 * `horizontal` rounds the right-hand pair instead, for ranked bars growing left→right.
 */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 4,
  horizontal = false,
): string {
  const r = Math.max(0, Math.min(radius, horizontal ? w : h, (horizontal ? h : w) / 2));
  if (h <= 0 || w <= 0) return "";
  if (horizontal) {
    return `M${x} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x} Z`;
  }
  return `M${x} ${y + h} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h} Z`;
}

// ───────────────────────────── variance bands ─────────────────────────────

/** One x position with both series' pixel y values. Pixel space: SMALLER y is a HIGHER value. */
export type BandPoint = { x: number; aY: number; bY: number };

export type BandSegment = {
  /** True where series A sits above series B - i.e. A is winning. */
  ahead: boolean;
  points: BandPoint[];
};

/**
 * Split two aligned series into runs of "A ahead" and "A behind", inserting the exact crossing
 * point at each handover.
 *
 * This is what lets the gap between target and actual be shaded green where ahead and red where
 * behind (the Finance annual chart's "the gap IS the variance"). Without interpolating the
 * crossing, the colour flips at the next data point instead of where the lines actually meet -
 * so a month that went from behind to ahead shows a red wedge poking into positive territory,
 * which is the one thing a variance chart must never do.
 *
 * Both series must share x positions; callers build `BandPoint[]` from the same scale.
 */
export function splitAtCrossings(points: readonly BandPoint[]): BandSegment[] {
  if (points.length === 0) return [];
  // Equal counts as "ahead": a value exactly on target is met, not missed.
  const aheadAt = (p: BandPoint) => p.aY <= p.bY;

  const segments: BandSegment[] = [];
  let current: BandSegment = { ahead: aheadAt(points[0]), points: [points[0]] };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const nextAhead = aheadAt(next);

    if (nextAhead === current.ahead) {
      current.points.push(next);
      continue;
    }

    // The lines swapped between prev and next. Find where, in [0,1] along the span.
    const dA = next.aY - prev.aY;
    const dB = next.bY - prev.bY;
    const denom = dA - dB;
    // Parallel-but-swapped is impossible; guard anyway so a degenerate span can't emit NaN.
    const t = denom === 0 ? 0.5 : (prev.bY - prev.aY) / denom;
    const clamped = Math.max(0, Math.min(1, t));
    const crossing: BandPoint = {
      x: prev.x + clamped * (next.x - prev.x),
      // At the crossing both series are at the same y by definition - compute once and share it,
      // so the two polygons meet exactly instead of leaving a hairline gap.
      aY: prev.aY + clamped * dA,
      bY: prev.aY + clamped * dA,
    };

    current.points.push(crossing);
    segments.push(current);
    current = { ahead: nextAhead, points: [crossing, next] };
  }

  segments.push(current);
  // A one-point segment has no area to fill; it only exists as the pivot between two real ones.
  return segments.filter((s) => s.points.length > 1);
}

/** Closed polygon between the two series of a segment - forward along A, back along B. */
export function bandPath(points: readonly BandPoint[]): string {
  if (points.length < 2) return "";
  const forward = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.aY.toFixed(1)}`);
  const back = [...points].reverse().map((p) => `L${p.x.toFixed(1)} ${p.bY.toFixed(1)}`);
  return `${forward.join(" ")} ${back.join(" ")} Z`;
}

// ───────────────────────────── target attainment ─────────────────────────────

/**
 * A value as a percentage of its target, so metrics with different targets and different units
 * become comparable.
 *
 * WHY THIS MATTERS: the L1 desk shows eight targets, some scored out of 30 and some out of 100.
 * "25" against a 30 target is nearly there; "25" against a 100 target is a crisis. Rendered as
 * eight independent progress bars the two are visually identical, so the screen cannot answer
 * "which one do I fix first" - the actual question a specialist opens it with.
 *
 * Uncapped on purpose: overshooting a target is information (140% of a 30-call floor is a good
 * day), and clamping it to 100 would hide the best performer as merely "done".
 */
export function attainmentPct(value: number | null, target: number): number | null {
  if (value === null || !Number.isFinite(value) || !Number.isFinite(target) || target === 0) return null;
  return (value / target) * 100;
}

// ───────────────────────────── label formatting ─────────────────────────────

/**
 * Axis-label number: 1.2k / 3.4L / 2.1Cr, Indian scale.
 *
 * Indian, not international, because every money figure in this product is INR under the lakh /
 * crore grouping (§3) - an axis reading "350K" beside a card reading "₹3,50,000" makes the reader
 * translate between two systems on one screen.
 */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const trim = (n: number) => (Math.abs(n) >= 10 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString());
  if (abs >= 1e7) return `${sign}${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
  return `${sign}${Math.round(abs * 100) / 100}`;
}

/** Axis label for money held in MINOR units (paise) - the app's universal money encoding. */
export function compactInrMinor(minor: number | bigint): string {
  return `₹${compactNumber(Number(minor) / 100)}`;
}

/**
 * Thin out categorical tick labels so they never collide.
 *
 * Returns the indices that should carry a label: always the first and last (they anchor the
 * range), plus an even stride between. Dropping labels beats rotating them - angled text is
 * measurably slower to read, and on a 12-month axis the reader only needs the ends plus a
 * rhythm to count by.
 */
export function tickIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const stride = Math.ceil(count / Math.max(1, maxLabels - 1));
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  const last = count - 1;
  if (out[out.length - 1] !== last) {
    // Drop the penultimate pick if the final label would crowd it, rather than letting two
    // labels overlap at the right edge.
    if (last - out[out.length - 1] < stride / 2) out.pop();
    out.push(last);
  }
  return out;
}

// ───────────────────────────── deltas ─────────────────────────────

/**
 * Percentage change from `previous` to `current`, or null where the question is meaningless.
 *
 * Growth from zero is NOT "+100%" and is not infinity - it is undefined, and a chart that prints
 * "+∞%" or a confident "+100%" beside a real figure has invented a number. Returning null makes
 * every caller render "new" (or nothing) instead of a lie.
 */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Long-tail roll-up: keep the top `limit` rows, fold the rest into one "Other".
 *
 * A 40-bar chart is a texture, not a ranking. The roll-up keeps the chart legible while the
 * table beneath it still carries every row - so nothing is hidden, only deferred. `Other` is
 * only synthesised when it would absorb more than one row; folding a single row into "Other"
 * hides a name for no gain.
 */
export function rollUpLongTail<T extends { label: string; value: number }>(
  rows: readonly T[],
  limit: number,
  makeOther: (value: number, count: number) => T,
): T[] {
  if (rows.length <= limit) return [...rows];
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  if (tail.length === 1) return [...head, tail[0]];
  const total = tail.reduce((s, r) => s + r.value, 0);
  return [...head, makeOther(total, tail.length)];
}
