/**
 * Next runs register() once per server boot — the only hook that fires before the
 * first request is served. Used here to fail a misconfigured deploy at startup
 * instead of letting it serve broken auth origins and localhost links (see lib/env.ts).
 */
export async function register() {
  // Guard 1: `next build` also imports this module. Validating there would demand
  // production secrets at image-build time — precisely the coupling we just removed
  // by taking migrations out of the build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

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
