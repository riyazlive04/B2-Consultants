/**
 * Next runs register() once per server boot — the only hook that fires before the
 * first request is served. Two jobs:
 *
 *  1. Fail a misconfigured deploy at startup instead of letting it serve broken auth
 *     origins and localhost links (see lib/env.ts).
 *  2. Attach the process-level error handlers, so a throw that escapes every request
 *     path is still reported rather than lost to stdout.
 */
export async function register() {
  // Guard 1: `next build` also imports this module. Validating there would demand
  // production secrets at image-build time — precisely the coupling we just removed
  // by taking migrations out of the build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Error handlers attach in EVERY environment, unlike the env validation below. An
  // unhandled rejection in dev is the same bug it is in production, and this is the
  // only place in the app where one is currently observable at all.
  await attachProcessHandlers();

  // Guard 2: dev/test run on http://localhost:3000 with a deliberately loose .env.
  if (process.env.NODE_ENV !== "production") return;

  const { validateEnv } = await import("@/lib/env");
  try {
    validateEnv();
  } catch (err) {
    // Next 14 CATCHES a throw from register() ("Failed to prepare server"), logs it,
    // then keeps the process alive serving 500s. That is not "refused to start" — it is
    // an unhealthy container that still shows "Up". So we log the reason ourselves and
    // hard-exit: the restart policy then crash-loops it, which is obvious in
    // `docker compose ps` and guarantees it never serves a single request.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Reports errors that escape every request path.
 *
 * `unhandledRejection` is the one that matters here: this codebase is full of
 * deliberately un-awaited fire-and-forget sends (notification emails, WhatsApp
 * dispatches, activity logs), and any of those rejecting produced exactly nothing —
 * no log line, no alert, no trace.
 *
 * `uncaughtException` does NOT exit the process. Node's default would, and Next's
 * server is already tolerant of a throw in a request; exiting here would turn a single
 * bad request into a container restart that drops every in-flight response. The
 * container's own health probe is what decides whether the process is worth keeping.
 */
async function attachProcessHandlers() {
  const g = globalThis as { __b2ErrorHandlersAttached?: boolean };
  // register() can run more than once in dev (HMR); duplicate handlers would report
  // every error N times and eventually trip Node's max-listeners warning.
  if (g.__b2ErrorHandlersAttached) return;
  g.__b2ErrorHandlersAttached = true;

  const { captureException } = await import("@/lib/observability");

  process.on("unhandledRejection", (reason) => {
    void captureException(reason, { where: "process:unhandledRejection" });
  });

  process.on("uncaughtException", (err) => {
    void captureException(err, { where: "process:uncaughtException" });
  });
}
