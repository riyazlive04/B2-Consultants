import "server-only";

/**
 * Rate limiting for the PUBLIC surfaces - the booking form, the funnel forms, and the two lead
 * webhooks. These are open endpoints that cost real money per request (WATI sends, Resend sends,
 * Supabase round-trips) and, in /book's case, cost a finite resource: calendar slots.
 *
 * WHY THIS WAS REWRITTEN. The previous implementation was a FIXED WINDOW: a counter that resets on
 * a wall-clock boundary. That permits a 2× burst straight through the middle of any rule - five
 * requests at 09:59:59 and five more at 10:00:00 is ten requests in one second against a
 * "5 per 10 minutes" limit. On /book that is ten slots gone. A token bucket has no boundary to
 * straddle: capacity is the burst you accept, refill is the sustained rate you accept, and the two
 * are stated separately instead of being tangled into one number.
 *
 * IN-MEMORY AND PER-INSTANCE, deliberately. The app runs as a single Node container
 * (docker-compose), so this is an effective brake without adding Redis to the manual core. On a
 * multi-instance deploy it degrades to per-instance limits - still meaningful, but not a security
 * boundary on its own, and it never was.
 */

type Bucket = {
  /** Fractional tokens available. */
  tokens: number;
  /** Last refill instant (ms). */
  at: number;
};

export type RateRule = {
  /** Burst - the most that can be spent at once from a full bucket. */
  capacity: number;
  /** Sustained rate. `capacity` tokens take `capacity / refillPerSec` seconds to come back. */
  refillPerSec: number;
};

export type RateVerdict = {
  ok: boolean;
  /** Whole seconds until at least one token is available. 0 when `ok`. */
  retryAfterSec: number;
  /** Tokens left after this call, floored. */
  remaining: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Drops buckets that have been idle long enough to be indistinguishable from a fresh one. Only
 * runs when the map is large, so the common path stays O(1).
 */
function sweep(now: number) {
  if (buckets.size < 10_000) return;
  for (const [k, b] of buckets) {
    // An hour untouched - every rule here refills fully in far less than that.
    if (now - b.at > 3_600_000) buckets.delete(k);
  }
}

/** Post-refill state of a bucket, without spending anything. */
function refilled(key: string, rule: RateRule, now: number): Bucket {
  const existing = buckets.get(key);
  // A key seen for the first time starts FULL. Starting empty would rate-limit every genuinely
  // new visitor, and starting at 1 would make `capacity` a lie.
  if (!existing) return { tokens: rule.capacity, at: now };
  const elapsedSec = (now - existing.at) / 1000;
  return {
    tokens: Math.min(rule.capacity, existing.tokens + elapsedSec * rule.refillPerSec),
    at: now,
  };
}

/** Spends one token for `key`. Returns the verdict; the caller decides what to do with it. */
export function takeToken(key: string, rule: RateRule): RateVerdict {
  return takeTokens([{ key, rule }]);
}

/**
 * Spends one token against SEVERAL rules at once, and only if every one of them can pay.
 *
 * This is what per-IP limiting alone cannot express. A per-IP cap on /book stops one abuser; it
 * does nothing about a hundred IPs each politely taking their allowance until the calendar is
 * empty. Pairing a per-IP rule with a global one covers both - and the all-or-nothing part
 * matters: if the global bucket is empty, the per-IP bucket must not be charged for a request
 * that was refused, or a blocked visitor is punished twice for one attempt.
 */
export function takeTokens(entries: { key: string; rule: RateRule }[]): RateVerdict {
  const now = Date.now();
  sweep(now);

  const staged = entries.map(({ key, rule }) => ({ key, rule, b: refilled(key, rule, now) }));

  const blocked = staged.filter((s) => s.b.tokens < 1);
  if (blocked.length) {
    // Persist the refill - that time really did pass - but charge nothing.
    for (const s of staged) buckets.set(s.key, s.b);
    const waitSec = Math.max(...blocked.map((s) => (1 - s.b.tokens) / s.rule.refillPerSec));
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(waitSec)), remaining: 0 };
  }

  for (const s of staged) {
    s.b.tokens -= 1;
    buckets.set(s.key, s.b);
  }
  return {
    ok: true,
    retryAfterSec: 0,
    remaining: Math.floor(Math.min(...staged.map((s) => s.b.tokens))),
  };
}

/**
 * COMPATIBILITY WRAPPER for the existing `rateLimitOk(key, limit, windowMs)` call sites.
 *
 * The old signature described a fixed window; it is reinterpreted here as a bucket of `limit`
 * tokens refilling over `windowMs`. Sustained throughput is identical, the straddle burst is gone,
 * and no caller had to change. Prefer `takeToken` in new code - it returns a `Retry-After`.
 */
export function rateLimitOk(key: string, limit: number, windowMs: number): boolean {
  return takeToken(key, { capacity: limit, refillPerSec: limit / (windowMs / 1000) }).ok;
}

/**
 * The public-surface rules, in ONE table.
 *
 * Previously these were magic numbers spread across nine route files, which made "what are our
 * limits" a question you answered with grep. The per-request cost is noted where it isn't
 * obvious, because that cost is the actual argument for each number.
 */
export const RATE_RULES = {
  /** Booking form. Costs a calendar slot + a WATI confirmation send. Deliberately tight. */
  bookPerIp: { capacity: 5, refillPerSec: 5 / 600 }, // 5 burst, then 5 per 10 min
  /** Whole-site ceiling on bookings - a distributed flood still can't drain the calendar. */
  bookGlobal: { capacity: 40, refillPerSec: 40 / 600 },

  /** Public funnel/lead forms. Costs a DB write plus a possible automation enrolment. */
  formPerIp: { capacity: 8, refillPerSec: 8 / 600 },
  formGlobal: { capacity: 120, refillPerSec: 120 / 600 },

  /**
   * Lead webhooks (Pabbly, FlexiFunnels). These arrive from ONE vendor IP, so a per-IP rule is
   * really a global rule that also breaks the day the vendor changes egress address. Generous on
   * purpose: a legitimate bulk replay happens, and dropping real leads is the expensive failure.
   * The cap is here to bound a runaway loop, not to police the vendor.
   */
  leadWebhook: { capacity: 240, refillPerSec: 2 },

  /** WATI inbound. Chatty by nature (status callbacks), so the ceiling is high. */
  watiWebhook: { capacity: 600, refillPerSec: 10 },

  /** Cron routes. An hourly tick; anything faster is a stuck scheduler. */
  cron: { capacity: 20, refillPerSec: 20 / 60 },
  /** For the 1-minute and 5-minute ticks (outreach, alerts). */
  cronFrequent: { capacity: 120, refillPerSec: 2 },
} satisfies Record<string, RateRule>;

/** A real 429 - with `Retry-After`, which Pabbly and WATI both honour and will redeliver on. */
export function tooManyRequests(retryAfterSec: number, message = "Too many requests"): Response {
  return new Response(message, {
    status: 429,
    headers: { "retry-after": String(Math.max(1, retryAfterSec)) },
  });
}

/** Best-effort client IP from proxy headers (Caddy/Traefik in front of the container). */
export function clientIpFrom(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Test seam - drops every bucket. Not used by application code. */
export function __resetRateLimiter(): void {
  buckets.clear();
}
