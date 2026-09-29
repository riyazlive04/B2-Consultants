import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  takeToken,
  takeTokens,
  rateLimitOk,
  clientIpFrom,
  tooManyRequests,
  RATE_RULES,
  __resetRateLimiter,
} from "../rate-limit";

/**
 * The limiter reads `Date.now()`, so every test that cares about refill drives a fake clock
 * rather than sleeping. `mock.timers` gives deterministic control and keeps the suite instant.
 */
function withClock(startMs: number) {
  mock.timers.enable({ apis: ["Date"], now: startMs });
  return {
    advance: (ms: number) => mock.timers.tick(ms),
    done: () => mock.timers.reset(),
  };
}

describe("token bucket", () => {
  beforeEach(() => {
    __resetRateLimiter();
    mock.timers.reset();
  });

  test("a fresh key starts full, so a first-time visitor is never throttled", () => {
    const rule = { capacity: 3, refillPerSec: 1 };
    assert.equal(takeToken("fresh", rule).ok, true);
    assert.equal(takeToken("fresh", rule).ok, true);
    assert.equal(takeToken("fresh", rule).ok, true);
    assert.equal(takeToken("fresh", rule).ok, false);
  });

  test("remaining counts down and floors at zero", () => {
    const rule = { capacity: 3, refillPerSec: 1 };
    assert.equal(takeToken("rem", rule).remaining, 2);
    assert.equal(takeToken("rem", rule).remaining, 1);
    assert.equal(takeToken("rem", rule).remaining, 0);
    assert.equal(takeToken("rem", rule).remaining, 0);
  });

  test("keys are independent", () => {
    const rule = { capacity: 1, refillPerSec: 1 };
    assert.equal(takeToken("a", rule).ok, true);
    assert.equal(takeToken("a", rule).ok, false);
    assert.equal(takeToken("b", rule).ok, true);
  });

  test("tokens refill at the stated rate, capped at capacity", () => {
    const clock = withClock(1_000_000);
    try {
      const rule = { capacity: 2, refillPerSec: 1 }; // one token per second
      assert.equal(takeToken("refill", rule).ok, true);
      assert.equal(takeToken("refill", rule).ok, true);
      assert.equal(takeToken("refill", rule).ok, false);

      clock.advance(1000);
      assert.equal(takeToken("refill", rule).ok, true, "one second buys exactly one token");
      assert.equal(takeToken("refill", rule).ok, false);

      // Ten seconds of idling must not bank ten tokens - capacity is the ceiling.
      clock.advance(10_000);
      assert.equal(takeToken("refill", rule).ok, true);
      assert.equal(takeToken("refill", rule).ok, true);
      assert.equal(takeToken("refill", rule).ok, false, "capacity caps the refill");
    } finally {
      clock.done();
    }
  });

  test("retryAfterSec reflects the real wait and is never zero when blocked", () => {
    const clock = withClock(2_000_000);
    try {
      const rule = { capacity: 1, refillPerSec: 0.1 }; // a token every 10s
      assert.equal(takeToken("wait", rule).ok, true);

      const blocked = takeToken("wait", rule);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.retryAfterSec, 10);

      clock.advance(6000);
      assert.equal(takeToken("wait", rule).retryAfterSec, 4, "the wait shrinks as time passes");

      clock.advance(4000);
      assert.equal(takeToken("wait", rule).ok, true);
    } finally {
      clock.done();
    }
  });

  test("a blocked call does not consume a token", () => {
    const clock = withClock(3_000_000);
    try {
      const rule = { capacity: 1, refillPerSec: 1 };
      takeToken("nocharge", rule); // empties it
      // Hammer it while empty. If a refused call still charged, the bucket would go
      // increasingly negative and the caller would be locked out for far longer than the rule.
      for (let i = 0; i < 20; i++) assert.equal(takeToken("nocharge", rule).ok, false);
      clock.advance(1000);
      assert.equal(takeToken("nocharge", rule).ok, true, "one second still buys exactly one token");
    } finally {
      clock.done();
    }
  });
});

describe("the fixed-window boundary bug this replaced", () => {
  beforeEach(() => {
    __resetRateLimiter();
    mock.timers.reset();
  });

  /**
   * THE REGRESSION TEST. A fixed-window counter resets wholesale on a wall-clock boundary, so
   * "5 per 10 minutes" permitted 5 requests at 09:59:59 and 5 more at 10:00:00 - ten in one
   * second, i.e. ten booking slots. A bucket has no boundary to straddle: after draining, the
   * next token is only available once it has actually been earned.
   */
  test("draining then crossing the old window boundary does not grant a second full burst", () => {
    const clock = withClock(4_000_000);
    try {
      const windowMs = 600_000; // 10 minutes
      const limit = 5;

      for (let i = 0; i < limit; i++) {
        assert.equal(rateLimitOk("straddle", limit, windowMs), true);
      }
      assert.equal(rateLimitOk("straddle", limit, windowMs), false);

      // Land exactly on the boundary the old implementation reset at.
      clock.advance(windowMs);

      let granted = 0;
      for (let i = 0; i < 20; i++) if (rateLimitOk("straddle", limit, windowMs)) granted++;

      assert.equal(granted, limit, "a full window's worth, not a doubled burst");
      // And the very next one is refused, rather than the old code's 2× allowance.
      assert.equal(rateLimitOk("straddle", limit, windowMs), false);
    } finally {
      clock.done();
    }
  });

  test("rateLimitOk preserves the sustained throughput of the old signature", () => {
    const clock = withClock(5_000_000);
    try {
      // 2 per second, drained; each subsequent 500ms should buy exactly one more.
      assert.equal(rateLimitOk("sustained", 2, 1000), true);
      assert.equal(rateLimitOk("sustained", 2, 1000), true);
      assert.equal(rateLimitOk("sustained", 2, 1000), false);
      clock.advance(500);
      assert.equal(rateLimitOk("sustained", 2, 1000), true);
      assert.equal(rateLimitOk("sustained", 2, 1000), false);
    } finally {
      clock.done();
    }
  });
});

describe("multi-dimension limiting", () => {
  beforeEach(() => {
    __resetRateLimiter();
    mock.timers.reset();
  });

  test("the tightest rule decides", () => {
    const perIp = { capacity: 5, refillPerSec: 1 };
    const global = { capacity: 2, refillPerSec: 1 };
    const entries = [
      { key: "ip:1.2.3.4", rule: perIp },
      { key: "global", rule: global },
    ];
    assert.equal(takeTokens(entries).ok, true);
    assert.equal(takeTokens(entries).ok, true);
    assert.equal(takeTokens(entries).ok, false, "the global ceiling bites first");
  });

  test("a global block does not charge the per-IP bucket", () => {
    const perIp = { capacity: 5, refillPerSec: 0.001 };
    const global = { capacity: 1, refillPerSec: 1 };
    const ipKey = "ip:9.9.9.9";

    assert.equal(takeTokens([{ key: ipKey, rule: perIp }, { key: "g2", rule: global }]).ok, true);
    // Global is empty now; five refused attempts must not eat this visitor's per-IP allowance.
    for (let i = 0; i < 5; i++) {
      assert.equal(takeTokens([{ key: ipKey, rule: perIp }, { key: "g2", rule: global }]).ok, false);
    }

    // Charged exactly once, so four of five remain. Without the all-or-nothing rule the
    // visitor would have been billed six times for one successful request.
    assert.equal(takeToken(ipKey, perIp).remaining, 3);
  });

  test("a distributed flood is still stopped by the global ceiling", () => {
    // Each 'visitor' is well inside its own per-IP allowance; only the shared bucket saves us.
    let granted = 0;
    for (let i = 0; i < 200; i++) {
      const ok = takeTokens([
        { key: `book:ip:10.0.0.${i}`, rule: RATE_RULES.bookPerIp },
        { key: "book:global", rule: RATE_RULES.bookGlobal },
      ]).ok;
      if (ok) granted++;
    }
    assert.equal(granted, RATE_RULES.bookGlobal.capacity);
  });
});

describe("helpers", () => {
  test("clientIpFrom prefers the first x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1", "x-real-ip": "10.0.0.1" });
    assert.equal(clientIpFrom(h), "203.0.113.5");
  });

  test("clientIpFrom falls back to x-real-ip, then to a constant", () => {
    assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
    assert.equal(clientIpFrom(new Headers()), "unknown");
  });

  test("tooManyRequests carries a Retry-After of at least one second", () => {
    const res = tooManyRequests(42);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "42");
    // A `Retry-After: 0` invites an immediate retry, which is the opposite of the point.
    assert.equal(tooManyRequests(0).headers.get("retry-after"), "1");
  });

  test("every shipped rule is sane", () => {
    for (const [name, rule] of Object.entries(RATE_RULES)) {
      assert.ok(rule.capacity >= 1, `${name} must allow at least one request`);
      assert.ok(rule.refillPerSec > 0, `${name} must eventually refill, or it is a one-shot fuse`);
    }
  });
});
