/**
 * The B2 Consultants logo mark — the rounded-square frame with the serif "B²",
 * reproduced as inline SVG so it stays crisp at any size and re-themes with the
 * rest of the shell. The ink is `currentColor`, defaulted to `--brand-indigo`
 * (the logo's periwinkle), so a caller can override it by setting text colour.
 *
 *  - "mark" (default): the framed B² badge — used everywhere a small square
 *    brand badge sits next to the "B2 Consultants" wordmark.
 *  - "full": the complete lockup with "CONSULTANTS" under the B² — used as a
 *    standalone brand where no wordmark follows it.
 */
export function BrandLogo({
  variant = "mark",
  className,
  title = "B2 Consultants",
}: {
  variant?: "mark" | "full";
  className?: string;
  title?: string;
}) {
  const serif = "Georgia, 'Times New Roman', serif";
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      className={className}
      style={{ color: "var(--brand-indigo)" }}
    >
      <rect
        x="6"
        y="6"
        width="88"
        height="88"
        rx="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
      />
      {variant === "full" ? (
        <>
          <text
            x="47"
            y="58"
            textAnchor="middle"
            fill="currentColor"
            fontFamily={serif}
            fontWeight="700"
            fontSize="48"
          >
            B
            <tspan fontSize="23" dy="-16">
              2
            </tspan>
          </text>
          <text
            x="50"
            y="81"
            textAnchor="middle"
            fill="currentColor"
            fontFamily={serif}
            fontSize="10"
            letterSpacing="1.9"
          >
            CONSULTANTS
          </text>
        </>
      ) : (
        <text
          x="47"
          y="70"
          textAnchor="middle"
          fill="currentColor"
          fontFamily={serif}
          fontWeight="700"
          fontSize="58"
        >
          B
          <tspan fontSize="27" dy="-20">
            2
          </tspan>
        </text>
      )}
    </svg>
  );
}
