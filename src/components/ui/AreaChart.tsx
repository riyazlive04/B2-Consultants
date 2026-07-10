/** Clean responsive area chart (SVG, no lib) with a gradient fill and an end dot. */
export function AreaChart({
  data,
  height = 180,
  className,
}: {
  data: number[];
  height?: number;
  className?: string;
}) {
  if (!data || data.length < 2) {
    return (
      <div
        className={`grid place-items-center text-sm text-muted ${className ?? ""}`}
        style={{ height }}
      >
        Not enough data yet
      </div>
    );
  }

  const W = 640;
  const H = 200;
  const pad = 10;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / span) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${H} ${line} ${W - pad},${H}`;
  const [ex, ey] = pts[pts.length - 1];
  const gid = `area-grad-${data.length}-${Math.round(max)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
      role="img"
      aria-label="Trend chart"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary-tint)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--primary-tint)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={ex} cy={ey} r="4.5" fill="var(--primary)" stroke="var(--bg-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
