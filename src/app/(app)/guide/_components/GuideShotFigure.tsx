import Image from "next/image";
import type { GuideShot } from "@/lib/guide-content";

/**
 * A real screenshot of the screen being described, with the thing to click boxed on it.
 *
 * ── Why percentages ────────────────────────────────────────────────────────────────────
 * `hotspot` is in percent of the image rather than pixels, so the box stays on its target when
 * the screenshot is re-captured at a different window size. That is what makes these
 * maintainable: `scripts/capture-guide-shots.ts` can refresh every image after a UI change
 * without anybody re-measuring a single coordinate. Pixel offsets would have rotted the first
 * time a button moved, and a guide whose arrows point at the wrong thing is worse than one with
 * no pictures.
 *
 * The box is `aria-hidden` and its label is read from the caption instead - a screen reader
 * cannot see where a rectangle is, so the caption has to carry the instruction in words anyway.
 */
export function GuideShotFigure({
  shot,
  size = { width: 1280, height: 800 },
}: {
  shot: GuideShot;
  /** The capture's real pixel size, so the box keeps its aspect ratio before the image loads. */
  size?: { width: number; height: number };
}) {
  return (
    <figure className="space-y-1.5">
      <div className="relative overflow-hidden rounded-field border border-line bg-surface-2">
        {/*
          `unoptimized` because these are already-compressed PNG captures of the app's own UI, and
          running them through the image optimiser at request time costs CPU on a 1-vCPU box to
          produce a file no smaller. `sizes` keeps the browser from fetching a 2x asset on a phone.
        */}
        <Image
          src={shot.src}
          alt={shot.caption}
          width={size.width}
          height={size.height}
          unoptimized
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="h-auto w-full"
        />
        {shot.hotspot && (
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-[3px] ring-2 ring-action ring-offset-1"
            style={{
              left: `${shot.hotspot.x}%`,
              top: `${shot.hotspot.y}%`,
              width: `${shot.hotspot.w}%`,
              height: `${shot.hotspot.h}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded-full bg-action px-1.5 py-0.5 text-[10px] font-bold text-on-action">
              {shot.hotspot.label}
            </span>
          </span>
        )}
      </div>
      <figcaption className="text-caption text-muted">{shot.caption}</figcaption>
    </figure>
  );
}
