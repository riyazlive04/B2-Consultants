/**
 * The B2 Consultants logo — the real artwork, not a redraw.
 *
 * ── Why a CSS mask and not an <img> ─────────────────────────────────────────────
 * The supplied PNG is pure black ink with every edge carried in the ALPHA channel
 * (no grey antialiasing pixels at all — checked). That means the alpha channel on
 * its own is a complete, loss-free stencil of the mark, so painting `currentColor`
 * through it reproduces the logo exactly while letting it re-theme.
 *
 * One asset therefore serves both themes. An <img> would need a second, inverted
 * file plus the three-state light/dark/system dance to pick between them — and
 * would still be the wrong colour inside a coloured surface. `-white` variants of
 * both files are kept in `public/brand/` anyway, for the two places that cannot
 * mask: @react-pdf documents and HTML email.
 *
 * ── Variants ────────────────────────────────────────────────────────────────────
 *  - "mark" (default): the bracketed B² alone (1844×1331 of ink). Used wherever a
 *    small badge sits next to an HTML "B2 Consultants" wordmark — repeating the
 *    name underneath the badge would say it twice.
 *  - "full": the complete lockup with CONSULTANTS beneath (1844×1544). For standalone
 *    use where no wordmark follows. The strapline is ~10% of the height, so below
 *    about 40px tall it stops being legible — use "mark" there.
 *
 * ── Sizing ──────────────────────────────────────────────────────────────────────
 * The mark is LANDSCAPE (1.385:1), not the square the old redraw was. The caller
 * sets the height and the component derives the width from the artwork's own
 * aspect ratio, so a `w-*` utility on the caller's side is both unnecessary and
 * harmful — it would squash the frame.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────────
 * Defaults to `--ink`, which is near-black on the light theme and near-white on
 * dark: the artwork is pure black, and `--ink` is the token that means "the darkest
 * thing on this surface" in whichever theme is live. Pass `color` for a logo that
 * sits on a coloured plate, where neither theme's ink is right.
 */

/** Intrinsic ink ratios, measured off the source artwork. */
const RATIO = {
  mark: 1844 / 1331,
  full: 1844 / 1544,
} as const;

const SRC = {
  mark: "/brand/b2-mark.png",
  full: "/brand/b2-lockup.png",
} as const;

export function BrandLogo({
  variant = "mark",
  className,
  color = "var(--ink)",
  title = "B2 Consultants",
}: {
  variant?: "mark" | "full";
  className?: string;
  /** Any CSS colour. Defaults to `--ink`, which is theme-correct on every app surface. */
  color?: string;
  title?: string;
}) {
  const url = `url(${SRC[variant]})`;
  return (
    <span
      role="img"
      aria-label={title}
      className={className}
      style={{
        display: "inline-block",
        aspectRatio: String(RATIO[variant]),
        // Height comes from the caller (h-10, h-8…); width follows the ratio above.
        width: "auto",
        // The ink: the mask lets this colour through wherever the artwork has alpha.
        backgroundColor: color,
        maskImage: url,
        maskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
        WebkitMaskImage: url,
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
