"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A horizontally scrolling row with a VISIBLE affordance.
 *
 * `overflow-x-auto` alone technically scrolls, which is why the boards "worked" - but on Windows
 * and macOS the scrollbar is an overlay that only appears mid-gesture, so a board with stages off
 * the right edge looks like a board that simply ends there. Nothing tells you to keep going.
 *
 * Three signals, all driven off the element's own scroll metrics so none of them lie:
 *   - a fade at whichever edge has more content (and only that edge);
 *   - arrow buttons that page by ~80% of the visible width, hidden when they'd do nothing;
 *   - a slim always-visible scrollbar (`.hscroll-bar`, globals.css) instead of the overlay one.
 *
 * Also handles the ordinary keyboard case: the strip is focusable, so ← / → and Home / End work
 * without a pointer.
 *
 * The scroll element is exposed via ref, because callers already drive it - the opportunities
 * board auto-scrolls this same element while a card is mid-drag.
 */

export type HScrollHandle = { el: HTMLDivElement | null };

export const HScroll = forwardRef<HScrollHandle, {
  children: ReactNode;
  className?: string;
  /** Accessible name for the scrollable region (e.g. "Pipeline stages"). */
  label: string;
}>(function HScroll({ children, className = "", label }, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useImperativeHandle(ref, () => ({ get el() { return scrollerRef.current; } }), []);

  /** Which edges have more content. 1px of slack absorbs sub-pixel layout rounding. */
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Columns are added, removed and filtered at runtime, so the overflow changes without any
    // scroll or resize event - a ResizeObserver on the content is the only reliable trigger.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  const page = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // ~80%, not 100%: leaving a sliver of the previous column visible is what makes it read as
    // "the same row, moved" rather than a page swap.
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const onKey = (e: React.KeyboardEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (e.key === "ArrowRight") { e.preventDefault(); page(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); page(-1); }
    if (e.key === "Home") { e.preventDefault(); el.scrollTo({ left: 0, behavior: "smooth" }); }
    if (e.key === "End") { e.preventDefault(); el.scrollTo({ left: el.scrollWidth, behavior: "smooth" }); }
  };

  /**
   * Arrows sit near the TOP of the strip, not vertically centred.
   *
   * A kanban column is far taller than the viewport, so `top-1/2` centres the arrow on the
   * board's full height - which put it hundreds of pixels below the fold, i.e. invisible exactly
   * when it was needed. Level with the column headers, it is on screen whenever the board is.
   */
  const arrow = (dir: -1 | 1, show: boolean) => (
    <button
      type="button"
      aria-label={dir === 1 ? "Scroll right" : "Scroll left"}
      tabIndex={-1} /* the strip itself is the keyboard path; these are pointer shortcuts */
      onClick={() => page(dir)}
      className={[
        "absolute top-2 z-[2] hidden h-9 w-9 place-items-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-e-2 transition-[opacity,background-color] md:grid",
        dir === 1 ? "right-1" : "left-1",
        show ? "opacity-100 hover:bg-surface-2 hover:text-ink" : "pointer-events-none opacity-0",
      ].join(" ")}
    >
      {dir === 1 ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
    </button>
  );

  return (
    <div className="relative">
      {arrow(-1, edges.left)}
      {arrow(1, edges.right)}
      {/* The fades sit above the content but must never swallow a click meant for a card. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 z-[1] w-10 bg-gradient-to-r from-canvas to-transparent transition-opacity ${
          edges.left ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 z-[1] w-10 bg-gradient-to-l from-canvas to-transparent transition-opacity ${
          edges.right ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={scrollerRef}
        role="group"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        className={`hscroll-bar overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-primary-soft ${className}`}
      >
        {children}
      </div>
    </div>
  );
});
