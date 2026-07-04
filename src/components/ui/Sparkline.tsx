/** Tiny inline SVG sparkline - no chart lib needed at this size. */
export function Sparkline({
  data,
  stroke = "currentColor",
  width = 120,
  height = 32,
}: {
  data: number[];
  stroke?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return <svg className="h-8 w-full" viewBox={`0 0 ${width} ${height}`} aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const coords = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${points} ${width - pad},${height} ${pad},${height}`;
  return (
    <svg
      className="h-8 w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={area} fill="currentColor" opacity={0.08} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
