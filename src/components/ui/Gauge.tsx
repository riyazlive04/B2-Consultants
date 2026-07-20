/**
 * Semicircular target gauge — the "speedometer" (§2.1).
 *
 * WHY THIS EXISTS: the month card used to state collected / target / projected finish /
 * behind-pace as four separate numbers in four places, so reading "am I on track?" meant
 * the eye hopping around and doing arithmetic. One dial answers it pre-attentively: the
 * scale IS the target, the needle IS what's collected, and the band under the needle
 * gives the verdict in red / amber / green before a single digit is read.
 *
 * The numbers are still rendered as text (centre readout + end captions), never colour
 * alone — the bands are a second encoding of a value that is always also spoken.
 *
 * Pure SVG, no client JS: it renders inside a server component.
 */

export type GaugeBand = {
  /** Upper edge of this band as a fraction of `max`, 0..1+. Bands are drawn in order. */
  upTo: number;
  color: string;
};

/**
 * Default verdict bands: behind → catching up → at target.
 *
 * Green has to occupy real arc (0.9→1.0), not just the endpoint. An earlier version put it
 * at 1→1.0001, which clamps to zero width and never rendered — the dial showed only red and
 * amber, so "green above" was unreachable no matter how well the month went.
 */
export const TARGET_BANDS: GaugeBand[] = [
  { upTo: 0.5, color: "var(--bad)" },
  { upTo: 0.9, color: "var(--warn)" },
  { upTo: 1, color: "var(--good)" },
];

const TAU = Math.PI / 180;

/** Fraction 0..1 along the dial → a point on the arc of radius `r`. f=0 left, f=1 right. */
function polar(cx: number, cy: number, r: number, f: number) {
  const deg = 180 - Math.max(0, Math.min(1, f)) * 180;
  return { x: cx + r * Math.cos(deg * TAU), y: cy - r * Math.sin(deg * TAU) };
}

/** Stroked arc between two fractions (never emits a zero-length path). */
function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, Math.max(from + 0.0005, to));
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function Gauge({
  value,
  max,
  valueText,
  maxText,
  minText = "0",
  label,
  caption,
  marker,
  markerLabel,
  bands = TARGET_BANDS,
  size = 260,
}: {
  /** Current value, same unit as `max` (e.g. paise). */
  value: number;
  /** Full-scale value — the target. */
  max: number;
  /** Pre-formatted centre readout, e.g. "₹2.47L". */
  valueText: string;
  /** Pre-formatted right-hand end caption, e.g. "₹8L". */
  maxText: string;
  minText?: string;
  label: string;
  caption?: string;
  /** Optional second tick, as a fraction of `max` — used for "expected by today". */
  marker?: number;
  markerLabel?: string;
  bands?: GaugeBand[];
  size?: number;
}) {
  const W = 240;
  const H = 148; // semicircle + room for the end captions
  const cx = W / 2;
  const cy = 124;
  const r = 96;
  const band = 16;

  const frac = max > 0 ? value / max : 0;
  const clamped = Math.max(0, Math.min(1, frac));

  // The band the needle currently sits in — also the colour of the needle and readout.
  const activeColor =
    bands.find((b) => frac <= b.upTo)?.color ?? bands[bands.length - 1]?.color ?? "var(--good)";

  const needle = polar(cx, cy, r - band - 8, clamped);
  const markerPt = marker !== undefined ? polar(cx, cy, r, Math.max(0, Math.min(1, marker))) : null;
  const markerInner =
    marker !== undefined ? polar(cx, cy, r - band, Math.max(0, Math.min(1, marker))) : null;

  let cursor = 0;

  return (
    <figure className="m-0 flex flex-col items-center" style={{ width: "100%", maxWidth: size }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%" }}
        role="img"
        aria-label={`${label}: ${valueText} of ${maxText}${
          markerLabel ? `. ${markerLabel}` : ""
        }`}
      >
        {/* unfilled track */}
        <path
          d={arcPath(cx, cy, r - band / 2, 0, 1)}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={band}
          strokeLinecap="round"
        />

        {/* verdict bands, clipped to the dial */}
        {bands.map((b, i) => {
          const from = cursor;
          const to = Math.min(1, b.upTo);
          cursor = to;
          if (to <= from) return null;
          return (
            <path
              key={i}
              d={arcPath(cx, cy, r - band / 2, from, to)}
              fill="none"
              stroke={b.color}
              strokeWidth={band}
              strokeLinecap="butt"
              opacity={0.28}
            />
          );
        })}

        {/* the filled portion: how far the needle has actually travelled */}
        <path
          d={arcPath(cx, cy, r - band / 2, 0, clamped)}
          fill="none"
          stroke={activeColor}
          strokeWidth={band}
          strokeLinecap="round"
        />

        {/* "expected by today" tick — the pace reference the needle is judged against */}
        {markerPt && markerInner && (
          <line
            x1={markerInner.x}
            y1={markerInner.y}
            x2={markerPt.x}
            y2={markerPt.y}
            stroke="var(--ink)"
            strokeWidth="2.5"
          />
        )}

        {/* needle + hub */}
        <line
          x1={cx}
          y1={cy}
          x2={needle.x}
          y2={needle.y}
          stroke="var(--ink)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="7" fill="var(--ink)" />
        <circle cx={cx} cy={cy} r="3" fill="var(--bg-surface)" />

        {/* end-of-scale captions */}
        <text x={cx - r} y={cy + 18} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
          {minText}
        </text>
        <text x={cx + r} y={cy + 18} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
          {maxText}
        </text>
      </svg>

      {/* centre readout sits below the dial so it never collides with the needle */}
      <figcaption className="-mt-6 text-center">
        <p className="tnum font-display text-3xl font-bold tracking-tight" style={{ color: activeColor }}>
          {valueText}
        </p>
        <p className="text-caption font-medium text-ink-2">{label}</p>
        {caption && <p className="mt-0.5 text-caption text-ink-3">{caption}</p>}
      </figcaption>
    </figure>
  );
}
