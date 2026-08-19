"use client";

import { useEffect, useRef, useState } from "react";
import SitePageRenderer from "./SitePageRenderer";
import type { NavItem, SiteSectionBlock, SiteTheme } from "@/lib/site-types";

/**
 * A live, scaled-down render of a page - the "screenshot" on a page card.
 *
 * There is no headless browser on the server to capture real screenshots, and storing one per
 * page would go stale the moment someone edits. Rendering the page itself through the SAME
 * renderer the public route uses, at desktop width and scaled to fit, costs nothing extra and
 * can never disagree with what is actually published.
 *
 * The inner frame is laid out at a fixed desktop width and shrunk with `transform: scale()`,
 * so the thumbnail shows the page as a visitor on a laptop would see it, not a squashed
 * mobile layout. The scale follows the card's real width via ResizeObserver.
 */
const FRAME_WIDTH = 1280;

export default function PageThumbnail({
  sections,
  header,
  footer,
  theme,
  nav,
  fromPath,
  siteDomain,
  className = "",
}: {
  sections: SiteSectionBlock[];
  header?: SiteSectionBlock[];
  footer?: SiteSectionBlock[];
  theme: SiteTheme;
  nav: NavItem[];
  fromPath: string;
  siteDomain?: string | null;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? el.clientWidth;
      if (w > 0) setScale(w / FRAME_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={box}
      aria-hidden
      className={`relative aspect-[16/10] w-full overflow-hidden bg-white ${className}`}
    >
      {/* Invisible until measured, so the frame never flashes at full size on first paint. */}
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
        style={{ width: FRAME_WIDTH, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}
      >
        <SitePageRenderer
          sections={sections}
          header={header}
          footer={footer}
          theme={theme}
          nav={nav}
          incoming={{}}
          fromPath={fromPath}
          siteDomain={siteDomain}
        />
      </div>
    </div>
  );
}
