"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Segmented tabs - full ARIA tab/tabpanel wiring with roving focus and
 * left/right arrow-key navigation.
 *
 * The active marker is a single element that TRAVELS (§6). One object moving from
 * A to B says "these are the same control, and you moved it"; a marker that blinks
 * off one tab and on to another says nothing and reads as a page reload. JS measures
 * the active tab and publishes --tab-x/y/w/h; globals.css animates it.
 *
 * `variant` exists because tabs nest: the Founder Console puts a second strip inside
 * a Card that already sits under a first one. Two identical filled strips give the
 * eye nothing to rank them by, so the inner level uses `underline`.
 */
export type TabsVariant = "pill" | "underline";

export function Tabs({
  tabs,
  variant = "pill",
  initial = 0,
  urlKey,
}: {
  tabs: { label: string; content: ReactNode }[];
  variant?: TabsVariant;
  /** Which tab is open on first render (e.g. a deep-link landing on "Expenses"). */
  initial?: number;
  /**
   * Keep the open tab in the URL under this query key (issue 28).
   *
   * Without it the tab lives in React state alone, so refreshing the page - or sharing the
   * address, or coming back through the browser's history - always reopened the first tab. On
   * Finance that meant any refresh while working on Expenses or Pending payments silently
   * returned you to Income.
   *
   * Opt-in by key rather than automatic, because a page may host more than one strip and two
   * of them writing the same parameter would fight.
   */
  urlKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /**
   * The URL is the source of truth when `urlKey` is set, with local state as the fallback for a
   * strip that does not want to be addressable. Reading it on every render (rather than syncing
   * it into state) is what makes Back and Forward move the tabs.
   */
  const fromUrl = urlKey ? Number(searchParams.get(urlKey)) : NaN;
  const [localActive, setLocalActive] = useState(initial);
  const active =
    urlKey && Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < tabs.length
      ? fromUrl
      : localActive;

  const setActive = useCallback(
    (i: number) => {
      setLocalActive(i);
      if (!urlKey) return;
      const params = new URLSearchParams(searchParams.toString());
      // Tab 0 is the default, so it is left OUT of the address rather than written as "=0" -
      // the common case keeps a clean URL, and a shared link means what it looks like.
      if (i === 0) params.delete(urlKey);
      else params.set(urlKey, String(i));
      const q = params.toString();
      /**
       * `scroll: false` because switching tab must not jump the page to the top - the strip is
       * often well down a long screen, and the panel that just opened is what the person is
       * looking at.
       */
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, urlKey],
  );
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // Until the first measurement lands, the indicator must not animate - otherwise it
  // flies in from the left edge on mount. It renders in place, THEN gains a transition.
  const [ready, setReady] = useState(false);
  const underline = variant === "underline";

  /** Publish the active tab's box to CSS. Cheap: two reads, four var writes. */
  const measure = useCallback(() => {
    const list = listRef.current;
    const el = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[active];
    if (!list || !el) return;
    // offsetLeft/Top are relative to the tablist because it is `relative` - the
    // offset parent. Measuring both axes keeps the marker correct when the strip
    // flex-wraps to a second line on a narrow window.
    const h = underline ? 2 : el.offsetHeight;
    const y = underline ? el.offsetTop + el.offsetHeight - 2 : el.offsetTop;
    list.style.setProperty("--tab-x", `${el.offsetLeft}px`);
    list.style.setProperty("--tab-y", `${y}px`);
    list.style.setProperty("--tab-w", `${el.offsetWidth}px`);
    list.style.setProperty("--tab-h", `${h}px`);
  }, [active, underline]);

  // Layout effect: measure before paint so the marker is never briefly wrong.
  useLayoutEffect(() => {
    measure();
    // Two frames: one to land the measured position with transitions off, one to
    // switch them on. Same frame would let the browser coalesce both and animate.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, [measure]);

  // Labels carry live counts ("Badges (23)"), the strip can wrap, and the webfont
  // lands after first paint - all of which resize the tabs under the marker.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    for (const el of list.querySelectorAll('[role="tab"]')) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tabs.length]);

  const focusTab = (i: number) => {
    const next = (i + tabs.length) % tabs.length;
    setActive(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); focusTab(i + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); focusTab(i - 1); }
    if (e.key === "Home") { e.preventDefault(); focusTab(0); }
    if (e.key === "End") { e.preventDefault(); focusTab(tabs.length - 1); }
  };

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="horizontal"
        className={
          underline
            ? "relative flex flex-wrap gap-5 border-b border-line"
            : "relative flex flex-wrap gap-1 rounded-field bg-surface-2 p-1"
        }
      >
        {/* The travelling marker. Decorative - the tabs carry the state for AT. */}
        <span
          aria-hidden
          data-ready={ready}
          className={`tab-indicator pointer-events-none ${
            underline ? "rounded-full bg-primary" : "rounded-field bg-primary shadow-card"
          }`}
        />
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            type="button"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            // relative z-10: the label rides ABOVE the marker sliding under it.
            className={
              underline
                ? `relative z-10 h-9 text-sm transition-colors duration-150 ${
                    i === active ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink"
                  }`
                : `relative z-10 h-9 rounded-field px-3.5 text-sm font-medium transition-colors duration-150 ${
                    i === active ? "text-on-accent" : "text-muted hover:text-ink"
                  }`
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
        className={underline ? "pt-4" : "pt-5"}
      >
        {/* keyed: React remounts on swap, which replays the cross-fade */}
        <div key={active} className="panel-in">
          {tabs[active]?.content}
        </div>
      </div>
    </div>
  );
}
