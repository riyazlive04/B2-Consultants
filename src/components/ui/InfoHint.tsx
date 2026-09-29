"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A small "i" chip that reveals a plain-English definition on hover AND on keyboard
 * focus (§2.4/§2.5: several dashboard figures were unreadable because nothing said
 * what they were a percentage *of*, or how they were derived).
 *
 * WHY THIS IS NOT CSS-ONLY ANY MORE. The bubble used to be `position: absolute`, which
 * means it lives inside the nearest positioned ancestor and is clipped by any ancestor
 * with `overflow: hidden`. Almost every surface that needs a hint has one: the month
 * hero is `overflow-hidden rounded-hero`, cards are the same. So the hint on the
 * right-aligned "behind target pace" chip - a 240px bubble centred on a 16px chip that
 * sits at the hero's right edge - had ~120px sliced off, and hints on the bottom row of
 * tiles were cut at the hero's lower border. The text was there; it just could not be read.
 *
 * The bubble is now `position: fixed` in a portal on `document.body`, so no ancestor can
 * clip it, and it is measured and placed against the VIEWPORT: centred on the chip, then
 * clamped into the horizontal gutters, and flipped above the chip when there is no room
 * below. That also retires the old phones-get-a-pinned-bottom-bar special case - clamping
 * keeps a narrow bubble beside its chip on a 390px screen without it running off the edge.
 *
 * `tabIndex` + `aria-label` still carry the same text to screen readers and to keyboard
 * users, who never get a :hover. The bubble itself is `aria-hidden` so the definition is
 * not announced twice.
 */

/** Keep this much clear of every viewport edge. */
const GUTTER = 8;
/** Vertical breathing room between the chip and its bubble. */
const GAP = 6;

type Box = { top: number; left: number };

export function InfoHint({ text, className = "" }: { text: string; className?: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setBox(null);
  }, []);

  // Layout effect, not effect: the bubble is rendered transparent for one frame so it can
  // be measured, then painted at the placed position. Doing this before paint means the
  // user never sees it flash in the wrong spot.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = anchorRef.current;
      const bubble = bubbleRef.current;
      if (!anchor || !bubble) return;

      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const w = bubble.offsetWidth;
      const h = bubble.offsetHeight;

      const left = Math.min(Math.max(a.left + a.width / 2 - w / 2, GUTTER), Math.max(GUTTER, vw - w - GUTTER));

      // Prefer below. Flip above only if below overflows AND above actually has room,
      // otherwise a hint near the bottom of a short window would flip into the top edge.
      const below = a.bottom + GAP;
      const above = a.top - GAP - h;
      const top =
        below + h > vh - GUTTER && above >= GUTTER
          ? above
          : Math.min(below, Math.max(GUTTER, vh - GUTTER - h));

      setBox({ top, left });
    };

    place();

    // `true` = capture, so the bubble also follows scrolling of any inner scroll container.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, text]);

  return (
    <span
      ref={anchorRef}
      className={`relative inline-flex align-middle ${className}`}
      tabIndex={0}
      aria-label={text}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onFocus={() => setOpen(true)}
      onBlur={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <span
        aria-hidden
        className="inline-flex h-4 w-4 flex-none cursor-help items-center justify-center rounded-full border border-line bg-surface-2 text-caption leading-none text-muted"
      >
        i
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            aria-hidden
            /* `text-surface`, not `text-white`: --ink is near-white in dark mode, so a
               hardcoded white label would render white-on-white there.

               Width is capped in CSS rather than measured, so the first (invisible) pass
               already wraps exactly as the painted one will and the measured height is real. */
            className="pointer-events-none fixed z-50 whitespace-normal rounded-field bg-ink px-2.5 py-1.5 text-left text-caption font-normal normal-case leading-snug tracking-normal text-surface shadow-soft transition-opacity"
            style={{
              top: box?.top ?? 0,
              left: box?.left ?? 0,
              width: "min(15rem, calc(100vw - 1rem))",
              opacity: box ? 1 : 0,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
