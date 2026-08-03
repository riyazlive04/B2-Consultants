import { type NextRequest } from "next/server";
import { captureException } from "@/lib/observability";
import { clientIpFrom, takeToken, tooManyRequests } from "@/lib/rate-limit";

/**
 * Where browser-side errors go.
 *
 * A React render error inside the app shell hits `app/(app)/error.tsx`, which until now showed the
 * user a message and told nobody. That is exactly the class of bug a client emails about — "the
 * students page is blank" — with no server-side trace to look at, because nothing threw on the
 * server.
 *
 * NOT PUBLIC. Deliberately absent from middleware's PUBLIC_PREFIXES, so only a logged-in session
 * can post here. A public error sink is a free way to fill someone's Sentry quota, and the errors
 * worth catching all happen behind the login anyway.
 *
 * The browser does NOT talk to Sentry directly: that needs a separate public DSN and a CORS
 * setup, and it would ship the DSN to every visitor. One hop through the server keeps a single
 * key, server-side, and lets the same scrubbing run over the payload.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // A render loop can fire an error handler dozens of times a second. Cheap and generous —
  // enough to catch a real burst, not enough to be a useful amplifier.
  const gate = takeToken(`client-error:${clientIpFrom(req.headers)}`, {
    capacity: 20,
    refillPerSec: 0.2,
  });
  if (!gate.ok) return tooManyRequests(gate.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message : "Unknown client error";
  const digest = typeof b.digest === "string" ? b.digest : null;
  const path = typeof b.path === "string" ? b.path : null;

  // Rebuild an Error so the stack Sentry shows is the BROWSER's, not this route's — a trace
  // pointing at the reporting endpoint would be worse than no trace.
  const err = new Error(message);
  err.name = "ClientError";
  if (typeof b.stack === "string") err.stack = b.stack;

  await captureException(err, {
    where: "client",
    extra: { path, digest, userAgent: req.headers.get("user-agent") },
    // Next's `digest` is its own stable hash of the error — a far better grouping key than a
    // minified browser stack, which differs per build.
    fingerprint: digest ? ["client", digest] : undefined,
  });

  return new Response(null, { status: 204 });
}
