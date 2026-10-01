/**
 * The app-wide footer: who built this, and a way back to them.
 *
 * Deliberately quiet. It sits under every screen in the app, most of which are dense working
 * surfaces someone stares at all day, so it reads as a credit line rather than a band of
 * furniture: hairline rule, caption type, muted ink, no background of its own.
 *
 * Server-rendered (no "use client") - it holds no state, and the shell around it is already a
 * client component, so keeping this one off the client bundle costs nothing and saves a little.
 */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-line px-4 py-4 md:px-7">
      <p className="text-caption text-ink-3">
        Developed by{" "}
        <a
          href="https://sirahdigital.in/"
          target="_blank"
          /**
           * `noopener` is the one that matters: without it the opened tab gets a handle on this
           * one through `window.opener` and can navigate it anywhere. `noreferrer` keeps the
           * internal URL - which can carry record ids - out of the other site's referrer log.
           */
          rel="noopener noreferrer"
          className="font-medium text-ink-2 underline decoration-line underline-offset-2 transition-colors hover:text-primary hover:decoration-primary"
        >
          Sirah Digital
          {/* Named for a screen reader, which otherwise announces a link that silently replaces
              the user's context with no warning. */}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </footer>
  );
}
