"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { askConfirm } from "@/components/ui/feedback";
import { clearUnsavedWork, hasUnsavedWork } from "@/components/ui/use-unsaved-guard";

/**
 * THE APP'S OWN "you have unsaved work" DIALOG, for every exit it is allowed to dress.
 *
 * Mounted once in the (app) layout, above every page. A half-typed finance entry is lost just as
 * completely by clicking Cash Health in the sidebar as by hitting refresh, and the sidebar click
 * is the one a browser hands us to deal with ourselves - so it gets the app's dialog rather than
 * the browser's grey one.
 *
 * ── Why a capture-phase click listener ───────────────────────────────────────────
 * Next's <Link> navigates from its own click handler. Catching the click in the CAPTURE phase is
 * what lets this stop it before Link ever sees it; a bubble-phase listener would be told about a
 * navigation that had already started. The alternative - wrapping every Link in the app in a
 * guarded component - would need every future link to remember, which is how a guard quietly
 * stops covering half the app.
 *
 * ── What is deliberately NOT intercepted ─────────────────────────────────────────
 * A modified click (Ctrl/Cmd/Shift/middle) opens a new tab and LEAVES this page where it is, so
 * nothing is at risk and interrupting it would be noise. Same for `target="_blank"`, downloads,
 * external links, and bare `#fragment` links that only scroll.
 *
 * Browser Back is also absent. `popstate` fires AFTER the history entry has already moved, so the
 * only way to "cancel" it is to push the user forward again - which fights the back button rather
 * than asking about it, and leaves the history stack in a state nobody predicted. The native
 * `beforeunload` net (see use-unsaved-guard) covers the exits that genuinely leave the app.
 */
export function UnsavedNavGuard() {
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // A new tab leaves this page - and its typing - exactly where it is.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || anchor.hasAttribute("download") || anchor.target === "_blank") return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Scrolling to an anchor on the page you are already on is not leaving it.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      if (!hasUnsavedWork()) return;

      // Stop Link's own handler, which is on the same click, from navigating underneath us.
      e.preventDefault();
      e.stopPropagation();

      void askConfirm({
        title: "Leave without saving?",
        body:
          "You have typed something into a form on this page that hasn't been saved yet. Leaving now discards it.",
        confirmLabel: "Leave and discard",
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        // Forget the edits first, so arriving somewhere and coming straight back does not find a
        // guard still armed over a form that is no longer on screen.
        clearUnsavedWork();
        router.push(url.pathname + url.search + url.hash);
      });
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
