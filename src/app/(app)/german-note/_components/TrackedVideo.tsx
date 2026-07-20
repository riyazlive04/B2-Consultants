"use client";

import { useEffect, useRef } from "react";
import { recordWatchProgress } from "@/server/german-note-actions";

/**
 * A recording iframe that reports how far the viewer actually got (spec §10.3: "the tracked
 * percentage is the source of truth").
 *
 * ONLY YOUTUBE IS TRACKABLE, and that is a real limit rather than an oversight. These are
 * cross-origin embeds: a page cannot see inside another origin's player, so progress is only
 * knowable when that provider exposes an API. YouTube does (the IFrame API). Fathom — which
 * the comments call the primary provider — does not, and neither does Drive.
 *
 * For an untrackable provider this renders a plain iframe and reports nothing, leaving
 * watchedPct null. That is deliberate: resolveWatchTruth reads null as "no tracking" and
 * falls back to the student's tick. The alternative — inferring progress from how long the
 * iframe sat on screen — would put a fabricated number in the one column the founders asked
 * us to trust, which is worse than no number at all.
 *
 * Every live recording is YouTube today, so this covers the whole library in practice. If
 * Fathom links start arriving, the answer is §19.4's decision to host video in-platform, not
 * a cleverer guess here.
 */

/** How often to report while playing: often enough to survive a closed tab, rare enough not to spam. */
const HEARTBEAT_MS = 5_000;

type YTPlayer = {
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Load YouTube's IFrame API once per page, shared by every player on it.
 *
 * The chained onYouTubeIframeAPIReady matters: YouTube calls that global exactly once, so a
 * second player mounting mid-load would otherwise clobber the first player's resolver and
 * hang it forever.
 */
let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** enablejsapi is what makes the player answerable; without it every getter returns nothing. */
function withJsApi(embedUrl: string): string {
  try {
    const u = new URL(embedUrl);
    u.searchParams.set("enablejsapi", "1");
    return u.toString();
  } catch {
    return embedUrl;
  }
}

export function TrackedVideo({
  recordingId,
  provider,
  embedUrl,
  title,
}: {
  recordingId: string;
  provider: "FATHOM" | "YOUTUBE" | "VIMEO" | "GDRIVE";
  embedUrl: string;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSentPct = useRef(-1);

  useEffect(() => {
    if (provider !== "YOUTUBE") return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let dead = false;

    const report = () => {
      if (!player || dead) return;
      let pos = 0;
      let dur = 0;
      try {
        pos = player.getCurrentTime();
        dur = player.getDuration();
      } catch {
        return; // player not ready yet, or torn down mid-tick
      }
      if (!Number.isFinite(dur) || dur <= 0) return;
      const pct = Math.round((pos / dur) * 100);
      // Only report forward movement. Scrubbing back isn't progress, and the server's
      // high-water mark would discard it anyway — no reason to spend the round-trip.
      if (pct <= lastSentPct.current) return;
      lastSentPct.current = pct;
      void recordWatchProgress(recordingId, Math.floor(pos), Math.floor(dur)).catch(() => {
        /* best-effort: a dropped heartbeat must never interrupt playback */
      });
    };

    void loadYouTubeApi().then(() => {
      if (dead || !window.YT?.Player) return;
      // Attach to the EXISTING iframe rather than creating another element — YouTube's API
      // adopts an iframe that already carries enablejsapi.
      player = new window.YT.Player(iframe, {
        events: {
          onReady: () => {
            timer = setInterval(report, HEARTBEAT_MS);
          },
          // Pause/end fire a final read, so closing the tab straight after finishing still
          // records the finish rather than losing the last few seconds.
          onStateChange: () => report(),
        },
      });
    });

    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
    };
  }, [recordingId, provider, embedUrl]);

  return (
    <iframe
      ref={iframeRef}
      src={provider === "YOUTUBE" ? withJsApi(embedUrl) : embedUrl}
      title={title}
      loading="lazy"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className="h-full w-full"
    />
  );
}
