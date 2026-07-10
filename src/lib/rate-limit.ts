import "server-only";

/**
 * Minimal fixed-window rate limiter for the PUBLIC surfaces (booking form, lead
 * webhooks). In-memory and per-instance by design: the app runs as a single Node
 * container on the VPS (docker-compose), so this is an effective guard against
 * slot-exhaustion and lead-spam floods without adding Redis to the manual core.
 * On a multi-instance/serverless deploy it degrades to per-instance limits —
 * still a meaningful brake, not a security boundary on its own.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Sweep expired buckets occasionally so the map can't grow unbounded. */
function sweep(now: number) {
  if (buckets.size < 10_000) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Returns true when the caller identified by `key` is within `limit` calls per
 * `windowMs`. Callers should fail the request when this returns false.
 */
export function rateLimitOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** Best-effort client IP from proxy headers (nginx/Traefik in front of the container). */
export function clientIpFrom(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
