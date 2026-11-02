"use client";

import { useEffect, useState } from "react";

/**
 * THE LAST BOUNDARY. Everything that escapes every other one lands here.
 *
 * ── Why this file had to exist ──────────────────────────────────────────────────────────────
 * `app/(app)/error.tsx` catches errors thrown by a PAGE and its children. It does not catch
 * errors thrown by the layout it sits beside - and `AppShell` is in `(app)/layout.tsx`. So
 * everything mounted in the shell is outside every boundary this app had: the nav, the clock, the
 * notification bell, the Record modal, and the improvement report form with its recorder.
 *
 * A throw in any of those produced Next's own built-in screen - "Application error: a client-side
 * exception has occurred (see the browser console for more information)" - which is a dead end in
 * three separate ways. It tells the person nothing they can act on, it offers no way back short of
 * knowing to reload, and NOTHING IS REPORTED: `(app)/error.tsx` posts to
 * `/api/observability/client-error`, this path posted nowhere, so the only record of the crash was
 * a console message in a browser nobody was watching. A real crash while filing a bug report was
 * invisible afterwards, which is the worst possible place to have no telemetry.
 *
 * ── Why the copy names a reload and a new version ───────────────────────────────────────────
 * The commonest cause of a client-side exception in a long-lived tab is a DEPLOY. The tab holds
 * the old build's chunk names, the server now has the new ones, and the next navigation fetches a
 * file that no longer exists - Webpack rejects with `ChunkLoadError` and React unwinds to here.
 * There is nothing wrong with the app and nothing wrong with what the person did; they need to
 * reload, so that is the first thing this screen says. `reset()` cannot fix that case, which is
 * why the primary action is a real reload rather than a re-render.
 *
 * ── Why it is deliberately plain ────────────────────────────────────────────────────────────
 * `global-error` REPLACES the root layout, so it brings its own <html> and <body> and cannot use
 * the app's fonts, theme variables or component kit - none of that is mounted at this point. Every
 * colour is therefore inline and literal, and the markup is as small as it can be: a boundary that
 * can itself throw is not a boundary. It still honours the OS dark-mode preference, because the
 * one thing worse than a crash screen is a blinding white one at midnight.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /**
   * A stale chunk is a different problem with a different fix, and the person deserves to be told
   * which one they have. The name is matched as well as the message because Webpack sets both, and
   * minification leaves neither intact in every build.
   */
  const stale =
    /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module/i.test(
      `${error?.name ?? ""} ${error?.message ?? ""}`,
    );
  const [reported, setReported] = useState(false);

  useEffect(() => {
    console.error(error);

    /**
     * Report it, through the same endpoint the section boundary uses - one sink, one scrubber,
     * one Sentry key held server-side. Fire-and-forget and swallowed on failure: somebody already
     * looking at a crash screen must not be shown a second one because the report of the first
     * did not send. `keepalive` so it survives the reload they are about to do.
     */
    void fetch("/api/observability/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error?.message ?? "Unknown client error",
        stack: error?.stack,
        digest: error?.digest,
        path: typeof window === "undefined" ? null : window.location.pathname + window.location.search,
      }),
      keepalive: true,
    })
      .then(() => setReported(true))
      .catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily:
            'Inter, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji"',
          background: "#F1F5FB",
          color: "#16203A",
        }}
      >
        {/* The dark variant lives in a <style> rather than in the inline styles above, because a
            media query cannot be expressed in a style attribute at all. */}
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #0C1222 !important; color: #E8EDF7 !important; }
            .ge-card { background: #121A2E !important; border-color: #233150 !important; }
            .ge-muted { color: #94A3BE !important; }
            .ge-ghost { color: #94A3BE !important; border-color: #233150 !important; }
          }
        `}</style>

        <div
          className="ge-card"
          style={{
            width: "100%",
            maxWidth: "30rem",
            background: "#FFFFFF",
            border: "1px solid #DCE4F0",
            borderRadius: "14px",
            padding: "28px",
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(16,32,58,.06), 0 8px 24px rgba(16,32,58,.06)",
          }}
        >
          <h1 style={{ margin: "0 0 10px", fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            {stale ? "The app was updated" : "Something went wrong"}
          </h1>
          <p className="ge-muted" style={{ margin: "0 0 20px", fontSize: "14px", lineHeight: 1.6, color: "#5A6B8C" }}>
            {stale
              ? "A new version was deployed while this tab was open, so part of the page could no longer be loaded. Reloading picks up the new version - nothing you saved is affected."
              : "This screen hit an unexpected problem and had to stop. Nothing you had saved was changed. Reloading usually clears it."}
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
            {/*
              A real reload, not `reset()`. `reset()` re-renders the same tree from the same
              already-loaded chunks, which cannot help the stale-chunk case and often throws
              straight back for the others. The re-render is still offered, second, for the
              genuinely transient failure.
            */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "40px",
                padding: "0 18px",
                borderRadius: "10px",
                border: "none",
                background: "#003C8C",
                color: "#FFFFFF",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload the page
            </button>
            <button
              type="button"
              onClick={reset}
              className="ge-ghost"
              style={{
                height: "40px",
                padding: "0 18px",
                borderRadius: "10px",
                border: "1px solid #DCE4F0",
                background: "transparent",
                color: "#5A6B8C",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>

          {/*
            The digest, shown on purpose.
            It is Next's own stable hash of the error and the one thing that ties what the person
            is looking at to the entry now sitting in Sentry - so "I got error 1f3a9c2" is a
            lookup instead of a conversation. The message itself stays out of production: a
            minified exception string tells a reader nothing and can carry data from the page.
          */}
          <p className="ge-muted" style={{ margin: "18px 0 0", fontSize: "12px", color: "#8494AE" }}>
            {error?.digest ? <>Reference {error.digest} · </> : null}
            {reported ? "Reported to the team automatically." : "If it keeps happening, tell the team."}
          </p>
        </div>
      </body>
    </html>
  );
}
